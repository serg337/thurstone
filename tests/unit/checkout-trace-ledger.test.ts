import { describe, expect, it } from "vitest";

import { CheckoutSessionStore, type CheckoutSessionIdKind } from "@/lib/domain/checkout-session";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";

function fixture() {
  let id = 0;
  let tick = 0;
  let registryHash = "a".repeat(64);
  let argumentMode: "unverified" | "object" | "json-string" = "unverified";
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => argumentMode,
    appCommit: "b".repeat(40),
    origin: "https://toolproof.example",
    userAgent: "Chrome/151 test"
  });
  const store = new CheckoutSessionStore({
    clock: () => `2026-08-26T12:00:${String(tick++).padStart(2, "0")}.000Z`,
    idFactory: (kind: CheckoutSessionIdKind) => `${kind}_${++id}`,
    traceSink: ledger
  });
  return {
    ledger,
    store,
    setRegistryHash: (value: string) => {
      registryHash = value;
    },
    setArgumentMode: (value: "unverified" | "object" | "json-string") => {
      argumentMode = value;
    }
  };
}

describe("CheckoutTraceLedger", () => {
  it("finalizes a latched post-completion cancellation in canonical evidence", async () => {
    const traceStarted = Promise.withResolvers<void>();
    const releaseTrace = Promise.withResolvers<void>();
    const ledger = new CheckoutTraceLedger({
      getRegistryHash: () => "a".repeat(64),
      getArgumentMode: () => "object",
      appCommit: "b".repeat(40),
      origin: "https://toolproof.example",
      userAgent: "Chrome/151 test"
    });
    const store = new CheckoutSessionStore({
      traceSink: {
        append: async (event) => {
          traceStarted.resolve();
          await releaseTrace.promise;
          await ledger.append(event);
        },
        archive: (archive) => ledger.archive(archive)
      }
    });
    const controller = new AbortController();

    const operation = store.cartGet({}, { source: "native", signal: controller.signal });
    await traceStarted.promise;
    controller.abort();
    releaseTrace.resolve();
    await expect(operation).resolves.toMatchObject({ ok: true });

    expect(ledger.snapshot().current.at(-1)).toMatchObject({
      status: "completed",
      cancellationObservedAfterCommit: false,
      cancellationObservedAfterCompletion: true
    });
  });

  it("keeps committed evidence authoritative when a view listener throws", async () => {
    const { ledger, store } = fixture();
    ledger.subscribe(() => {
      throw new Error("view failed");
    });

    await expect(store.cartGet({})).resolves.toMatchObject({ ok: true });
    expect(store.getSnapshot().haltedReason).toBeNull();
    expect(ledger.snapshot().current).toEqual([
      expect.objectContaining({ status: "completed", commitDisposition: "none" })
    ]);
  });

  it("adapts session events into complete canonical operation evidence", async () => {
    const { ledger, store, setArgumentMode } = fixture();
    await store.cartGet({}, { source: "native" });
    await store.cartUpdate(
      {
        operationId: "update_0123456789",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 3
      },
      { source: "ui" }
    );
    setArgumentMode("json-string");
    await store.orderReview({}, { source: "native" });

    const snapshot = ledger.snapshot();
    expect(snapshot.current).toHaveLength(3);
    expect(snapshot.current.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(snapshot.current[0]).toMatchObject({
      sessionId: "session_1",
      runId: "trajectory_2",
      source: "native",
      toolName: "cart_get",
      registryHash: "a".repeat(64),
      handlerVersion: "cart_get@1.0.0",
      domainVersion: "checkout-domain@1.0.0",
      toolsetVersion: "checkout-toolset-v1@1.0.0",
      appCommit: "b".repeat(40),
      fixture: {
        fixtureId: "checkout-seed-v1",
        fixtureVersion: "checkout-fixture@1.0.0",
        fixtureSeed: "toolproof-checkout-seed-001"
      },
      runtime: {
        executionPath: "native-webmcp",
        origin: "https://toolproof.example",
        userAgent: "Chrome/151 test",
        argumentMode: "unverified"
      }
    });
    expect(snapshot.current[1]).toMatchObject({
      source: "ui",
      toolName: "cart_update",
      operationId: "update_0123456789",
      status: "completed",
      commitDisposition: "committed",
      runtime: { executionPath: "ui", argumentMode: "not-applicable" },
      effect: {
        stateChanged: true,
        revision: { before: 0, after: 1, delta: 1 },
        pendingCheckout: { changed: false }
      }
    });
    expect(snapshot.current[2]).toMatchObject({
      toolName: "order_review",
      runtime: { argumentMode: "json-string" }
    });
    expect(snapshot.current[1]?.rawArguments.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.current[1]?.canonicalResult?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.current[2]?.parentEventId).toBe(snapshot.current[1]?.eventId);
    expect(JSON.stringify(snapshot)).not.toMatch(/expected|score|semanticFamily|subset/iu);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("stores a captured tagged raw value once without escaping the evidence encoding", async () => {
    const { ledger, store } = fixture();
    const input = Object.create(null) as Record<string, never>;
    Object.defineProperty(input, Symbol.toPrimitive, {
      value: () => "{}",
      enumerable: false
    });

    await expect(store.cartGet(input, { source: "native" })).resolves.toMatchObject({ ok: true });
    expect(ledger.snapshot().current[0]?.rawArguments.value).toMatchObject({
      $toolproofTrace: "object_descriptors"
    });
    expect(ledger.snapshot().current[0]?.rawArguments.value).not.toMatchObject({
      $toolproofTrace: "escaped_object"
    });
  });

  it("archives the old trajectory and keeps the verified-reset trace separate", async () => {
    const { ledger, store, setRegistryHash } = fixture();
    await store.cartUpdate({
      operationId: "update_0123456789",
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 2
    });
    const oldTrajectoryId = store.getSnapshot().trajectoryId;
    setRegistryHash("c".repeat(64));

    const reset = await store.hardReset();
    const snapshot = ledger.snapshot();

    expect(reset).toMatchObject({
      receiptScope: "domain_core",
      registryVerification: "pending",
      core: { stateRevision: 0, currentOperationCount: 0 }
    });
    expect(store.inspect()).toMatchObject({ currentTraceCount: 0, currentOperationCount: 0 });
    expect(snapshot.current).toEqual([]);
    expect(snapshot.archives).toHaveLength(1);
    expect(snapshot.archives[0]).toMatchObject({
      trajectoryId: oldTrajectoryId,
      archivedByResetId: reset.resetId,
      traces: [{ toolName: "cart_update" }]
    });
    expect(snapshot.lastResetTrace).toMatchObject({
      toolName: "fixture_reset",
      status: "completed",
      registryHash: "c".repeat(64),
      runId: reset.trajectoryId,
      effect: { stateChanged: true, revision: { before: 1, after: 0 } }
    });
    expect(snapshot.totalTraceCount).toBe(2);

    await store.cartGet({});
    const afterRead = ledger.snapshot();
    expect(afterRead.current).toHaveLength(1);
    expect(afterRead.current[0]?.parentEventId).toBe(afterRead.lastResetTrace?.eventId);
    expect(afterRead.current[0]?.runId).toBe(reset.trajectoryId);

    await store.hardReset();
    const afterSecondReset = ledger.snapshot();
    expect(afterSecondReset.resetTraces).toHaveLength(2);
    expect(afterSecondReset.archives).toHaveLength(2);
    expect(afterSecondReset.current).toEqual([]);
    expect(afterSecondReset.totalTraceCount).toBe(4);
  });
});
