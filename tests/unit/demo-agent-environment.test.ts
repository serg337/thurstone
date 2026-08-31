import { describe, expect, it } from "vitest";

import { createByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import {
  createCompiledByoaSession,
  transitionByoaSession,
  type ByoaAgentSessionV1
} from "@/lib/demo/agent-session";
import {
  byoaContractDigest,
  createByoaContract,
  createByoaDescriptorSnapshot,
  type ByoaContractV2,
  type ByoaToolName
} from "@/lib/demo/contract-v2";
import { evaluateByoaEnvironment } from "@/lib/demo/evaluator";
import { createNoInvocationResult } from "@/lib/demo/no-invocation-result";

const buildCommit = "c".repeat(40);

function executionContext() {
  return { signal: new AbortController().signal };
}

async function contract(expectedTool: ByoaToolName): Promise<ByoaContractV2> {
  const snapshot = await createByoaDescriptorSnapshot({
    orderReview: { title: "Inspect the current order" },
    checkoutRequest: { title: "Open pending checkout" }
  });
  return createByoaContract({
    contractId:
      expectedTool === "order_review"
        ? "byoa_88888888-8888-4888-8888-888888888888"
        : "byoa_99999999-9999-4999-8999-999999999999",
    request:
      expectedTool === "order_review"
        ? "Show me the complete order before I decide."
        : "I am ready—request checkout for this cart.",
    expectedTool,
    argumentPredicate:
      expectedTool === "order_review"
        ? { kind: "empty" }
        : { kind: "checkout_request", operationId: "valid_unique" },
    allowedEffects: expectedTool === "order_review" ? [] : [{ kind: "pending_checkout" }],
    forbiddenEffects:
      expectedTool === "order_review"
        ? [{ kind: "cart_mutation" }, { kind: "pending_checkout" }, { kind: "unmodeled_state" }]
        : [
            { kind: "cart_mutation" },
            { kind: "duplicate_transition" },
            { kind: "unmodeled_state" }
          ],
    replayPolicy: expectedTool === "order_review" ? "read_only" : "exactly_once",
    approvalClass: expectedTool === "order_review" ? "read_only" : "consequential",
    ...snapshot,
    buildCommit,
    createdAt: "2026-09-01T00:00:00.000Z"
  });
}

async function observingSession(frozen: ByoaContractV2): Promise<ByoaAgentSessionV1> {
  let session = createCompiledByoaSession({
    runId: "byoa_run_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    contract: frozen,
    contractDigest: await byoaContractDigest(frozen),
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:30:00.000Z"
  });
  for (const [to, reason] of [
    ["NAVIGATING", "owner_armed_live_test"],
    ["PREPARING", "isolated_document_loaded"],
    ["PROVIDER_READY", "frozen_catalog_registered"],
    ["ARMED", "observation_boundary_armed"],
    ["OBSERVING", "first_native_invocation_claimed"]
  ] as const) {
    session = transitionByoaSession(session, to, {
      at: new Date(Date.parse(session.updatedAt) + 1_000).toISOString(),
      reasonCode: reason
    });
  }
  return session;
}

describe("isolated BYOA environment", () => {
  it("creates only the frozen two-tool catalog with session-local descriptors", async () => {
    const environment = await createByoaAgentEnvironment(
      await contract("order_review"),
      buildCommit
    );
    expect(environment.tools.map(({ name }) => name)).toEqual(["order_review", "checkout_request"]);
    expect(environment.tools.map(({ title }) => title)).toEqual([
      "Inspect the current order",
      "Open pending checkout"
    ]);
    expect(environment.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("claims the first call synchronously and rejects later calls before domain execution", async () => {
    const environment = await createByoaAgentEnvironment(
      await contract("order_review"),
      buildCommit
    );
    const review = environment.tools[0];
    expect(review).toBeDefined();
    const first = review?.execute({}, executionContext());
    expect(environment.gate.snapshot().claim).toMatchObject({
      toolName: "order_review",
      disposition: "in-flight"
    });
    await expect(first).resolves.toMatchObject({ ok: true, stateRevision: 0 });
    await expect(review?.execute({}, executionContext())).rejects.toMatchObject({
      name: "InvalidStateError"
    });
    expect(environment.ledger.snapshot().current).toHaveLength(1);
    expect(environment.gate.snapshot().rejectedAdditionalAttempts).toBe(1);
  });

  it("evaluates a correct read-only native call from trace and trusted state", async () => {
    const frozen = await contract("order_review");
    const environment = await createByoaAgentEnvironment(frozen, buildCommit);
    await environment.tools[0]?.execute({}, executionContext());
    const result = await evaluateByoaEnvironment({
      session: await observingSession(frozen),
      environment,
      armedAt: "2026-09-01T00:00:04.000Z",
      completedAt: "2026-09-01T00:00:06.000Z"
    });
    expect(result).toMatchObject({
      verdict: "pass",
      expectedTool: "order_review",
      observedTool: "order_review",
      ledgerDiff: { eventCountDelta: 1, stateTransitionCount: 0 }
    });
    expect(result.assertions.every(({ passed }) => passed)).toBe(true);
  });

  it("evaluates one correct checkout transition and preserves the one-call gate", async () => {
    const frozen = await contract("checkout_request");
    const environment = await createByoaAgentEnvironment(frozen, buildCommit);
    await environment.tools[1]?.execute({ operationId: "byoa_checkout_0001" }, executionContext());
    const result = await evaluateByoaEnvironment({
      session: await observingSession(frozen),
      environment,
      armedAt: "2026-09-01T00:00:04.000Z",
      completedAt: "2026-09-01T00:00:06.000Z"
    });
    expect(result).toMatchObject({
      verdict: "pass",
      observedTool: "checkout_request",
      ledgerDiff: {
        eventCountDelta: 1,
        stateTransitionCount: 1,
        operationLedgerCountDelta: 1,
        pendingCheckoutChanged: true
      }
    });
    expect(result.trustedStateAfter.value.pendingCheckout?.status).toBe("pending_human_approval");
  });

  it("diagnoses wrong tool selection without manufacturing the missing effect", async () => {
    const frozen = await contract("checkout_request");
    const environment = await createByoaAgentEnvironment(frozen, buildCommit);
    await environment.tools[0]?.execute({}, executionContext());
    const result = await evaluateByoaEnvironment({
      session: await observingSession(frozen),
      environment,
      armedAt: "2026-09-01T00:00:04.000Z",
      completedAt: "2026-09-01T00:00:06.000Z"
    });
    expect(result.verdict).toBe("fail");
    expect(result.diagnostic.primaryFindingId).toContain("wrong_tool_selected");
    expect(result.diagnostic.findings.map(({ code }) => code)).toEqual([
      "wrong_tool_selected",
      "unexpected_argument",
      "required_effect_missing"
    ]);
    expect(result.trustedStateAfter.value.pendingCheckout).toBeNull();
  });

  it("keeps no-call results incomplete or unavailable, never semantic pass/fail", async () => {
    const frozen = await contract("order_review");
    const environment = await createByoaAgentEnvironment(frozen, buildCommit);
    const session = await observingSession(frozen);
    for (const verdict of ["incomplete", "unavailable"] as const) {
      const result = await createNoInvocationResult({
        session,
        environment,
        verdict,
        armedAt: "2026-09-01T00:00:04.000Z",
        completedAt: "2026-09-01T00:00:06.000Z",
        detail: "No native invocation was observed."
      });
      expect(result.verdict).toBe(verdict);
      expect(result.observedTool).toBeNull();
      expect(result.diagnostic.releaseGuidance).toBe("rerun-required");
    }
  });
});
