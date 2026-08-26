export type RegistryPhase = "idle" | "registering" | "ready" | "error";

export interface RegistryStatus {
  readonly phase: RegistryPhase;
  readonly toolNames: readonly string[];
  readonly error?: string;
}

interface ActiveLease {
  readonly id: number;
  readonly controllers: readonly AbortController[];
  readonly toolNames: readonly string[];
}

type StatusListener = (status: RegistryStatus) => void;

export class WebMcpRegistryManager {
  private queue: Promise<void> = Promise.resolve();
  private active: ActiveLease | undefined;
  private nextLeaseId = 1;

  acquire(
    context: WebMCP.ModelContext,
    tools: readonly WebMCP.ModelContextTool[],
    onStatus: StatusListener
  ): () => void {
    const leaseId = this.nextLeaseId++;
    const controllers = tools.map(() => new AbortController());
    let released = false;
    let resolveReleased: () => void = () => undefined;
    const releasedPromise = new Promise<void>((resolve) => {
      resolveReleased = resolve;
    });

    this.queue = this.queue.then(async () => {
      if (released) return;

      this.clearActive();
      onStatus({ phase: "registering", toolNames: tools.map(({ name }) => name) });

      try {
        const registrationPromise = Promise.all(
          tools.map((tool, index) => {
            const controller = controllers[index];
            if (!controller) throw new Error("Registration controller was not created.");
            return context.registerTool(tool, { signal: controller.signal });
          })
        );
        const outcome = await Promise.race([
          registrationPromise.then(
            () => ({ kind: "registered" as const }),
            (error: unknown) => ({ kind: "error" as const, error })
          ),
          releasedPromise.then(() => ({ kind: "released" as const }))
        ]);

        if (outcome.kind === "released") return;
        if (outcome.kind === "error") throw outcome.error;

        if (released) {
          controllers.forEach((controller) => controller.abort("Registration lease released."));
          return;
        }

        this.active = {
          id: leaseId,
          controllers,
          toolNames: tools.map(({ name }) => name)
        };
        onStatus({ phase: "ready", toolNames: this.active.toolNames });
      } catch (error) {
        controllers.forEach((controller) => controller.abort("Registration failed."));
        if (released) return;
        onStatus({
          phase: "error",
          toolNames: tools.map(({ name }) => name),
          error: error instanceof Error ? error.message : "Unknown registration failure."
        });
      }
    });

    return () => {
      if (released) return;
      released = true;
      controllers.forEach((controller) => controller.abort("Registration lease released."));
      resolveReleased();
      this.queue = this.queue.then(() => {
        if (this.active?.id === leaseId) {
          this.clearActive();
          onStatus({ phase: "idle", toolNames: [] });
        }
      });
    };
  }

  private clearActive(): void {
    this.active?.controllers.forEach((controller) =>
      controller.abort("Tool registration was replaced or released.")
    );
    this.active = undefined;
  }
}

export const webMcpRegistryManager = new WebMcpRegistryManager();
