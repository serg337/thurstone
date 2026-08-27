import { describe, expect, it, vi } from "vitest";

import { WebMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

interface NativeRegistration {
  readonly tool: WebMCP.ModelContextTool;
  readonly signal: AbortSignal;
}

interface ContextHarnessOptions {
  readonly beforeRegister?: (
    name: string,
    callNumber: number,
    signal: AbortSignal
  ) => void | Promise<void>;
  readonly failRegistration?: (name: string, callNumber: number) => boolean;
  readonly discover?: (
    registrations: ReadonlyMap<string, NativeRegistration>,
    callNumber: number
  ) => readonly WebMCP.RegisteredTool[] | Promise<readonly WebMCP.RegisteredTool[]>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function registeredTool(tool: WebMCP.ModelContextTool): WebMCP.RegisteredTool {
  return {
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description,
    ...(tool.inputSchema === undefined ? {} : { inputSchema: structuredClone(tool.inputSchema) }),
    window,
    origin: window.location.origin,
    ...(tool.annotations === undefined ? {} : { annotations: structuredClone(tool.annotations) })
  };
}

function createContext(options: ContextHarnessOptions = {}) {
  const active = new Map<string, NativeRegistration>();
  const registrationCalls: Array<{
    readonly name: string;
    readonly tool: WebMCP.ModelContextTool;
    readonly signal: AbortSignal;
  }> = [];
  const abortedNames: string[] = [];
  const listeners = new Set<EventListenerOrEventListenerObject>();
  let discoveryCalls = 0;

  function emitToolChange() {
    const event = new Event("toolchange");
    for (const listener of [...listeners]) {
      if (typeof listener === "function") listener.call(context, event);
      else listener.handleEvent(event);
    }
  }

  const registerTool = vi.fn(
    async (
      tool: WebMCP.ModelContextTool,
      registerOptions?: WebMCP.ModelContextRegisterToolOptions
    ) => {
      const signal = registerOptions?.signal;
      if (!signal) throw new Error("The manager must register every tool with an AbortSignal.");
      const callNumber = registrationCalls.length + 1;
      registrationCalls.push({ name: tool.name, tool, signal });
      await options.beforeRegister?.(tool.name, callNumber, signal);
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (options.failRegistration?.(tool.name, callNumber)) {
        throw new Error(`Synthetic registration failure for ${tool.name}.`);
      }
      if (active.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}.`);

      active.set(tool.name, { tool, signal });
      signal.addEventListener(
        "abort",
        () => {
          if (active.get(tool.name)?.signal === signal) {
            active.delete(tool.name);
            abortedNames.push(tool.name);
            emitToolChange();
          }
        },
        { once: true }
      );
      emitToolChange();
    }
  );

  const getTools = vi.fn(async () => {
    discoveryCalls += 1;
    const discovered = options.discover
      ? await options.discover(active, discoveryCalls)
      : [...active.values()].map(({ tool }) => registeredTool(tool));
    return [...discovered];
  });

  const context = {
    registerTool,
    getTools,
    ontoolchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(() => true)
  } as unknown as WebMCP.ModelContext;

  return {
    active,
    abortedNames,
    context,
    getTools,
    registrationCalls,
    registerTool,
    emitToolChange
  };
}

function createTool(
  name: string,
  execute: WebMCP.ModelContextTool["execute"] = async () => ({ ok: true, name })
): WebMCP.ModelContextTool {
  return {
    name,
    title: `Tool ${name}`,
    description: `Execute ${name}.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: name === "cart_get" || name === "order_review" },
    execute
  };
}

function callsFor(calls: readonly { readonly name: string }[], name: string): number {
  return calls.filter((call) => call.name === name).length;
}

const CART_GET = "cart_get";
const CART_UPDATE = "cart_update";
const CHECKOUT_CANCEL = "checkout_cancel";
const CHECKOUT_REQUEST = "checkout_request";
const ORDER_REVIEW = "order_review";

function createCatalog() {
  const cartGet = createTool(CART_GET);
  const cartUpdate = createTool(CART_UPDATE);
  const checkoutCancel = createTool(CHECKOUT_CANCEL);
  const checkoutRequest = createTool(CHECKOUT_REQUEST);
  const orderReview = createTool(ORDER_REVIEW);
  const initial = [cartGet, cartUpdate, checkoutRequest, orderReview] as const;
  const pending = [cartGet, cartUpdate, checkoutCancel, checkoutRequest, orderReview] as const;
  return { initial, pending, checkoutCancel };
}

describe("WebMcpRegistryManager", () => {
  it("awaits every registration and exact discovery before reporting a generated ready catalog", async () => {
    const orderReviewGate = deferred<void>();
    const harness = createContext({
      beforeRegister: async (name) => {
        if (name === ORDER_REVIEW) await orderReviewGate.promise;
      }
    });
    const { initial } = createCatalog();
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    let executionFromReadyListener: WebMCP.MaybePromise<unknown> | undefined;
    const release = manager.acquire(harness.context, initial, (status) => {
      statuses.push(status);
      if (status.phase === "ready") {
        executionFromReadyListener = harness.active
          .get(CART_GET)
          ?.tool.execute({}, { signal: new AbortController().signal });
      }
    });

    await vi.waitFor(() => expect(harness.registerTool).toHaveBeenCalledTimes(4));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      phase: "registering",
      toolNames: [],
      desiredToolNames: initial.map(({ name }) => name),
      verifiedManifestNames: [],
      generation: 0
    });

    orderReviewGate.resolve();
    await manager.settled();
    expect(statuses.at(-1)).toMatchObject({
      phase: "ready",
      toolNames: initial.map(({ name }) => name),
      verifiedManifestNames: initial.map(({ name }) => name),
      generation: 1
    });
    expect(Object.keys(statuses.at(-1)?.fingerprints ?? {})).toEqual(
      initial.map(({ name }) => name)
    );
    await expect(Promise.resolve(executionFromReadyListener)).resolves.toEqual({
      ok: true,
      name: CART_GET
    });
    expect(harness.getTools).toHaveBeenCalled();

    release();
    await manager.settled();
    expect(statuses.at(-1)).toMatchObject({ phase: "idle", toolNames: [], generation: 2 });
    expect(harness.active.size).toBe(0);
  });

  it("preserves the four unchanged registrations while pending adds and removes only checkout_cancel", async () => {
    const harness = createContext();
    const { initial, pending } = createCatalog();
    const manager = new WebMcpRegistryManager();
    const initialStatuses: RegistryStatus[] = [];
    const releaseInitial = manager.acquire(harness.context, initial, (status) =>
      initialStatuses.push(status)
    );
    await manager.settled();
    const initialSignals = new Map(
      initial.map(({ name }) => [name, harness.active.get(name)?.signal] as const)
    );

    releaseInitial();
    const pendingStatuses: RegistryStatus[] = [];
    const releasePending = manager.acquire(harness.context, pending, (status) =>
      pendingStatuses.push(status)
    );
    await manager.settled();

    expect(pendingStatuses.at(-1)).toMatchObject({
      phase: "ready",
      generation: 2,
      verifiedManifestNames: pending.map(({ name }) => name)
    });
    for (const { name } of initial) {
      expect(callsFor(harness.registrationCalls, name)).toBe(1);
      expect(harness.active.get(name)?.signal).toBe(initialSignals.get(name));
    }
    expect(callsFor(harness.registrationCalls, CHECKOUT_CANCEL)).toBe(1);
    expect(harness.abortedNames).toEqual([]);

    releasePending();
    const finalStatuses: RegistryStatus[] = [];
    const releaseFinal = manager.acquire(harness.context, initial, (status) =>
      finalStatuses.push(status)
    );
    await manager.settled();

    expect(finalStatuses.at(-1)).toMatchObject({
      phase: "ready",
      generation: 3,
      verifiedManifestNames: initial.map(({ name }) => name)
    });
    expect(harness.abortedNames).toEqual([CHECKOUT_CANCEL]);
    for (const { name } of initial) {
      expect(callsFor(harness.registrationCalls, name)).toBe(1);
      expect(harness.active.get(name)?.signal).toBe(initialSignals.get(name));
    }

    releaseFinal();
    await manager.settled();
  });

  it("reaches a quiescent point before adding a tool while an unchanged handler is in flight", async () => {
    const handlerStarted = deferred<void>();
    const handlerFinish = deferred<void>();
    let executionSignal: AbortSignal | undefined;
    const cartGet = createTool(CART_GET, async (_input, options) => {
      executionSignal = options.signal;
      handlerStarted.resolve();
      await handlerFinish.promise;
      return { ok: true };
    });
    const checkoutCancel = createTool(CHECKOUT_CANCEL);
    const initial = [cartGet] as const;
    const pending = [cartGet, checkoutCancel] as const;
    const harness = createContext();
    const manager = new WebMcpRegistryManager();
    const releaseInitial = manager.acquire(harness.context, initial, () => undefined);
    await manager.settled();

    const executionController = new AbortController();
    const execution = harness.active
      .get(CART_GET)
      ?.tool.execute({}, { signal: executionController.signal });
    expect(execution).toBeDefined();
    await handlerStarted.promise;

    releaseInitial();
    const statuses: RegistryStatus[] = [];
    const releasePending = manager.acquire(harness.context, pending, (status) =>
      statuses.push(status)
    );
    await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe("registering"));

    expect(callsFor(harness.registrationCalls, CHECKOUT_CANCEL)).toBe(0);
    expect(harness.active.has(CHECKOUT_CANCEL)).toBe(false);
    expect(executionSignal?.aborted).toBe(false);

    handlerFinish.resolve();
    await expect(execution).resolves.toEqual({ ok: true });
    await manager.settled();
    expect(callsFor(harness.registrationCalls, CHECKOUT_CANCEL)).toBe(1);
    expect(harness.active.has(CHECKOUT_CANCEL)).toBe(true);
    expect(statuses.at(-1)?.phase).toBe("ready");
    expect(executionController.signal.aborted).toBe(false);

    releasePending();
    await manager.settled();
  });

  it("blocks new wrapper admission during transition and waits for an in-flight handler before unregistering", async () => {
    const handlerStarted = deferred<void>();
    const handlerFinish = deferred<void>();
    let observedExecutionSignal: AbortSignal | undefined;
    const checkoutCancel = createTool(CHECKOUT_CANCEL, async (_input, options) => {
      observedExecutionSignal = options.signal;
      handlerStarted.resolve();
      await handlerFinish.promise;
      return { ok: true };
    });
    const cartGet = createTool(CART_GET);
    const initial = [cartGet] as const;
    const pending = [cartGet, checkoutCancel] as const;
    const harness = createContext();
    const manager = new WebMcpRegistryManager();
    const releasePending = manager.acquire(harness.context, pending, () => undefined);
    await manager.settled();

    const consumerController = new AbortController();
    const execution = harness.active
      .get(CHECKOUT_CANCEL)
      ?.tool.execute({}, { signal: consumerController.signal });
    expect(execution).toBeDefined();
    await handlerStarted.promise;

    releasePending();
    const transitionStatuses: RegistryStatus[] = [];
    const releaseInitial = manager.acquire(harness.context, initial, (status) =>
      transitionStatuses.push(status)
    );
    await vi.waitFor(() => expect(transitionStatuses.at(-1)?.phase).toBe("registering"));

    expect(harness.active.has(CHECKOUT_CANCEL)).toBe(true);
    expect(observedExecutionSignal?.aborted).toBe(false);
    await expect(
      harness.active.get(CART_GET)?.tool.execute({}, { signal: new AbortController().signal })
    ).rejects.toMatchObject({
      name: "RegistryAdmissionError",
      code: "registry_transition"
    });

    handlerFinish.resolve();
    await expect(execution).resolves.toEqual({ ok: true });
    await manager.settled();
    expect(observedExecutionSignal?.aborted).toBe(false);
    expect(consumerController.signal.aborted).toBe(false);
    expect(harness.active.has(CHECKOUT_CANCEL)).toBe(false);
    expect(transitionStatuses.at(-1)?.phase).toBe("ready");

    releaseInitial();
    await manager.settled();
  });

  it("rolls back every staged registration after a partial failure and never reports mixed readiness", async () => {
    const harness = createContext({
      beforeRegister: async (name) => {
        if (name === "failing_extra") await new Promise((resolve) => setTimeout(resolve, 20));
      },
      failRegistration: (name) => name === "failing_extra"
    });
    const { initial, pending } = createCatalog();
    const extra = createTool("failing_extra");
    const manager = new WebMcpRegistryManager();
    const releaseInitial = manager.acquire(harness.context, initial, () => undefined);
    await manager.settled();

    releaseInitial();
    const statuses: RegistryStatus[] = [];
    const releaseFailing = manager.acquire(harness.context, [...pending, extra], (status) =>
      statuses.push(status)
    );
    await manager.settled();

    expect(statuses.map(({ phase }) => phase)).toEqual(["registering", "error"]);
    expect(statuses.at(-1)).toMatchObject({
      toolNames: initial.map(({ name }) => name),
      verifiedManifestNames: initial.map(({ name }) => name),
      generation: 1
    });
    expect(statuses.at(-1)?.error).toContain("Synthetic registration failure");
    expect([...harness.active.keys()].sort()).toEqual(initial.map(({ name }) => name).sort());
    expect(harness.abortedNames).toContain(CHECKOUT_CANCEL);

    releaseFailing();
    await manager.settled();
  });

  it("waits on toolchange/polling and fails closed when discovery never exposes the exact manifest", async () => {
    let revealCancel = false;
    const harness = createContext({
      discover: (active) =>
        [...active.values()]
          .filter(({ tool }) => revealCancel || tool.name !== CHECKOUT_CANCEL)
          .map(({ tool }) => registeredTool(tool))
    });
    const emit = harness.emitToolChange;
    const { initial, pending } = createCatalog();
    const manager = new WebMcpRegistryManager();
    const releaseInitial = manager.acquire(harness.context, initial, () => undefined);
    await manager.settled();

    releaseInitial();
    const statuses: RegistryStatus[] = [];
    const releasePending = manager.acquire(harness.context, pending, (status) =>
      statuses.push(status)
    );
    await vi.waitFor(() => expect(harness.active.has(CHECKOUT_CANCEL)).toBe(true));
    expect(statuses.map(({ phase }) => phase)).toEqual(["registering"]);

    revealCancel = true;
    emit();
    await manager.settled();
    expect(statuses.at(-1)?.phase).toBe("ready");

    releasePending();
    await manager.settled();

    const mismatchHarness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => {
          const discovered = registeredTool(tool);
          return tool.name === CART_GET
            ? { ...discovered, description: "Drifted native description." }
            : discovered;
        })
    });
    const mismatchManager = new WebMcpRegistryManager();
    const mismatchStatuses: RegistryStatus[] = [];
    const releaseMismatch = mismatchManager.acquire(
      mismatchHarness.context,
      [createTool(CART_GET)],
      (status) => mismatchStatuses.push(status)
    );
    await mismatchManager.settled();

    expect(mismatchStatuses.map(({ phase }) => phase)).toEqual(["registering", "error"]);
    expect(mismatchStatuses.at(-1)).toMatchObject({
      toolNames: [],
      verifiedManifestNames: [],
      generation: 0
    });
    expect(mismatchStatuses.at(-1)?.error).toContain("exact desired catalog");
    expect(mismatchStatuses.at(-1)?.error).toContain("cart_get.description");
    expect(mismatchHarness.active.size).toBe(0);

    releaseMismatch();
    await mismatchManager.settled();
  });

  it("accepts Chrome JSON-string discovered schemas without weakening their content", async () => {
    const harness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => ({
          ...registeredTool(tool),
          inputSchema: JSON.stringify(tool.inputSchema) as unknown as object
        }))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [createTool(CART_GET)], (status) =>
      statuses.push(status)
    );

    await manager.settled();
    expect(statuses.at(-1)).toMatchObject({ phase: "ready", toolNames: [CART_GET] });

    release();
    await manager.settled();
  });

  it("rejects a wrong non-empty discovered title", async () => {
    const harness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => ({
          ...registeredTool(tool),
          title: "Wrong native title"
        }))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [createTool(CART_GET)], (status) =>
      statuses.push(status)
    );

    await manager.settled();
    expect(statuses.at(-1)?.phase).toBe("error");
    expect(statuses.at(-1)?.error).toContain("cart_get.title");

    release();
    await manager.settled();
  });

  it("rejects an empty discovered title when registration supplied one", async () => {
    const harness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => ({
          ...registeredTool(tool),
          title: ""
        }))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [createTool(CART_GET)], (status) =>
      statuses.push(status)
    );

    await manager.settled();
    expect(statuses.at(-1)?.phase).toBe("error");
    expect(statuses.at(-1)?.error).toContain("cart_get.title");

    release();
    await manager.settled();
  });

  it("rejects semantically drifted serialized discovered schemas", async () => {
    const harness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => ({
          ...registeredTool(tool),
          inputSchema: JSON.stringify({ type: "object" }) as unknown as object
        }))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [createTool(CART_GET)], (status) =>
      statuses.push(status)
    );

    await manager.settled();
    expect(statuses.at(-1)?.phase).toBe("error");
    expect(statuses.at(-1)?.error).toContain("cart_get.inputSchema");

    release();
    await manager.settled();
  });

  it("rejects malformed serialized discovered schemas", async () => {
    const harness = createContext({
      discover: (active) =>
        [...active.values()].map(({ tool }) => ({
          ...registeredTool(tool),
          inputSchema: "{" as unknown as object
        }))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [createTool(CART_GET)], (status) =>
      statuses.push(status)
    );

    await manager.settled();
    expect(statuses.at(-1)?.phase).toBe("error");
    expect(statuses.at(-1)?.error).toContain("not valid JSON");

    release();
    await manager.settled();
  });

  it("rejects same-document schema or handler replacement without disturbing the verified tool", async () => {
    const harness = createContext();
    const source = createTool(CART_GET);
    const manager = new WebMcpRegistryManager();
    const releaseSource = manager.acquire(harness.context, [source], () => undefined);
    await manager.settled();
    const originalSignal = harness.active.get(CART_GET)?.signal;

    const replacementStatuses: RegistryStatus[] = [];
    const handlerReplacement = createTool(CART_GET, async () => ({ ok: false }));
    const releaseHandlerReplacement = manager.acquire(
      harness.context,
      [handlerReplacement],
      (status) => replacementStatuses.push(status)
    );
    await manager.settled();
    expect(replacementStatuses.at(-1)).toMatchObject({
      phase: "error",
      toolNames: [CART_GET],
      generation: 1
    });
    expect(replacementStatuses.at(-1)?.error).toContain("P0 forbids replacing");
    expect(harness.registerTool).toHaveBeenCalledOnce();
    expect(harness.active.get(CART_GET)?.signal).toBe(originalSignal);

    releaseHandlerReplacement();
    await manager.settled();
    const schemaReplacement = { ...source, inputSchema: { type: "object" } };
    const schemaStatuses: RegistryStatus[] = [];
    const releaseSchemaReplacement = manager.acquire(
      harness.context,
      [schemaReplacement],
      (status) => schemaStatuses.push(status)
    );
    await manager.settled();
    expect(schemaStatuses.at(-1)?.phase).toBe("error");
    expect(schemaStatuses.at(-1)?.error).toContain("P0 forbids replacing");
    expect(harness.registerTool).toHaveBeenCalledOnce();

    releaseSchemaReplacement();
    releaseSource();
    await manager.settled();
  });

  it("owns and freezes the tool definition captured at acquire time", async () => {
    const harness = createContext();
    const source = createTool(CART_GET);
    const originalHandler = source.execute;
    const manager = new WebMcpRegistryManager();
    const release = manager.acquire(harness.context, [source], () => undefined);

    source.description = "Caller-mutated description.";
    source.inputSchema = { type: "array" };
    source.execute = async () => ({ ok: false });
    await manager.settled();

    const registered = harness.active.get(CART_GET)?.tool;
    expect(registered?.description).toBe(`Execute ${CART_GET}.`);
    expect(registered?.execute).not.toBe(source.execute);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.inputSchema)).toBe(true);
    expect(Reflect.set(registered as object, "description", "Provider mutation")).toBe(false);
    await expect(
      registered?.execute({}, { signal: new AbortController().signal })
    ).resolves.toEqual(await originalHandler({}, { signal: new AbortController().signal }));

    release();
    await manager.settled();
  });

  it("coalesces an immediate StrictMode release so the live lease registers each tool once", async () => {
    const harness = createContext();
    const { initial } = createCatalog();
    const manager = new WebMcpRegistryManager();
    const releaseFirst = manager.acquire(harness.context, initial, () => undefined);
    releaseFirst();

    const statuses: RegistryStatus[] = [];
    const releaseSecond = manager.acquire(harness.context, initial, (status) =>
      statuses.push(status)
    );
    await manager.settled();

    expect(statuses.at(-1)?.phase).toBe("ready");
    expect(harness.registerTool).toHaveBeenCalledTimes(initial.length);
    for (const { name } of initial) expect(callsFor(harness.registrationCalls, name)).toBe(1);

    releaseSecond();
    await manager.settled();
  });

  it("aborts delayed StrictMode registration cleanup without deadlocking the replacement lease", async () => {
    const firstGate = deferred<void>();
    let firstSignal: AbortSignal | undefined;
    const harness = createContext({
      beforeRegister: async (_name, callNumber, signal) => {
        if (callNumber === 1) {
          firstSignal = signal;
          await firstGate.promise;
        }
      }
    });
    const source = createTool(CART_GET);
    const manager = new WebMcpRegistryManager();
    const releaseFirst = manager.acquire(harness.context, [source], () => undefined);
    await vi.waitFor(() => expect(harness.registerTool).toHaveBeenCalledOnce());

    releaseFirst();
    const replacementStatuses: RegistryStatus[] = [];
    const releaseSecond = manager.acquire(harness.context, [source], (status) =>
      replacementStatuses.push(status)
    );
    await vi.waitFor(() => expect(harness.registerTool).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(replacementStatuses.at(-1)?.phase).toBe("ready"));
    expect(firstSignal?.aborted).toBe(true);
    expect(harness.active.size).toBe(1);

    firstGate.resolve();
    await manager.settled();
    expect(harness.active.size).toBe(1);

    releaseSecond();
    await manager.settled();
  });

  it("fails closed instead of restoring orphaned tools when final teardown verification fails", async () => {
    let sabotageEmptyDiscovery = false;
    const source = createTool(CART_GET);
    const harness = createContext({
      discover: (active) =>
        sabotageEmptyDiscovery
          ? [registeredTool(source)]
          : [...active.values()].map(({ tool }) => registeredTool(tool))
    });
    const manager = new WebMcpRegistryManager();
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [source], (status) => statuses.push(status));
    await manager.settled();
    const registeredWrapper = harness.registrationCalls[0]?.tool;

    sabotageEmptyDiscovery = true;
    release();
    await manager.settled();

    expect(harness.active.size).toBe(0);
    expect(statuses.at(-1)).toMatchObject({ phase: "error", toolNames: [] });
    await expect(
      registeredWrapper?.execute({}, { signal: new AbortController().signal })
    ).rejects.toMatchObject({ name: "RegistryAdmissionError", code: "tool_not_admitted" });
  });

  it("supersedes a quiescence wait without deadlocking on a never-settling handler", async () => {
    const handlerStarted = deferred<void>();
    const handlerFinish = deferred<void>();
    const cartGet = createTool(CART_GET, async () => {
      handlerStarted.resolve();
      await handlerFinish.promise;
      return { ok: true };
    });
    const checkoutCancel = createTool(CHECKOUT_CANCEL);
    const initial = [cartGet] as const;
    const pending = [cartGet, checkoutCancel] as const;
    const harness = createContext();
    const manager = new WebMcpRegistryManager();
    const releaseInitial = manager.acquire(harness.context, initial, () => undefined);
    await manager.settled();
    const inFlight = harness.active
      .get(CART_GET)
      ?.tool.execute({}, { signal: new AbortController().signal });
    await handlerStarted.promise;

    releaseInitial();
    const pendingStatuses: RegistryStatus[] = [];
    const releasePending = manager.acquire(harness.context, pending, (status) =>
      pendingStatuses.push(status)
    );
    await vi.waitFor(() => expect(pendingStatuses.at(-1)?.phase).toBe("registering"));
    releasePending();
    const recoveredStatuses: RegistryStatus[] = [];
    const releaseRecovered = manager.acquire(harness.context, initial, (status) =>
      recoveredStatuses.push(status)
    );
    await manager.settled();

    expect(recoveredStatuses.at(-1)?.phase).toBe("ready");
    expect(callsFor(harness.registrationCalls, CHECKOUT_CANCEL)).toBe(0);
    handlerFinish.resolve();
    await expect(inFlight).resolves.toEqual({ ok: true });
    releaseRecovered();
    await manager.settled();
  });

  it("bounds final teardown and quarantines a hung in-flight registration", async () => {
    const handlerStarted = deferred<void>();
    const handlerFinish = deferred<void>();
    const source = createTool(CART_GET, async () => {
      handlerStarted.resolve();
      await handlerFinish.promise;
      return { ok: true };
    });
    const harness = createContext();
    const manager = new WebMcpRegistryManager({ quiescenceTimeoutMs: 20 });
    const statuses: RegistryStatus[] = [];
    const release = manager.acquire(harness.context, [source], (status) => statuses.push(status));
    await manager.settled();
    const wrapper = harness.active.get(CART_GET)?.tool;
    const inFlight = wrapper?.execute({}, { signal: new AbortController().signal });
    await handlerStarted.promise;

    release();
    await manager.settled();

    expect(statuses.at(-1)).toMatchObject({ phase: "error", toolNames: [] });
    expect(statuses.at(-1)?.error).toContain("idle handler boundary");
    await expect(
      wrapper?.execute({}, { signal: new AbortController().signal })
    ).rejects.toMatchObject({ name: "RegistryAdmissionError", code: "tool_not_admitted" });
    expect(harness.active.has(CART_GET)).toBe(true);

    handlerFinish.resolve();
    await expect(inFlight).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(harness.active.has(CART_GET)).toBe(false));
  });
});
