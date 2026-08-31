import { beforeEach, describe, expect, it } from "vitest";

import {
  agentVisibleRunProjection,
  BYOA_SESSION_MAX_BYTES,
  BYOA_SESSION_STORAGE_KEY,
  canTransition,
  clearByoaAgentSession,
  createCompiledByoaSession,
  parseByoaAgentSession,
  readByoaAgentSession,
  transitionByoaSession,
  writeByoaAgentSession
} from "@/lib/demo/agent-session";
import {
  BYOA_AGENT_PROJECTION_STORAGE_KEY,
  parseAgentVisibleRunProjection,
  readAgentVisibleRunProjection,
  writeAgentVisibleRunProjection
} from "@/lib/demo/agent-projection";
import {
  byoaContractDigest,
  createByoaContract,
  createByoaDescriptorSnapshot
} from "@/lib/demo/contract-v2";

beforeEach(() => window.sessionStorage.clear());

async function session() {
  const snapshot = await createByoaDescriptorSnapshot();
  const contract = createByoaContract({
    contractId: "byoa_66666666-6666-4666-8666-666666666666",
    request: "I am ready—request checkout for this cart.",
    expectedTool: "checkout_request",
    argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
    allowedEffects: [{ kind: "pending_checkout" }],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    approvalClass: "consequential",
    ...snapshot,
    buildCommit: "c".repeat(40),
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  return createCompiledByoaSession({
    runId: "byoa_run_77777777-7777-4777-8777-777777777777",
    contract,
    contractDigest: await byoaContractDigest(contract),
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:30:00.000Z"
  });
}

describe("BYOA agent session", () => {
  it("allows only the frozen run-state transitions", () => {
    expect(canTransition("DRAFT", "COMPILED")).toBe(true);
    expect(canTransition("COMPILED", "NAVIGATING")).toBe(true);
    expect(canTransition("NAVIGATING", "PREPARING")).toBe(true);
    expect(canTransition("PREPARING", "PROVIDER_READY")).toBe(true);
    expect(canTransition("PROVIDER_READY", "ARMED")).toBe(true);
    expect(canTransition("ARMED", "OBSERVING")).toBe(true);
    expect(canTransition("OBSERVING", "EVALUATING")).toBe(true);
    expect(canTransition("EVALUATING", "PASS")).toBe(true);
    expect(canTransition("PASS", "DRAFT")).toBe(false);
    expect(canTransition("COMPILED", "PASS")).toBe(false);
  });

  it("records a continuous immutable transition chain", async () => {
    const compiled = await session();
    const navigating = transitionByoaSession(compiled, "NAVIGATING", {
      at: "2026-09-01T00:00:01.000Z",
      reasonCode: "owner_armed_live_test"
    });
    expect(navigating.transitions).toHaveLength(2);
    expect(navigating.state).toBe("NAVIGATING");
    expect(compiled.state).toBe("COMPILED");
    expect(() =>
      transitionByoaSession(navigating, "PASS", {
        at: "2026-09-01T00:00:02.000Z",
        reasonCode: "invalid_shortcut",
        resultDigest: "a".repeat(64)
      })
    ).toThrow(/not allowed/iu);
  });

  it("requires terminal results only in terminal states", async () => {
    const compiled = await session();
    expect(() =>
      parseByoaAgentSession({ ...compiled, terminalResultDigest: "a".repeat(64) })
    ).toThrow(/only terminal/iu);
  });

  it("stores only a strict bounded tab-scoped session", async () => {
    const compiled = await session();
    writeByoaAgentSession(window.sessionStorage, compiled);
    expect(readByoaAgentSession(window.sessionStorage)).toEqual(compiled);
    clearByoaAgentSession(window.sessionStorage);
    expect(readByoaAgentSession(window.sessionStorage)).toBeNull();
    window.sessionStorage.setItem(BYOA_SESSION_STORAGE_KEY, "x".repeat(BYOA_SESSION_MAX_BYTES + 1));
    expect(() => readByoaAgentSession(window.sessionStorage)).toThrow(/exceeds/iu);
  });

  it("creates a separate agent-visible projection without the answer-key fields", async () => {
    const compiled = await session();
    const projection = agentVisibleRunProjection(compiled);
    const encoded = JSON.stringify(projection);
    for (const forbidden of [
      "expectedTool",
      "argumentPredicate",
      "allowedEffects",
      "forbiddenEffects",
      "replayPolicy",
      "approvalClass",
      "contractDigest"
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    expect(projection.descriptors.map(({ name }) => name)).toEqual([
      "order_review",
      "checkout_request"
    ]);
    writeAgentVisibleRunProjection(window.sessionStorage, projection);
    expect(readAgentVisibleRunProjection(window.sessionStorage)).toEqual(projection);
    expect(window.sessionStorage.getItem(BYOA_AGENT_PROJECTION_STORAGE_KEY)).not.toBeNull();
    expect(() =>
      parseAgentVisibleRunProjection({ ...projection, expectedTool: "checkout_request" })
    ).toThrow();
  });
});
