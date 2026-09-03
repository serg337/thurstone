import { z } from "zod";

import {
  agentVisibleRunProjectionV2Schema,
  parseAgentVisibleRunProjectionV2,
  type AgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  BYOA_SESSION_V2_VERSION,
  byoaAgentSessionV2Schema,
  byoaContractV3LineageSchema,
  byoaSessionV2StateSchema,
  byoaSessionV2TransitionSchema,
  canTransitionByoaSessionV2,
  parseByoaAgentSessionV2,
  transitionByoaSessionV2,
  type ByoaAgentSessionV2,
  type ByoaSessionV2State
} from "@/lib/demo/agent-session-v2";
import { byoaContractV3Schema, type ByoaContractV3 } from "@/lib/demo/contract-v3";
import { diagnosticFindingCodeSchema, jsonValueSchema } from "@/lib/demo/diagnostic-contract";
import { THURSTONE_DEMO_SELECTABLE_TOOL_NAMES } from "@/lib/demo/reference-tool-templates";
import { regressionRerunLinkV2Schema } from "@/lib/demo/regression-link-v2";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_HANDOFF_ENVELOPE_V2_VERSION = "thurstone-byoa-handoff-envelope@2" as const;
export const BYOA_HANDOFF_PREPARE_V2_VERSION = "thurstone-byoa-handoff-prepare@3" as const;
export const BYOA_HANDOFF_BOOTSTRAP_V2_VERSION = "thurstone-byoa-handoff-bootstrap@3" as const;
export const BYOA_HANDOFF_REVEAL_V2_VERSION = "thurstone-byoa-handoff-reveal@2" as const;
export const BYOA_HANDOFF_CONTROL_V2_VERSION = "thurstone-byoa-handoff-control@2" as const;
export const BYOA_HANDOFF_REVOKE_V2_VERSION = "thurstone-byoa-handoff-revoke@2" as const;
export const BYOA_HANDOFF_REPORT_V2_VERSION = "thurstone-byoa-handoff-report@5" as const;
export const BYOA_HANDOFF_STATUS_V2_VERSION = "thurstone-byoa-handoff-status@2" as const;
export const BYOA_CONTINUOUS_JOURNEY_VERSION = "thurstone-batched-run@2" as const;
export const BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION = "thurstone-batched-run-advance@2" as const;
export const BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION = "thurstone-batched-run-status@5" as const;
export const BYOA_REMOTE_SESSION_V2_VERSION = "thurstone-byoa-remote-session@2" as const;
export const BYOA_REMOTE_SESSION_V2_STORAGE_KEY = "thurstone:byoa-remote-session@2" as const;
export const BYOA_FRESH_CONTEXT_V2_STORAGE_KEY = "thurstone:byoa-fresh-context@2" as const;
export const BYOA_FRESH_CONTEXT_V2_HEADER = "X-Thurstone-Fresh-Context" as const;
export const BYOA_REMOTE_SESSION_V2_MAX_BYTES = 96 * 1024;
export const BYOA_RUNNER_V2_MARKER_KEY = "thurstone:byoa-runner-version" as const;
export const BYOA_AUTO_RUNNER_V2_MARKER_KEY = "thurstone:auto-runner-v2@1" as const;
const BYOA_CONTINUOUS_JOURNEY_MAX_STEPS = 12;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const byoaFreshContextIdV2Schema = z
  .string()
  .regex(/^fresh_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const terminalStates = new Set<ByoaSessionV2State>(["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"]);

export const handoffClaimFailureReasonSchema = z.enum([
  "expired",
  "already_claimed",
  "binding_mismatch",
  "ledger_record_missing",
  "revoked",
  "invalid_token",
  "ledger_unavailable"
]);
export type HandoffClaimFailureReasonV1 = z.infer<typeof handoffClaimFailureReasonSchema>;

export const handoffClaimFailureReceiptSchema = z
  .object({
    version: z.literal("thurstone-handoff-claim-receipt@1"),
    reason: handoffClaimFailureReasonSchema,
    observedAtMs: z.number().int().nonnegative(),
    attemptCount: z.number().int().positive(),
    requestRevealed: z.literal(false),
    toolsRegistered: z.literal(false),
    nativeInvocationCount: z.literal(0)
  })
  .strict();
export type HandoffClaimFailureReceiptV1 = z.infer<typeof handoffClaimFailureReceiptSchema>;

export const byoaHandoffOpenRequestV2Schema = z
  .object({
    token: z.string().min(16).max(3_800),
    freshContextId: byoaFreshContextIdV2Schema
  })
  .strict();

export const byoaHandoffControlRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_CONTROL_V2_VERSION),
    action: z.enum(["start", "settle", "unavailable", "timeout"]),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema
  })
  .strict();

export const byoaHandoffRevokeRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REVOKE_V2_VERSION),
    token: z.string().min(16).max(3_800)
  })
  .strict();

const ownerTrustedStateSummarySchema = z
  .object({
    revision: z.number().int().min(0),
    lines: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(64),
            name: z.string().min(1).max(120),
            quantity: z.number().int().min(1).max(10)
          })
          .strict()
      )
      .max(20),
    pendingCheckoutStatus: z.string().min(1).max(80).nullable()
  })
  .strict();

export const byoaHandoffReportRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REPORT_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
    verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]),
    resultDigest: sha256Schema,
    ownerSummary: z
      .object({
        caseId: z.string().regex(/^case_[0-9a-f-]{36}$/u),
        request: z.string().min(1).max(280),
        expectedTool: z.string().min(1).max(64),
        observedTool: z.string().min(1).max(64).nullable(),
        expectedArguments: jsonValueSchema,
        actualArguments: jsonValueSchema,
        verifiedEffect: z.string().min(1).max(400),
        resultExplanation: z.string().min(1).max(500),
        primaryFindingCode: diagnosticFindingCodeSchema.nullable(),
        primaryFindingTitle: z.string().min(1).max(160).nullable(),
        recommendedNextStep: z.string().min(1).max(600).nullable(),
        trustedStateAfter: ownerTrustedStateSummarySchema,
        testVariant: z
          .enum(["standard", "planted-cart-update-noop", "semantic-collision"])
          .optional()
      })
      .strict()
  })
  .strict();

export type ByoaOwnerResultSummaryV1 = z.infer<
  typeof byoaHandoffReportRequestV2Schema
>["ownerSummary"];

export const byoaHandoffStatusRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_STATUS_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
    token: z.string().min(16).max(3_800)
  })
  .strict();

export const byoaHandoffStatusResponseV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_STATUS_V2_VERSION),
    state: z
      .enum([
        "ISSUED",
        "CLAIMED",
        "RECEIVED",
        "STARTED",
        "SETTLED",
        "TIMED_OUT",
        "UNAVAILABLE",
        "REVOKED"
      ])
      .nullable(),
    verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]).nullable(),
    resultDigest: sha256Schema.nullable(),
    claimFailure: handoffClaimFailureReceiptSchema.nullable()
  })
  .strict();

export const byoaContinuousJourneyPlanSchema = z
  .object({
    version: z.literal(BYOA_CONTINUOUS_JOURNEY_VERSION),
    journeyId: z.string().regex(/^journey_[0-9a-f-]{36}$/u),
    mode: z.enum(["continuous", "regression"]),
    processEndingToolNames: z.array(z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES)).max(4),
    steps: z.array(byoaAgentSessionV2Schema).min(2).max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS)
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      plan.steps.some(
        (step) =>
          step.state !== "HANDOFF_ISSUED" ||
          step.contract.suiteId !== plan.steps[0]?.contract.suiteId ||
          step.contract.catalogDigest !== plan.steps[0]?.contract.catalogDigest ||
          step.contract.buildCommit !== plan.steps[0]?.contract.buildCommit
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A continuous journey must bind every request to one suite and build."
      });
    }
    const catalogNames = new Set(
      plan.steps[0]?.contract.catalogSnapshot.tools.map(({ name }) => name) ?? []
    );
    if (
      new Set(plan.processEndingToolNames).size !== plan.processEndingToolNames.length ||
      plan.processEndingToolNames.some((toolName) => !catalogNames.has(toolName))
    ) {
      context.addIssue({
        code: "custom",
        path: ["processEndingToolNames"],
        message: "Process-ending tools must be unique members of the selected catalog."
      });
    }
    for (const [index, step] of plan.steps.entries()) {
      if (
        plan.mode === "continuous" &&
        plan.processEndingToolNames.includes(step.contract.expectedTool) &&
        index !== plan.steps.length - 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index],
          message: "Nothing may follow a process-ending tool."
        });
      }
    }
    if (new Set(plan.steps.map(({ contract }) => contract.caseId)).size !== plan.steps.length) {
      context.addIssue({ code: "custom", message: "Journey case IDs must be unique." });
    }
  });

export type ByoaContinuousJourneyPlan = z.infer<typeof byoaContinuousJourneyPlanSchema>;

export const byoaContinuousJourneyAdvanceRequestSchema = z
  .object({
    version: z.literal(BYOA_CONTINUOUS_JOURNEY_ADVANCE_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
    resultDigest: sha256Schema
  })
  .strict();

export const byoaContinuousJourneyMetadataSchema = z
  .object({
    journeyId: z.string().regex(/^journey_[0-9a-f-]{36}$/u),
    mode: z.enum(["continuous", "regression"]),
    position: z.number().int().min(1).max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS),
    total: z.number().int().min(2).max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS)
  })
  .strict();

export const byoaContinuousJourneyStatusRequestSchema = z
  .object({
    version: z.literal(BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
    token: z.string().min(16).max(3_800)
  })
  .strict();

export const byoaContinuousJourneyStatusResponseSchema = z
  .object({
    version: z.literal(BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION),
    mode: z.enum(["continuous", "regression"]),
    position: z.number().int().min(1).max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS),
    total: z.number().int().min(2).max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS),
    state: z
      .enum([
        "ISSUED",
        "CLAIMED",
        "RECEIVED",
        "STARTED",
        "SETTLED",
        "TIMED_OUT",
        "UNAVAILABLE",
        "REVOKED"
      ])
      .nullable(),
    claimFailure: handoffClaimFailureReceiptSchema.nullable(),
    complete: z.boolean(),
    results: z
      .array(
        z
          .object({
            caseId: z.string().regex(/^case_[0-9a-f-]{36}$/u),
            verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]),
            resultDigest: sha256Schema,
            ownerSummary: byoaHandoffReportRequestV2Schema.shape.ownerSummary
          })
          .strict()
      )
      .max(BYOA_CONTINUOUS_JOURNEY_MAX_STEPS)
  })
  .strict();

export function parseByoaFreshContextV2Header(headers: Headers): string {
  return byoaFreshContextIdV2Schema.parse(headers.get(BYOA_FRESH_CONTEXT_V2_HEADER));
}

export const remoteByoaSessionV2Schema = z
  .object({
    version: z.literal(BYOA_REMOTE_SESSION_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    state: byoaSessionV2StateSchema,
    lineage: byoaContractV3LineageSchema,
    contractDigest: sha256Schema,
    regressionLink: regressionRerunLinkV2Schema.nullable(),
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    transitions: z.array(byoaSessionV2TransitionSchema).min(2).max(24),
    terminalResultDigest: sha256Schema.nullable()
  })
  .strict()
  .superRefine((session, context) => {
    const first = session.transitions[0];
    const last = session.transitions.at(-1);
    if (first?.from !== "COMPILED" || last?.to !== session.state || last.at !== session.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["transitions"],
        message: "Remote session transitions must span COMPILED through the current state."
      });
    }
    for (const [index, transition] of session.transitions.entries()) {
      const previous = session.transitions[index - 1];
      if (
        (previous !== undefined && previous.to !== transition.from) ||
        !canTransitionByoaSessionV2(transition.from, transition.to) ||
        (previous !== undefined && Date.parse(transition.at) <= Date.parse(previous.at))
      ) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index],
          message: "Remote session contains an invalid lifecycle transition."
        });
      }
      if (
        transition.from === "READY_TO_ARM" &&
        transition.to === "PREPARING" &&
        transition.reasonCode !== "agent_explicit_start"
      ) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index, "reasonCode"],
          message: "Remote provider preparation requires explicit start."
        });
      }
    }
    if (terminalStates.has(session.state) !== (session.terminalResultDigest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["terminalResultDigest"],
        message: "Only terminal remote sessions may carry a result digest."
      });
    }
  });

export type RemoteByoaSessionV2 = z.infer<typeof remoteByoaSessionV2Schema>;

export const byoaHandoffEnvelopeV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_ENVELOPE_V2_VERSION),
    issuedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    session: byoaAgentSessionV2Schema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.session.state !== "HANDOFF_ISSUED") {
      context.addIssue({
        code: "custom",
        path: ["session", "state"],
        message: "Only a HANDOFF_ISSUED session may enter a fresh-agent token."
      });
    }
    if (value.session.expiresAt !== value.expiresAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Handoff v2 session and envelope expiry must match."
      });
    }
  });

export type ByoaHandoffEnvelopeV2 = z.infer<typeof byoaHandoffEnvelopeV2Schema>;

export const byoaHandoffPrepareRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_PREPARE_V2_VERSION),
    session: byoaAgentSessionV2Schema,
    projection: agentVisibleRunProjectionV2Schema,
    journey: byoaContinuousJourneyPlanSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const catalogProjection = value.session.contract.catalogSnapshot.tools.map(
      ({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations
      })
    );
    if (
      value.session.state !== "HANDOFF_ISSUED" ||
      value.session.runId !== value.projection.runId ||
      value.session.contract.request !== value.projection.request ||
      value.session.contract.catalogDigest !== value.projection.catalogDigest ||
      value.session.contract.buildCommit !== value.projection.buildCommit ||
      (value.session.contract.runtimeVariant ?? "standard") !==
        (value.projection.runtimeVariant ?? "standard") ||
      value.session.expiresAt !== value.projection.expiresAt ||
      canonicalJson(catalogProjection) !== canonicalJson(value.projection.descriptors)
    ) {
      context.addIssue({
        code: "custom",
        message: "The Handoff v2 request does not bind one exact session and projection."
      });
    }
    if (
      value.journey !== undefined &&
      (value.journey.steps[0]?.runId !== value.session.runId ||
        value.journey.steps[0]?.contractDigest !== value.session.contractDigest)
    ) {
      context.addIssue({ code: "custom", message: "The journey must begin with this handoff." });
    }
  });

export const byoaHandoffPrepareResponseV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_PREPARE_V2_VERSION),
    handoffUrl: z
      .string()
      .url()
      .max(8 * 1024),
    expiresAt: z.string().datetime({ offset: false })
  })
  .strict();

export const byoaHandoffBootstrapResponseV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_BOOTSTRAP_V2_VERSION),
    session: remoteByoaSessionV2Schema,
    projection: agentVisibleRunProjectionV2Schema,
    journey: byoaContinuousJourneyMetadataSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.session.state !== "RECEIVED" ||
      value.session.runId !== value.projection.runId ||
      value.session.lineage.catalogDigest !== value.projection.catalogDigest ||
      value.session.expiresAt !== value.projection.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["projection"],
        message: "Bootstrap v2 must expose one RECEIVED session and its answer-free projection."
      });
    }
  });

export const byoaHandoffRevealRequestV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REVEAL_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema
  })
  .strict();

export const byoaHandoffRevealResponseV2Schema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REVEAL_V2_VERSION),
    contract: byoaContractV3Schema,
    lineage: byoaContractV3LineageSchema
  })
  .strict();

export function parseHandoffEnvelopeV2(value: unknown): ByoaHandoffEnvelopeV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaHandoffEnvelopeV2Schema.parse(value))) as ByoaHandoffEnvelopeV2
  );
}

export function parseRemoteByoaSessionV2(value: unknown): RemoteByoaSessionV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(remoteByoaSessionV2Schema.parse(value))) as RemoteByoaSessionV2
  );
}

export function byoaHandoffV2ReceivedAt(sessionUpdatedAt: string, nowMs = Date.now()): string {
  const updatedAtMs = Date.parse(sessionUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) throw new Error("Invalid Handoff v2 session timestamp.");
  return new Date(Math.max(nowMs, updatedAtMs + 1)).toISOString();
}

export function receiveAndRedactByoaSessionV2(
  value: unknown,
  receivedAt: string
): RemoteByoaSessionV2 {
  const issued = parseByoaAgentSessionV2(value);
  const received = transitionByoaSessionV2(issued, "RECEIVED", {
    at: receivedAt,
    reasonCode: "fresh_agent_handoff_received"
  });
  const { contract, ...redacted } = received;
  void contract;
  return parseRemoteByoaSessionV2({
    ...redacted,
    version: BYOA_REMOTE_SESSION_V2_VERSION
  });
}

export function transitionRemoteByoaSessionV2(
  value: unknown,
  to: ByoaSessionV2State,
  input: {
    readonly at: string;
    readonly reasonCode: string;
    readonly resultDigest?: string;
    readonly explicitStart?: true;
  }
): RemoteByoaSessionV2 {
  const current = parseRemoteByoaSessionV2(value);
  if (!canTransitionByoaSessionV2(current.state, to)) {
    throw new Error(`Remote BYOA Session v2 transition ${current.state} → ${to} is not allowed.`);
  }
  if (current.state === "READY_TO_ARM" && to === "PREPARING" && input.explicitStart !== true) {
    throw new Error("Remote BYOA Session v2 provider preparation requires explicit start.");
  }
  if (Date.parse(input.at) <= Date.parse(current.updatedAt)) {
    throw new Error("Remote BYOA Session v2 transition timestamps must advance.");
  }
  const terminal = terminalStates.has(to);
  return parseRemoteByoaSessionV2({
    ...current,
    state: to,
    updatedAt: input.at,
    transitions: [
      ...current.transitions,
      {
        from: current.state,
        to,
        at: input.at,
        reasonCode:
          current.state === "READY_TO_ARM" && to === "PREPARING"
            ? "agent_explicit_start"
            : input.reasonCode
      }
    ],
    terminalResultDigest: terminal ? (input.resultDigest ?? null) : null
  });
}

export function hydrateRemoteByoaSessionV2(
  remoteValue: unknown,
  contract: ByoaContractV3
): ByoaAgentSessionV2 {
  const remote = parseRemoteByoaSessionV2(remoteValue);
  if (
    remote.lineage.suiteId !== contract.suiteId ||
    remote.lineage.suiteDigest !== contract.suiteDigest ||
    remote.lineage.caseId !== contract.caseId ||
    remote.lineage.catalogDigest !== contract.catalogDigest
  ) {
    throw new Error("Remote BYOA Session v2 contract lineage does not match.");
  }
  const { version, ...session } = remote;
  void version;
  return parseByoaAgentSessionV2({
    ...session,
    version: BYOA_SESSION_V2_VERSION,
    contract
  });
}

export function parseAgentProjectionForHandoffV2(value: unknown): AgentVisibleRunProjectionV2 {
  return parseAgentVisibleRunProjectionV2(value);
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function writeRemoteByoaSessionV2(storage: Storage, value: unknown): void {
  const encoded = canonicalJson(parseRemoteByoaSessionV2(value));
  if (encodedBytes(encoded) > BYOA_REMOTE_SESSION_V2_MAX_BYTES) {
    throw new Error("Remote BYOA Session v2 exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_REMOTE_SESSION_V2_STORAGE_KEY, encoded);
}

export function readRemoteByoaSessionV2(storage: Storage): RemoteByoaSessionV2 | null {
  const encoded = storage.getItem(BYOA_REMOTE_SESSION_V2_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_REMOTE_SESSION_V2_MAX_BYTES) {
    throw new Error("Stored remote BYOA Session v2 exceeds the allowed size.");
  }
  return parseRemoteByoaSessionV2(JSON.parse(encoded) as unknown);
}

export function clearRemoteByoaSessionV2(storage: Storage): void {
  storage.removeItem(BYOA_REMOTE_SESSION_V2_STORAGE_KEY);
}
