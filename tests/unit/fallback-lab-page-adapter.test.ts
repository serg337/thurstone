import { describe, expect, it, vi } from "vitest";

import { createCheckoutFixture, type CheckoutState } from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { canonicalSha256 } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import {
  ToolProofFallbackLabPageAdapter,
  createFallbackLiveManifestFromReadiness,
  type ProjectedReadiness
} from "@/lib/fallback/lab-page-adapter.server";
import { checkoutToolContractSnapshot, type SerializableToolMetadata } from "@/lib/webmcp/catalog";
import type { Page } from "puppeteer-core";

const APP_COMMIT = "b".repeat(40);

async function readiness(
  state: CheckoutState = createCheckoutFixture()
): Promise<ProjectedReadiness> {
  const contract = checkoutToolContractSnapshot(state);
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map((tool: SerializableToolMetadata) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.annotations?.readOnlyHint ?? false,
        untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
      },
      handlerVersion: versions.get(tool.name)!
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest = {
    catalogState: state.pendingCheckout === null ? "initial" : "pending",
    toolsetVersion: contract.toolsetVersion,
    domainVersion: "checkout-domain@1.0.0",
    appCommit: APP_COMMIT,
    tools
  };
  const manifestHash = await canonicalSha256(manifest);
  return {
    status: "consumer-ready",
    fixtureId: "checkout-seed-v1",
    fixtureRevision: state.revision,
    stateHash: await canonicalSha256(state),
    manifestHash,
    registeredToolNames: tools.map(({ name }) => name),
    manifest,
    runtimeCatalog: { generation: 1, manifestHash }
  };
}

describe("fallback Lab page adapter", () => {
  it("projects the verified readiness receipt into the exact sorted live manifest", async () => {
    const source = await readiness();
    const manifest = createFallbackLiveManifestFromReadiness(source);
    expect(manifest.manifestHash).toBe(source.manifestHash);
    expect(manifest.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);
    expect(manifest.tools[0]).toMatchObject({
      name: "cart_get",
      annotations: { readOnlyHint: true, untrustedContentHint: false }
    });
  });

  it("creates a full verified reset lineage and releases only its matching admission", async () => {
    const ready = await readiness();
    const ledger = new CheckoutTraceLedger({
      getRegistryHash: () => ready.manifestHash,
      getArgumentMode: () => "json-string",
      appCommit: APP_COMMIT
    });
    const store = new CheckoutSessionStore({ traceSink: ledger });
    let resetId = "";
    const evaluate = vi
      .fn()
      .mockImplementationOnce(async () => {
        return {
          session: store.getSnapshot(),
          inspection: store.inspect(),
          domainArchives: store.archivedTrajectories(),
          traceLedger: ledger.snapshot(),
          journal: {
            entries: [{ sequence: 1, kind: "readiness_receipt", payload: ready }],
            eventCount: 1,
            overflowed: false,
            fault: null
          },
          origin: "https://toolproof-rust.vercel.app",
          userAgent: "Chrome/151.0.7922.47"
        };
      })
      .mockImplementationOnce(async () => {
        const domainReceipt = await store.hardReset({
          source: "ui",
          holdForVerification: true
        });
        resetId = domainReceipt.resetId;
        return { beforeEventCount: 1, domainReceipt };
      })
      .mockImplementationOnce(async () => ({
        session: store.getSnapshot(),
        inspection: store.inspect(),
        domainArchives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot(),
        journal: {
          entries: [
            { sequence: 1, kind: "readiness_receipt", payload: ready },
            { sequence: 2, kind: "readiness_receipt", payload: ready }
          ],
          eventCount: 2,
          overflowed: false,
          fault: null
        },
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Chrome/151.0.7922.47"
      }))
      .mockImplementationOnce(async (_callback: unknown, suppliedResetId: string) => {
        expect(suppliedResetId).toBe(resetId);
        return store.releaseResetAdmission(suppliedResetId);
      });
    const page = { evaluate } as unknown as Page;
    const boundary = await new ToolProofFallbackLabPageAdapter().resetAndVerify({
      page,
      stage: "before"
    });
    expect(boundary).toMatchObject({
      status: "verified",
      catalogState: "initial",
      fixtureId: "checkout-seed-v1",
      fixtureSeed: "toolproof-checkout-seed-001",
      stateRevision: 0,
      stateHash: CHECKOUT_FIXTURE_STATE_HASH,
      manifestHash: ready.manifestHash,
      registrationGeneration: 1,
      operationLedgerCount: 0,
      currentTrajectoryCount: 0,
      resetId
    });
    expect(boundary.resetReceipt).toMatchObject({
      verification: { status: "verified", resetId },
      domainReceipt: { resetId }
    });
    expect(boundary.expectedManifest.manifestHash).toBe(ready.manifestHash);
    expect(store.isResetAdmissionLocked()).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("admits a healthy pending checkout after execution, then proves a fresh exact reset", async () => {
    const initial = await readiness();
    const ledger = new CheckoutTraceLedger({
      getRegistryHash: () => initial.manifestHash,
      getArgumentMode: () => "json-string",
      appCommit: APP_COMMIT
    });
    const store = new CheckoutSessionStore({ traceSink: ledger });
    await store.checkoutRequest({ operationId: "fallback_request_0001" });
    const pending = await readiness(store.getSnapshot().state);
    let resetId = "";
    const evaluate = vi
      .fn()
      .mockImplementationOnce(async () => ({
        session: store.getSnapshot(),
        inspection: store.inspect(),
        domainArchives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot(),
        journal: {
          entries: [{ sequence: 1, kind: "readiness_receipt", payload: pending }],
          eventCount: 1,
          overflowed: false,
          fault: null
        },
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Chrome/151.0.7922.47"
      }))
      .mockImplementationOnce(async () => {
        const domainReceipt = await store.hardReset({
          source: "ui",
          holdForVerification: true
        });
        resetId = domainReceipt.resetId;
        return { beforeEventCount: 1, domainReceipt };
      })
      .mockImplementationOnce(async () => ({
        session: store.getSnapshot(),
        inspection: store.inspect(),
        domainArchives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot(),
        journal: {
          entries: [
            { sequence: 1, kind: "readiness_receipt", payload: pending },
            { sequence: 2, kind: "readiness_receipt", payload: initial }
          ],
          eventCount: 2,
          overflowed: false,
          fault: null
        },
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Chrome/151.0.7922.47"
      }))
      .mockImplementationOnce(async (_callback: unknown, suppliedResetId: string) => {
        expect(suppliedResetId).toBe(resetId);
        return store.releaseResetAdmission(suppliedResetId);
      });

    const boundary = await new ToolProofFallbackLabPageAdapter().resetAndVerify({
      page: { evaluate } as unknown as Page,
      stage: "after"
    });

    expect(boundary).toMatchObject({
      status: "verified",
      catalogState: "initial",
      stateRevision: 0,
      stateHash: CHECKOUT_FIXTURE_STATE_HASH,
      manifestHash: initial.manifestHash,
      resetId
    });
    expect(store.getSnapshot().state.pendingCheckout).toBeNull();
    expect(store.isResetAdmissionLocked()).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("keeps the before stage strict when the document is already pending", async () => {
    vi.useFakeTimers();
    try {
      const initial = await readiness();
      const ledger = new CheckoutTraceLedger({
        getRegistryHash: () => initial.manifestHash,
        getArgumentMode: () => "json-string",
        appCommit: APP_COMMIT
      });
      const store = new CheckoutSessionStore({ traceSink: ledger });
      await store.checkoutRequest({ operationId: "fallback_request_0002" });
      const pending = await readiness(store.getSnapshot().state);
      const evaluate = vi.fn(async () => ({
        session: store.getSnapshot(),
        inspection: store.inspect(),
        domainArchives: store.archivedTrajectories(),
        traceLedger: ledger.snapshot(),
        journal: {
          entries: [{ sequence: 1, kind: "readiness_receipt", payload: pending }],
          eventCount: 1,
          overflowed: false,
          fault: null
        },
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Chrome/151.0.7922.47"
      }));

      const reset = new ToolProofFallbackLabPageAdapter().resetAndVerify({
        page: { evaluate } as unknown as Page,
        stage: "before"
      });
      const rejection = expect(reset).rejects.toThrow("fallback_lab_boot_timeout");
      await vi.advanceTimersByTimeAsync(15_001);
      await rejection;
      expect(evaluate).toHaveBeenCalled();
      expect(store.getSnapshot().state.pendingCheckout).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("acquires and idempotently releases the page-owned native consumer hold", async () => {
    const holdId = "123e4567-e89b-12d3-a456-426614174000";
    const evaluate = vi.fn().mockResolvedValueOnce(holdId).mockResolvedValueOnce(true);
    const page = { evaluate } as unknown as Page;
    const adapter = new ToolProofFallbackLabPageAdapter();

    const release = await adapter.holdConsumerCall({
      page,
      toolName: "checkout_request",
      registrationGeneration: 7
    });
    await release();
    await release();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[0]?.[1]).toEqual({
      toolName: "checkout_request",
      registrationGeneration: 7
    });
    expect(evaluate.mock.calls[1]?.[1]).toBe(holdId);
  });
});
