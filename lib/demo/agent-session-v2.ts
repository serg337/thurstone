import { z } from "zod";

import {
  BYOA_AGENT_PROJECTION_V2_VERSION,
  parseAgentVisibleRunProjectionV2,
  type AgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  byoaContractV3Digest,
  byoaContractV3Schema,
  parseByoaContractV3,
  verifyByoaContractV3,
  type ByoaContractV3,
  type ByoaContractV3ExpectedLineage
} from "@/lib/demo/contract-v3";
import {
  regressionRerunLinkV2Schema,
  type RegressionRerunLinkV2
} from "@/lib/demo/regression-link-v2";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_SESSION_V2_VERSION = "thurstone-byoa-session@2" as const;
export const BYOA_SESSION_V2_STORAGE_KEY = "thurstone:byoa-session@2" as const;
export const BYOA_SESSION_V2_MAX_BYTES = 128 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const byoaSessionV2StateSchema = z.enum([
  "COMPILED",
  "HANDOFF_ISSUED",
  "RECEIVED",
  "READY_TO_ARM",
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

export type ByoaSessionV2State = z.infer<typeof byoaSessionV2StateSchema>;

export const byoaContractV3LineageSchema = z
  .object({
    suiteId: z.string().regex(/^suite_[0-9a-f-]{36}$/u),
    suiteDigest: sha256Schema,
    caseId: z.string().regex(/^case_[0-9a-f-]{36}$/u),
    catalogDigest: sha256Schema
  })
  .strict();

export const byoaSessionV2TransitionSchema = z
  .object({
    from: byoaSessionV2StateSchema,
    to: byoaSessionV2StateSchema,
    at: z.string().datetime({ offset: false }),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/u)
  })
  .strict();

const terminalV2States: ReadonlySet<ByoaSessionV2State> = new Set([
  "PASS",
  "ISSUE",
  "INCOMPLETE",
  "UNAVAILABLE"
]);

const v2Transitions: Readonly<Record<ByoaSessionV2State, readonly ByoaSessionV2State[]>> =
  Object.freeze({
    COMPILED: ["HANDOFF_ISSUED"],
    HANDOFF_ISSUED: ["RECEIVED"],
    RECEIVED: ["READY_TO_ARM", "INCOMPLETE", "UNAVAILABLE"],
    READY_TO_ARM: ["PREPARING", "INCOMPLETE", "UNAVAILABLE"],
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

export function canTransitionByoaSessionV2(
  from: ByoaSessionV2State,
  to: ByoaSessionV2State
): boolean {
  return v2Transitions[from].includes(to);
}

export const byoaAgentSessionV2Schema = z
  .object({
    version: z.literal(BYOA_SESSION_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    state: byoaSessionV2StateSchema,
    contract: byoaContractV3Schema,
    lineage: byoaContractV3LineageSchema,
    contractDigest: sha256Schema,
    createdAt: z.string().datetime({ offset: false }),
    updatedAt: z.string().datetime({ offset: false }),
    expiresAt: z.string().datetime({ offset: false }),
    transitions: z.array(byoaSessionV2TransitionSchema).max(24),
    regressionLink: regressionRerunLinkV2Schema.nullable(),
    terminalResultDigest: sha256Schema.nullable()
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.lineage.suiteId !== session.contract.suiteId ||
      session.lineage.suiteDigest !== session.contract.suiteDigest ||
      session.lineage.caseId !== session.contract.caseId ||
      session.lineage.catalogDigest !== session.contract.catalogDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["lineage"],
        message: "Session lineage must match the independently bound Contract v3 identity."
      });
    }
    if (Date.parse(session.expiresAt) <= Date.parse(session.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Session expiry must follow creation."
      });
    }
    if (session.transitions.length === 0) {
      if (session.state !== "COMPILED" || session.updatedAt !== session.createdAt) {
        context.addIssue({
          code: "custom",
          path: ["transitions"],
          message: "Only a newly compiled session may have an empty transition chain."
        });
      }
    } else {
      const first = session.transitions[0];
      const last = session.transitions.at(-1);
      if (
        first?.from !== "COMPILED" ||
        last?.to !== session.state ||
        last.at !== session.updatedAt
      ) {
        context.addIssue({
          code: "custom",
          path: ["transitions"],
          message: "Session transitions must begin at COMPILED and end at the current state."
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
            message: "Session transitions must form one valid, monotonic lifecycle chain."
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
            message: "Provider preparation requires the agent's explicit start action."
          });
        }
      }
    }
    if (terminalV2States.has(session.state) !== (session.terminalResultDigest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["terminalResultDigest"],
        message: "Only terminal sessions may carry a terminal result digest."
      });
    }
  });

export type ByoaAgentSessionV2 = z.infer<typeof byoaAgentSessionV2Schema>;

export function parseByoaAgentSessionV2(value: unknown): ByoaAgentSessionV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaAgentSessionV2Schema.parse(value))) as ByoaAgentSessionV2
  );
}

export async function createCompiledByoaSessionV2(input: {
  readonly runId: string;
  readonly contract: ByoaContractV3;
  readonly lineage: ByoaContractV3ExpectedLineage;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly regressionLink?: RegressionRerunLinkV2 | null;
}): Promise<ByoaAgentSessionV2> {
  const contract = await verifyByoaContractV3(input.contract, input.lineage);
  return parseByoaAgentSessionV2({
    version: BYOA_SESSION_V2_VERSION,
    runId: input.runId,
    state: "COMPILED",
    contract,
    lineage: input.lineage,
    contractDigest: await byoaContractV3Digest(contract, input.lineage),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    expiresAt: input.expiresAt,
    transitions: [],
    regressionLink: input.regressionLink ?? null,
    terminalResultDigest: null
  });
}

export async function verifyByoaAgentSessionV2(
  value: unknown,
  expectedLineage: ByoaContractV3ExpectedLineage
): Promise<ByoaAgentSessionV2> {
  const session = parseByoaAgentSessionV2(value);
  await verifyByoaContractV3(session.contract, expectedLineage);
  if ((await byoaContractV3Digest(session.contract, expectedLineage)) !== session.contractDigest) {
    throw new Error("BYOA Session v2 contract digest does not match Contract v3.");
  }
  if (canonicalJson(session.lineage) !== canonicalJson(expectedLineage)) {
    throw new Error("BYOA Session v2 lineage does not match independent suite evidence.");
  }
  return session;
}

export function transitionByoaSessionV2(
  value: unknown,
  to: ByoaSessionV2State,
  input: {
    readonly at: string;
    readonly reasonCode: string;
    readonly resultDigest?: string;
    readonly explicitStart?: true;
  }
): ByoaAgentSessionV2 {
  const session = parseByoaAgentSessionV2(value);
  if (!canTransitionByoaSessionV2(session.state, to)) {
    throw new Error(`BYOA Session v2 transition ${session.state} → ${to} is not allowed.`);
  }
  if (session.state === "READY_TO_ARM" && to === "PREPARING" && input.explicitStart !== true) {
    throw new Error("BYOA Session v2 provider preparation requires explicit start.");
  }
  if (Date.parse(input.at) <= Date.parse(session.updatedAt)) {
    throw new Error("BYOA Session v2 transition timestamps must advance.");
  }
  const terminal = terminalV2States.has(to);
  return parseByoaAgentSessionV2({
    ...session,
    state: to,
    updatedAt: input.at,
    transitions: [
      ...session.transitions,
      {
        from: session.state,
        to,
        at: input.at,
        reasonCode:
          session.state === "READY_TO_ARM" && to === "PREPARING"
            ? "agent_explicit_start"
            : input.reasonCode
      }
    ],
    terminalResultDigest: terminal ? (input.resultDigest ?? null) : null
  });
}

export function agentVisibleRunProjectionV2(value: unknown): AgentVisibleRunProjectionV2 {
  const session = parseByoaAgentSessionV2(value);
  const contract = parseByoaContractV3(session.contract);
  return parseAgentVisibleRunProjectionV2({
    version: BYOA_AGENT_PROJECTION_V2_VERSION,
    runId: session.runId,
    request: contract.request,
    fixture: {
      fixtureId: contract.fixtureId,
      summary: "Two synthetic cart lines; no purchase, payment, shipment, or external transaction."
    },
    descriptors: contract.catalogSnapshot.tools.map(
      ({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations
      })
    ),
    catalogDigest: contract.catalogDigest,
    ...(contract.runtimeVariant ? { runtimeVariant: contract.runtimeVariant } : {}),
    buildCommit: contract.buildCommit,
    expiresAt: session.expiresAt
  });
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function writeByoaAgentSessionV2(storage: Storage, value: unknown): void {
  const encoded = canonicalJson(parseByoaAgentSessionV2(value));
  if (encodedBytes(encoded) > BYOA_SESSION_V2_MAX_BYTES) {
    throw new Error("BYOA Session v2 exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_SESSION_V2_STORAGE_KEY, encoded);
}

export function readByoaAgentSessionV2(storage: Storage): ByoaAgentSessionV2 | null {
  const encoded = storage.getItem(BYOA_SESSION_V2_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_SESSION_V2_MAX_BYTES) {
    throw new Error("Stored BYOA Session v2 exceeds the allowed size.");
  }
  return parseByoaAgentSessionV2(JSON.parse(encoded) as unknown);
}

export function clearByoaAgentSessionV2(storage: Storage): void {
  storage.removeItem(BYOA_SESSION_V2_STORAGE_KEY);
}
