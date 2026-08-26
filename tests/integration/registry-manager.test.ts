import { describe, expect, it, vi } from "vitest";

import { WebMcpRegistryManager } from "@/lib/webmcp/registry-manager";

function createContext() {
  const active = new Map<string, WebMCP.ModelContextTool>();
  const registerTool = vi.fn(
    async (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
      if (active.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
      active.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => active.delete(tool.name), { once: true });
    }
  );

  const context = {
    registerTool,
    getTools: vi.fn(async () => []),
    ontoolchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as unknown as WebMCP.ModelContext;

  return { active, context, registerTool };
}

const tool: WebMCP.ModelContextTool = {
  name: "cart_get",
  description: "Return cart lines.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: () => ({ ok: true })
};

describe("WebMcpRegistryManager", () => {
  it("awaits registration and releases the active tool through AbortSignal", async () => {
    const { active, context } = createContext();
    const manager = new WebMcpRegistryManager();
    const statuses: string[] = [];
    const release = manager.acquire(context, [tool], ({ phase }) => statuses.push(phase));

    await vi.waitFor(() => expect(active.has("cart_get")).toBe(true));
    expect(statuses).toEqual(["registering", "ready"]);

    release();
    await vi.waitFor(() => expect(active.size).toBe(0));
    expect(statuses.at(-1)).toBe("idle");
  });

  it("does not double-register when an initial StrictMode-style lease is released immediately", async () => {
    const { active, context, registerTool } = createContext();
    const manager = new WebMcpRegistryManager();
    const releaseFirst = manager.acquire(context, [tool], () => undefined);
    releaseFirst();

    const releaseSecond = manager.acquire(context, [tool], () => undefined);
    await vi.waitFor(() => expect(active.size).toBe(1));
    expect(registerTool).toHaveBeenCalledOnce();

    releaseSecond();
    await vi.waitFor(() => expect(active.size).toBe(0));
  });

  it("aborts and bypasses a delayed registration so a replacement lease cannot deadlock", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: (() => void) | undefined;
    const firstRegistration = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const registerTool = vi.fn(
      async (_tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
        if (registerTool.mock.calls.length === 1) {
          firstSignal = options?.signal;
          await firstRegistration;
        }
      }
    );
    const context = {
      registerTool,
      getTools: vi.fn(async () => []),
      ontoolchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as WebMCP.ModelContext;
    const manager = new WebMcpRegistryManager();
    const releaseFirst = manager.acquire(context, [tool], () => undefined);

    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledOnce());
    releaseFirst();
    expect(firstSignal?.aborted).toBe(true);

    const secondStatuses: string[] = [];
    const releaseSecond = manager.acquire(context, [tool], ({ phase }) =>
      secondStatuses.push(phase)
    );
    await vi.waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(secondStatuses.at(-1)).toBe("ready"));

    resolveFirst?.();
    releaseSecond();
  });
});
