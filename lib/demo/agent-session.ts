import { z } from "zod";

import { byoaContractSchema, parseByoaContract, type ByoaContractV2 } from "@/lib/demo/contract-v2";
import {
  BYOA_AGENT_PROJECTION_VERSION,
  parseAgentVisibleRunProjection
} from "@/lib/demo/agent-projection";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_SESSION_VERSION = "thurstone-byoa-session@1" as const;
export const BYOA_SESSION_STORAGE_KEY = "thurstone:byoa-session@1" as const;
export const BYOA_SESSION_MAX_BYTES = 128 * 1024;

export const byoaSessionStateSchema = z.enum([
  "DRAFT",
  "COMPILED",
  "NAVIGATING",
  "PREPARING",
  "PROVIDER_READY",
  "ARMED",
  "OBSERVING",
  "EVALUATING",
  "PASS",
  "ISSUE",
  "INCOMPLETE",
  "UNAVAILABLE"
]);

export type ByoaSessionState = z.infer<typeof byoaSessionStateSchema>;

const terminalStates: ReadonlySet<ByoaSessionState> = new Set([
  "PASS",
  "ISSUE",
  "INCOMPLETE",
  "UNAVAILABLE"
]);

const transitionSchema = z
  .object({
    from: byoaSessionStateSchema,
    to: byoaSessionStateSchema,
    at: z.string().datetime({ offset: false }),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/u)
  })
  .strict();

export const byoaAgentSessionSchema = z
  .object({
    version: z.literal(BYOA_SESSION_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    state: byoaSessionStateSchema,
    contract: byoaContractSchema,
    contractDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    transitions: z.array(transitionSchema).min(1).max(24),
    terminalResultDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
  })
  .strict()
  .superRefine((session, context) => {
    const last = session.transitions.at(-1);
    if (!last || last.to !== session.state || last.at !== session.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["transitions"],
        message: "The final transition must match the current session state and update time."
      });
    }
    for (const [index, transition] of session.transitions.entries()) {
      if (index > 0 && session.transitions[index - 1]?.to !== transition.from) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index],
          message: "Session transitions must form one continuous state chain."
        });
      }
      if (!canTransition(transition.from, transition.to)) {
        context.addIssue({
          code: "custom",
          path: ["transitions", index],
          message: `Transition ${transition.from} → ${transition.to} is not allowed.`
        });
      }
    }
    if (terminalStates.has(session.state) !== (session.terminalResultDigest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["terminalResultDigest"],
        message: "Only terminal sessions may carry a terminal result digest."
      });
    }
  });

export type ByoaAgentSessionV1 = z.infer<typeof byoaAgentSessionSchema>;

const transitions: Readonly<Record<ByoaSessionState, readonly ByoaSessionState[]>> = Object.freeze({
  DRAFT: ["COMPILED"],
  COMPILED: ["NAVIGATING"],
  NAVIGATING: ["PREPARING"],
  PREPARING: ["PROVIDER_READY", "INCOMPLETE", "UNAVAILABLE"],
  PROVIDER_READY: ["ARMED", "INCOMPLETE", "UNAVAILABLE"],
  ARMED: ["OBSERVING", "INCOMPLETE", "UNAVAILABLE"],
  OBSERVING: ["EVALUATING", "INCOMPLETE"],
  EVALUATING: ["PASS", "ISSUE", "INCOMPLETE"],
  PASS: [],
  ISSUE: [],
  INCOMPLETE: [],
  UNAVAILABLE: []
});

export function canTransition(from: ByoaSessionState, to: ByoaSessionState): boolean {
  return transitions[from].includes(to);
}

export function parseByoaAgentSession(value: unknown): ByoaAgentSessionV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaAgentSessionSchema.parse(value))) as ByoaAgentSessionV1
  );
}

export function createCompiledByoaSession(input: {
  readonly runId: string;
  readonly contract: ByoaContractV2;
  readonly contractDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}): ByoaAgentSessionV1 {
  return parseByoaAgentSession({
    version: BYOA_SESSION_VERSION,
    runId: input.runId,
    state: "COMPILED",
    contract: parseByoaContract(input.contract),
    contractDigest: input.contractDigest,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    expiresAt: input.expiresAt,
    transitions: [
      { from: "DRAFT", to: "COMPILED", at: input.createdAt, reasonCode: "contract_compiled" }
    ],
    terminalResultDigest: null
  });
}

export function transitionByoaSession(
  session: ByoaAgentSessionV1,
  to: ByoaSessionState,
  input: { readonly at: string; readonly reasonCode: string; readonly resultDigest?: string }
): ByoaAgentSessionV1 {
  const current = parseByoaAgentSession(session);
  if (!canTransition(current.state, to)) {
    throw new Error(`BYOA transition ${current.state} → ${to} is not allowed.`);
  }
  const terminal = terminalStates.has(to);
  return parseByoaAgentSession({
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

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function writeByoaAgentSession(storage: Storage, value: ByoaAgentSessionV1): void {
  const encoded = JSON.stringify(parseByoaAgentSession(value));
  if (encodedBytes(encoded) > BYOA_SESSION_MAX_BYTES) {
    throw new Error("BYOA session exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_SESSION_STORAGE_KEY, encoded);
}

export function readByoaAgentSession(storage: Storage): ByoaAgentSessionV1 | null {
  const encoded = storage.getItem(BYOA_SESSION_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_SESSION_MAX_BYTES) {
    throw new Error("Stored BYOA session exceeds the allowed size.");
  }
  return parseByoaAgentSession(JSON.parse(encoded) as unknown);
}

export function clearByoaAgentSession(storage: Storage): void {
  storage.removeItem(BYOA_SESSION_STORAGE_KEY);
}

export function agentVisibleRunProjection(session: ByoaAgentSessionV1) {
  const parsed = parseByoaAgentSession(session);
  return parseAgentVisibleRunProjection({
    version: BYOA_AGENT_PROJECTION_VERSION,
    runId: parsed.runId,
    request: parsed.contract.request,
    fixture: Object.freeze({
      fixtureId: parsed.contract.fixtureId,
      summary: "Two synthetic cart lines; no purchase, payment, shipment, or external transaction."
    }),
    descriptors: parsed.contract.descriptors,
    buildCommit: parsed.contract.buildCommit,
    expiresAt: parsed.expiresAt
  });
}
