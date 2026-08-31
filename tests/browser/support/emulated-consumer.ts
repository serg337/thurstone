import type { Page } from "@playwright/test";

export async function installEmulatedConsumer(
  page: Page,
  mode: "object" | "json-string" = "json-string"
): Promise<void> {
  await page.addInitScript(
    ({ mode }) => {
      class EmulatedModelContext extends EventTarget {
        readonly active = new Map<
          string,
          { readonly tool: WebMCP.ModelContextTool; readonly signal?: AbortSignal }
        >();
        ontoolchange: ((this: WebMCP.ModelContext, event: Event) => unknown) | null = null;

        async registerTool(
          tool: WebMCP.ModelContextTool,
          options?: WebMCP.ModelContextRegisterToolOptions
        ): Promise<void> {
          if (this.active.has(tool.name)) throw new Error(`Duplicate emulated tool: ${tool.name}`);
          this.active.set(tool.name, {
            tool,
            ...(options?.signal ? { signal: options.signal } : {})
          });
          options?.signal?.addEventListener(
            "abort",
            () => {
              if (this.active.get(tool.name)?.signal === options.signal) {
                this.active.delete(tool.name);
                this.dispatchEvent(new Event("toolchange"));
              }
            },
            { once: true }
          );
          this.dispatchEvent(new Event("toolchange"));
        }

        async getTools(): Promise<WebMCP.RegisteredTool[]> {
          return [...this.active.values()].map(({ tool }) => ({
            name: tool.name,
            title: tool.title ?? tool.name,
            description: tool.description,
            ...(tool.inputSchema
              ? {
                  inputSchema:
                    mode === "json-string"
                      ? (JSON.stringify(tool.inputSchema) as unknown as object)
                      : structuredClone(tool.inputSchema)
                }
              : {}),
            window,
            origin: window.location.origin,
            ...(tool.annotations ? { annotations: structuredClone(tool.annotations) } : {})
          }));
        }

        async executeTool(
          selected: WebMCP.RegisteredTool,
          input: object | string,
          options?: { readonly signal?: AbortSignal }
        ): Promise<string | null> {
          const registration = this.active.get(selected.name);
          if (!registration) throw new Error(`Emulated tool is not active: ${selected.name}`);
          const semanticInput =
            mode === "json-string"
              ? (JSON.parse(String(input)) as Record<string, unknown>)
              : (input as Record<string, unknown>);
          const result = await Reflect.apply(
            registration.tool.execute,
            registration.tool,
            options?.signal ? [semanticInput, { signal: options.signal }] : [semanticInput]
          );
          await new Promise((resolve) => setTimeout(resolve, 15));
          if (registration.signal?.aborted) {
            throw new Error("The selected registration retired before consumer result delivery.");
          }
          return JSON.stringify(result);
        }
      }

      Object.defineProperty(document, "modelContext", {
        value: new EmulatedModelContext(),
        configurable: false,
        enumerable: false,
        writable: false
      });
    },
    { mode }
  );
}
