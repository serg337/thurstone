import { describe, expect, it } from "vitest";

import {
  appendOperationTrace,
  canonicalEvidence,
  checkoutEffectDiff,
  createOperationTrace,
  normalizeJsonSafe,
  type OperationTrace
} from "@/lib/evidence/operation-trace";
import { cartUpdate, checkoutRequest, createCheckoutFixture } from "@/lib/domain/checkout";

const registryHash = "a".repeat(64);
const appCommit = "b".repeat(40);
const nativeRuntime = {
  executionPath: "native-webmcp" as const,
  origin: "https://toolproof.example",
  userAgent: "Chrome/151 test",
  argumentMode: "json-string" as const
};

function baseTraceInput(sequence: number) {
  const state = createCheckoutFixture();
  return {
    eventId: `event-${sequence}`,
    sessionId: "session-1",
    runId: "plumbing-run-1",
    sequence,
    source: "native" as const,
    toolName: "cart_get",
    observedAt: `2026-08-26T12:00:0${sequence}.000Z`,
    registryHash,
    handlerVersion: "cart_get@1.0.0",
    domainVersion: "checkout-domain@1.0.0",
    toolsetVersion: "checkout-toolset-v1@1.0.0",
    appCommit,
    runtime: nativeRuntime,
    status: "completed" as const,
    commitDisposition: "none" as const,
    rawArguments: {},
    canonicalArguments: {},
    rawResult: { ok: true },
    canonicalResult: { ok: true },
    stateBefore: state,
    stateAfter: state
  };
}

describe("operation trace normalization", () => {
  it("serializes cyclic and non-JSON raw values without throwing", () => {
    const raw: Record<string, unknown> = {
      undefinedValue: undefined,
      nan: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      negativeZero: -0,
      bigint: 42n
    };
    raw.self = raw;

    const normalized = normalizeJsonSafe(raw);

    expect(() => JSON.stringify(normalized)).not.toThrow();
    expect(normalized).toEqual({
      bigint: { $toolproofTrace: "bigint", value: "42" },
      nan: { $toolproofTrace: "number", value: "NaN" },
      negativeInfinity: { $toolproofTrace: "number", value: "-Infinity" },
      negativeZero: { $toolproofTrace: "number", value: "-0" },
      positiveInfinity: { $toolproofTrace: "number", value: "Infinity" },
      self: { $toolproofTrace: "reference", path: "#" },
      undefinedValue: { $toolproofTrace: "undefined" }
    });
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("distinguishes sparse array holes from explicit undefined entries", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = undefined;

    expect(normalizeJsonSafe(sparse)).toEqual([
      { $toolproofTrace: "array_hole" },
      { $toolproofTrace: "undefined" }
    ]);
  });

  it("escapes objects that could collide with internal tagged values", () => {
    expect(normalizeJsonSafe({ $toolproofTrace: "undefined" })).toEqual({
      $toolproofTrace: "escaped_object",
      entries: [["$toolproofTrace", "undefined"]]
    });
  });

  it("preserves a JSON __proto__ key without changing the normalized prototype", () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as unknown;
    const normalized = normalizeJsonSafe(raw);

    expect(JSON.parse(JSON.stringify(normalized))).toEqual(
      JSON.parse('{"__proto__":{"polluted":true},"ok":1}')
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("captures accessor descriptors without invoking getters", () => {
    let reads = 0;
    const raw = {};
    Object.defineProperty(raw, "danger", {
      enumerable: true,
      configurable: false,
      get: () => {
        reads += 1;
        throw new Error("getter must not run");
      }
    });

    const normalized = normalizeJsonSafe(raw);

    expect(reads).toBe(0);
    expect(normalized).toMatchObject({
      $toolproofTrace: "object_descriptors",
      prototype: "Object.prototype",
      entries: [
        {
          key: { kind: "string", value: "danger" },
          descriptor: "accessor",
          enumerable: true,
          configurable: false
        }
      ]
    });
  });

  it("retains symbol keys, null prototypes, and ordinary constructor keys", () => {
    const symbol = Symbol("secret");
    const withSymbol: Record<PropertyKey, unknown> = { visible: 1 };
    withSymbol[symbol] = 2;
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      value: 3
    });
    const constructorKey = JSON.parse('{"constructor":{"safe":true}}') as unknown;

    expect(normalizeJsonSafe(withSymbol)).toMatchObject({
      $toolproofTrace: "object_descriptors",
      entries: expect.arrayContaining([
        expect.objectContaining({
          key: { kind: "symbol", globalKey: null, description: "secret" },
          descriptor: "data",
          value: 2
        })
      ])
    });
    expect(normalizeJsonSafe(nullPrototype)).toMatchObject({
      $toolproofTrace: "object_descriptors",
      prototype: "null"
    });
    expect(normalizeJsonSafe(constructorKey)).toEqual({ constructor: { safe: true } });
    expect(({} as { safe?: boolean }).safe).toBeUndefined();
  });

  it("produces deterministic bytes and SHA-256 across object key order", async () => {
    const first = await canonicalEvidence({ z: 3, a: { y: 2, x: 1 } });
    const second = await canonicalEvidence({ a: { x: 1, y: 2 }, z: 3 });

    expect(first.bytes).toBe('{"a":{"x":1,"y":2},"z":3}');
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });
});

describe("checkout effect diff", () => {
  it("normalizes revision and every item quantity in stable item order", () => {
    const before = createCheckoutFixture();
    const after = cartUpdate(before, {
      operationId: "update_0123456789",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 4
    }).state;

    expect(checkoutEffectDiff(before, after)).toEqual({
      stateChanged: true,
      revision: { before: 0, after: 1, delta: 1, changed: true },
      quantities: [
        {
          itemId: "field-notebook",
          beforeQuantity: 1,
          afterQuantity: 1,
          delta: 0,
          changed: false
        },
        {
          itemId: "stoneware-mug",
          beforeQuantity: 2,
          afterQuantity: 4,
          delta: 2,
          changed: true
        }
      ],
      pendingCheckout: { before: null, after: null, changed: false },
      unmodeledStateChanged: false
    });
  });

  it("captures the exact pending-checkout transition", () => {
    const before = createCheckoutFixture();
    const after = checkoutRequest(
      before,
      { operationId: "request_012345678" },
      "c".repeat(64)
    ).state;
    const diff = checkoutEffectDiff(before, after);

    expect(diff.pendingCheckout).toEqual({
      before: null,
      after: {
        cartSnapshotHash: "c".repeat(64),
        orderTotalCents: 7300,
        pendingId: "pending_cccccccccccc_12345678",
        requestOperationId: "request_012345678",
        requestedFromRevision: 0,
        status: "pending_human_approval"
      },
      changed: true
    });
    expect(diff.quantities.every(({ changed }) => !changed)).toBe(true);
    expect(diff.unmodeledStateChanged).toBe(false);
  });
});

describe("operation traces", () => {
  it("separates raw and canonical artifacts and derives hashes and effects", async () => {
    const before = createCheckoutFixture();
    const transition = cartUpdate(before, {
      operationId: "update_0123456789",
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 2
    });
    const trace = await createOperationTrace({
      eventId: "event-1",
      sessionId: "session-1",
      runId: "plumbing-run-1",
      sequence: 1,
      source: "ui",
      toolName: "cart_update",
      operationId: "update_0123456789",
      observedAt: "2026-08-26T12:00:01.000Z",
      registryHash,
      handlerVersion: "cart_update@1.0.0",
      domainVersion: "checkout-domain@1.0.0",
      toolsetVersion: "checkout-toolset-v1@1.0.0",
      appCommit,
      runtime: {
        executionPath: "ui",
        origin: "https://toolproof.example",
        userAgent: "Chrome/151 test",
        argumentMode: "not-applicable"
      },
      status: "completed",
      commitDisposition: "committed",
      rawArguments: { quantity: "2", itemId: "field-notebook" },
      canonicalArguments: {
        operationId: "update_0123456789",
        operation: "set_quantity",
        itemId: "field-notebook",
        quantity: 2
      },
      rawResult: transition.result,
      canonicalResult: transition.result,
      stateBefore: before,
      stateAfter: transition.state
    });

    expect(trace.rawArguments.value).toEqual({ itemId: "field-notebook", quantity: "2" });
    expect(trace.canonicalArguments?.value).toMatchObject({ quantity: 2 });
    expect(trace).toMatchObject({
      runId: "plumbing-run-1",
      fixture: {
        fixtureId: "checkout-seed-v1",
        fixtureVersion: "checkout-fixture@1.0.0",
        fixtureSeed: "toolproof-checkout-seed-001"
      },
      handlerVersion: "cart_update@1.0.0",
      domainVersion: "checkout-domain@1.0.0",
      toolsetVersion: "checkout-toolset-v1@1.0.0",
      runtime: { executionPath: "ui", argumentMode: "not-applicable" }
    });
    expect(trace.stateBefore.sha256).not.toBe(trace.stateAfter.sha256);
    expect(trace.canonicalResult?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.effect.quantities.find(({ itemId }) => itemId === "field-notebook")).toMatchObject(
      { beforeQuantity: 1, afterQuantity: 2, changed: true }
    );
    expect(trace).not.toHaveProperty("expected");
    expect(trace).not.toHaveProperty("score");
    expect(Object.isFrozen(trace)).toBe(true);
  });

  it("distinguishes absent artifacts from a captured null result", async () => {
    const absent = await createOperationTrace({
      ...baseTraceInput(1),
      rawResult: undefined,
      canonicalResult: null
    });
    const input = baseTraceInput(1);
    const { rawResult, canonicalResult, ...withoutResults } = input;
    const omitted = await createOperationTrace(withoutResults);

    expect(rawResult).toEqual({ ok: true });
    expect(canonicalResult).toEqual({ ok: true });
    expect(absent.rawResult?.value).toEqual({ $toolproofTrace: "undefined" });
    expect(absent.canonicalResult?.value).toBeNull();
    expect(omitted.rawResult).toBeNull();
    expect(omitted.canonicalResult).toBeNull();
  });

  it("appends immutably with a single-session monotonic sequence", async () => {
    const first = await createOperationTrace(baseTraceInput(1));
    const second = await createOperationTrace(baseTraceInput(2));
    const initial = Object.freeze([]) as readonly OperationTrace[];
    const one = appendOperationTrace(initial, first);
    const two = appendOperationTrace(one, second);

    expect(initial).toHaveLength(0);
    expect(one).toEqual([first]);
    expect(two).toEqual([first, second]);
    expect(Object.isFrozen(two)).toBe(true);

    await expect(
      createOperationTrace({ ...baseTraceInput(4), eventId: "event-4" }).then((trace) =>
        appendOperationTrace(two, trace)
      )
    ).rejects.toThrow("increase by exactly one");
    await expect(
      createOperationTrace({
        ...baseTraceInput(3),
        eventId: "event-3",
        sessionId: "session-2"
      }).then((trace) => appendOperationTrace(two, trace))
    ).rejects.toThrow("different session");
  });
});
