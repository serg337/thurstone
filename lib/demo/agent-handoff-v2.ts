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
import { regressionRerunLinkV2Schema } from "@/lib/demo/regression-link-v2";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_HANDOFF_ENVELOPE_V2_VERSION = "thurstone-byoa-handoff-envelope@2" as const;
export const BYOA_HANDOFF_PREPARE_V2_VERSION = "thurstone-byoa-handoff-prepare@2" as const;
export const BYOA_HANDOFF_BOOTSTRAP_V2_VERSION = "thurstone-byoa-handoff-bootstrap@2" as const;
export const BYOA_HANDOFF_REVEAL_V2_VERSION = "thurstone-byoa-handoff-reveal@2" as const;
export const BYOA_HANDOFF_CONTROL_V2_VERSION = "thurstone-byoa-handoff-control@2" as const;
export const BYOA_HANDOFF_REVOKE_V2_VERSION = "thurstone-byoa-handoff-revoke@2" as const;
export const BYOA_REMOTE_SESSION_V2_VERSION = "thurstone-byoa-remote-session@2" as const;
export const BYOA_REMOTE_SESSION_V2_STORAGE_KEY = "thurstone:byoa-remote-session@2" as const;
export const BYOA_FRESH_CONTEXT_V2_STORAGE_KEY = "thurstone:byoa-fresh-context@2" as const;
export const BYOA_FRESH_CONTEXT_V2_HEADER = "X-Thurstone-Fresh-Context" as const;
export const BYOA_REMOTE_SESSION_V2_MAX_BYTES = 96 * 1024;
export const BYOA_RUNNER_V2_MARKER_KEY = "thurstone:byoa-runner-version" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const byoaFreshContextIdV2Schema = z
  .string()
  .regex(/^fresh_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const terminalStates = new Set<ByoaSessionV2State>(["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"]);

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
    projection: agentVisibleRunProjectionV2Schema
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
      value.session.expiresAt !== value.projection.expiresAt ||
      canonicalJson(catalogProjection) !== canonicalJson(value.projection.descriptors)
    ) {
      context.addIssue({
        code: "custom",
        message: "The Handoff v2 request does not bind one exact session and projection."
      });
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
    projection: agentVisibleRunProjectionV2Schema
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
