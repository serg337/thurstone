import { describe, expect, it } from "vitest";

import {
  CheckoutSessionStore,
  type CheckoutSessionIdKind,
  type CheckoutSessionTraceEvent,
  type CheckoutTrajectoryArchive
} from "@/lib/domain/checkout-session";

const updateId = "update_0123456789";
const secondUpdateId = "update_9876543210";
const requestId = "request_012345678";
const cancelId = "cancel_0123456789";
const terminalErrorId = "error_01234567890";

function deterministicStore(
  options: ConstructorParameters<typeof CheckoutSessionStore>[0] = {}
): CheckoutSessionStore {
  let id = 0;
  let tick = 0;
  return new CheckoutSessionStore({
    clock: () => `2026-08-26T12:00:${String(tick++).padStart(2, "0")}.000Z`,
    idFactory: (kind: CheckoutSessionIdKind) => `${kind}_${++id}`,
    ...options
  });
}

function updateInput(operationId = updateId, quantity = 3) {
  return {
    operationId,
    operation: "set_quantity" as const,
    itemId: "stoneware-mug" as const,
    quantity
  };
}

describe("CheckoutSessionStore", () => {
  it("serves deterministic reads and strictly rejects undeclared arguments", async () => {
    const store = deterministicStore();
    const initial = store.getSnapshot().state;

    await expect(store.cartGet({})).resolves.toEqual({
      ok: true,
      fixtureId: "checkout-seed-v1",
      stateRevision: 0,
      lines: [
        { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
        { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
      ]
    });
    const review = await store.orderReview({});
    expect(review).toMatchObject({ ok: true, subtotalCents: 6600, totalCents: 7300 });

    const invalidRead = await store.cartGet({ extra: true });
    expect(invalidRead).toMatchObject({
      ok: false,
      code: "invalid_arguments",
      replayed: false,
      stateRevision: 0
    });
    const invalidMutation = await store.cartUpdate({ ...updateInput(), quantity: 2.5 });
    expect(invalidMutation).toMatchObject({ ok: false, code: "invalid_quantity" });

    expect(store.getSnapshot().state).toBe(initial);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 0,
      retainedTombstoneCount: 0,
      currentTraceCount: 4
    });
  });

  it("applies a canonical mutation once and replays its original receipt", async () => {
    const store = deterministicStore();
    const commits: string[] = [];
    store.subscribe(({ toolName }) => {
      commits.push(toolName);
    });

    const original = await store.cartUpdate(updateInput());
    const replay = await store.cartUpdate({
      quantity: 3,
      itemId: "stoneware-mug",
      operation: "set_quantity",
      operationId: updateId
    });

    expect(original).toMatchObject({
      ok: true,
      code: "updated",
      replayed: false,
      stateRevision: 1
    });
    expect(replay).toEqual({ ...original, replayed: true });
    expect(store.getSnapshot().state).toMatchObject({ revision: 1 });
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
    expect(commits).toEqual(["cart_update"]);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 1,
      retainedTombstoneCount: 1
    });
    expect(store.currentTrajectory().map(({ outcome }) => outcome)).toEqual([
      "completed",
      "duplicate"
    ]);
  });

  it("rejects reuse of one operation ID across mutation tools or commands", async () => {
    const store = deterministicStore();
    await store.cartUpdate(updateInput());

    const crossTool = await store.checkoutCancel({ operationId: updateId });
    const changedCommand = await store.cartUpdate(updateInput(updateId, 4));

    expect(crossTool).toMatchObject({
      ok: false,
      code: "operation_id_conflict",
      operationId: updateId,
      replayed: false,
      stateRevision: 1
    });
    expect(changedCommand).toMatchObject({ ok: false, code: "operation_id_conflict" });
    expect(store.getSnapshot().state.revision).toBe(1);
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 1,
      retainedTombstoneCount: 1
    });
  });

  it("tombstones expected terminal errors and replays them after state changes", async () => {
    const store = deterministicStore();
    const first = await store.checkoutCancel({ operationId: terminalErrorId });
    expect(first).toMatchObject({
      ok: false,
      code: "no_pending_checkout",
      operationId: terminalErrorId,
      replayed: false,
      stateRevision: 0
    });

    const requested = await store.checkoutRequest({ operationId: requestId });
    expect(requested).toMatchObject({ ok: true, code: "pending_human_approval" });
    const replay = await store.checkoutCancel({ operationId: terminalErrorId });

    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.getSnapshot().state.pendingCheckout).not.toBeNull();
    expect(store.getSnapshot().state.revision).toBe(1);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 2,
      retainedTombstoneCount: 2
    });
  });

  it("distinguishes correctable validation from consumed precondition outcomes", async () => {
    const store = deterministicStore();
    const invalid = await store.cartUpdate({ ...updateInput(), quantity: 11 });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_quantity", retryable: true });
    await expect(store.cartUpdate(updateInput())).resolves.toMatchObject({
      ok: true,
      code: "updated",
      replayed: false
    });

    await store.checkoutRequest({ operationId: requestId });
    const blockedId = "blocked_012345678";
    const blocked = await store.cartUpdate(updateInput(blockedId, 4));
    expect(blocked).toMatchObject({ ok: false, code: "checkout_pending", retryable: false });
    await store.checkoutCancel({ operationId: cancelId });
    await expect(store.cartUpdate(updateInput(blockedId, 4))).resolves.toEqual({
      ...blocked,
      replayed: true
    });
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
  });

  it("records a successful no-op without changing state or notifying subscribers", async () => {
    const store = deterministicStore();
    const before = store.getSnapshot().state;
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    const result = await store.cartUpdate({
      operationId: updateId,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 1
    });

    expect(result).toMatchObject({ ok: true, code: "no_change", stateRevision: 0 });
    expect(store.getSnapshot().state).toBe(before);
    expect(notifications).toBe(0);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 1,
      retainedTombstoneCount: 1
    });
    expect(store.currentTrajectory().at(-1)).toMatchObject({
      effectApplied: false,
      commitDisposition: "none"
    });
  });

  it("serializes concurrent duplicates so exactly one effect is applied", async () => {
    const store = deterministicStore();

    const [first, second] = await Promise.all([
      store.cartUpdate(updateInput()),
      store.cartUpdate(updateInput())
    ]);

    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(store.getSnapshot().state.revision).toBe(1);
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 1,
      retainedTombstoneCount: 1
    });
  });

  it("serializes distinct concurrent cart updates without losing either effect", async () => {
    const store = deterministicStore();

    const [mug, notebook] = await Promise.all([
      store.cartUpdate(updateInput()),
      store.cartUpdate({
        operationId: secondUpdateId,
        operation: "set_quantity",
        itemId: "field-notebook",
        quantity: 4
      })
    ]);

    expect(mug).toMatchObject({ ok: true, stateRevision: 1 });
    expect(notebook).toMatchObject({ ok: true, stateRevision: 2 });
    expect(store.getSnapshot().state).toMatchObject({ revision: 2 });
    expect(store.getSnapshot().state.lines).toEqual([
      expect.objectContaining({ itemId: "field-notebook", quantity: 4 }),
      expect.objectContaining({ itemId: "stoneware-mug", quantity: 3 })
    ]);
    expect(store.inspect()).toMatchObject({ currentOperationCount: 2, retainedTombstoneCount: 2 });
  });

  it("serializes distinct concurrent checkout commands in call order", async () => {
    const store = deterministicStore();

    const [requested, canceled] = await Promise.all([
      store.checkoutRequest({ operationId: requestId }),
      store.checkoutCancel({ operationId: cancelId })
    ]);

    expect(requested).toMatchObject({
      ok: true,
      code: "pending_human_approval",
      stateRevision: 1
    });
    expect(canceled).toMatchObject({ ok: true, code: "checkout_canceled", stateRevision: 2 });
    expect(store.getSnapshot().state).toMatchObject({ revision: 2, pendingCheckout: null });
    expect(store.currentTrajectory().map(({ toolName }) => toolName)).toEqual([
      "checkout_request",
      "checkout_cancel"
    ]);
  });

  it("commits state before a handler resolves and holds later calls behind it", async () => {
    const traceStarted = Promise.withResolvers<void>();
    const releaseTrace = Promise.withResolvers<void>();
    const traceSink = {
      append: async (event: CheckoutSessionTraceEvent) => {
        if (event.toolName !== "cart_update") return;
        traceStarted.resolve();
        await releaseTrace.promise;
      }
    };
    const store = deterministicStore({ traceSink });

    const mutation = store.cartUpdate(updateInput());
    await traceStarted.promise;
    expect(store.getSnapshot().state.revision).toBe(1);

    let readResolved = false;
    const read = store.cartGet({}).then((result) => {
      readResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(readResolved).toBe(false);

    releaseTrace.resolve();
    await expect(mutation).resolves.toMatchObject({ ok: true, code: "updated" });
    await expect(read).resolves.toMatchObject({ ok: true, stateRevision: 1 });
  });

  it("hard-resets exact fixture state and current ledger while retaining tombstones", async () => {
    const archived: CheckoutTrajectoryArchive[] = [];
    const store = deterministicStore({
      traceSink: {
        append: () => undefined,
        archive: (trajectory) => {
          archived.push(trajectory);
        }
      }
    });
    const original = await store.cartUpdate(updateInput());
    const receipt = await store.hardReset({ source: "native" });

    expect(receipt).toMatchObject({
      ok: true,
      code: "fixture_reset",
      receiptScope: "domain_core",
      registryVerification: "pending",
      archivedEventCount: 1,
      retainedTombstoneCount: 1,
      core: {
        fixtureId: "checkout-seed-v1",
        fixtureVersion: "checkout-fixture@1.0.0",
        fixtureSeed: "toolproof-checkout-seed-001",
        stateRevision: 0,
        pendingCheckout: null,
        currentOperationCount: 0,
        lines: [
          { itemId: "field-notebook", quantity: 1 },
          { itemId: "stoneware-mug", quantity: 2 }
        ]
      }
    });
    expect(receipt.core.stateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.coreHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 0,
      retainedTombstoneCount: 1,
      currentTraceCount: 0,
      archivedTrajectoryCount: 1,
      lastResetTrace: expect.objectContaining({ toolName: "fixture_reset" })
    });
    expect(store.currentTrajectory()).toEqual([]);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ eventCount: 1, entries: [{ toolName: "cart_update" }] });

    const lateRetry = await store.cartUpdate(updateInput());
    expect(lateRetry).toEqual({ ...original, replayed: true });
    expect(store.getSnapshot().state).toMatchObject({ revision: 0, pendingCheckout: null });
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(2);
    expect(store.inspect().currentOperationCount).toBe(0);
  });

  it("holds tool admission until the exact reset receipt is released", async () => {
    const store = deterministicStore();
    const receipt = await store.hardReset({ source: "ui", holdForVerification: true });

    expect(store.isResetAdmissionLocked()).toBe(true);
    await expect(store.cartGet({})).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(store.currentTrajectory()).toEqual([]);
    expect(store.releaseResetAdmission("wrong-reset")).toBe(false);
    expect(store.releaseResetAdmission(receipt.resetId)).toBe(true);
    expect(store.isResetAdmissionLocked()).toBe(false);
    await expect(store.cartGet({})).resolves.toMatchObject({ ok: true, stateRevision: 0 });
  });

  it("produces the same deterministic reset core despite different histories", async () => {
    const first = deterministicStore();
    const second = deterministicStore();
    await first.cartUpdate(updateInput());
    await second.checkoutCancel({ operationId: terminalErrorId });

    const firstReset = await first.hardReset();
    const secondReset = await second.hardReset();

    expect(firstReset.core).toEqual(secondReset.core);
    expect(firstReset.coreHash).toBe(secondReset.coreHash);
  });

  it("restores the identical fixture from initial, pending, canceled, and error histories", async () => {
    const stores = [
      deterministicStore(),
      deterministicStore(),
      deterministicStore(),
      deterministicStore()
    ];
    await stores[1]?.checkoutRequest({ operationId: requestId });
    await stores[2]?.checkoutRequest({ operationId: requestId });
    await stores[2]?.checkoutCancel({ operationId: cancelId });
    await stores[3]?.checkoutCancel({ operationId: terminalErrorId });

    const receipts = await Promise.all(stores.map((store) => store.hardReset()));
    expect(new Set(receipts.map(({ coreHash }) => coreHash)).size).toBe(1);
    for (const [index, store] of stores.entries()) {
      expect(store.getSnapshot().state, `history ${index}`).toEqual(stores[0]?.getSnapshot().state);
      expect(store.inspect(), `history ${index}`).toMatchObject({
        currentOperationCount: 0,
        currentTraceCount: 0
      });
    }
  });

  it("rejects cancellation before commit without consuming an operation ID", async () => {
    const store = deterministicStore();
    const controller = new AbortController();
    controller.abort();

    await expect(
      store.cartUpdate(updateInput(), { source: "native", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getSnapshot().state.revision).toBe(0);
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 0,
      retainedTombstoneCount: 0
    });
    expect(store.currentTrajectory()).toEqual([
      expect.objectContaining({
        toolName: "cart_update",
        outcome: "canceled",
        cancellation: "before_commit",
        effectApplied: false
      })
    ]);
  });

  it("returns the committed receipt when cancellation arrives after commit", async () => {
    const store = deterministicStore();
    const controller = new AbortController();
    store.subscribe(() => {
      controller.abort();
    });

    const result = await store.cartUpdate(updateInput(), {
      source: "native",
      signal: controller.signal
    });

    expect(result).toMatchObject({ ok: true, code: "updated", stateRevision: 1 });
    expect(store.getSnapshot().state.revision).toBe(1);
    expect(store.getSnapshot().haltedReason).toBeNull();
    expect(store.currentTrajectory().at(-1)).toMatchObject({
      commitDisposition: "committed",
      cancellation: "after_completion",
      effectApplied: true
    });
  });

  it("preserves a post-commit mutation, marks it partial, and halts after subscriber failure", async () => {
    const store = deterministicStore();
    const unsubscribe = store.subscribe(() => {
      throw new Error("render failed");
    });

    const committed = await store.cartUpdate(updateInput());
    expect(committed).toMatchObject({ ok: true, code: "updated", stateRevision: 1 });
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
    expect(store.getSnapshot().haltedReason).toMatchObject({ code: "subscriber_failure" });
    expect(store.currentTrajectory().at(-1)).toMatchObject({
      outcome: "partial",
      commitDisposition: "partial",
      effectApplied: true
    });

    const blocked = await store.orderReview({});
    expect(blocked).toMatchObject({ ok: false, code: "session_halted", stateRevision: 1 });
    expect(store.getSnapshot().state.revision).toBe(1);

    unsubscribe();
    await store.hardReset();
    expect(store.getSnapshot()).toMatchObject({ haltedReason: null, state: { revision: 0 } });
  });

  it("enforces the document-lifetime tombstone bound across hard reset", async () => {
    const store = deterministicStore({ maxTombstones: 1 });
    await store.checkoutCancel({ operationId: terminalErrorId });
    await store.hardReset();

    const full = await store.cartUpdate(updateInput(secondUpdateId));
    expect(full).toMatchObject({
      ok: false,
      code: "operation_ledger_full",
      operationId: secondUpdateId,
      stateRevision: 0
    });
    expect(store.inspect()).toMatchObject({
      currentOperationCount: 0,
      retainedTombstoneCount: 1
    });
    expect(store.getSnapshot().state.revision).toBe(0);
  });

  it("emits monotonically sequenced trace events and archives the prior trajectory", async () => {
    const events: CheckoutSessionTraceEvent[] = [];
    const archives: CheckoutTrajectoryArchive[] = [];
    const store = deterministicStore({
      traceSink: {
        append: (event) => {
          events.push(event);
        },
        archive: (archive) => {
          archives.push(archive);
        }
      }
    });

    await store.cartGet({});
    await store.cartUpdate(updateInput());
    await store.cartUpdate(updateInput());
    const priorTrajectoryId = store.getSnapshot().trajectoryId;
    await store.hardReset();

    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map(({ outcome }) => outcome)).toEqual([
      "completed",
      "completed",
      "duplicate",
      "completed"
    ]);
    expect(new Set(events.map(({ eventId }) => eventId)).size).toBe(4);
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ trajectoryId: priorTrajectoryId, eventCount: 3 });
    expect(events[3]?.trajectoryId).not.toBe(priorTrajectoryId);
  });

  it("captures hostile validation input without invoking traps or changing state", async () => {
    const store = deterministicStore();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new TypeError("hostile ownKeys trap");
        }
      }
    );

    await expect(store.cartGet(hostile)).resolves.toMatchObject({
      ok: false,
      code: "invalid_arguments"
    });
    await expect(store.cartUpdate(hostile)).resolves.toMatchObject({ ok: false });

    expect(store.getSnapshot().state).toMatchObject({ revision: 0, pendingCheckout: null });
    expect(store.inspect()).toMatchObject({ currentOperationCount: 0, retainedTombstoneCount: 0 });
    expect(store.currentTrajectory()).toEqual([
      expect.objectContaining({
        toolName: "cart_get",
        outcome: "validation_error",
        commitDisposition: "none",
        effectApplied: false
      }),
      expect.objectContaining({
        toolName: "cart_update",
        outcome: "validation_error",
        commitDisposition: "none",
        effectApplied: false
      })
    ]);
  });

  it("snapshots raw arguments before queued work or caller mutation", async () => {
    const subscriberStarted = Promise.withResolvers<void>();
    const releaseSubscriber = Promise.withResolvers<void>();
    const events: CheckoutSessionTraceEvent[] = [];
    const store = deterministicStore({
      traceSink: {
        append: (event) => {
          events.push(event);
        }
      }
    });
    store.subscribe(async () => {
      subscriberStarted.resolve();
      await releaseSubscriber.promise;
    });
    const input = updateInput();

    const pending = store.cartUpdate(input);
    await subscriberStarted.promise;
    input.quantity = 9;
    releaseSubscriber.resolve();
    await expect(pending).resolves.toMatchObject({ ok: true, quantity: 3 });

    expect(events).toHaveLength(1);
    expect(events[0]?.rawInput).toMatchObject({ quantity: 3 });
    expect(events[0]?.canonicalInput).toMatchObject({ quantity: 3 });
    expect(store.getSnapshot().state.lines[1]?.quantity).toBe(3);
  });

  it.each(["read", "mutation", "replay", "error", "reset"] as const)(
    "latches cancellation during async %s trace finalization",
    async (kind) => {
      let blockNext = false;
      let traceStarted = Promise.withResolvers<void>();
      let releaseTrace = Promise.withResolvers<void>();
      const captured: CheckoutSessionTraceEvent[] = [];
      const store = deterministicStore({
        traceSink: {
          append: async (event) => {
            captured.push(event);
            if (blockNext) {
              traceStarted.resolve();
              await releaseTrace.promise;
            }
          }
        }
      });
      if (kind === "replay") await store.cartUpdate(updateInput());

      traceStarted = Promise.withResolvers<void>();
      releaseTrace = Promise.withResolvers<void>();
      blockNext = true;
      const controller = new AbortController();
      const operation =
        kind === "read"
          ? store.cartGet({}, { source: "native", signal: controller.signal })
          : kind === "mutation"
            ? store.cartUpdate(updateInput(), { source: "native", signal: controller.signal })
            : kind === "replay"
              ? store.cartUpdate(updateInput(), { source: "native", signal: controller.signal })
              : kind === "error"
                ? store.cartUpdate(
                    { operationId: "short" },
                    { source: "native", signal: controller.signal }
                  )
                : store.hardReset({ source: "native", signal: controller.signal });

      await traceStarted.promise;
      controller.abort(new DOMException("Canceled during trace", "AbortError"));
      releaseTrace.resolve();
      await expect(operation).resolves.toBeDefined();

      const summary =
        kind === "reset" ? store.inspect().lastResetTrace : store.currentTrajectory().at(-1);
      expect(summary).toMatchObject({ cancellation: "after_completion" });
      expect(captured.at(-1)?.finalCancellation()).toBe("after_completion");
    }
  );
});
