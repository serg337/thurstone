import { describe, expect, it } from "vitest";

import { CHECKOUT_FIXTURE_STATE_HASH, verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";

function tracedStore() {
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => "a".repeat(64),
    getArgumentMode: () => "unverified",
    appCommit: "b".repeat(40),
    origin: "https://toolproof.example",
    userAgent: "Chrome/151 test"
  });
  return { store: new CheckoutSessionStore({ traceSink: ledger }), ledger };
}

async function resetFixture() {
  const { store, ledger } = tracedStore();
  await store.cartUpdate({
    operationId: "update_0123456789",
    operation: "set_quantity",
    itemId: "field-notebook",
    quantity: 3
  });
  const domainReceipt = await store.hardReset();
  return { store, ledger, domainReceipt };
}

describe("verified checkout reset receipt", () => {
  it("binds the exact fixture bytes, empty current trajectory, and initial registry", async () => {
    const { store, ledger, domainReceipt } = await resetFixture();
    const receipt = await verifyCheckoutReset({
      domainReceipt,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      registry: {
        verified: true,
        registryHash: "a".repeat(64),
        registeredToolNames: [...INITIAL_CHECKOUT_TOOL_NAMES].reverse()
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });

    expect(receipt).toEqual({
      receiptVersion: "checkout-reset@1",
      status: "verified",
      resetId: domainReceipt.resetId,
      fixtureId: "checkout-seed-v1",
      fixtureVersion: "checkout-fixture@1.0.0",
      seed: "toolproof-checkout-seed-001",
      stateRevision: 0,
      stateHash: CHECKOUT_FIXTURE_STATE_HASH,
      expectedStateHash: CHECKOUT_FIXTURE_STATE_HASH,
      registryHash: "a".repeat(64),
      registeredToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
      operationLedgerCount: 0,
      currentTrajectoryCount: 0,
      checkedAt: "2026-08-26T12:00:00.000Z"
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.registeredToolNames)).toBe(true);
    expect(store.inspect().retainedTombstoneCount).toBe(1);
  });

  it("recomputes identically after a complete JSON evidence round trip", async () => {
    const { store, ledger, domainReceipt } = await resetFixture();
    const input = JSON.parse(
      JSON.stringify({
        domainReceipt,
        inspection: store.inspect(),
        archives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot()
      })
    ) as {
      domainReceipt: Parameters<typeof verifyCheckoutReset>[0]["domainReceipt"];
      inspection: Parameters<typeof verifyCheckoutReset>[0]["inspection"];
      archives: Parameters<typeof verifyCheckoutReset>[0]["archives"];
      traceLedger: Parameters<typeof verifyCheckoutReset>[0]["traceLedger"];
    };
    const receipt = await verifyCheckoutReset({
      ...input,
      registry: {
        verified: true,
        registryHash: "a".repeat(64),
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });
    expect(receipt.status).toBe("verified");
  });

  it("fails closed for registry, ledger, trajectory, timestamp, or domain-core drift", async () => {
    const cases = [
      {
        label: "registry status",
        inspectionOverride: {},
        registry: { verified: false, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
        receiptOverride: {},
        checkedAt: "2026-08-26T12:00:00.000Z",
        error: "registry_not_verified"
      },
      {
        label: "registry names",
        inspectionOverride: {},
        registry: { verified: true, registeredToolNames: ["cart_get"] },
        receiptOverride: {},
        checkedAt: "2026-08-26T12:00:00.000Z",
        error: "registry_catalog_mismatch"
      },
      {
        label: "operation ledger",
        inspectionOverride: { currentOperationCount: 1 },
        registry: { verified: true, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
        receiptOverride: {},
        checkedAt: "2026-08-26T12:00:00.000Z",
        error: "operation_ledger_not_empty"
      },
      {
        label: "trajectory",
        inspectionOverride: { currentTraceCount: 1 },
        registry: { verified: true, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
        receiptOverride: {},
        checkedAt: "2026-08-26T12:00:00.000Z",
        error: "current_trajectory_not_empty"
      },
      {
        label: "domain core hash",
        inspectionOverride: {},
        registry: { verified: true, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
        receiptOverride: { coreHash: "tampered" },
        checkedAt: "2026-08-26T12:00:00.000Z",
        error: "domain_core_hash_mismatch"
      },
      {
        label: "timestamp",
        inspectionOverride: {},
        registry: { verified: true, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
        receiptOverride: {},
        checkedAt: " ",
        error: "checked_at_missing"
      }
    ] as const;

    for (const testCase of cases) {
      const { store, ledger, domainReceipt } = await resetFixture();
      const receipt = await verifyCheckoutReset({
        domainReceipt: { ...domainReceipt, ...testCase.receiptOverride },
        inspection: { ...store.inspect(), ...testCase.inspectionOverride },
        archives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot(),
        registry: {
          ...testCase.registry,
          registryHash: "b".repeat(64)
        },
        checkedAt: testCase.checkedAt
      });

      expect(receipt.status, testCase.label).toBe("invalid");
      if (receipt.status === "invalid") {
        expect(receipt.errors, testCase.label).toContain(testCase.error);
        expect(Object.isFrozen(receipt.errors)).toBe(true);
      }
    }
  });

  it("rejects a stale receipt after a later reset in the same session", async () => {
    const { store, ledger } = tracedStore();
    const staleReceipt = await store.hardReset();
    await store.cartGet({});
    await store.hardReset();

    const receipt = await verifyCheckoutReset({
      domainReceipt: staleReceipt,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      registry: {
        verified: true,
        registryHash: "c".repeat(64),
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });

    expect(receipt.status).toBe("invalid");
    if (receipt.status === "invalid") {
      expect(receipt.errors).toEqual(
        expect.arrayContaining([
          "reset_trajectory_mismatch",
          "reset_trace_mismatch",
          "reset_archive_mismatch"
        ])
      );
    }
  });

  it("rejects a reset whose post-commit subscriber failed", async () => {
    const { store, ledger } = tracedStore();
    store.subscribe(() => {
      throw new Error("render failed");
    });
    const domainReceipt = await store.hardReset();

    const receipt = await verifyCheckoutReset({
      domainReceipt,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      registry: {
        verified: true,
        registryHash: "d".repeat(64),
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });

    expect(receipt.status).toBe("invalid");
    if (receipt.status === "invalid") {
      expect(receipt.errors).toEqual(
        expect.arrayContaining(["reset_session_halted", "reset_trace_mismatch"])
      );
    }
  });

  it("seals verification while concurrent tool admission is paused", async () => {
    const { store, ledger } = tracedStore();
    const domainReceipt = await store.hardReset({ holdForVerification: true });
    const verification = verifyCheckoutReset({
      domainReceipt,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      registry: {
        verified: true,
        registryHash: "e".repeat(64),
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });

    await expect(store.cartGet({})).rejects.toMatchObject({ name: "InvalidStateError" });
    await expect(verification).resolves.toMatchObject({ status: "verified" });
    expect(store.currentTrajectory()).toEqual([]);
    expect(store.releaseResetAdmission(domainReceipt.resetId)).toBe(true);
  });

  it("rejects a missing full reset trace even when session summaries exist", async () => {
    const { store, ledger, domainReceipt } = await resetFixture();
    const traceLedger = ledger.snapshot();
    const receipt = await verifyCheckoutReset({
      domainReceipt,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: { ...traceLedger, lastResetTrace: null },
      registry: {
        verified: true,
        registryHash: "f".repeat(64),
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      checkedAt: "2026-08-26T12:00:00.000Z"
    });

    expect(receipt.status).toBe("invalid");
    if (receipt.status === "invalid") {
      expect(receipt.errors).toContain("reset_evidence_mismatch");
    }
  });
});
