import { describe, expect, it, vi } from "vitest";

import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  WebMcpRuntime,
  WebMcpRuntimeError,
  type ExecuteOnceRequest,
  type ExecuteTraceObservation,
  type RuntimeModelContext,
  type RuntimeObservation
} from "@/lib/webmcp/runtime";

const CART_RESULT = {
  ok: true,
  fixtureId: "checkout-seed-v1",
  stateRevision: 0,
  lines: [
    { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
    { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
  ]
};

function registeredTool(name = "cart_get"): WebMCP.RegisteredTool {
  return {
    name,
    title: "Read cart lines",
    description: "Return current cart line-item identities and quantities.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    origin: window.location.origin,
    window
  };
}

function contextWith(executeTool: RuntimeModelContext["executeTool"]): RuntimeModelContext {
  return {
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => []),
    executeTool,
    ontoolchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  } as unknown as RuntimeModelContext;
}

function harness(
  options: {
    readonly mode?: "object" | "json-string";
    readonly nativeResult?: string | null;
    readonly execute?: RuntimeModelContext["executeTool"];
    readonly stateAfter?: string;
    readonly manifestAfter?: string;
    readonly traceIncrement?: number;
  } = {}
) {
  const tool = registeredTool();
  let handlerCount = 0;
  let lastToolName = tool.name;
  let lastRawResult: string | null = JSON.stringify(CART_RESULT);
  const mode = options.mode ?? "object";
  const defaultExecute = vi.fn(async (selected: WebMCP.RegisteredTool, input: object | string) => {
    if (mode === "json-string") String(input);
    handlerCount += options.traceIncrement ?? 1;
    lastToolName = selected.name;
    lastRawResult =
      options.nativeResult === undefined ? JSON.stringify(CART_RESULT) : options.nativeResult;
    return lastRawResult;
  });
  const executeTool: RuntimeModelContext["executeTool"] = options.execute
    ? vi.fn(async (tool, input, executeOptions) => {
        handlerCount += options.traceIncrement ?? 1;
        lastToolName = tool.name;
        lastRawResult = (await options.execute?.(tool, input, executeOptions)) ?? null;
        return lastRawResult;
      })
    : defaultExecute;
  const context = contextWith(executeTool);
  const observe = vi.fn(async (): Promise<RuntimeObservation> => {
    const canonicalResult = lastRawResult === null ? null : (JSON.parse(lastRawResult) as unknown);
    const stateHash = handlerCount > 0 ? (options.stateAfter ?? "state-hash") : "state-hash";
    const manifestHash =
      handlerCount > 0 ? (options.manifestAfter ?? "manifest-hash") : "manifest-hash";
    return {
      stateHash,
      manifestHash,
      handlerTraceCount: handlerCount,
      ...(handlerCount > 0
        ? {
            lastHandlerTraceId: `trace-${handlerCount}`,
            lastEffectDigest: "empty-effect",
            lastTrace: {
              eventId: `trace-${handlerCount}`,
              source: "native" as const,
              toolName: lastToolName,
              status: "completed",
              registryHash: manifestHash,
              resultDigest:
                canonicalResult === null ? null : await canonicalSha256(canonicalResult),
              effectDigest: "empty-effect",
              stateBeforeDigest: "state-hash",
              stateAfterDigest: stateHash
            }
          }
        : {})
    };
  });
  const executionObserve = (manifestHash: string) =>
    vi.fn(async (): Promise<ExecuteTraceObservation> => {
      const canonicalResult =
        lastRawResult === null ? null : (JSON.parse(lastRawResult) as unknown);
      return {
        stateHash: "state-hash",
        handlerTraceCount: handlerCount,
        lastTrace:
          handlerCount === 0
            ? null
            : {
                eventId: `trace-${handlerCount}`,
                source: "native",
                toolName: lastToolName,
                status: "completed",
                registryHash: manifestHash,
                resultDigest:
                  canonicalResult === null ? null : await canonicalSha256(canonicalResult),
                effectDigest: "empty-effect",
                stateBeforeDigest: "state-hash",
                stateAfterDigest: "state-hash"
              }
      };
    });

  return {
    tool,
    context,
    observe,
    executionObserve,
    executeTool,
    request: {
      context,
      catalog: { generation: 1, manifestHash: "manifest-hash", tools: [tool] },
      cartTool: tool,
      expectedCartResult: CART_RESULT,
      observe
    }
  };
}

async function readyRuntime(
  mode: "object" | "json-string" = "object",
  serializer?: (value: Readonly<Record<string, unknown>>) => string
) {
  const fixture = harness({ mode });
  const runtime = new WebMcpRuntime(serializer);
  await runtime.initializeWithCartGet(fixture.request);
  const executeOnce = (request: Omit<ExecuteOnceRequest, "observe">) =>
    runtime.executeOnce({
      ...request,
      observe: fixture.executionObserve(request.manifestHash)
    });
  return { runtime, executeOnce, ...fixture };
}

function executeWithObservation(
  runtime: WebMcpRuntime,
  fixture: ReturnType<typeof harness>,
  request: Omit<ExecuteOnceRequest, "observe">
) {
  return runtime.executeOnce({
    ...request,
    observe: fixture.executionObserve(request.manifestHash)
  });
}

function expectRuntimeCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(WebMcpRuntimeError);
  expect((error as WebMcpRuntimeError).code).toBe(code);
  return true;
}

describe("WebMcpRuntime compatibility calibration", () => {
  it("freezes object mode from one harmless call without coercion", async () => {
    const fixture = harness({ mode: "object" });
    const runtime = new WebMcpRuntime();

    await expect(runtime.initializeWithCartGet(fixture.request)).resolves.toMatchObject({
      status: "compatibility-verified",
      argumentMode: "object",
      coercionCount: 0,
      nativeCallCount: 1,
      handlerTraceId: "trace-1",
      stateBeforeDigest: "state-hash",
      stateAfterDigest: "state-hash"
    });
    expect(fixture.executeTool).toHaveBeenCalledOnce();
    expect(runtime.argumentMode).toBe("object");
  });

  it("freezes JSON-string mode from exactly one WebIDL-style coercion", async () => {
    const fixture = harness({ mode: "json-string" });
    const runtime = new WebMcpRuntime();

    await expect(runtime.initializeWithCartGet(fixture.request)).resolves.toMatchObject({
      argumentMode: "json-string",
      coercionCount: 1,
      nativeCallCount: 1
    });
    expect(fixture.executeTool).toHaveBeenCalledOnce();
  });

  it("accepts Chrome JSON-string inputSchema discovery for calibration", async () => {
    const fixture = harness({ mode: "json-string" });
    fixture.tool.inputSchema = JSON.stringify(fixture.tool.inputSchema) as unknown as object;
    const runtime = new WebMcpRuntime();

    await expect(runtime.initializeWithCartGet(fixture.request)).resolves.toMatchObject({
      status: "compatibility-verified",
      argumentMode: "json-string"
    });
    expect(fixture.executeTool).toHaveBeenCalledOnce();
  });

  it("rejects schema representation mutation after catalog binding", async () => {
    const fixture = harness({ mode: "json-string" });
    const objectSchema = fixture.tool.inputSchema;
    if (!objectSchema) throw new Error("Fixture schema is required.");
    fixture.tool.inputSchema = JSON.stringify(objectSchema) as unknown as object;
    const runtime = new WebMcpRuntime();
    await runtime.initializeWithCartGet(fixture.request);

    fixture.tool.inputSchema = objectSchema;
    await expect(
      runtime.executeOnce({
        executionId: "representation-drift",
        manifestHash: "manifest-hash",
        tool: fixture.tool,
        input: {},
        observe: fixture.executionObserve("manifest-hash")
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "stale_manifest"));
    expect(fixture.executeTool).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent initialization into one native call", async () => {
    let release: (result: string) => void = () => undefined;
    let handlerCount = 0;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      handlerCount += 1;
      return pending;
    });
    const fixture = harness({
      execute,
      traceIncrement: 0
    });
    fixture.observe.mockImplementation(async () => ({
      stateHash: "state-hash",
      manifestHash: "manifest-hash",
      handlerTraceCount: handlerCount,
      ...(handlerCount > 0
        ? {
            lastHandlerTraceId: "trace-1",
            lastEffectDigest: "empty-effect",
            lastTrace: {
              eventId: "trace-1",
              source: "native" as const,
              toolName: "cart_get",
              status: "completed",
              registryHash: "manifest-hash",
              resultDigest: await canonicalSha256(CART_RESULT),
              effectDigest: "empty-effect",
              stateBeforeDigest: "state-hash",
              stateAfterDigest: "state-hash"
            }
          }
        : {})
    }));
    const runtime = new WebMcpRuntime();

    const first = runtime.initializeWithCartGet(fixture.request);
    const second = runtime.initializeWithCartGet(fixture.request);
    expect(first).toBe(second);
    release(JSON.stringify(CART_RESULT));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects a non-current or unsafe compatibility tool before execution", async () => {
    const fixture = harness();
    const runtime = new WebMcpRuntime();
    const foreign = { ...fixture.tool, origin: "https://foreign.example" };

    await expect(
      runtime.initializeWithCartGet({ ...fixture.request, cartTool: foreign })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "invalid_compatibility_tool"));
    expect(fixture.executeTool).not.toHaveBeenCalled();
  });

  it("terminal-fails on a result mismatch without trying another representation", async () => {
    const fixture = harness({ nativeResult: JSON.stringify({ ok: false }) });
    const runtime = new WebMcpRuntime();

    await expect(runtime.initializeWithCartGet(fixture.request)).rejects.toSatisfy(
      (error: unknown) => expectRuntimeCode(error, "compatibility_result_mismatch")
    );
    await expect(runtime.initializeWithCartGet(fixture.request)).rejects.toSatisfy(
      (error: unknown) => expectRuntimeCode(error, "compatibility_result_mismatch")
    );
    expect(fixture.executeTool).toHaveBeenCalledOnce();
  });

  it.each([
    [{ traceIncrement: 2 }, "compatibility_trace_mismatch"],
    [{ stateAfter: "mutated-state" }, "compatibility_state_mutation"],
    [{ manifestAfter: "changed-manifest" }, "compatibility_manifest_drift"],
    [{ nativeResult: null }, "compatibility_null_result"],
    [{ nativeResult: "not-json" }, "compatibility_invalid_result"]
  ] as const)("fails closed for incompatible calibration evidence %#", async (options, code) => {
    const fixture = harness(options);
    const runtime = new WebMcpRuntime();
    await expect(runtime.initializeWithCartGet(fixture.request)).rejects.toSatisfy(
      (error: unknown) => expectRuntimeCode(error, code)
    );
    expect(fixture.executeTool).toHaveBeenCalledOnce();
  });
});

describe("WebMcpRuntime.executeOnce", () => {
  it("passes validated objects directly in object mode", async () => {
    const { executeOnce, tool, executeTool } = await readyRuntime("object");
    const input = { operationId: "operation-0000001" };

    await expect(
      executeOnce({ executionId: "run-1", manifestHash: "manifest-hash", tool, input })
    ).resolves.toMatchObject({
      executionId: "run-1",
      argumentMode: "object",
      canonicalResult: CART_RESULT,
      nativeCallCount: 1,
      handlerTraceId: "trace-2",
      effectDigest: "empty-effect",
      stateBeforeDigest: "state-hash",
      stateAfterDigest: "state-hash",
      manifestHash: "manifest-hash"
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenLastCalledWith(tool, input, undefined);
  });

  it("serializes exactly once and never double-encodes in JSON-string mode", async () => {
    const serializer = vi.fn((value: Readonly<Record<string, unknown>>) => JSON.stringify(value));
    const { executeOnce, tool, executeTool } = await readyRuntime("json-string", serializer);
    const input = { quantity: 3 };

    await executeOnce({
      executionId: "run-string",
      manifestHash: "manifest-hash",
      tool,
      input
    });

    expect(serializer).toHaveBeenCalledOnce();
    expect(serializer).toHaveBeenCalledWith(input);
    expect(executeTool).toHaveBeenLastCalledWith(tool, '{"quantity":3}', undefined);
  });

  it("consumes an execution ID before a native failure and never retries", async () => {
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length === 1) return JSON.stringify(CART_RESULT);
      throw new Error("native failed");
    });
    const fixture = harness({ execute });
    const runtime = new WebMcpRuntime();
    await runtime.initializeWithCartGet(fixture.request);

    const request = {
      executionId: "uncertain-run",
      manifestHash: "manifest-hash",
      tool: fixture.tool,
      input: {}
    };
    await expect(executeWithObservation(runtime, fixture, request)).rejects.toSatisfy(
      (error: unknown) => {
        expectRuntimeCode(error, "native_execution_failure");
        expect((error as WebMcpRuntimeError).nativeCallMade).toBe(true);
        return true;
      }
    );
    await expect(executeWithObservation(runtime, fixture, request)).rejects.toSatisfy(
      (error: unknown) => expectRuntimeCode(error, "duplicate_execution_id")
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("propagates the exact AbortSignal and reports cancellation without retry", async () => {
    const controller = new AbortController();
    const execute = vi.fn(
      async (
        _tool: WebMCP.RegisteredTool,
        _input: object | string,
        options?: { readonly signal?: AbortSignal }
      ) => {
        if (execute.mock.calls.length === 1) return JSON.stringify(CART_RESULT);
        expect(options?.signal).toBe(controller.signal);
        throw new DOMException("Canceled", "AbortError");
      }
    );
    const fixture = harness({ execute });
    const runtime = new WebMcpRuntime();
    await runtime.initializeWithCartGet(fixture.request);

    await expect(
      executeWithObservation(runtime, fixture, {
        executionId: "canceled-run",
        manifestHash: "manifest-hash",
        tool: fixture.tool,
        input: {},
        signal: controller.signal
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "execution_canceled"));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects non-JSON, cyclic, sparse, accessor, and exotic input before native dispatch", async () => {
    const { executeOnce, tool, executeTool } = await readyRuntime();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
    const sparse = new Array<unknown>(1);
    const symbolProperty: Record<string, unknown> = {};
    Object.defineProperty(symbolProperty, Symbol("hidden"), { value: true });

    const invalidInputs: readonly Readonly<Record<string, unknown>>[] = [
      cyclic,
      { value: Number.NaN },
      { value: BigInt(1) },
      { value: undefined },
      { value: sparse },
      { value: new Date(0) },
      accessor,
      symbolProperty
    ];
    for (const [index, input] of invalidInputs.entries()) {
      await expect(
        executeOnce({
          executionId: `invalid-run-${index}`,
          manifestHash: "manifest-hash",
          tool,
          input
        })
      ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "invalid_input"));
    }
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it("permanently consumes a pre-canceled execution ID without dispatch", async () => {
    const { executeOnce, tool, executeTool } = await readyRuntime();
    const controller = new AbortController();
    controller.abort();
    const request = {
      executionId: "pre-canceled-run",
      manifestHash: "manifest-hash",
      tool,
      input: {},
      signal: controller.signal
    };

    await expect(executeOnce(request)).rejects.toSatisfy((error: unknown) =>
      expectRuntimeCode(error, "execution_canceled")
    );
    const retryWithoutSignal = {
      executionId: request.executionId,
      manifestHash: request.manifestHash,
      tool: request.tool,
      input: request.input
    };
    await expect(executeOnce(retryWithoutSignal)).rejects.toSatisfy((error: unknown) =>
      expectRuntimeCode(error, "duplicate_execution_id")
    );
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it("rejects stale manifests and RegisteredTool objects before dispatch", async () => {
    const { executeOnce, tool, executeTool } = await readyRuntime();
    const staleTool = registeredTool();

    await expect(
      executeOnce({
        executionId: "stale-hash",
        manifestHash: "old-hash",
        tool,
        input: {}
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "stale_manifest"));
    await expect(
      executeOnce({
        executionId: "stale-tool",
        manifestHash: "manifest-hash",
        tool: staleTool,
        input: {}
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "unselected_tool"));
    tool.description = "Descriptor changed after verification.";
    await expect(
      executeOnce({
        executionId: "drifted-tool",
        manifestHash: "manifest-hash",
        tool,
        input: {}
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "stale_manifest"));
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it("dispatches an owned descriptor snapshot despite divergent getters or later mutation", async () => {
    const releaseExecution = Promise.withResolvers<void>();
    let receivedInput: object | string | undefined;
    const execute = vi.fn(async (_tool: WebMCP.RegisteredTool, input: object | string) => {
      if (execute.mock.calls.length === 1) return JSON.stringify(CART_RESULT);
      receivedInput = input;
      await releaseExecution.promise;
      return JSON.stringify(CART_RESULT);
    });
    const fixture = harness({ execute });
    const runtime = new WebMcpRuntime();
    await runtime.initializeWithCartGet(fixture.request);
    const target = { quantity: 3 };
    const input = new Proxy(target, {
      get: (object, key, receiver) => (key === "quantity" ? 9 : Reflect.get(object, key, receiver))
    });

    const pending = executeWithObservation(runtime, fixture, {
      executionId: "owned-input",
      manifestHash: "manifest-hash",
      tool: fixture.tool,
      input
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    target.quantity = 8;
    releaseExecution.resolve();
    await expect(pending).resolves.toMatchObject({ nativeCallCount: 1 });

    expect(receivedInput).toEqual({ quantity: 3 });
    expect(receivedInput).not.toBe(input);
  });

  it("reserves an execution ID before an awaited observation", async () => {
    const { runtime, tool, executeTool, executionObserve } = await readyRuntime();
    const releaseObservation = Promise.withResolvers<void>();
    const baseObserve = executionObserve("manifest-hash");
    let observations = 0;
    const observe = async () => {
      observations += 1;
      if (observations === 1) await releaseObservation.promise;
      return baseObserve();
    };
    const request = {
      executionId: "concurrent-duplicate",
      manifestHash: "manifest-hash",
      tool,
      input: {},
      observe
    };

    const first = runtime.executeOnce(request);
    await vi.waitFor(() => expect(observations).toBe(1));
    await expect(runtime.executeOnce(request)).rejects.toSatisfy((error: unknown) =>
      expectRuntimeCode(error, "duplicate_execution_id")
    );
    expect(executeTool).toHaveBeenCalledOnce();

    releaseObservation.resolve();
    await expect(first).resolves.toMatchObject({ nativeCallCount: 1 });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("refreshes the verified catalog without recalibrating and invalidates old tool objects", async () => {
    const { runtime, executeOnce, tool, executeTool } = await readyRuntime("json-string");
    const currentTool = registeredTool("order_review");
    runtime.verifyRegistry({
      generation: 2,
      manifestHash: "pending-manifest",
      tools: [currentTool]
    });

    await expect(
      executeOnce({
        executionId: "old-tool",
        manifestHash: "pending-manifest",
        tool,
        input: {}
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, "unselected_tool"));
    await expect(
      executeOnce({
        executionId: "current-tool",
        manifestHash: "pending-manifest",
        tool: currentTool,
        input: {}
      })
    ).resolves.toMatchObject({ argumentMode: "json-string", toolName: "order_review" });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(() =>
      runtime.verifyRegistry({
        generation: 1,
        manifestHash: "older-manifest",
        tools: [currentTool]
      })
    ).toThrow("cannot move backward");
  });

  it.each([
    [null, "null_result"],
    ["not-json", "invalid_result"]
  ] as const)("distinguishes native result failure %#", async (nativeResult, code) => {
    const execute = vi.fn(async () =>
      execute.mock.calls.length === 1 ? JSON.stringify(CART_RESULT) : nativeResult
    );
    const fixture = harness({ execute });
    const runtime = new WebMcpRuntime();
    await runtime.initializeWithCartGet(fixture.request);

    await expect(
      executeWithObservation(runtime, fixture, {
        executionId: `result-${code}`,
        manifestHash: "manifest-hash",
        tool: fixture.tool,
        input: {}
      })
    ).rejects.toSatisfy((error: unknown) => expectRuntimeCode(error, code));
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
