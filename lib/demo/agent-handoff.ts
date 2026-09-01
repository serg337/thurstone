import { z } from "zod";

import {
  agentVisibleRunProjectionSchema,
  parseAgentVisibleRunProjection,
  type AgentVisibleRunProjection
} from "@/lib/demo/agent-projection";
import {
  byoaAgentSessionSchema,
  byoaSessionStateSchema,
  byoaSessionTransitionSchema,
  canTransition,
  parseByoaAgentSession,
  type ByoaAgentSessionV1,
  type ByoaSessionState
} from "@/lib/demo/agent-session";
import { byoaContractSchema, parseByoaContract, type ByoaContractV2 } from "@/lib/demo/contract-v2";
import { regressionRerunSchema, type RegressionRerunV1 } from "@/lib/demo/regression-rerun";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_HANDOFF_ENVELOPE_VERSION = "thurstone-byoa-handoff-envelope@1" as const;
export const BYOA_HANDOFF_PREPARE_VERSION = "thurstone-byoa-handoff-prepare@1" as const;
export const BYOA_HANDOFF_BOOTSTRAP_VERSION = "thurstone-byoa-handoff-bootstrap@1" as const;
export const BYOA_HANDOFF_REVEAL_VERSION = "thurstone-byoa-handoff-reveal@1" as const;
export const BYOA_REMOTE_SESSION_VERSION = "thurstone-byoa-remote-session@1" as const;
export const BYOA_REMOTE_SESSION_STORAGE_KEY = "thurstone:byoa-remote-session@1" as const;
export const BYOA_HANDOFF_URL_STORAGE_KEY = "thurstone:byoa-handoff-url@1" as const;
export const BYOA_HANDOFF_MAX_BYTES = 96 * 1024;
export const BYOA_HANDOFF_TTL_MS = 10 * 60 * 1000;
export const BYOA_HANDOFF_TOKEN_MAX_BYTES = 3_800;
export const BYOA_HANDOFF_URL_MAX_BYTES = 8 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const remoteByoaSessionSchema = z
  .object({
    version: z.literal(BYOA_REMOTE_SESSION_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    state: byoaSessionStateSchema,
    contractDigest: sha256Schema,
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    transitions: z.array(byoaSessionTransitionSchema).min(1).max(24),
    terminalResultDigest: sha256Schema.nullable()
  })
  .strict()
  .superRefine((session, context) => {
    const last = session.transitions.at(-1);
    if (!last || last.to !== session.state || last.at !== session.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["transitions"],
        message: "The remote session transition chain is inconsistent."
      });
    }
    for (const [index, transition] of session.transitions.entries()) {
      if (
        (index > 0 && session.transitions[index - 1]?.to !== transition.from) ||
        !canTransition(transition.from, transition.to)
      ) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index],
          message: "The remote session contains an invalid transition."
        });
      }
    }
    const terminal = ["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(session.state);
    if (terminal !== (session.terminalResultDigest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["terminalResultDigest"],
        message: "Only a terminal remote session may contain a result digest."
      });
    }
  });

export type RemoteByoaSessionV1 = z.infer<typeof remoteByoaSessionSchema>;

export const byoaHandoffEnvelopeSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_ENVELOPE_VERSION),
    issuedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    session: byoaAgentSessionSchema,
    projection: agentVisibleRunProjectionSchema,
    rerun: regressionRerunSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.session.runId !== value.projection.runId ||
      value.session.contract.buildCommit !== value.projection.buildCommit ||
      value.session.expiresAt !== value.projection.expiresAt ||
      value.expiresAt !== value.projection.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["projection"],
        message: "Handoff session and agent projection identities must match."
      });
    }
  });

export type ByoaHandoffEnvelopeV1 = z.infer<typeof byoaHandoffEnvelopeSchema>;

export const byoaHandoffPrepareRequestSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_PREPARE_VERSION),
    session: byoaAgentSessionSchema,
    projection: agentVisibleRunProjectionSchema,
    rerun: regressionRerunSchema.nullable()
  })
  .strict();

export const byoaHandoffPrepareResponseSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_PREPARE_VERSION),
    handoffUrl: z.string().url().max(BYOA_HANDOFF_URL_MAX_BYTES),
    expiresAt: z.string().datetime({ offset: false })
  })
  .strict();

export const byoaHandoffOpenRequestSchema = z
  .object({
    token: z.string().min(80).max(BYOA_HANDOFF_TOKEN_MAX_BYTES)
  })
  .strict();

export const byoaHandoffBootstrapResponseSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_BOOTSTRAP_VERSION),
    session: remoteByoaSessionSchema,
    projection: agentVisibleRunProjectionSchema,
    rerun: regressionRerunSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.session.runId !== value.projection.runId ||
      value.session.expiresAt !== value.projection.expiresAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["projection"],
        message: "Bootstrap session and projection identities must match."
      });
    }
    if (value.rerun && value.session.state !== "NAVIGATING") {
      context.addIssue({
        code: "custom",
        path: ["rerun"],
        message: "A handoff rerun must begin from the navigating boundary."
      });
    }
  });

export const byoaHandoffRevealRequestSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REVEAL_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema
  })
  .strict();

export const byoaHandoffRevealResponseSchema = z
  .object({
    version: z.literal(BYOA_HANDOFF_REVEAL_VERSION),
    contract: byoaContractSchema
  })
  .strict();

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseRemoteByoaSession(value: unknown): RemoteByoaSessionV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(remoteByoaSessionSchema.parse(value))) as RemoteByoaSessionV1
  );
}

export function redactByoaSession(session: ByoaAgentSessionV1): RemoteByoaSessionV1 {
  const parsed = parseByoaAgentSession(session);
  const { contract, ...remote } = parsed;
  void contract;
  return parseRemoteByoaSession({ ...remote, version: BYOA_REMOTE_SESSION_VERSION });
}

export function hydrateRemoteByoaSession(
  remote: RemoteByoaSessionV1,
  contract: ByoaContractV2
): ByoaAgentSessionV1 {
  const { version, ...session } = parseRemoteByoaSession(remote);
  void version;
  return parseByoaAgentSession({ ...session, version: "thurstone-byoa-session@1", contract });
}

export function transitionRemoteByoaSession(
  session: RemoteByoaSessionV1,
  to: ByoaSessionState,
  input: { readonly at: string; readonly reasonCode: string; readonly resultDigest?: string }
): RemoteByoaSessionV1 {
  const current = parseRemoteByoaSession(session);
  if (!canTransition(current.state, to)) {
    throw new Error(`Remote BYOA transition ${current.state} → ${to} is not allowed.`);
  }
  const terminal = ["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(to);
  return parseRemoteByoaSession({
    ...current,
    state: to,
    updatedAt: input.at,
    transitions: [
      ...current.transitions,
      { from: current.state, to, at: input.at, reasonCode: input.reasonCode }
    ],
    terminalResultDigest: terminal ? (input.resultDigest ?? null) : null
  });
}

export function writeRemoteByoaSession(storage: Storage, session: RemoteByoaSessionV1): void {
  const encoded = canonicalJson(parseRemoteByoaSession(session));
  if (encodedBytes(encoded) > BYOA_HANDOFF_MAX_BYTES) {
    throw new Error("Remote BYOA session exceeds the browser boundary.");
  }
  storage.setItem(BYOA_REMOTE_SESSION_STORAGE_KEY, encoded);
}

export function readRemoteByoaSession(storage: Storage): RemoteByoaSessionV1 | null {
  const encoded = storage.getItem(BYOA_REMOTE_SESSION_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_HANDOFF_MAX_BYTES) {
    throw new Error("Stored remote BYOA session exceeds the browser boundary.");
  }
  return parseRemoteByoaSession(JSON.parse(encoded) as unknown);
}

export function clearRemoteByoaSession(storage: Storage): void {
  storage.removeItem(BYOA_REMOTE_SESSION_STORAGE_KEY);
}

export function writeByoaHandoffUrl(storage: Storage, url: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== globalThis.location.origin || parsed.pathname !== "/demo/handoff") {
    throw new Error("The fresh-agent handoff URL must remain on this Thurstone origin.");
  }
  if (encodedBytes(url) > BYOA_HANDOFF_URL_MAX_BYTES)
    throw new Error("The handoff URL is too large.");
  storage.setItem(BYOA_HANDOFF_URL_STORAGE_KEY, url);
}

export function readByoaHandoffUrl(storage: Storage): string | null {
  const value = storage.getItem(BYOA_HANDOFF_URL_STORAGE_KEY);
  if (value === null) return null;
  if (encodedBytes(value) > BYOA_HANDOFF_URL_MAX_BYTES)
    throw new Error("The stored handoff URL is too large.");
  const parsed = new URL(value);
  if (parsed.origin !== globalThis.location.origin || parsed.pathname !== "/demo/handoff") {
    throw new Error("The stored handoff URL has the wrong origin.");
  }
  return value;
}

export function clearByoaHandoffUrl(storage: Storage): void {
  storage.removeItem(BYOA_HANDOFF_URL_STORAGE_KEY);
}

export function parseHandoffEnvelope(value: unknown): ByoaHandoffEnvelopeV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaHandoffEnvelopeSchema.parse(value))) as ByoaHandoffEnvelopeV1
  );
}

export function parseAgentProjectionForHandoff(value: unknown): AgentVisibleRunProjection {
  return parseAgentVisibleRunProjection(value);
}

export function parseContractForHandoff(value: unknown): ByoaContractV2 {
  return parseByoaContract(value);
}

export type { AgentVisibleRunProjection, RegressionRerunV1 };
