import type { CheckoutState, PendingCheckout } from "@/lib/domain/checkout";
import { canonicalJson, sha256Hex } from "@/lib/evidence/digest";

export const OPERATION_TRACE_VERSION = "operation-trace@1.0.0";

const TRACE_TAG = "$toolproofTrace";

export type JsonSafePrimitive = null | boolean | number | string;
export type JsonSafeValue =
  JsonSafePrimitive | readonly JsonSafeValue[] | { readonly [key: string]: JsonSafeValue };

export type OperationTraceSource = "ui" | "native";

export type OperationTraceStatus =
  | "completed"
  | "validation_error"
  | "expected_error"
  | "unexpected_error"
  | "duplicate"
  | "canceled"
  | "partial";

export type CommitDisposition = "none" | "committed" | "replayed" | "partial";

export interface OperationRuntimeIdentity {
  readonly executionPath: "ui" | "native-webmcp";
  readonly origin: string;
  readonly userAgent: string;
  readonly argumentMode: "not-applicable" | "unverified" | "object" | "json-string";
}

export interface OperationFixtureIdentity {
  readonly fixtureId: CheckoutState["fixtureId"];
  readonly fixtureVersion: CheckoutState["fixtureVersion"];
  readonly fixtureSeed: CheckoutState["seed"];
}

export interface CanonicalEvidence {
  readonly value: JsonSafeValue;
  readonly bytes: string;
  readonly sha256: string;
}

export interface RevisionEffect {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly changed: boolean;
}

export interface QuantityEffect {
  readonly itemId: string;
  readonly beforeQuantity: number | null;
  readonly afterQuantity: number | null;
  readonly delta: number | null;
  readonly changed: boolean;
}

export interface PendingCheckoutEffect {
  readonly before: JsonSafeValue;
  readonly after: JsonSafeValue;
  readonly changed: boolean;
}

export interface CheckoutEffectDiff {
  readonly stateChanged: boolean;
  readonly revision: RevisionEffect;
  readonly quantities: readonly QuantityEffect[];
  readonly pendingCheckout: PendingCheckoutEffect;
  /** True when state outside revision, line quantity, or pending checkout changed. */
  readonly unmodeledStateChanged: boolean;
}

export interface OperationTrace {
  readonly traceVersion: typeof OPERATION_TRACE_VERSION;
  readonly eventId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly parentEventId: string | null;
  readonly sequence: number;
  readonly source: OperationTraceSource;
  readonly toolName: string;
  readonly operationId: string | null;
  readonly observedAt: string;
  readonly registryHash: string;
  readonly fixture: OperationFixtureIdentity;
  readonly handlerVersion: string;
  readonly domainVersion: string;
  readonly toolsetVersion: string;
  readonly appCommit: string;
  readonly runtime: OperationRuntimeIdentity;
  readonly status: OperationTraceStatus;
  readonly commitDisposition: CommitDisposition;
  readonly cancellationObservedAfterCommit: boolean;
  readonly cancellationObservedAfterCompletion: boolean;
  readonly rawArguments: CanonicalEvidence;
  readonly canonicalArguments: CanonicalEvidence | null;
  readonly rawResult: CanonicalEvidence | null;
  readonly canonicalResult: CanonicalEvidence | null;
  readonly error: CanonicalEvidence | null;
  readonly stateBefore: CanonicalEvidence;
  readonly stateAfter: CanonicalEvidence;
  readonly effect: CheckoutEffectDiff;
}

export interface CreateOperationTraceInput {
  readonly eventId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly parentEventId?: string | null;
  readonly sequence: number;
  readonly source: OperationTraceSource;
  readonly toolName: string;
  readonly operationId?: string | null;
  readonly observedAt: string;
  readonly registryHash: string;
  readonly handlerVersion: string;
  readonly domainVersion: string;
  readonly toolsetVersion: string;
  readonly appCommit: string;
  readonly runtime: OperationRuntimeIdentity;
  readonly status: OperationTraceStatus;
  readonly commitDisposition: CommitDisposition;
  readonly cancellationObservedAfterCommit?: boolean | (() => boolean);
  readonly cancellationObservedAfterCompletion?: boolean | (() => boolean);
  readonly rawArguments: unknown;
  readonly rawArgumentsAreNormalized?: boolean;
  readonly canonicalArguments?: unknown;
  readonly rawResult?: unknown;
  readonly canonicalResult?: unknown;
  readonly error?: unknown;
  readonly stateBefore: CheckoutState;
  readonly stateAfter: CheckoutState;
}

interface NormalizeContext {
  readonly references: WeakMap<object, string>;
}

function tagged(kind: string, fields: Record<string, JsonSafeValue> = {}): JsonSafeValue {
  return { [TRACE_TAG]: kind, ...fields };
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function thrownSummary(error: unknown): JsonSafeValue {
  try {
    if (error instanceof Error) {
      return tagged("thrown", { name: error.name, message: error.message });
    }

    return tagged("thrown", { value: String(error) });
  } catch {
    return tagged("thrown", { value: "unreadable" });
  }
}

function normalizeNumber(value: number): JsonSafeValue {
  if (Number.isNaN(value)) return tagged("number", { value: "NaN" });
  if (value === Number.POSITIVE_INFINITY) return tagged("number", { value: "Infinity" });
  if (value === Number.NEGATIVE_INFINITY) return tagged("number", { value: "-Infinity" });
  if (Object.is(value, -0)) return tagged("number", { value: "-0" });
  return value;
}

function propertyKeyEvidence(key: PropertyKey): JsonSafeValue {
  if (typeof key !== "symbol") return { kind: "string", value: String(key) };
  return {
    kind: "symbol",
    globalKey: Symbol.keyFor(key) ?? null,
    description: key.description ?? ""
  };
}

function functionName(value: unknown): JsonSafeValue {
  if (typeof value !== "function") return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "name");
  return typeof descriptor?.value === "string" ? descriptor.value : "anonymous";
}

function prototypeEvidence(prototype: object | null): JsonSafeValue {
  if (prototype === null) return "null";
  if (prototype === Object.prototype) return "Object.prototype";
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return tagged("prototype", {
    constructor:
      typeof constructor === "function" ? functionName(constructor as () => unknown) : "unknown"
  });
}

function descriptorEvidence(
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  path: string,
  context: NormalizeContext
): JsonSafeValue {
  const common: Record<string, JsonSafeValue> = {
    key: propertyKeyEvidence(key),
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false
  };
  if ("value" in descriptor) {
    return {
      ...common,
      descriptor: "data",
      writable: descriptor.writable ?? false,
      value: normalizeUnknown(descriptor.value, path, context)
    };
  }
  return {
    ...common,
    descriptor: "accessor",
    get: functionName(descriptor.get),
    set: functionName(descriptor.set)
  };
}

function ownDescriptors(value: object): readonly [PropertyKey, PropertyDescriptor][] {
  return Reflect.ownKeys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new TypeError("Own property descriptor disappeared during capture.");
    return [key, descriptor] as const;
  });
}

function normalizeArray(value: unknown[], path: string, context: NormalizeContext): JsonSafeValue {
  const allDescriptors = ownDescriptors(value);
  const lengthDescriptor = allDescriptors.find(([key]) => key === "length")?.[1];
  const length =
    lengthDescriptor && "value" in lengthDescriptor && Number.isSafeInteger(lengthDescriptor.value)
      ? (lengthDescriptor.value as number)
      : 0;
  const descriptors = allDescriptors.filter(([key]) => key !== "length");
  const simple = descriptors.every(([key, descriptor]) => {
    if (typeof key !== "string" || !("value" in descriptor) || !descriptor.enumerable) return false;
    const index = Number(key);
    return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
  });

  if (simple) {
    const byIndex = new Map(
      descriptors.map(([key, descriptor]) => [Number(key), descriptor] as const)
    );
    return Array.from({ length }, (_, index) => {
      const descriptor = byIndex.get(index);
      return descriptor && "value" in descriptor
        ? normalizeUnknown(descriptor.value, `${path}/${index}`, context)
        : tagged("array_hole");
    });
  }

  return tagged("array_descriptors", {
    length,
    entries: descriptors.map(([key, descriptor], index) =>
      descriptorEvidence(key, descriptor, `${path}/descriptors/${index}`, context)
    )
  });
}

function normalizeObject(value: object, path: string, context: NormalizeContext): JsonSafeValue {
  const priorPath = context.references.get(value);
  if (priorPath !== undefined) return tagged("reference", { path: priorPath });
  context.references.set(value, path);

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time)
      ? tagged("date", { value: "invalid" })
      : tagged("date", { value: value.toISOString() });
  }

  if (value instanceof RegExp) {
    return tagged("regexp", { source: value.source, flags: value.flags });
  }

  if (value instanceof Error) {
    const fields: Record<string, JsonSafeValue> = {
      name: value.name,
      message: value.message
    };
    if ("cause" in value) {
      fields.cause = normalizeUnknown(value.cause, `${path}/cause`, context);
    }
    return tagged("error", fields);
  }

  if (Array.isArray(value)) {
    return normalizeArray(value, path, context);
  }

  if (value instanceof Map) {
    const entries: JsonSafeValue[] = [];
    let index = 0;
    for (const [key, entryValue] of value.entries()) {
      entries.push([
        normalizeUnknown(key, `${path}/entries/${index}/0`, context),
        normalizeUnknown(entryValue, `${path}/entries/${index}/1`, context)
      ]);
      index += 1;
    }
    return tagged("map", { entries });
  }

  if (value instanceof Set) {
    const values: JsonSafeValue[] = [];
    let index = 0;
    for (const entry of value.values()) {
      values.push(normalizeUnknown(entry, `${path}/values/${index}`, context));
      index += 1;
    }
    return tagged("set", { values });
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return tagged("binary", {
      type: value.constructor.name,
      bytes: Array.from(bytes)
    });
  }

  if (value instanceof ArrayBuffer) {
    return tagged("binary", {
      type: "ArrayBuffer",
      bytes: Array.from(new Uint8Array(value))
    });
  }

  let descriptors: readonly [PropertyKey, PropertyDescriptor][];
  let prototype: object | null;
  try {
    descriptors = ownDescriptors(value);
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch (error) {
    return tagged("unreadable_object", { error: thrownSummary(error) });
  }

  const plainDataObject =
    prototype === Object.prototype &&
    descriptors.every(
      ([key, descriptor]) =>
        typeof key === "string" && descriptor.enumerable === true && "value" in descriptor
    );
  if (!plainDataObject) {
    return tagged("object_descriptors", {
      prototype: prototypeEvidence(prototype),
      entries: descriptors.map(([key, descriptor], index) =>
        descriptorEvidence(key, descriptor, `${path}/descriptors/${index}`, context)
      )
    });
  }

  const entries: Record<string, JsonSafeValue> = {};
  const sortedDescriptors = [...descriptors].sort(([left], [right]) =>
    String(left).localeCompare(String(right))
  );
  for (const [key, descriptor] of sortedDescriptors) {
    const stringKey = key as string;
    const entry = normalizeUnknown(
      descriptor.value,
      `${path}/${escapeJsonPointerSegment(stringKey)}`,
      context
    );
    Object.defineProperty(entries, stringKey, {
      value: entry,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }

  if (Object.hasOwn(entries, TRACE_TAG)) {
    return tagged("escaped_object", {
      entries: Object.entries(entries).map(([key, entry]) => [key, entry])
    });
  }

  return entries;
}

function normalizeUnknown(value: unknown, path: string, context: NormalizeContext): JsonSafeValue {
  switch (typeof value) {
    case "undefined":
      return tagged("undefined");
    case "boolean":
    case "string":
      return value;
    case "number":
      return normalizeNumber(value);
    case "bigint":
      return tagged("bigint", { value: value.toString() });
    case "symbol":
      return tagged("symbol", {
        value: Symbol.keyFor(value) ?? value.description ?? ""
      });
    case "function":
      return tagged("function", { name: functionName(value) });
    case "object":
      if (value === null) return null;
      try {
        return normalizeObject(value, path, context);
      } catch (error) {
        return tagged("unreadable_object", { error: thrownSummary(error) });
      }
  }
}

function freezeJson(value: JsonSafeValue): JsonSafeValue {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

export function normalizeJsonSafe(value: unknown): JsonSafeValue {
  const context = { references: new WeakMap<object, string>() };
  try {
    return freezeJson(normalizeUnknown(value, "#", context));
  } catch (error) {
    return freezeJson(tagged("unreadable_value", { error: thrownSummary(error) }));
  }
}

function snapshotEnumerableUnknown(
  value: unknown,
  path: string,
  references: WeakMap<object, string>
): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" || typeof value === "bigint"
      ? normalizeJsonSafe(value)
      : value;
  }
  const priorPath = references.get(value);
  if (priorPath !== undefined) return tagged("reference", { path: priorPath });
  references.set(value, path);

  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length =
        lengthDescriptor &&
        "value" in lengthDescriptor &&
        Number.isSafeInteger(lengthDescriptor.value)
          ? (lengthDescriptor.value as number)
          : 0;
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        snapshot[index] = !descriptor
          ? undefined
          : "value" in descriptor
            ? snapshotEnumerableUnknown(descriptor.value, `${path}/${index}`, references)
            : tagged("accessor");
      }
      return Object.freeze(snapshot);
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return tagged("non_json_object", { prototype: prototypeEvidence(prototype) });
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      const entry =
        "value" in descriptor
          ? snapshotEnumerableUnknown(
              descriptor.value,
              `${path}/${escapeJsonPointerSegment(key)}`,
              references
            )
          : tagged("accessor");
      Object.defineProperty(snapshot, key, {
        value: entry,
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return Object.freeze(snapshot);
  } catch (error) {
    return tagged("unreadable_object", { error: thrownSummary(error) });
  }
}

/** Capture enumerable JSON/data semantics without invoking accessors or retaining caller objects. */
export function snapshotEnumerableData(value: unknown): unknown {
  return snapshotEnumerableUnknown(value, "#", new WeakMap<object, string>());
}

export async function canonicalEvidence(value: unknown): Promise<CanonicalEvidence> {
  const normalized = normalizeJsonSafe(value);
  return canonicalEvidenceFromNormalized(normalized);
}

export async function canonicalEvidenceFromNormalized(
  normalized: JsonSafeValue
): Promise<CanonicalEvidence> {
  const bytes = canonicalJson(normalized);
  const sha256 = await sha256Hex(bytes);
  return Object.freeze({ value: normalized, bytes, sha256 });
}

function pendingSnapshot(value: PendingCheckout | null): JsonSafeValue {
  return normalizeJsonSafe(value);
}

function lineQuantities(state: CheckoutState): Map<string, number> {
  return new Map(state.lines.map(({ itemId, quantity }) => [itemId, quantity]));
}

function stateWithoutModeledEffects(
  state: CheckoutState,
  retainedItemIds: ReadonlySet<string>
): JsonSafeValue {
  return normalizeJsonSafe({
    fixtureId: state.fixtureId,
    fixtureVersion: state.fixtureVersion,
    seed: state.seed,
    currency: state.currency,
    lines: state.lines
      .filter(({ itemId }) => retainedItemIds.has(itemId))
      .map(({ itemId, name, unitPriceCents }) => ({ itemId, name, unitPriceCents })),
    fulfillment: state.fulfillment
  });
}

export function checkoutEffectDiff(
  before: CheckoutState,
  after: CheckoutState
): CheckoutEffectDiff {
  const beforeQuantities = lineQuantities(before);
  const afterQuantities = lineQuantities(after);
  const itemIds = [...new Set([...beforeQuantities.keys(), ...afterQuantities.keys()])].sort();
  const retainedItemIds = new Set(
    itemIds.filter((itemId) => beforeQuantities.has(itemId) && afterQuantities.has(itemId))
  );
  const quantities = itemIds.map((itemId): QuantityEffect => {
    const beforeQuantity = beforeQuantities.get(itemId) ?? null;
    const afterQuantity = afterQuantities.get(itemId) ?? null;
    return Object.freeze({
      itemId,
      beforeQuantity,
      afterQuantity,
      delta:
        beforeQuantity === null || afterQuantity === null ? null : afterQuantity - beforeQuantity,
      changed: beforeQuantity !== afterQuantity
    });
  });
  const beforePending = pendingSnapshot(before.pendingCheckout);
  const afterPending = pendingSnapshot(after.pendingCheckout);
  const beforeStateBytes = canonicalJson(normalizeJsonSafe(before));
  const afterStateBytes = canonicalJson(normalizeJsonSafe(after));
  const beforeRemainder = canonicalJson(stateWithoutModeledEffects(before, retainedItemIds));
  const afterRemainder = canonicalJson(stateWithoutModeledEffects(after, retainedItemIds));

  return Object.freeze({
    stateChanged: beforeStateBytes !== afterStateBytes,
    revision: Object.freeze({
      before: before.revision,
      after: after.revision,
      delta: after.revision - before.revision,
      changed: before.revision !== after.revision
    }),
    quantities: Object.freeze(quantities),
    pendingCheckout: Object.freeze({
      before: beforePending,
      after: afterPending,
      changed: canonicalJson(beforePending) !== canonicalJson(afterPending)
    }),
    unmodeledStateChanged: beforeRemainder !== afterRemainder
  });
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
}

function hasOwn(input: CreateOperationTraceInput, key: keyof CreateOperationTraceInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

async function optionalEvidence(
  input: CreateOperationTraceInput,
  key: "canonicalArguments" | "rawResult" | "canonicalResult" | "error"
): Promise<CanonicalEvidence | null> {
  if (!hasOwn(input, key)) return null;
  return canonicalEvidence(input[key]);
}

export async function createOperationTrace(
  input: CreateOperationTraceInput
): Promise<OperationTrace> {
  requireNonEmpty(input.eventId, "eventId");
  requireNonEmpty(input.sessionId, "sessionId");
  requireNonEmpty(input.runId, "runId");
  requireNonEmpty(input.toolName, "toolName");
  requireNonEmpty(input.observedAt, "observedAt");
  requireNonEmpty(input.registryHash, "registryHash");
  requireNonEmpty(input.handlerVersion, "handlerVersion");
  requireNonEmpty(input.domainVersion, "domainVersion");
  requireNonEmpty(input.toolsetVersion, "toolsetVersion");
  requireNonEmpty(input.appCommit, "appCommit");
  requireNonEmpty(input.runtime.origin, "runtime.origin");
  requireNonEmpty(input.runtime.userAgent, "runtime.userAgent");
  if (
    input.stateBefore.fixtureId !== input.stateAfter.fixtureId ||
    input.stateBefore.fixtureVersion !== input.stateAfter.fixtureVersion ||
    input.stateBefore.seed !== input.stateAfter.seed
  ) {
    throw new Error("operation trace cannot cross fixture identities");
  }
  const expectedExecutionPath = input.source === "ui" ? "ui" : "native-webmcp";
  if (input.runtime.executionPath !== expectedExecutionPath) {
    throw new Error("runtime executionPath must match the operation source");
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error("sequence must be a positive safe integer");
  }

  const [
    rawArguments,
    canonicalArguments,
    rawResult,
    canonicalResult,
    error,
    stateBefore,
    stateAfter
  ] = await Promise.all([
    input.rawArgumentsAreNormalized
      ? canonicalEvidenceFromNormalized(input.rawArguments as JsonSafeValue)
      : canonicalEvidence(input.rawArguments),
    optionalEvidence(input, "canonicalArguments"),
    optionalEvidence(input, "rawResult"),
    optionalEvidence(input, "canonicalResult"),
    optionalEvidence(input, "error"),
    canonicalEvidence(input.stateBefore),
    canonicalEvidence(input.stateAfter)
  ]);

  return Object.freeze({
    traceVersion: OPERATION_TRACE_VERSION,
    eventId: input.eventId,
    sessionId: input.sessionId,
    runId: input.runId,
    parentEventId: input.parentEventId ?? null,
    sequence: input.sequence,
    source: input.source,
    toolName: input.toolName,
    operationId: input.operationId ?? null,
    observedAt: input.observedAt,
    registryHash: input.registryHash,
    fixture: Object.freeze({
      fixtureId: input.stateBefore.fixtureId,
      fixtureVersion: input.stateBefore.fixtureVersion,
      fixtureSeed: input.stateBefore.seed
    }),
    handlerVersion: input.handlerVersion,
    domainVersion: input.domainVersion,
    toolsetVersion: input.toolsetVersion,
    appCommit: input.appCommit,
    runtime: Object.freeze({ ...input.runtime }),
    status: input.status,
    commitDisposition: input.commitDisposition,
    cancellationObservedAfterCommit:
      typeof input.cancellationObservedAfterCommit === "function"
        ? input.cancellationObservedAfterCommit()
        : (input.cancellationObservedAfterCommit ?? false),
    cancellationObservedAfterCompletion:
      typeof input.cancellationObservedAfterCompletion === "function"
        ? input.cancellationObservedAfterCompletion()
        : (input.cancellationObservedAfterCompletion ?? false),
    rawArguments,
    canonicalArguments,
    rawResult,
    canonicalResult,
    error,
    stateBefore,
    stateAfter,
    effect: checkoutEffectDiff(input.stateBefore, input.stateAfter)
  });
}

export function appendOperationTrace(
  existing: readonly OperationTrace[],
  trace: OperationTrace
): readonly OperationTrace[] {
  const previous = existing.at(-1);
  if (previous) {
    if (trace.sessionId !== previous.sessionId) {
      throw new Error("cannot append a trace from a different session");
    }
    if (trace.sequence !== previous.sequence + 1) {
      throw new Error("trace sequence must increase by exactly one");
    }
  }
  if (existing.some(({ eventId }) => eventId === trace.eventId)) {
    throw new Error("trace eventId must be unique within the log");
  }

  return Object.freeze([...existing, trace]);
}
