import { describe, expect, it, vi } from "vitest";

import {
  ProbeClientRunnerError,
  runProbeClientTrial,
  type ProbeClientRunnerDependencies,
  type ProbeClientTrialCapture,
  type ProbeFreshDecisionReceipt,
  type ProbeLiveInitialBoundary,
  type ProbeVerifiedInitialBoundary
} from "@/lib/probe/client-runner";

interface FakeTool {
  readonly name: string;
  readonly identity: string;
}

interface FakeResetReceipt {
  readonly resetId: string;
}

interface FakeExecutionResult {
  readonly ok: true;
  readonly traceId: string;
}

interface FakeEvidence {
  readonly terminalStatus: string;
  readonly nativeDispatchCount: 0 | 1;
}

const STATE_HASH = "a".repeat(64);
const MANIFEST_HASH = "b".repeat(64);
const beforeTool = Object.freeze({ name: "cart_get", identity: "before" });
const liveTool = Object.freeze({ name: "cart_get", identity: "live" });

function verifiedBoundary(
  stage: "before" | "after",
  tools: readonly FakeTool[] = [stage === "before" ? beforeTool : liveTool]
): ProbeVerifiedInitialBoundary<FakeTool, FakeResetReceipt> {
  const resetId = stage === "before" ? "reset_before_0123456789" : "reset_after_01234567890";
  return Object.freeze({
    status: "verified",
    catalogState: "initial",
    fixtureId: "checkout-seed-v1",
    fixtureSeed: "toolproof-checkout-seed-001",
    stateRevision: 0,
    stateHash: STATE_HASH,
    manifestHash: MANIFEST_HASH,
    registrationGeneration: 4,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    resetId,
    resetReceipt: Object.freeze({ resetId }),
    tools
  });
}

function liveBoundary(
  tools: readonly FakeTool[] = [liveTool],
  overrides: Partial<ProbeLiveInitialBoundary<FakeTool>> = {}
): ProbeLiveInitialBoundary<FakeTool> {
  return Object.freeze({
    status: "verified",
    catalogState: "initial",
    fixtureId: "checkout-seed-v1",
    fixtureSeed: "toolproof-checkout-seed-001",
    stateRevision: 0,
    stateHash: STATE_HASH,
    manifestHash: MANIFEST_HASH,
    registrationGeneration: 4,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    tools,
    ...overrides
  });
}

function freshDecision(decision: unknown): ProbeFreshDecisionReceipt {
  return Object.freeze({
    context: Object.freeze({
      kind: "fresh-stateless",
      previousResponseId: null,
      providerRequestCount: 1
    }),
    rawModelResponse: JSON.stringify({ decision }),
    providerReceipt: Object.freeze({ responseId: "response_0123456789abcdef", store: false }),
    decision
  });
}

interface HarnessOptions {
  readonly decision?: unknown;
  readonly providerError?: Error;
  readonly live?: ProbeLiveInitialBoundary<FakeTool>;
  readonly executionError?: Error;
  readonly captureError?: Error;
  readonly postReset?: ProbeVerifiedInitialBoundary<FakeTool, FakeResetReceipt>;
}

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const captures: Array<ProbeClientTrialCapture<FakeResetReceipt, FakeExecutionResult>> = [];
  let tick = 1_000;
  const executeOnce = vi.fn(
    async ({ tool }: { readonly tool: FakeTool }): Promise<FakeExecutionResult> => {
      order.push("execute");
      expect(tool).toBe(liveTool);
      if (options.executionError) throw options.executionError;
      return Object.freeze({ ok: true as const, traceId: "event_0123456789abcdef" });
    }
  );
  const completeAndSeal = vi.fn(async () => {
    order.push("complete");
    return "sealed_trial_0123456789";
  });
  const discardTransientReferences = vi.fn(() => order.push("discard"));

  const dependencies: ProbeClientRunnerDependencies<
    FakeTool,
    string,
    FakeResetReceipt,
    FakeExecutionResult,
    FakeEvidence,
    string
  > = {
    async waitAndVerifyCleanInitial({ stage }) {
      order.push(`reset:${stage}`);
      return stage === "before"
        ? verifiedBoundary("before")
        : (options.postReset ?? verifiedBoundary("after"));
    },
    async issueOpaqueClaim() {
      order.push("issue");
      return Object.freeze({
        runId: "run_0123456789abcdef",
        caseId: "case_0123456789abcdef",
        trialId: "trial_0123456789abcdef",
        authorization: "signed_authorization"
      });
    },
    async requestFreshDecision() {
      order.push("decision");
      if (options.providerError) throw options.providerError;
      return freshDecision(
        Object.hasOwn(options, "decision")
          ? options.decision
          : { kind: "call", tool: "cart_get", arguments: {} }
      );
    },
    async reverifyLiveInitial() {
      order.push("reverify");
      return options.live ?? liveBoundary();
    },
    executeOnce,
    async captureCurrentTrialEvidence(capture) {
      order.push("capture");
      captures.push(capture);
      if (options.captureError) throw options.captureError;
      return Object.freeze({
        terminalStatus: capture.terminalStatus,
        nativeDispatchCount: capture.nativeDispatchCount
      });
    },
    completeAndSeal,
    discardTransientReferences,
    nowMs: () => tick++
  };

  return {
    dependencies,
    order,
    captures,
    executeOnce,
    completeAndSeal,
    discardTransientReferences
  };
}

describe("Probe client one-trial state machine", () => {
  it("enforces the full call order and dispatches the exact reverified RegisteredTool once", async () => {
    const harness = createHarness();

    await expect(runProbeClientTrial(harness.dependencies)).resolves.toEqual({
      status: "sealed",
      terminalStatus: "call_completed",
      nativeDispatchCount: 1,
      seal: "sealed_trial_0123456789"
    });

    expect(harness.order).toEqual([
      "reset:before",
      "issue",
      "decision",
      "reverify",
      "execute",
      "capture",
      "reset:after",
      "complete",
      "discard"
    ]);
    expect(harness.executeOnce).toHaveBeenCalledTimes(1);
    expect(harness.executeOnce.mock.calls[0]?.[0]).toMatchObject({
      tool: liveTool,
      arguments: {},
      manifestHash: MANIFEST_HASH,
      registrationGeneration: 4
    });
    expect(harness.captures[0]).toMatchObject({
      decisionRequestCount: 1,
      terminalStatus: "call_completed",
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      selectedToolName: "cart_get",
      errors: { provider: null, decision: null, liveBoundary: null, execution: null }
    });
    expect(harness.captures[0]?.claim).not.toHaveProperty("authorization");
    expect(harness.discardTransientReferences).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ kind: "clarify", text: "Which item should change?" }, "clarified"],
    [{ kind: "abstain", reason: "No live tool applies." }, "abstained"]
  ] as const)("seals a %s decision with zero native dispatch", async (decision, status) => {
    const harness = createHarness({ decision });

    await expect(runProbeClientTrial(harness.dependencies)).resolves.toMatchObject({
      status: "sealed",
      terminalStatus: status,
      nativeDispatchCount: 0
    });

    expect(harness.executeOnce).not.toHaveBeenCalled();
    expect(harness.order).toEqual([
      "reset:before",
      "issue",
      "decision",
      "reverify",
      "capture",
      "reset:after",
      "complete",
      "discard"
    ]);
    expect(harness.captures[0]).toMatchObject({
      terminalStatus: status,
      nativeAllowanceConsumed: false,
      nativeDispatchCount: 0
    });
  });

  it.each([
    {
      name: "unregistered tool",
      options: { decision: { kind: "call", tool: "missing_tool", arguments: {} } },
      status: "unregistered_tool",
      errorSlot: "decision"
    },
    {
      name: "malformed decision",
      options: {
        decision: { kind: "call", tool: "cart_get", arguments: {}, secondDecision: true }
      },
      status: "malformed_decision",
      errorSlot: "decision"
    },
    {
      name: "known null decision",
      options: { decision: null },
      status: "malformed_decision",
      errorSlot: "decision"
    }
  ] as const)("records $name and dispatches zero calls", async ({ options, status, errorSlot }) => {
    const harness = createHarness(options);

    await expect(runProbeClientTrial(harness.dependencies)).resolves.toMatchObject({
      status: "sealed",
      terminalStatus: status,
      nativeDispatchCount: 0
    });

    expect(harness.executeOnce).not.toHaveBeenCalled();
    expect(harness.captures[0]?.terminalStatus).toBe(status);
    expect(harness.captures[0]?.errors[errorSlot]).not.toBeNull();
    expect(harness.captures[0]?.providerReceipt).toEqual({
      responseId: "response_0123456789abcdef",
      store: false
    });
    expect(harness.captures[0]?.rawModelResponse).toBeTruthy();
    expect(harness.completeAndSeal).toHaveBeenCalledTimes(1);
  });

  it("resets but does not seal a request that has no known provider receipt", async () => {
    const harness = createHarness({ providerError: new Error("provider unavailable") });
    await expect(runProbeClientTrial(harness.dependencies)).rejects.toMatchObject({
      stage: "completion",
      code: "provider_receipt_missing"
    });
    expect(harness.executeOnce).not.toHaveBeenCalled();
    expect(harness.order).toContain("reset:after");
    expect(harness.completeAndSeal).not.toHaveBeenCalled();
  });

  it("consumes the allowance before dispatch and never retries a failed executeOnce", async () => {
    const executionError = Object.assign(new Error("native rejected"), {
      code: "native_execution_failure",
      nativeCallMade: true
    });
    const harness = createHarness({ executionError });

    await expect(runProbeClientTrial(harness.dependencies)).resolves.toMatchObject({
      status: "sealed",
      terminalStatus: "call_failed",
      nativeDispatchCount: 1
    });

    expect(harness.executeOnce).toHaveBeenCalledTimes(1);
    expect(harness.captures[0]).toMatchObject({
      terminalStatus: "call_failed",
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      executionResult: null,
      errors: {
        execution: {
          code: "native_execution_failure",
          nativeCallMade: true
        }
      }
    });
    expect(harness.order).toContain("reset:after");
    expect(harness.completeAndSeal).toHaveBeenCalledTimes(1);
  });

  it("fails closed on manifest drift after the decision and records zero native calls", async () => {
    const harness = createHarness({
      live: liveBoundary([liveTool], { manifestHash: "c".repeat(64) })
    });

    await expect(runProbeClientTrial(harness.dependencies)).resolves.toMatchObject({
      status: "sealed",
      terminalStatus: "boundary_drift",
      nativeDispatchCount: 0
    });
    expect(harness.executeOnce).not.toHaveBeenCalled();
    expect(harness.captures[0]).toMatchObject({
      liveBoundary: null,
      terminalStatus: "boundary_drift",
      errors: { liveBoundary: { name: "ProbeClientRunnerError" } }
    });
  });

  it("still performs the verified post-reset and discards references when capture fails", async () => {
    const harness = createHarness({ captureError: new Error("capture failed") });

    await expect(runProbeClientTrial(harness.dependencies)).rejects.toEqual(
      expect.objectContaining<Partial<ProbeClientRunnerError>>({
        name: "ProbeClientRunnerError",
        stage: "capture",
        code: "capture_failed"
      })
    );
    expect(harness.order).toEqual([
      "reset:before",
      "issue",
      "decision",
      "reverify",
      "execute",
      "capture",
      "reset:after",
      "discard"
    ]);
    expect(harness.completeAndSeal).not.toHaveBeenCalled();
    expect(harness.discardTransientReferences).toHaveBeenCalledTimes(1);
  });

  it("refuses to seal when the post-reset reuses the pre-trial reset identity", async () => {
    const harness = createHarness({ postReset: verifiedBoundary("before") });

    await expect(runProbeClientTrial(harness.dependencies)).rejects.toEqual(
      expect.objectContaining<Partial<ProbeClientRunnerError>>({
        name: "ProbeClientRunnerError",
        stage: "post_reset",
        code: "post_reset_failed"
      })
    );
    expect(harness.executeOnce).toHaveBeenCalledTimes(1);
    expect(harness.completeAndSeal).not.toHaveBeenCalled();
    expect(harness.discardTransientReferences).toHaveBeenCalledTimes(1);
  });
});
