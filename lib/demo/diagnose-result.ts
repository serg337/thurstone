import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  DEMO_DIAGNOSTIC_VERSION,
  DEMO_DIAGNOSER_VERSION,
  diagnosticEnvelopeSchema,
  diagnosticSignalSchema,
  type DiagnosticEnvelopeV1,
  type DiagnosticFindingCode,
  type DiagnosticSignal,
  type JsonValue
} from "@/lib/demo/diagnostic-contract";

interface FindingTemplate {
  readonly order: number;
  readonly category: DiagnosticEnvelopeV1["findings"][number]["category"];
  readonly severity: DiagnosticEnvelopeV1["findings"][number]["severity"];
  readonly title: string;
  readonly summary: string;
  readonly hypothesis: string | null;
  readonly target: DiagnosticEnvelopeV1["findings"][number]["nextStep"]["target"];
  readonly instruction: string;
  readonly successCriterion: string;
}

const TEMPLATES: Readonly<Record<DiagnosticFindingCode, FindingTemplate>> = {
  fixture_or_reset_invalid: {
    order: 10,
    category: "evidence",
    severity: "unknown",
    title: "Fixture or reset could not be verified",
    summary: "The declared starting or terminal fixture boundary did not verify.",
    hypothesis: null,
    target: "runtime-integration",
    instruction:
      "Restore the exact fixture/reset boundary and its receipt before interpreting agent behavior.",
    successCriterion:
      "The unchanged case starts from the declared fixture and produces a verified reset receipt."
  },
  native_trace_unverified: {
    order: 20,
    category: "evidence",
    severity: "unknown",
    title: "Native trace could not be verified",
    summary: "The trace did not bind to the frozen run, catalog, build, or fixture.",
    hypothesis: null,
    target: "runtime-integration",
    instruction:
      "Restore trace, build, catalog, and run linkage; then rerun the unchanged contract.",
    successCriterion:
      "The native trace verifies against the armed run, manifest, build, and fixture."
  },
  execution_canceled_or_partial: {
    order: 30,
    category: "evidence",
    severity: "unknown",
    title: "Execution did not reach a trustworthy terminal state",
    summary: "Cancellation or partial execution prevented a safe semantic conclusion.",
    hypothesis: null,
    target: "runtime-integration",
    instruction:
      "Recover or reset the execution boundary without retrying an uncertain mutation automatically.",
    successCriterion:
      "The unchanged case produces one trustworthy terminal trace and state boundary."
  },
  agent_decision_unobservable: {
    order: 40,
    category: "evidence",
    severity: "unknown",
    title: "Agent decision was not observable",
    summary: "No native call or structured decision channel established what the agent decided.",
    hypothesis: null,
    target: "runtime-integration",
    instruction:
      "Use a supported WebMCP consumer and resend the exact request while the armed page remains open.",
    successCriterion:
      "The unchanged case produces one admitted native invocation or an explicitly supported structured decision."
  },
  forbidden_effect_observed: {
    order: 50,
    category: "invariant",
    severity: "critical",
    title: "A forbidden effect occurred",
    summary: "Trusted state or ledger evidence contains a contract-forbidden change.",
    hypothesis:
      "The evidence places the mismatch at a site-defined invariant boundary; investigate server-side authorization and transaction scope.",
    target: "handler",
    instruction:
      "Inspect server-side authorization, transaction boundaries, and the invariant that permitted this change; do not solve it only with prose.",
    successCriterion: "The same case preserves every forbidden state and ledger surface."
  },
  unmodeled_state_changed: {
    order: 60,
    category: "invariant",
    severity: "critical",
    title: "Unmodeled state changed",
    summary: "Trusted state changed outside the contract's declared surfaces.",
    hypothesis:
      "The evidence suggests that the trusted-state model or handler scope is incomplete; investigate both before release.",
    target: "trusted-state-adapter",
    instruction:
      "Identify the unmodeled field, then correct the handler boundary or explicitly model the state before rerunning.",
    successCriterion: "The same case changes only explicitly declared state surfaces."
  },
  read_only_action_mutated_state: {
    order: 70,
    category: "invariant",
    severity: "critical",
    title: "Read-only action mutated state",
    summary: "The contract declared a read-only action, but trusted state or ledger changed.",
    hypothesis:
      "The evidence places the mismatch in the handler or trusted-state boundary, not merely the tool response.",
    target: "handler",
    instruction:
      "Inspect the read-only handler and every shared side effect before releasing this catalog.",
    successCriterion:
      "The same read-only case leaves canonical state and operation ledger unchanged."
  },
  duplicate_transition: {
    order: 80,
    category: "replay",
    severity: "critical",
    title: "Replay created a second transition",
    summary: "The idempotency policy was violated by a duplicate state transition.",
    hypothesis:
      "The evidence suggests that idempotency ownership or atomic commit handling needs investigation.",
    target: "idempotency-ledger",
    instruction: "Inspect operation-ID ownership, atomic commit, and duplicate-ledger behavior.",
    successCriterion: "Replaying the same operation produces exactly one total transition."
  },
  multiple_native_invocations: {
    order: 90,
    category: "execution",
    severity: "critical",
    title: "More than one native invocation was admitted",
    summary: "The armed one-call boundary admitted multiple native invocations.",
    hypothesis: "The evidence places the mismatch in first-call admission or catalog closure.",
    target: "runtime-integration",
    instruction:
      "Make first-call admission synchronous and reject all later attempts before domain execution.",
    successCriterion: "Only the first eligible invocation reaches domain execution."
  },
  unexpected_native_invocation: {
    order: 100,
    category: "execution",
    severity: "critical",
    title: "An unexpected native invocation occurred",
    summary: "A native call occurred where the declared contract did not permit one.",
    hypothesis:
      "The evidence places the mismatch at the action-selection boundary; it cannot establish the agent's private reasoning.",
    target: "tool-descriptions",
    instruction:
      "Review the agent-visible action boundaries and the surrounding agent instructions, then rerun the same case.",
    successCriterion: "The same request produces no prohibited native invocation."
  },
  wrong_tool_selected: {
    order: 110,
    category: "selection",
    severity: "high",
    title: "Wrong tool selected",
    summary: "The native tool differs from the tool required by the contract.",
    hypothesis:
      "This run cannot establish why the agent made that choice. The evidence places the mismatch at the tool-selection boundary.",
    target: "tool-descriptions",
    instruction:
      "Compare the expected and observed tool descriptions and make their inclusion and exclusion boundaries explicit.",
    successCriterion:
      "The same request selects the contract-required tool, then the required suite passes."
  },
  required_argument_missing: {
    order: 120,
    category: "arguments",
    severity: "high",
    title: "Required argument missing",
    summary: "The admitted invocation omitted a value required by the contract.",
    hypothesis:
      "The evidence places the mismatch at the argument-construction boundary; investigate field requirements and available context.",
    target: "input-schema",
    instruction:
      "Inspect required fields, field descriptions, and whether the agent-visible context supplies the needed value.",
    successCriterion:
      "The same tool call supplies every required canonical argument without weakening the schema."
  },
  argument_value_mismatch: {
    order: 130,
    category: "arguments",
    severity: "high",
    title: "Argument value mismatch",
    summary: "A canonical argument differs from the contract predicate.",
    hypothesis:
      "The evidence places the mismatch at argument construction or field interpretation.",
    target: "input-schema",
    instruction:
      "Inspect enums, ranges, field descriptions, and the context used to construct this argument.",
    successCriterion:
      "The same case produces canonical arguments that satisfy the unchanged predicate."
  },
  unexpected_argument: {
    order: 140,
    category: "arguments",
    severity: "high",
    title: "Unexpected argument observed",
    summary: "The invocation contained a field outside the closed schema or contract.",
    hypothesis:
      "The evidence suggests schema enforcement or argument construction needs investigation.",
    target: "input-schema",
    instruction: "Keep the schema closed and remove or server-reject the uncovered input surface.",
    successCriterion: "The same case contains only contract-permitted canonical argument leaves."
  },
  handler_rejected_expected_call: {
    order: 150,
    category: "execution",
    severity: "high",
    title: "Expected call was rejected",
    summary: "The contract-required tool reached the handler but did not complete successfully.",
    hypothesis:
      "The evidence places the mismatch in schema/handler acceptance, not tool selection.",
    target: "handler",
    instruction:
      "Compare canonical arguments with handler validation and the declared fixture, then rerun unchanged.",
    successCriterion: "The same expected call reaches a trustworthy terminal handler result."
  },
  required_effect_missing: {
    order: 160,
    category: "effects",
    severity: "high",
    title: "Required effect missing",
    summary: "Trusted state did not contain the contract-required effect.",
    hypothesis: "The evidence places the mismatch in handler commit or trusted-state observation.",
    target: "handler",
    instruction:
      "Inspect the handler transaction and trusted-state adapter; compare the response with the ledger.",
    successCriterion:
      "The same case produces the required trusted state and ledger effect exactly once."
  },
  tool_result_conflicts_with_state: {
    order: 170,
    category: "invariant",
    severity: "high",
    title: "Tool result conflicts with trusted state",
    summary:
      "The tool response represents an effect that trusted state or ledger does not support.",
    hypothesis:
      "The evidence suggests response construction or trusted-state projection needs investigation.",
    target: "trusted-state-adapter",
    instruction:
      "Inspect response construction and the independent trusted-state projection before release.",
    successCriterion:
      "The tool response and trusted state represent the same verified terminal effect."
  },
  replay_not_verified: {
    order: 180,
    category: "replay",
    severity: "unknown",
    title: "Replay was not verified",
    summary: "The exactly-once contract lacks a verified replay assertion for this trial.",
    hypothesis: null,
    target: "idempotency-ledger",
    instruction:
      "Run the declared provider-free native replay check or retain the result with this qualification.",
    successCriterion: "The same operation is replayed and produces no second transition."
  },
  native_invocation_missing: {
    order: 190,
    category: "execution",
    severity: "unknown",
    title: "Native invocation missing",
    summary:
      "The call-expected contract reached its observation boundary without a terminal native invocation.",
    hypothesis: null,
    target: "runtime-integration",
    instruction: "Keep the armed page open in a supported consumer and resend the exact request.",
    successCriterion: "The unchanged case produces one admitted terminal native invocation."
  }
};

const DEFAULT_LIMITATIONS = Object.freeze([
  "Thurstone did not observe the agent's private reasoning.",
  "A diagnostic hypothesis identifies where to investigate; it does not prove causality or guarantee a repair.",
  "This result covers one contract, catalog, agent session, and build in the synthetic reference checkout."
]);

export function diagnosticPrecedence(code: DiagnosticFindingCode): number {
  return TEMPLATES[code].order;
}

function guidanceFor(
  status: DiagnosticEnvelopeV1["status"],
  findings: readonly DiagnosticEnvelopeV1["findings"][number][]
): DiagnosticEnvelopeV1["releaseGuidance"] {
  if (status === "not-needed") return "case-passed";
  if (status === "inconclusive" || status === "invalid-evidence") return "rerun-required";
  return findings.some(({ severity }) => severity === "critical" || severity === "high")
    ? "block-recommended"
    : "review-required";
}

function statusFor(signals: readonly DiagnosticSignal[]): DiagnosticEnvelopeV1["status"] {
  if (signals.length === 0) return "not-needed";
  if (
    signals.some(
      ({ code }) => code === "fixture_or_reset_invalid" || code === "native_trace_unverified"
    )
  ) {
    return "invalid-evidence";
  }
  if (
    signals.every(({ code }) =>
      [
        "native_invocation_missing",
        "execution_canceled_or_partial",
        "agent_decision_unobservable",
        "replay_not_verified"
      ].includes(code)
    )
  ) {
    return "inconclusive";
  }
  return "diagnosed";
}

export interface CreateDiagnosticInput {
  readonly sourceResultDigest: string;
  readonly contractDigest: string;
  readonly buildCommit: string;
  readonly completedAt: string;
  readonly signals: readonly DiagnosticSignal[];
  readonly regressionCase?: DiagnosticEnvelopeV1["regressionCase"];
}

export async function createDiagnosticEnvelope(
  input: CreateDiagnosticInput
): Promise<DiagnosticEnvelopeV1> {
  const signals = input.signals.map((signal) => diagnosticSignalSchema.parse(signal));
  if (new Set(signals.map(({ code }) => code)).size !== signals.length) {
    throw new Error("Diagnostic signals must contain at most one entry per finding code.");
  }
  const invalidEvidence = signals.filter(
    ({ code }) => code === "fixture_or_reset_invalid" || code === "native_trace_unverified"
  );
  const admittedSignals = invalidEvidence.length > 0 ? invalidEvidence : signals;
  const sorted = [...admittedSignals].sort(
    (left, right) =>
      diagnosticPrecedence(left.code) - diagnosticPrecedence(right.code) ||
      left.code.localeCompare(right.code)
  );
  const findingIds = new Map(
    sorted.map(({ code }, index) => [code, `finding_${String(index + 1).padStart(2, "0")}_${code}`])
  );
  const findings = sorted.map((signal) => {
    const template = TEMPLATES[signal.code];
    const findingId = findingIds.get(signal.code);
    if (!findingId) throw new Error("Diagnostic finding identity was not assigned.");
    const factId = `${findingId}_fact_01`;
    const consequenceFindingIds =
      signal.code === "wrong_tool_selected"
        ? ([findingIds.get("required_effect_missing")].filter(Boolean) as string[])
        : [];
    return {
      findingId,
      code: signal.code,
      category: template.category,
      severity: template.severity,
      title: template.title,
      verifiedSummary: template.summary,
      facts: [
        {
          factId,
          statementCode: `${signal.code}.verified`,
          message: template.summary,
          expected: signal.expected,
          actual: signal.actual,
          evidenceRefs: signal.evidenceRefs
        }
      ],
      failedAssertionIds: signal.failedAssertionIds,
      consequenceFindingIds,
      hypothesis:
        template.hypothesis === null
          ? null
          : {
              hypothesisCode: `${signal.code}.investigate`,
              status: "investigate" as const,
              message: template.hypothesis,
              basedOnFactIds: [factId]
            },
      nextStep: {
        actionCode: `${signal.code}.next`,
        target: template.target,
        instruction: template.instruction,
        successCriterion: template.successCriterion,
        rerun: "same-case-then-required-suite" as const
      }
    };
  });
  const status = statusFor(sorted);
  const identityMaterial = {
    algorithmVersion: DEMO_DIAGNOSER_VERSION,
    sourceResultDigest: input.sourceResultDigest,
    contractDigest: input.contractDigest,
    buildCommit: input.buildCommit,
    completedAt: input.completedAt,
    signals: sorted
  };
  const identity = await canonicalSha256(identityMaterial);
  const envelope = diagnosticEnvelopeSchema.parse({
    version: DEMO_DIAGNOSTIC_VERSION,
    algorithmVersion: DEMO_DIAGNOSER_VERSION,
    diagnosticId: `diagnostic_${identity.slice(0, 24)}`,
    status,
    sourceResultDigest: input.sourceResultDigest,
    contractDigest: input.contractDigest,
    buildCommit: input.buildCommit,
    completedAt: input.completedAt,
    primaryFindingId: findings[0]?.findingId ?? null,
    findings,
    releaseGuidance: guidanceFor(status, findings),
    regressionCase: input.regressionCase ?? null,
    limitations: DEFAULT_LIMITATIONS
  });
  return Object.freeze(JSON.parse(canonicalJson(envelope)) as DiagnosticEnvelopeV1);
}

export function diagnosticVerifiedValues(
  expected: JsonValue,
  actual: JsonValue
): Readonly<{ expected: JsonValue; actual: JsonValue }> {
  return Object.freeze({ expected, actual });
}
