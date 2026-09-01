import type { ByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import type { ByoaAgentSessionV1 } from "@/lib/demo/agent-session";
import {
  createByoaDemoResult,
  type ByoaDemoResultV2,
  type DemoAssertionV2
} from "@/lib/demo/result-v2";

export async function createNoInvocationResult(input: {
  readonly session: ByoaAgentSessionV1;
  readonly environment: ByoaAgentEnvironment;
  readonly verdict: "incomplete" | "unavailable";
  readonly armedAt: string;
  readonly completedAt: string;
  readonly detail: string;
  readonly previousResultDigest?: string | null;
}): Promise<ByoaDemoResultV2> {
  const assertion: DemoAssertionV2 = {
    assertionId: "runtime.native-invocation-observed",
    scope: "runtime",
    path: "/observedTool",
    expected: "one native invocation",
    actual: null,
    passed: false,
    label: "Native agent invocation was not observed",
    detail: input.detail,
    evidenceRefs: [{ source: "runtime-boundary", jsonPointer: "/observation", sha256: null }]
  };
  return createByoaDemoResult({
    runId: input.session.runId,
    contract: input.session.contract,
    observedTool: null,
    rawArguments: null,
    canonicalArguments: null,
    trustedStateBefore: input.environment.initialState,
    trustedStateAfter: input.environment.store.getSnapshot().state,
    ledgerDiff: {
      eventCountBefore: 0,
      eventCountAfter: 0,
      eventCountDelta: 0,
      stateTransitionCount: 0,
      operationLedgerCountBefore: 0,
      operationLedgerCountAfter: 0,
      operationLedgerCountDelta: 0,
      pendingCheckoutChanged: false,
      rejectedAdditionalAttempts: input.environment.gate.snapshot().rejectedAdditionalAttempts
    },
    assertions: [assertion],
    diagnosticSignals: [
      {
        code:
          input.verdict === "unavailable"
            ? "agent_decision_unobservable"
            : "native_invocation_missing",
        expected: "one native invocation",
        actual: null,
        failedAssertionIds: [assertion.assertionId],
        evidenceRefs: assertion.evidenceRefs
      }
    ],
    verdict: input.verdict,
    manifestHash: input.environment.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  });
}
