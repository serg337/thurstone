import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { ModelContextConsumerCompatibility } from "@/lib/webmcp/capabilities";
import { canonicalInputSchema, normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";

export type ExecuteArgumentMode = "object" | "json-string";

export interface RuntimeCatalogSnapshot {
  readonly generation: number;
  readonly manifestHash: string;
  readonly tools: readonly WebMCP.RegisteredTool[];
}

export interface RuntimeObservation {
  readonly stateHash: string;
  readonly manifestHash: string;
  readonly handlerTraceCount: number;
  readonly lastHandlerTraceId?: string;
  readonly lastEffectDigest?: string;
  readonly lastTrace?: ExecuteTraceObservation["lastTrace"];
}

export interface ExecuteTraceObservation {
  readonly stateHash: string;
  readonly handlerTraceCount: number;
  readonly lastTrace: {
    readonly eventId: string;
    readonly source: "ui" | "native";
    readonly toolName: string;
    readonly status: string;
    readonly registryHash: string;
    readonly resultDigest: string | null;
    readonly effectDigest: string;
    readonly stateBeforeDigest: string;
    readonly stateAfterDigest: string;
  } | null;
}

export interface RuntimeCompatibilityReceipt {
  readonly status: "compatibility-verified";
  readonly argumentMode: ExecuteArgumentMode;
  readonly toolName: "cart_get";
  readonly nativeCallCount: 1;
  readonly coercionCount: 0 | 1;
  readonly rawResult: string;
  readonly canonicalResult: unknown;
  readonly resultDigest: string;
  readonly handlerTraceId: string;
  readonly effectDigest: string;
  readonly stateBeforeDigest: string;
  readonly stateAfterDigest: string;
  readonly manifestHashBefore: string;
  readonly manifestHashAfter: string;
  readonly registrationGeneration: number;
}

export interface InitializeRuntimeRequest {
  readonly context: RuntimeModelContext;
  readonly catalog: RuntimeCatalogSnapshot;
  readonly cartTool: WebMCP.RegisteredTool;
  readonly expectedCartResult: unknown;
  readonly observe: () => RuntimeObservation | Promise<RuntimeObservation>;
  readonly signal?: AbortSignal;
}

export interface ExecuteOnceRequest {
  readonly executionId: string;
  readonly manifestHash: string;
  readonly tool: WebMCP.RegisteredTool;
  readonly input: Readonly<Record<string, unknown>>;
  readonly observe: () => ExecuteTraceObservation | Promise<ExecuteTraceObservation>;
  readonly signal?: AbortSignal;
}

export interface ExecuteOnceResult {
  readonly executionId: string;
  readonly toolName: string;
  readonly argumentMode: ExecuteArgumentMode;
  readonly rawResult: string;
  readonly canonicalResult: unknown;
  readonly resultDigest: string;
  readonly nativeCallCount: 1;
  readonly handlerTraceId: string;
  readonly handlerTraceStatus: string;
  readonly effectDigest: string;
  readonly stateBeforeDigest: string;
  readonly stateAfterDigest: string;
  readonly manifestHash: string;
}

export type WebMcpRuntimeErrorCode =
  | "runtime_not_ready"
  | "runtime_terminal_failure"
  | "consumer_execution_unavailable"
  | "invalid_catalog"
  | "invalid_compatibility_tool"
  | "compatibility_canceled"
  | "compatibility_native_failure"
  | "compatibility_null_result"
  | "compatibility_invalid_result"
  | "compatibility_result_mismatch"
  | "compatibility_trace_mismatch"
  | "compatibility_state_mutation"
  | "compatibility_manifest_drift"
  | "invalid_execution_id"
  | "duplicate_execution_id"
  | "stale_manifest"
  | "unselected_tool"
  | "invalid_input"
  | "execution_canceled"
  | "native_execution_failure"
  | "null_result"
  | "invalid_result";

export class WebMcpRuntimeError extends Error {
  readonly code: WebMcpRuntimeErrorCode;
  readonly nativeCallMade: boolean;
  readonly rawResult: string | null | undefined;

  constructor(
    code: WebMcpRuntimeErrorCode,
    message: string,
    options: {
      readonly nativeCallMade?: boolean;
      readonly rawResult?: string | null;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WebMcpRuntimeError";
    this.code = code;
    this.nativeCallMade = options.nativeCallMade ?? false;
    this.rawResult = options.rawResult;
  }
}

export type RuntimeModelContext = WebMCP.ModelContext &
  ModelContextConsumerCompatibility & {
    readonly executeTool: NonNullable<ModelContextConsumerCompatibility["executeTool"]>;
  };

type Serializer = (value: Readonly<Record<string, unknown>>) => string;

interface RuntimeToolBinding {
  readonly tool: WebMCP.RegisteredTool;
  readonly name: string;
  readonly origin: string;
  readonly ownerWindow: Window;
  readonly fingerprint: string;
}

const EMPTY_INPUT_SCHEMA = canonicalJson({
  type: "object",
  properties: {},
  additionalProperties: false
});

function toolFingerprint(tool: WebMCP.RegisteredTool): string {
  return canonicalJson({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchemaRepresentation:
      tool.inputSchema === undefined || tool.inputSchema === null
        ? "absent"
        : typeof tool.inputSchema === "string"
          ? "json-string"
          : "object",
    inputSchema: normalizeInputSchema(tool.inputSchema),
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint ?? false,
      untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
    },
    origin: tool.origin
  });
}

function bindTools(
  snapshot: RuntimeCatalogSnapshot
): ReadonlyMap<WebMCP.RegisteredTool, RuntimeToolBinding> {
  try {
    return new Map(
      snapshot.tools.map((tool) => [
        tool,
        Object.freeze({
          tool,
          name: tool.name,
          origin: tool.origin,
          ownerWindow: tool.window,
          fingerprint: toolFingerprint(tool)
        })
      ])
    );
  } catch (cause) {
    throw new WebMcpRuntimeError(
      "invalid_catalog",
      "Registry descriptors are not canonical JSON.",
      {
        cause
      }
    );
  }
}

function assertToolBinding(tool: WebMCP.RegisteredTool, binding: RuntimeToolBinding): void {
  let fingerprint: string;
  try {
    fingerprint = toolFingerprint(tool);
  } catch (cause) {
    throw new WebMcpRuntimeError("stale_manifest", "Selected tool descriptor became unreadable.", {
      cause
    });
  }
  if (
    tool !== binding.tool ||
    tool.name !== binding.name ||
    tool.origin !== binding.origin ||
    tool.window !== binding.ownerWindow ||
    fingerprint !== binding.fingerprint
  ) {
    throw new WebMcpRuntimeError(
      "stale_manifest",
      "Selected tool descriptor changed after registry verification."
    );
  }
}

function freezeCatalog(snapshot: RuntimeCatalogSnapshot): RuntimeCatalogSnapshot {
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) {
    throw new WebMcpRuntimeError(
      "invalid_catalog",
      "Registry generation must be a positive integer."
    );
  }
  if (typeof snapshot.manifestHash !== "string" || snapshot.manifestHash.length === 0) {
    throw new WebMcpRuntimeError("invalid_catalog", "Registry manifest hash is required.");
  }
  if (
    snapshot.tools.length === 0 ||
    new Set(snapshot.tools.map(({ name }) => name)).size !== snapshot.tools.length
  ) {
    throw new WebMcpRuntimeError(
      "invalid_catalog",
      "Registry tools must be non-empty and uniquely named."
    );
  }
  for (const tool of snapshot.tools) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(tool.name)) {
      throw new WebMcpRuntimeError("invalid_catalog", "Registry contains an invalid tool name.");
    }
    if (
      typeof window !== "undefined" &&
      (tool.window !== window || tool.origin !== window.location.origin)
    ) {
      throw new WebMcpRuntimeError(
        "invalid_catalog",
        "Every runtime tool must be discovered from this document and origin."
      );
    }
  }
  return Object.freeze({
    generation: snapshot.generation,
    manifestHash: snapshot.manifestHash,
    tools: Object.freeze([...snapshot.tools])
  });
}

function assertCompatibilityTool(
  tool: WebMCP.RegisteredTool,
  catalog: RuntimeCatalogSnapshot
): void {
  if (!catalog.tools.includes(tool)) {
    throw new WebMcpRuntimeError(
      "invalid_compatibility_tool",
      "Compatibility tool must come from the current discovered registry."
    );
  }
  if (
    tool.name !== "cart_get" ||
    tool.annotations?.readOnlyHint !== true ||
    canonicalInputSchema(tool.inputSchema) !== EMPTY_INPUT_SCHEMA
  ) {
    throw new WebMcpRuntimeError(
      "invalid_compatibility_tool",
      "Compatibility calibration requires the exact read-only cart_get empty-input contract."
    );
  }
  if (
    typeof window !== "undefined" &&
    (tool.window !== window || tool.origin !== window.location.origin)
  ) {
    throw new WebMcpRuntimeError(
      "invalid_compatibility_tool",
      "Compatibility tool must be owned by this document and origin."
    );
  }
}

function abortErrorCode(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

type OwnedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly OwnedJsonValue[]
  | { readonly [key: string]: OwnedJsonValue };

function snapshotJsonValue(value: unknown, path: string, seen: Set<object>): OwnedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new WebMcpRuntimeError("invalid_input", `${path} must contain only finite numbers.`);
  }
  if (typeof value !== "object") {
    throw new WebMcpRuntimeError("invalid_input", `${path} contains a non-JSON value.`);
  }
  if (seen.has(value)) {
    throw new WebMcpRuntimeError("invalid_input", `${path} contains a cyclic reference.`);
  }
  seen.add(value);

  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length > 0) {
    throw new WebMcpRuntimeError("invalid_input", `${path} contains symbol properties.`);
  }

  if (Array.isArray(value)) {
    const names = Object.getOwnPropertyNames(value);
    const expectedNames = new Set(["length"]);
    const snapshot: OwnedJsonValue[] = [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length =
      lengthDescriptor &&
      "value" in lengthDescriptor &&
      Number.isSafeInteger(lengthDescriptor.value)
        ? (lengthDescriptor.value as number)
        : -1;
    if (length < 0) {
      throw new WebMcpRuntimeError("invalid_input", `${path} has an invalid array length.`);
    }
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new WebMcpRuntimeError("invalid_input", `${path} must be a dense data-only array.`);
      }
      expectedNames.add(key);
      snapshot.push(snapshotJsonValue(descriptor.value, `${path}[${index}]`, seen));
    }
    if (names.some((name) => !expectedNames.has(name)) || names.length !== expectedNames.size) {
      throw new WebMcpRuntimeError("invalid_input", `${path} must be a dense JSON array.`);
    }
    seen.delete(value);
    return Object.freeze(snapshot);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WebMcpRuntimeError("invalid_input", `${path} must be a plain JSON object.`);
  }
  const snapshot: Record<string, OwnedJsonValue> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new WebMcpRuntimeError(
        "invalid_input",
        `${path}.${key} must be an enumerable data property.`
      );
    }
    Object.defineProperty(snapshot, key, {
      value: snapshotJsonValue(descriptor.value, `${path}.${key}`, seen),
      configurable: false,
      enumerable: true,
      writable: false
    });
  }
  seen.delete(value);
  return Object.freeze(snapshot);
}

function snapshotJsonObject(
  input: Readonly<Record<string, unknown>>
): Readonly<Record<string, OwnedJsonValue>> {
  if (input === null || Array.isArray(input) || typeof input !== "object") {
    throw new WebMcpRuntimeError("invalid_input", "Tool input must be a JSON object.");
  }
  try {
    return snapshotJsonValue(input, "input", new Set()) as Readonly<Record<string, OwnedJsonValue>>;
  } catch (error) {
    if (error instanceof WebMcpRuntimeError) throw error;
    throw new WebMcpRuntimeError("invalid_input", "Tool input could not be captured safely.", {
      cause: error
    });
  }
}

function parseNativeResult(
  rawResult: string | null,
  nullCode: "compatibility_null_result" | "null_result",
  invalidCode: "compatibility_invalid_result" | "invalid_result"
): unknown {
  if (rawResult === null) {
    throw new WebMcpRuntimeError(nullCode, "Native execution returned navigation/null.", {
      nativeCallMade: true,
      rawResult: null
    });
  }
  if (typeof rawResult !== "string") {
    throw new WebMcpRuntimeError(invalidCode, "Native execution returned a non-string result.", {
      nativeCallMade: true
    });
  }
  try {
    return JSON.parse(rawResult) as unknown;
  } catch (cause) {
    throw new WebMcpRuntimeError(invalidCode, "Native execution returned malformed JSON.", {
      nativeCallMade: true,
      rawResult,
      cause
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export class WebMcpRuntime {
  private readonly consumedExecutionIds = new Set<string>();
  private readonly serialize: Serializer;
  private initialization: Promise<RuntimeCompatibilityReceipt> | undefined;
  private receipt: RuntimeCompatibilityReceipt | undefined;
  private failure: WebMcpRuntimeError | undefined;
  private context: RuntimeModelContext | undefined;
  private catalog: RuntimeCatalogSnapshot | undefined;
  private toolBindings: ReadonlyMap<WebMCP.RegisteredTool, RuntimeToolBinding> = new Map();

  constructor(serialize: Serializer = (value) => JSON.stringify(value)) {
    this.serialize = serialize;
  }

  get argumentMode(): ExecuteArgumentMode | undefined {
    return this.receipt?.argumentMode;
  }

  get compatibilityReceipt(): RuntimeCompatibilityReceipt | undefined {
    return this.receipt;
  }

  initializeWithCartGet(request: InitializeRuntimeRequest): Promise<RuntimeCompatibilityReceipt> {
    if (this.receipt) return Promise.resolve(this.receipt);
    if (this.failure) return Promise.reject(this.failure);
    if (this.initialization) return this.initialization;

    const task = this.calibrate(request).catch((error: unknown) => {
      const failure =
        error instanceof WebMcpRuntimeError
          ? error
          : new WebMcpRuntimeError(
              "runtime_terminal_failure",
              "Compatibility calibration failed.",
              {
                cause: error
              }
            );
      this.failure = failure;
      throw failure;
    });
    this.initialization = task;
    return task;
  }

  verifyRegistry(snapshot: RuntimeCatalogSnapshot): void {
    if (!this.receipt || !this.context || this.failure) {
      throw new WebMcpRuntimeError("runtime_not_ready", "Runtime compatibility is not ready.");
    }
    const nextCatalog = freezeCatalog(snapshot);
    if (this.catalog && nextCatalog.generation < this.catalog.generation) {
      throw new WebMcpRuntimeError(
        "invalid_catalog",
        "Registry generation cannot move backward within one document."
      );
    }
    this.toolBindings = bindTools(nextCatalog);
    this.catalog = nextCatalog;
  }

  async executeOnce(request: ExecuteOnceRequest): Promise<ExecuteOnceResult> {
    if (this.failure) {
      throw new WebMcpRuntimeError(
        "runtime_terminal_failure",
        "Runtime is terminal-failed for this document.",
        { cause: this.failure }
      );
    }
    if (!this.receipt || !this.context || !this.catalog) {
      throw new WebMcpRuntimeError("runtime_not_ready", "Calibrate native execution first.");
    }
    if (typeof request.executionId !== "string" || request.executionId.length === 0) {
      throw new WebMcpRuntimeError("invalid_execution_id", "A non-empty execution ID is required.");
    }
    if (this.consumedExecutionIds.has(request.executionId)) {
      throw new WebMcpRuntimeError(
        "duplicate_execution_id",
        "This execution ID has already consumed its one-call allowance."
      );
    }
    if (request.manifestHash !== this.catalog.manifestHash) {
      throw new WebMcpRuntimeError(
        "stale_manifest",
        "Execution is bound to a stale registry manifest."
      );
    }
    const binding = this.toolBindings.get(request.tool);
    if (!binding) {
      throw new WebMcpRuntimeError(
        "unselected_tool",
        "Execution requires a RegisteredTool from the current discovered catalog."
      );
    }
    assertToolBinding(request.tool, binding);
    const capturedInput = snapshotJsonObject(request.input);
    this.consumedExecutionIds.add(request.executionId);

    const before = await request.observe();
    if (before.handlerTraceCount < 0 || before.stateHash.length === 0) {
      throw new WebMcpRuntimeError("invalid_result", "Execution observation is invalid.");
    }
    if (request.manifestHash !== this.catalog.manifestHash) {
      throw new WebMcpRuntimeError("stale_manifest", "Registry changed before native dispatch.");
    }
    if (this.toolBindings.get(request.tool) !== binding) {
      throw new WebMcpRuntimeError("stale_manifest", "Selected tool was replaced before dispatch.");
    }
    assertToolBinding(request.tool, binding);

    if (request.signal?.aborted) {
      throw new WebMcpRuntimeError("execution_canceled", "Execution was canceled before dispatch.");
    }

    const wireInput =
      this.receipt.argumentMode === "json-string" ? this.serialize(capturedInput) : capturedInput;
    let rawResult: string | null;
    try {
      rawResult = await this.context.executeTool(
        request.tool,
        wireInput,
        request.signal ? { signal: request.signal } : undefined
      );
    } catch (cause) {
      if (abortErrorCode(cause, request.signal)) {
        throw new WebMcpRuntimeError("execution_canceled", "Native execution was canceled.", {
          nativeCallMade: true,
          cause
        });
      }
      throw new WebMcpRuntimeError("native_execution_failure", "Native execution failed.", {
        nativeCallMade: true,
        cause
      });
    }

    const canonicalResult = parseNativeResult(rawResult, "null_result", "invalid_result");
    const resultDigest = await canonicalSha256(canonicalResult);
    const after = await request.observe();
    const trace = after.lastTrace;
    if (
      after.handlerTraceCount !== before.handlerTraceCount + 1 ||
      !trace ||
      trace.source !== "native" ||
      trace.toolName !== binding.name ||
      trace.registryHash !== request.manifestHash ||
      trace.resultDigest !== resultDigest ||
      trace.stateBeforeDigest !== before.stateHash ||
      trace.stateAfterDigest !== after.stateHash
    ) {
      throw new WebMcpRuntimeError(
        "invalid_result",
        "Native result did not bind to exactly one matching handler trace.",
        { nativeCallMade: true, rawResult }
      );
    }
    return deepFreeze({
      executionId: request.executionId,
      toolName: binding.name,
      argumentMode: this.receipt.argumentMode,
      rawResult: rawResult as string,
      canonicalResult,
      resultDigest,
      nativeCallCount: 1 as const,
      handlerTraceId: trace.eventId,
      handlerTraceStatus: trace.status,
      effectDigest: trace.effectDigest,
      stateBeforeDigest: trace.stateBeforeDigest,
      stateAfterDigest: trace.stateAfterDigest,
      manifestHash: request.manifestHash
    });
  }

  private async calibrate(request: InitializeRuntimeRequest): Promise<RuntimeCompatibilityReceipt> {
    if (typeof request.context.executeTool !== "function") {
      throw new WebMcpRuntimeError(
        "consumer_execution_unavailable",
        "This document does not expose native WebMCP execution."
      );
    }
    const catalog = freezeCatalog(request.catalog);
    assertCompatibilityTool(request.cartTool, catalog);
    const calibrationBindings = bindTools(catalog);
    const cartBinding = calibrationBindings.get(request.cartTool);
    if (!cartBinding) {
      throw new WebMcpRuntimeError(
        "invalid_compatibility_tool",
        "Compatibility tool has no verified descriptor binding."
      );
    }
    if (request.signal?.aborted) {
      throw new WebMcpRuntimeError(
        "compatibility_canceled",
        "Compatibility calibration was canceled."
      );
    }

    const before = await request.observe();
    if (before.manifestHash !== catalog.manifestHash) {
      throw new WebMcpRuntimeError(
        "compatibility_manifest_drift",
        "Observed registry does not match the calibration catalog."
      );
    }
    assertToolBinding(request.cartTool, cartBinding);

    let coercionCount = 0;
    const dualRepresentationInput = Object.create(null) as Record<string, never>;
    Object.defineProperty(dualRepresentationInput, Symbol.toPrimitive, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: () => {
        coercionCount += 1;
        return "{}";
      }
    });

    let rawResult: string | null;
    try {
      rawResult = await request.context.executeTool(
        request.cartTool,
        dualRepresentationInput,
        request.signal ? { signal: request.signal } : undefined
      );
    } catch (cause) {
      if (abortErrorCode(cause, request.signal)) {
        throw new WebMcpRuntimeError(
          "compatibility_canceled",
          "Compatibility calibration was canceled.",
          { nativeCallMade: true, cause }
        );
      }
      throw new WebMcpRuntimeError(
        "compatibility_native_failure",
        "Native compatibility execution failed.",
        { nativeCallMade: true, cause }
      );
    }

    if (coercionCount !== 0 && coercionCount !== 1) {
      throw new WebMcpRuntimeError(
        "compatibility_invalid_result",
        "Native argument coercion was not deterministic.",
        { nativeCallMade: true, rawResult }
      );
    }
    const argumentMode: ExecuteArgumentMode = coercionCount === 1 ? "json-string" : "object";
    const canonicalResult = parseNativeResult(
      rawResult,
      "compatibility_null_result",
      "compatibility_invalid_result"
    );
    if (canonicalJson(canonicalResult) !== canonicalJson(request.expectedCartResult)) {
      throw new WebMcpRuntimeError(
        "compatibility_result_mismatch",
        "Compatibility cart_get result did not match the deterministic fixture.",
        { nativeCallMade: true, rawResult }
      );
    }

    const resultDigest = await canonicalSha256(canonicalResult);
    const after = await request.observe();
    if (after.stateHash !== before.stateHash) {
      throw new WebMcpRuntimeError(
        "compatibility_state_mutation",
        "Read-only compatibility execution changed fixture state.",
        { nativeCallMade: true, rawResult }
      );
    }
    if (after.manifestHash !== before.manifestHash) {
      throw new WebMcpRuntimeError(
        "compatibility_manifest_drift",
        "Registry manifest changed during compatibility execution.",
        { nativeCallMade: true, rawResult }
      );
    }
    const handlerTrace = after.lastTrace;
    if (
      after.handlerTraceCount !== before.handlerTraceCount + 1 ||
      !after.lastHandlerTraceId ||
      !after.lastEffectDigest ||
      !handlerTrace ||
      handlerTrace.eventId !== after.lastHandlerTraceId ||
      handlerTrace.source !== "native" ||
      handlerTrace.toolName !== "cart_get" ||
      handlerTrace.status !== "completed" ||
      handlerTrace.registryHash !== before.manifestHash ||
      handlerTrace.resultDigest !== resultDigest ||
      handlerTrace.effectDigest !== after.lastEffectDigest ||
      handlerTrace.stateBeforeDigest !== before.stateHash ||
      handlerTrace.stateAfterDigest !== after.stateHash
    ) {
      throw new WebMcpRuntimeError(
        "compatibility_trace_mismatch",
        "Compatibility execution did not produce exactly one handler trace.",
        { nativeCallMade: true, rawResult }
      );
    }
    const receipt = deepFreeze({
      status: "compatibility-verified" as const,
      argumentMode,
      toolName: "cart_get" as const,
      nativeCallCount: 1 as const,
      coercionCount: coercionCount as 0 | 1,
      rawResult: rawResult as string,
      canonicalResult,
      resultDigest,
      handlerTraceId: after.lastHandlerTraceId,
      effectDigest: after.lastEffectDigest,
      stateBeforeDigest: before.stateHash,
      stateAfterDigest: after.stateHash,
      manifestHashBefore: before.manifestHash,
      manifestHashAfter: after.manifestHash,
      registrationGeneration: catalog.generation
    });
    this.context = request.context;
    this.catalog = catalog;
    this.toolBindings = calibrationBindings;
    this.receipt = receipt;
    return receipt;
  }
}

export const webMcpRuntime = new WebMcpRuntime();
