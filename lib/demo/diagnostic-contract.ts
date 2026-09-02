import { z } from "zod";

export const DEMO_DIAGNOSTIC_VERSION = "thurstone-demo-diagnostic@1" as const;
export const DEMO_DIAGNOSER_VERSION = "thurstone-demo-diagnoser@2" as const;

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export const diagnosticStatusSchema = z.enum([
  "not-needed",
  "diagnosed",
  "inconclusive",
  "invalid-evidence"
]);
export const diagnosticCategorySchema = z.enum([
  "selection",
  "arguments",
  "execution",
  "effects",
  "replay",
  "invariant",
  "evidence"
]);
export const diagnosticSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "informational",
  "unknown"
]);
export const releaseGuidanceSchema = z.enum([
  "case-passed",
  "review-required",
  "block-recommended",
  "rerun-required"
]);

export const diagnosticFindingCodeSchema = z.enum([
  "wrong_tool_selected",
  "native_invocation_missing",
  "unexpected_native_invocation",
  "multiple_native_invocations",
  "required_argument_missing",
  "argument_value_mismatch",
  "unexpected_argument",
  "handler_rejected_expected_call",
  "required_effect_missing",
  "forbidden_effect_observed",
  "unmodeled_state_changed",
  "read_only_action_mutated_state",
  "duplicate_transition",
  "replay_not_verified",
  "tool_result_conflicts_with_state",
  "native_trace_unverified",
  "fixture_or_reset_invalid",
  "execution_canceled_or_partial",
  "agent_decision_unobservable"
]);

export type DiagnosticFindingCode = z.infer<typeof diagnosticFindingCodeSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const jsonPointerSchema = z
  .string()
  .max(400)
  .refine(
    (value) => value === "" || /^(?:\/(?:~[01]|[^~/])*)+$/u.test(value),
    "Use an RFC 6901 JSON pointer."
  );

export const diagnosticEvidenceRefSchema = z
  .object({
    source: z.enum([
      "contract",
      "agent-decision",
      "native-trace",
      "tool-result",
      "trusted-state-before",
      "trusted-state-after",
      "ledger",
      "runtime-boundary"
    ]),
    jsonPointer: jsonPointerSchema,
    sha256: sha256Schema.nullable()
  })
  .strict();

export type DiagnosticEvidenceRef = z.infer<typeof diagnosticEvidenceRefSchema>;

export const diagnosticFactSchema = z
  .object({
    factId: z.string().min(1).max(120),
    statementCode: z.string().min(1).max(120),
    message: z.string().min(1).max(500),
    expected: jsonValueSchema,
    actual: jsonValueSchema,
    evidenceRefs: z.array(diagnosticEvidenceRefSchema).min(1).max(12)
  })
  .strict();

export const investigationHypothesisSchema = z
  .object({
    hypothesisCode: z.string().min(1).max(120),
    status: z.literal("investigate"),
    message: z.string().min(1).max(500),
    basedOnFactIds: z.array(z.string().min(1).max(120)).min(1).max(8)
  })
  .strict();

export const recommendedNextStepSchema = z
  .object({
    actionCode: z.string().min(1).max(120),
    target: z.enum([
      "tool-descriptions",
      "input-schema",
      "owner-contract",
      "agent-instructions",
      "handler",
      "trusted-state-adapter",
      "idempotency-ledger",
      "runtime-integration"
    ]),
    instruction: z.string().min(1).max(600),
    successCriterion: z.string().min(1).max(400),
    rerun: z.literal("same-case-then-required-suite")
  })
  .strict();

export const diagnosticFindingSchema = z
  .object({
    findingId: z.string().min(1).max(160),
    code: diagnosticFindingCodeSchema,
    category: diagnosticCategorySchema,
    severity: diagnosticSeveritySchema,
    title: z.string().min(1).max(160),
    verifiedSummary: z.string().min(1).max(600),
    facts: z.array(diagnosticFactSchema).min(1).max(8),
    failedAssertionIds: z.array(z.string().min(1).max(160)).max(16),
    consequenceFindingIds: z.array(z.string().min(1).max(160)).max(16),
    hypothesis: investigationHypothesisSchema.nullable(),
    nextStep: recommendedNextStepSchema
  })
  .strict();

export const regressionCaseReferenceSchema = z
  .object({
    caseDigest: sha256Schema,
    sourceResultDigest: sha256Schema
  })
  .strict();

export const diagnosticEnvelopeSchema = z
  .object({
    version: z.literal(DEMO_DIAGNOSTIC_VERSION),
    algorithmVersion: z.literal(DEMO_DIAGNOSER_VERSION),
    diagnosticId: z.string().regex(/^diagnostic_[a-f0-9]{24}$/u),
    status: diagnosticStatusSchema,
    sourceResultDigest: sha256Schema,
    contractDigest: sha256Schema,
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    completedAt: z.string().datetime({ offset: false }),
    primaryFindingId: z.string().min(1).max(160).nullable(),
    findings: z.array(diagnosticFindingSchema).max(19),
    releaseGuidance: releaseGuidanceSchema,
    regressionCase: regressionCaseReferenceSchema.nullable(),
    limitations: z.array(z.string().min(1).max(400)).min(1).max(8)
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.findings.map(({ findingId }) => findingId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: "Finding IDs must be unique."
      });
    }
    if (value.status === "not-needed") {
      if (value.findings.length !== 0 || value.primaryFindingId !== null) {
        context.addIssue({
          code: "custom",
          message: "A passing diagnosis cannot contain findings."
        });
      }
      if (value.releaseGuidance !== "case-passed") {
        context.addIssue({
          code: "custom",
          message: "A passing diagnosis requires case-passed guidance."
        });
      }
      return;
    }
    if (value.findings.length === 0 || !value.primaryFindingId) {
      context.addIssue({
        code: "custom",
        message: "A non-passing diagnosis requires a primary finding."
      });
    } else if (!ids.includes(value.primaryFindingId)) {
      context.addIssue({
        code: "custom",
        path: ["primaryFindingId"],
        message: "Primary finding must resolve."
      });
    }
    for (const finding of value.findings) {
      if (
        finding.consequenceFindingIds.some((id) => !ids.includes(id) || id === finding.findingId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["findings"],
          message: "Consequence finding IDs must resolve to another finding."
        });
      }
    }
  });

export type DiagnosticEnvelopeV1 = z.infer<typeof diagnosticEnvelopeSchema>;

export const diagnosticSignalSchema = z
  .object({
    code: diagnosticFindingCodeSchema,
    expected: jsonValueSchema,
    actual: jsonValueSchema,
    failedAssertionIds: z.array(z.string().min(1).max(160)).max(16),
    evidenceRefs: z.array(diagnosticEvidenceRefSchema).min(1).max(12)
  })
  .strict();

export type DiagnosticSignal = z.infer<typeof diagnosticSignalSchema>;
