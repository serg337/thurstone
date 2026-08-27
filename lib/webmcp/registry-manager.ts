import { canonicalJson } from "@/lib/evidence/digest";
import { canonicalInputSchema, normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";

export type RegistryPhase = "idle" | "registering" | "ready" | "error";

export interface RegistryStatus {
  readonly phase: RegistryPhase;
  /** The last catalog whose registration and discovery were both verified. */
  readonly toolNames: readonly string[];
  readonly error?: string;
  /** Present on every manager-produced status. Optional only for older UI initializers. */
  readonly generation?: number;
  /** The catalog requested by the current lease. */
  readonly desiredToolNames?: readonly string[];
  /** An explicit alias used by evidence receipts. */
  readonly verifiedManifestNames?: readonly string[];
  /** Stable fingerprints for the last verified registrations. */
  readonly fingerprints?: Readonly<Record<string, string>>;
}

export type RegistryAdmissionErrorCode = "registry_transition" | "tool_not_admitted";

export class RegistryAdmissionError extends Error {
  readonly code: RegistryAdmissionErrorCode;

  constructor(code: RegistryAdmissionErrorCode, message: string) {
    super(message);
    this.name = "RegistryAdmissionError";
    this.code = code;
  }
}

interface DesiredTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: WebMCP.ToolAnnotations;
  readonly handler: WebMCP.ModelContextTool["execute"];
  readonly contractFingerprint: string;
  readonly handlerFingerprint: string;
  readonly fingerprint: string;
}

interface ActiveRegistration extends DesiredTool {
  controller: AbortController;
  registeredTool: WebMCP.ModelContextTool;
  accepting: boolean;
  registered: boolean;
  inFlight: number;
  consumerCallsInFlight: number;
  readonly idleWaiters: Set<() => void>;
}

interface RegistryLease {
  readonly id: number;
  readonly context: WebMCP.ModelContext;
  readonly tools: readonly WebMCP.ModelContextTool[];
  readonly onStatus: StatusListener;
  released: boolean;
}

interface Transition {
  readonly leaseId: number | null;
  readonly controller: AbortController;
}

type StatusListener = (status: RegistryStatus) => void;

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const DISCOVERY_TIMEOUT_MS = 750;
const DISCOVERY_POLL_MS = 15;
const DEFAULT_QUIESCENCE_TIMEOUT_MS = 10_000;

class TransitionCanceledError extends Error {
  constructor() {
    super("Registry transition was superseded.");
    this.name = "TransitionCanceledError";
  }
}

class QuiescenceTimeoutError extends Error {
  constructor() {
    super("Registry could not reach an idle handler boundary before the bounded timeout.");
    this.name = "QuiescenceTimeoutError";
  }
}

function abortReason(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function frozenNames(names: readonly string[]): readonly string[] {
  return Object.freeze([...names]);
}

function manifestProjection(tool: {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly annotations?: WebMCP.ToolAnnotations;
}): object {
  const inputSchema = normalizeInputSchema(tool.inputSchema);
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    ...(inputSchema === null ? {} : { inputSchema }),
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint ?? false,
      untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
    }
  };
}

function descriptorMismatchDetails(
  expected: readonly WebMCP.ModelContextTool[],
  actual: readonly WebMCP.RegisteredTool[]
): readonly string[] {
  const actualByName = new Map(actual.map((tool) => [tool.name, tool]));
  const fields: string[] = [];
  for (const expectedTool of expected) {
    const actualTool = actualByName.get(expectedTool.name);
    if (!actualTool) continue;
    if (actualTool.title !== expectedTool.title) {
      fields.push(`${expectedTool.name}.title`);
    }
    if (actualTool.description !== expectedTool.description) {
      fields.push(`${expectedTool.name}.description`);
    }
    if (
      canonicalInputSchema(actualTool.inputSchema) !==
      canonicalInputSchema(expectedTool.inputSchema)
    ) {
      fields.push(`${expectedTool.name}.inputSchema`);
    }
    const expectedAnnotations = manifestProjection(expectedTool) as {
      readonly annotations: object;
    };
    const actualAnnotations = manifestProjection(actualTool) as {
      readonly annotations: object;
    };
    if (
      canonicalJson(actualAnnotations.annotations) !==
      canonicalJson(expectedAnnotations.annotations)
    ) {
      fields.push(`${expectedTool.name}.annotations`);
    }
  }
  return Object.freeze(fields);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown registry failure.";
}

function snapshotJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function freezeOwned<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freezeOwned(nested);
  }
  return value;
}

function snapshotSourceTool(source: WebMCP.ModelContextTool): WebMCP.ModelContextTool {
  const handler = source.execute;
  return Object.freeze({
    name: source.name,
    ...(source.title === undefined ? {} : { title: source.title }),
    description: source.description,
    ...(source.inputSchema === undefined
      ? {}
      : { inputSchema: freezeOwned(snapshotJson(source.inputSchema)) }),
    ...(source.annotations === undefined
      ? {}
      : { annotations: freezeOwned(snapshotJson(source.annotations)) }),
    execute: handler
  });
}

export class WebMcpRegistryManager {
  private readonly quiescenceTimeoutMs: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly leases = new Map<number, RegistryLease>();
  private readonly registrations = new Map<string, ActiveRegistration>();
  private readonly handlerIds = new WeakMap<WebMCP.ModelContextTool["execute"], number>();
  private readonly contextFingerprints = new WeakMap<WebMCP.ModelContext, Map<string, string>>();
  private nextLeaseId = 1;
  private nextHandlerId = 1;
  private reconcileVersion = 0;
  private generation = 0;
  private verifiedContext: WebMCP.ModelContext | undefined;
  private verifiedNames: readonly string[] = Object.freeze([]);
  private transition: Transition | undefined;
  private transitioning = false;

  constructor(options: { readonly quiescenceTimeoutMs?: number } = {}) {
    const timeout = options.quiescenceTimeoutMs ?? DEFAULT_QUIESCENCE_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout < 1) {
      throw new RangeError("quiescenceTimeoutMs must be a positive safe integer.");
    }
    this.quiescenceTimeoutMs = timeout;
  }

  acquire(
    context: WebMCP.ModelContext,
    tools: readonly WebMCP.ModelContextTool[],
    onStatus: StatusListener
  ): () => void {
    const lease: RegistryLease = {
      id: this.nextLeaseId++,
      context,
      tools: Object.freeze(tools.map(snapshotSourceTool)),
      onStatus,
      released: false
    };
    this.leases.set(lease.id, lease);

    // A newly acquired lease supersedes an in-progress release or catalog change.
    this.transition?.controller.abort(abortReason("Registry lease was superseded."));
    this.enqueue();

    return () => {
      if (lease.released) return;
      lease.released = true;
      this.leases.delete(lease.id);
      if (this.transition?.leaseId === lease.id) {
        this.transition.controller.abort(abortReason("Registry lease was released."));
      }
      this.enqueue(lease);
    };
  }

  /** Useful to deterministic harnesses; it never changes registry state. */
  async settled(): Promise<void> {
    await this.queue;
  }

  /**
   * Keeps registration signals stable until an outer native consumer call has settled.
   * Handler quiescence alone is insufficient because the browser may still be delivering the
   * handler result when a state-driven catalog transition begins.
   */
  holdConsumerCall(toolName: string, generation: number): () => void {
    const registration = this.registrations.get(toolName);
    if (
      this.transitioning ||
      generation !== this.generation ||
      !registration?.accepting ||
      !registration.registered
    ) {
      throw new RegistryAdmissionError(
        "registry_transition",
        `${toolName} consumer execution is not admitted for the requested registry generation.`
      );
    }

    registration.consumerCallsInFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      registration.consumerCallsInFlight -= 1;
      this.notifyIfIdle(registration);
    };
  }

  private enqueue(releasedLease?: RegistryLease): void {
    const version = ++this.reconcileVersion;
    this.queue = this.queue
      .then(async () => {
        if (version !== this.reconcileVersion) return;
        await this.reconcile(releasedLease);
      })
      .catch((error: unknown) => {
        if (version !== this.reconcileVersion) return;
        const current = this.latestLease();
        if (current) {
          this.notify(
            current,
            this.status(
              "error",
              current.tools.map(({ name }) => name),
              errorMessage(error)
            )
          );
        }
      });
  }

  private latestLease(): RegistryLease | undefined {
    let latest: RegistryLease | undefined;
    for (const lease of this.leases.values()) {
      if (!lease.released && (!latest || lease.id > latest.id)) latest = lease;
    }
    return latest;
  }

  private async reconcile(releasedLease?: RegistryLease): Promise<void> {
    const lease = this.latestLease();
    if (!lease) {
      if (this.registrations.size > 0 && this.verifiedContext) {
        await this.transitionCatalog(undefined, [], releasedLease);
      } else if (releasedLease) {
        this.notify(releasedLease, this.status("idle", []));
      }
      return;
    }

    let desired: readonly DesiredTool[];
    try {
      desired = this.prepareDesired(lease.context, lease.tools);
      this.assertContextCompatible(lease.context);
      this.assertNoReplacement(desired);
    } catch (error) {
      this.notify(
        lease,
        this.status(
          "error",
          lease.tools.map(({ name }) => name),
          errorMessage(error)
        )
      );
      return;
    }

    const desiredNames = desired.map(({ name }) => name);
    if (this.catalogIsUnchanged(lease.context, desired)) {
      this.notify(lease, this.status("ready", desiredNames));
      return;
    }

    await this.transitionCatalog(lease, desired);
  }

  private prepareDesired(
    context: WebMCP.ModelContext,
    tools: readonly WebMCP.ModelContextTool[]
  ): readonly DesiredTool[] {
    const names = new Set<string>();
    const history = this.contextFingerprints.get(context);

    return Object.freeze(
      tools.map((source) => {
        if (!TOOL_NAME_PATTERN.test(source.name)) {
          throw new Error(`Invalid WebMCP tool name: ${source.name || "<empty>"}.`);
        }
        if (names.has(source.name)) {
          throw new Error(`Duplicate WebMCP tool name in desired catalog: ${source.name}.`);
        }
        names.add(source.name);
        if (typeof source.execute !== "function") {
          throw new Error(`WebMCP tool ${source.name} has no executable handler.`);
        }

        const handler = source.execute;
        const manifest = Object.freeze({
          name: source.name,
          ...(source.title === undefined ? {} : { title: source.title }),
          description: source.description,
          ...(source.inputSchema === undefined
            ? {}
            : { inputSchema: freezeOwned(snapshotJson(source.inputSchema)) }),
          ...(source.annotations === undefined
            ? {}
            : { annotations: freezeOwned(snapshotJson(source.annotations)) })
        });
        const contractFingerprint = canonicalJson(manifestProjection(manifest));
        let handlerId = this.handlerIds.get(handler);
        if (handlerId === undefined) {
          handlerId = this.nextHandlerId++;
          this.handlerIds.set(handler, handlerId);
        }
        const handlerFingerprint = `handler-${handlerId}`;
        const fingerprint = `${contractFingerprint}\u0000${handlerFingerprint}`;
        const prior = history?.get(source.name);
        if (prior !== undefined && prior !== fingerprint) {
          throw new Error(
            `P0 forbids replacing ${source.name} with a different schema, metadata, or handler fingerprint in the same document.`
          );
        }

        return Object.freeze({
          ...manifest,
          handler,
          contractFingerprint,
          handlerFingerprint,
          fingerprint
        });
      })
    );
  }

  private assertContextCompatible(context: WebMCP.ModelContext): void {
    if (this.registrations.size > 0 && this.verifiedContext !== context) {
      throw new Error(
        "P0 forbids replacing the active ModelContext within the same registry lease."
      );
    }
  }

  private assertNoReplacement(desired: readonly DesiredTool[]): void {
    for (const entry of desired) {
      const active = this.registrations.get(entry.name);
      if (active && active.fingerprint !== entry.fingerprint) {
        throw new Error(
          `P0 forbids replacing ${entry.name} with a different schema, metadata, or handler fingerprint in the same document.`
        );
      }
    }
  }

  private catalogIsUnchanged(
    context: WebMCP.ModelContext,
    desired: readonly DesiredTool[]
  ): boolean {
    if (this.verifiedContext !== context || desired.length !== this.registrations.size)
      return false;
    return desired.every((entry) => {
      const active = this.registrations.get(entry.name);
      return active?.fingerprint === entry.fingerprint && active.registered && active.accepting;
    });
  }

  private async transitionCatalog(
    lease: RegistryLease | undefined,
    desired: readonly DesiredTool[],
    releasedLease?: RegistryLease
  ): Promise<void> {
    const context = lease?.context ?? this.verifiedContext;
    if (!context) return;

    const desiredNames = desired.map(({ name }) => name);
    const transition: Transition = {
      leaseId: lease?.id ?? null,
      controller: new AbortController()
    };
    this.transition = transition;
    this.transitioning = true;

    if (lease) this.notify(lease, this.status("registering", desiredNames));

    const snapshot = new Map(this.registrations);
    const staged: ActiveRegistration[] = [];
    const removed = [...snapshot.values()].filter(
      ({ name }) => !desired.some((entry) => entry.name === name)
    );
    let nativeRemovalStarted = false;

    try {
      // Catalog mutation is a quiescent-point operation. Admission is already frozen by
      // `transitioning`; let every call admitted by the last verified generation finish before
      // registerTool() or registration-signal abort can change native discovery.
      await this.raceTransitionAbort(
        this.withTimeout(
          Promise.all(
            [...snapshot.values()].map((registration) => this.waitUntilIdle(registration))
          ).then(() => undefined),
          this.quiescenceTimeoutMs,
          "Registry quiescence timed out."
        ).catch((error: unknown) => {
          if (error instanceof TransitionCanceledError) throw error;
          throw new QuiescenceTimeoutError();
        }),
        transition.controller.signal
      );
      this.assertTransitionCurrent(transition);

      for (const entry of desired) {
        if (!snapshot.has(entry.name)) {
          staged.push(this.createRegistration(entry, transition.controller.signal));
        }
      }

      await this.registerAll(context, staged, transition.controller.signal);
      this.assertTransitionCurrent(transition);

      for (const registration of removed) registration.accepting = false;
      this.assertTransitionCurrent(transition);

      nativeRemovalStarted = removed.length > 0;
      for (const registration of removed) {
        registration.controller.abort(abortReason("Tool left the desired catalog."));
        registration.registered = false;
      }

      const next = new Map<string, ActiveRegistration>();
      for (const entry of desired) {
        const registration =
          snapshot.get(entry.name) ?? staged.find(({ name }) => name === entry.name);
        if (!registration) throw new Error(`Missing staged registration for ${entry.name}.`);
        next.set(entry.name, registration);
      }

      await this.verifyDiscovery(
        context,
        [...next.values()].map(({ registeredTool }) => registeredTool),
        transition.controller.signal
      );
      this.assertTransitionCurrent(transition);

      this.registrations.clear();
      for (const [name, registration] of next) {
        registration.accepting = true;
        registration.registered = true;
        this.registrations.set(name, registration);
      }
      this.verifiedContext = desired.length > 0 ? context : undefined;
      this.verifiedNames = frozenNames(desiredNames);
      this.generation += 1;
      this.rememberFingerprints(context, desired);
      this.finishTransition(transition);

      if (lease) {
        this.notify(lease, this.status("ready", desiredNames));
      } else if (releasedLease) {
        this.notify(releasedLease, this.status("idle", []));
      }
    } catch (error) {
      const canceled = error instanceof TransitionCanceledError;
      if (!lease) {
        if (canceled && this.latestLease()) return;
        if (error instanceof QuiescenceTimeoutError) {
          this.quarantineInFlight(snapshot);
          this.finishTransition(transition);
          if (releasedLease) {
            this.notify(releasedLease, this.status("error", [], errorMessage(error)));
          }
          return;
        }
        let cleanupError: unknown;
        try {
          await this.failClosed(context, snapshot, staged);
        } catch (failure) {
          cleanupError = failure;
        }
        this.finishTransition(transition);
        if (releasedLease) {
          const detail = cleanupError
            ? `${errorMessage(error)} Cleanup failed closed: ${errorMessage(cleanupError)}`
            : errorMessage(error);
          this.notify(releasedLease, this.status("error", [], detail));
        }
        return;
      }

      let rollbackError: unknown;
      try {
        await this.rollback(context, snapshot, staged, removed, nativeRemovalStarted);
      } catch (failure) {
        rollbackError = failure;
        await this.failClosed(context, snapshot, staged);
      }

      this.finishTransition(transition);
      if (!canceled && lease && this.latestLease()?.id === lease.id) {
        const combined = rollbackError
          ? `${errorMessage(error)} Rollback failed closed: ${errorMessage(rollbackError)}`
          : errorMessage(error);
        this.notify(lease, this.status("error", desiredNames, combined));
      }
    } finally {
      this.finishTransition(transition);
    }
  }

  private finishTransition(transition: Transition): void {
    if (this.transition === transition) this.transition = undefined;
    this.transitioning = false;
  }

  private createRegistration(
    desired: DesiredTool,
    transitionSignal: AbortSignal
  ): ActiveRegistration {
    const registration = {
      ...desired,
      controller: new AbortController(),
      registeredTool: undefined as unknown as WebMCP.ModelContextTool,
      accepting: false,
      registered: false,
      inFlight: 0,
      consumerCallsInFlight: 0,
      idleWaiters: new Set<() => void>()
    };

    const registeredTool: WebMCP.ModelContextTool = Object.freeze({
      name: desired.name,
      ...(desired.title === undefined ? {} : { title: desired.title }),
      description: desired.description,
      ...(desired.inputSchema === undefined ? {} : { inputSchema: desired.inputSchema }),
      ...(desired.annotations === undefined ? {} : { annotations: desired.annotations }),
      execute: async (
        input: Record<string, unknown>,
        options?: WebMCP.ToolExecuteCallbackOptions
      ) => this.executeRegistered(registration, input, options)
    });
    registration.registeredTool = registeredTool;

    transitionSignal.addEventListener(
      "abort",
      () => registration.controller.abort(transitionSignal.reason),
      { once: true }
    );
    if (transitionSignal.aborted) registration.controller.abort(transitionSignal.reason);
    return registration;
  }

  private async executeRegistered(
    registration: ActiveRegistration,
    input: Record<string, unknown>,
    options?: WebMCP.ToolExecuteCallbackOptions
  ): Promise<unknown> {
    if (this.transitioning) {
      throw new RegistryAdmissionError(
        "registry_transition",
        "Tool execution is temporarily blocked while the verified catalog changes."
      );
    }
    if (!registration.accepting || !registration.registered) {
      throw new RegistryAdmissionError(
        "tool_not_admitted",
        `${registration.name} is not admitted in the verified catalog.`
      );
    }

    registration.inFlight += 1;
    try {
      if (options === undefined) {
        return await Reflect.apply(registration.handler, undefined, [input]);
      }
      return await Reflect.apply(registration.handler, undefined, [input, options]);
    } finally {
      registration.inFlight -= 1;
      this.notifyIfIdle(registration);
    }
  }

  private waitUntilIdle(registration: ActiveRegistration): Promise<void> {
    if (registration.inFlight === 0 && registration.consumerCallsInFlight === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => registration.idleWaiters.add(resolve));
  }

  private notifyIfIdle(registration: ActiveRegistration): void {
    if (registration.inFlight !== 0 || registration.consumerCallsInFlight !== 0) return;
    for (const resolve of registration.idleWaiters) resolve();
    registration.idleWaiters.clear();
  }

  private async registerAll(
    context: WebMCP.ModelContext,
    registrations: readonly ActiveRegistration[],
    signal?: AbortSignal
  ): Promise<void> {
    if (registrations.length === 0) return;
    const promises = registrations.map(async (registration) => {
      await context.registerTool(registration.registeredTool, {
        signal: registration.controller.signal
      });
      registration.registered = true;
    });
    const allSettled = Promise.allSettled(promises);
    const outcomes = signal ? await this.raceTransitionAbort(allSettled, signal) : await allSettled;
    const failures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    );
    if (failures.length > 0) {
      throw new Error(
        `WebMCP registration failed: ${failures.map(({ reason }) => errorMessage(reason)).join("; ")}`
      );
    }
  }

  private raceTransitionAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new TransitionCanceledError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new TransitionCanceledError());
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  private assertTransitionCurrent(transition: Transition): void {
    const latest = this.latestLease();
    const currentLeaseId = latest?.id ?? null;
    if (transition.controller.signal.aborted || currentLeaseId !== transition.leaseId) {
      throw new TransitionCanceledError();
    }
  }

  private async rollback(
    context: WebMCP.ModelContext,
    snapshot: ReadonlyMap<string, ActiveRegistration>,
    staged: readonly ActiveRegistration[],
    removed: readonly ActiveRegistration[],
    nativeRemovalStarted: boolean
  ): Promise<void> {
    for (const registration of staged) {
      registration.accepting = false;
      await this.waitUntilIdle(registration);
      registration.controller.abort(abortReason("Unverified registration was rolled back."));
      registration.registered = false;
    }

    if (nativeRemovalStarted) {
      for (const registration of removed) {
        registration.controller = new AbortController();
        registration.registered = false;
      }
      await this.registerAll(context, removed);
    }

    await this.verifyDiscovery(
      context,
      [...snapshot.values()].map(({ registeredTool }) => registeredTool)
    );
    this.registrations.clear();
    for (const [name, registration] of snapshot) {
      registration.accepting = true;
      registration.registered = true;
      this.registrations.set(name, registration);
    }
  }

  private async failClosed(
    context: WebMCP.ModelContext,
    snapshot: ReadonlyMap<string, ActiveRegistration>,
    staged: readonly ActiveRegistration[]
  ): Promise<void> {
    const all = new Set([...snapshot.values(), ...staged]);
    for (const registration of all) {
      registration.accepting = false;
      await this.waitUntilIdle(registration);
      registration.controller.abort(abortReason("Registry rollback failed closed."));
      registration.registered = false;
    }
    this.registrations.clear();
    this.verifiedContext = undefined;
    this.verifiedNames = Object.freeze([]);
    try {
      await this.verifyDiscovery(context, []);
    } catch {
      // The manager remains non-admitting and never reports readiness for a mixed provider state.
    }
  }

  private quarantineInFlight(snapshot: ReadonlyMap<string, ActiveRegistration>): void {
    this.registrations.clear();
    this.verifiedContext = undefined;
    this.verifiedNames = Object.freeze([]);
    for (const registration of snapshot.values()) {
      registration.accepting = false;
      void this.waitUntilIdle(registration).then(() => {
        registration.controller.abort(abortReason("Quarantined registration became idle."));
        registration.registered = false;
      });
    }
  }

  private async verifyDiscovery(
    context: WebMCP.ModelContext,
    expected: readonly WebMCP.ModelContextTool[],
    signal?: AbortSignal
  ): Promise<void> {
    const compatibility = context as WebMCP.ModelContext & {
      getTools?: WebMCP.ModelContext["getTools"];
    };
    if (typeof compatibility.getTools !== "function") return;

    const expectedNames = new Set(expected.map(({ name }) => name));
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
    let lastNames: readonly string[] = Object.freeze([]);
    let lastDescriptorMismatches: readonly string[] = Object.freeze([]);
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new TransitionCanceledError();
      try {
        const remaining = Math.max(1, deadline - Date.now());
        const discovered = await this.withTimeout(
          Promise.resolve(compatibility.getTools.call(context)),
          remaining,
          "WebMCP getTools() timed out."
        );
        lastError = undefined;
        lastNames = frozenNames(discovered.map(({ name }) => name));
        lastDescriptorMismatches = descriptorMismatchDetails(expected, discovered);
        if (
          new Set(lastNames).size === lastNames.length &&
          lastNames.length === expectedNames.size &&
          lastNames.every((name) => expectedNames.has(name)) &&
          lastDescriptorMismatches.length === 0
        ) {
          return;
        }
      } catch (error) {
        if (error instanceof TransitionCanceledError) throw error;
        lastError = error;
      }

      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await this.waitForToolChange(context, Math.min(DISCOVERY_POLL_MS, remaining), signal);
      }
    }

    const detail = lastError
      ? ` Last discovery error: ${errorMessage(lastError)}`
      : ` Last discovered names: ${lastNames.join(", ") || "<none>"}.${
          lastDescriptorMismatches.length > 0
            ? ` Descriptor mismatches: ${lastDescriptorMismatches.join(", ")}.`
            : ""
        }`;
    throw new Error(
      `WebMCP discovery did not converge to the exact desired catalog within ${DISCOVERY_TIMEOUT_MS}ms.${detail}`
    );
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      void promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private waitForToolChange(
    context: WebMCP.ModelContext,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return Promise.reject(new TransitionCanceledError());
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        context.removeEventListener("toolchange", onChange);
        signal?.removeEventListener("abort", onAbort);
      };
      const onChange = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new TransitionCanceledError());
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      context.addEventListener("toolchange", onChange, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private rememberFingerprints(
    context: WebMCP.ModelContext,
    desired: readonly DesiredTool[]
  ): void {
    let history = this.contextFingerprints.get(context);
    if (!history) {
      history = new Map<string, string>();
      this.contextFingerprints.set(context, history);
    }
    for (const entry of desired) history.set(entry.name, entry.fingerprint);
  }

  private status(
    phase: RegistryPhase,
    desiredNames: readonly string[],
    error?: string
  ): RegistryStatus {
    const fingerprints = Object.freeze(
      Object.fromEntries(
        [...this.registrations].map(([name, registration]) => [name, registration.fingerprint])
      )
    );
    return Object.freeze({
      phase,
      toolNames: this.verifiedNames,
      generation: this.generation,
      desiredToolNames: frozenNames(desiredNames),
      verifiedManifestNames: this.verifiedNames,
      fingerprints,
      ...(error === undefined ? {} : { error })
    });
  }

  private notify(lease: RegistryLease, status: RegistryStatus): void {
    try {
      lease.onStatus(status);
    } catch {
      // A UI observer cannot alter provider registration or admission state.
    }
  }
}

export const webMcpRegistryManager = new WebMcpRegistryManager();
