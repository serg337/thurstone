import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM
} from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import {
  BYOA_HANDOFF_ENVELOPE_V2_VERSION,
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  byoaHandoffPrepareRequestV2Schema,
  parseHandoffEnvelopeV2,
  type ByoaHandoffEnvelopeV2
} from "@/lib/demo/agent-handoff-v2";
import {
  BYOA_HANDOFF_MAX_BYTES,
  BYOA_HANDOFF_TOKEN_MAX_BYTES,
  BYOA_HANDOFF_TTL_MS
} from "@/lib/demo/agent-handoff";
import type { AgentVisibleRunProjectionV2 } from "@/lib/demo/agent-projection";
import type { ByoaAgentSessionV2 } from "@/lib/demo/agent-session-v2";
import { REGRESSION_RERUN_LINK_V2_VERSION } from "@/lib/demo/regression-link-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import { BYOA_CONTRACT_V3_VERSION, BYOA_DEMO_TOOLSET_V2_VERSION } from "@/lib/demo/contract-v3";
import {
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_DEMO_TRUSTED_STATE_SOURCE,
  THURSTONE_DEMO_FIXTURE_ID
} from "@/lib/demo/reference-tool-templates";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_HANDOFF_V2_TOKEN_VERSION = "tbh2" as const;

export type ByoaHandoffTokenV2ErrorCode = "invalid_token" | "expired";

export class ByoaHandoffTokenV2Error extends Error {
  constructor(readonly code: ByoaHandoffTokenV2ErrorCode) {
    super(
      code === "expired" ? "BYOA handoff v2 token expired." : "BYOA handoff v2 token is invalid."
    );
    this.name = "ByoaHandoffTokenV2Error";
  }
}

const AAD = Buffer.from("thurstone-byoa-handoff-token@2", "utf8");
const itemIds = ["field-notebook", "stoneware-mug"] as const;
const effectKinds = [
  "cart_quantity",
  "pending_checkout",
  "cart_mutation",
  "duplicate_transition",
  "unmodeled_state"
] as const;

type CompactArgument = readonly [0] | readonly [1, 0 | 1, number] | readonly [2];
type CompactEffect = readonly [number] | readonly [0, 0 | 1, number];
type CompactTool = readonly [number, string, string];

interface CompactHandoffV2 {
  readonly v: 2;
  readonly i: string;
  readonly x: string;
  readonly r: string;
  readonly d: string;
  readonly g: readonly [string | null, string] | null;
  readonly s: readonly [string, string, string];
  readonly c: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    CompactArgument,
    readonly CompactEffect[],
    readonly CompactEffect[],
    0 | 1,
    0 | 1,
    string,
    string,
    string,
    readonly CompactTool[],
    (null | 0 | 1 | 2)?
  ];
}

function compactRuntimeVariant(
  value: ByoaHandoffEnvelopeV2["session"]["contract"]["runtimeVariant"]
): null | 0 | 1 | 2 {
  if (value === undefined) return null;
  if (value === "standard") return 0;
  if (value === "planted-cart-update-noop") return 1;
  return 2;
}

function expandRuntimeVariant(value: null | 0 | 1 | 2 | undefined) {
  if (value === null || value === undefined) return undefined;
  if (value === 0) return "standard" as const;
  if (value === 1) return "planted-cart-update-noop" as const;
  if (value === 2) return "semantic-collision" as const;
  throw new Error("invalid compact runtime variant");
}

function handoffKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = environment.TOOLPROOF_SIGNING_SECRET?.trim() ?? "";
  const secret = Buffer.from(encoded, "base64url");
  if (secret.byteLength < 32) throw new Error("BYOA handoff encryption is not configured.");
  return createHash("sha256")
    .update("thurstone-byoa-handoff-key@2\0", "utf8")
    .update(secret)
    .digest();
}

function decodeBase64Url(value: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("non-canonical base64url");
  return bytes;
}

function compactUuid(value: string, prefix: string): string {
  if (!value.startsWith(prefix)) throw new Error("invalid compact UUID prefix");
  return value.slice(prefix.length).replaceAll("-", "");
}

function expandUuid(value: string, prefix: string): string {
  if (!/^[a-f0-9]{32}$/u.test(value)) throw new Error("invalid compact UUID");
  return `${prefix}${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function compactHex(value: string): string {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) throw new Error("invalid compact hex");
  return Buffer.from(value, "hex").toString("base64url");
}

function expandHex(value: string, bytes: 20 | 32): string {
  const decoded = decodeBase64Url(value);
  if (decoded.byteLength !== bytes) throw new Error("invalid compact hex length");
  return decoded.toString("hex");
}

function toolIndex(name: string): number {
  const index = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.indexOf(
    name as (typeof THURSTONE_DEMO_SELECTABLE_TOOL_NAMES)[number]
  );
  if (index < 0) throw new Error("invalid compact tool");
  return index;
}

function toolName(index: number): (typeof THURSTONE_DEMO_SELECTABLE_TOOL_NAMES)[number] {
  const name = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES[index];
  if (name === undefined) throw new Error("invalid compact tool index");
  return name;
}

function compactArgument(
  argument: ByoaHandoffEnvelopeV2["session"]["contract"]["argumentPredicate"]
): CompactArgument {
  if (argument.kind === "empty") return [0];
  if (argument.kind === "checkout_request") return [2];
  const itemIndex = itemIds.indexOf(argument.itemId);
  if (itemIndex < 0) throw new Error("invalid compact item");
  return [1, itemIndex as 0 | 1, argument.quantity];
}

function expandArgument(argument: CompactArgument) {
  if (argument[0] === 0) return { kind: "empty" } as const;
  if (argument[0] === 2) {
    return { kind: "checkout_request", operationId: "valid_unique" } as const;
  }
  const itemId = itemIds[argument[1]];
  if (itemId === undefined) throw new Error("invalid compact item index");
  return {
    kind: "cart_update",
    operationId: "valid_unique",
    operation: "set_quantity",
    itemId,
    quantity: argument[2]
  } as const;
}

function compactEffects(
  effects: ByoaHandoffEnvelopeV2["session"]["contract"]["allowedEffects"]
): readonly CompactEffect[] {
  return effects.map((effect) => {
    const kind = effectKinds.indexOf(effect.kind);
    if (kind < 0) throw new Error("invalid compact effect");
    if (effect.kind !== "cart_quantity") return [kind] as const;
    if (effect.itemId === undefined || effect.quantity === undefined) {
      throw new Error("invalid compact cart effect");
    }
    const item = itemIds.indexOf(effect.itemId);
    if (item < 0) throw new Error("invalid compact effect item");
    return [0, item as 0 | 1, effect.quantity] as const;
  });
}

function expandEffects(effects: readonly CompactEffect[]) {
  return effects.map((effect) => {
    const kind = effectKinds[effect[0]];
    if (kind === undefined) throw new Error("invalid compact effect index");
    if (kind !== "cart_quantity") return { kind };
    if (effect.length !== 3) throw new Error("invalid compact cart effect");
    const itemId = itemIds[effect[1]];
    if (itemId === undefined) throw new Error("invalid compact effect item index");
    return { kind, itemId, quantity: effect[2] };
  });
}

function compactEnvelope(value: unknown): CompactHandoffV2 {
  const envelope = parseHandoffEnvelopeV2(value);
  const { session } = envelope;
  const { contract } = session;
  if (session.transitions.length !== 1) throw new Error("invalid handoff transition count");
  return {
    v: 2,
    i: envelope.issuedAt,
    x: envelope.expiresAt,
    r: compactUuid(session.runId, "byoa_run_"),
    d: compactHex(session.contractDigest),
    g:
      session.regressionLink === null
        ? null
        : [
            session.regressionLink.regressionCaseDigest === null
              ? null
              : compactHex(session.regressionLink.regressionCaseDigest),
            compactHex(session.regressionLink.previousResultDigest)
          ],
    s: [session.createdAt, session.updatedAt, session.transitions[0]!.reasonCode],
    c: [
      compactUuid(contract.contractId, "byoa_"),
      compactUuid(contract.suiteId, "suite_"),
      compactHex(contract.suiteDigest),
      compactUuid(contract.caseId, "case_"),
      compactHex(contract.caseDigest),
      contract.title,
      contract.request,
      toolIndex(contract.expectedTool),
      compactArgument(contract.argumentPredicate),
      compactEffects(contract.allowedEffects),
      compactEffects(contract.forbiddenEffects),
      contract.replayPolicy === "read_only" ? 0 : 1,
      contract.approvalClass === "read_only" ? 0 : 1,
      compactHex(contract.catalogDigest),
      compactHex(contract.buildCommit),
      contract.createdAt,
      contract.catalogSnapshot.tools.map(({ name, title, description }) => [
        toolIndex(name),
        title,
        description
      ]),
      compactRuntimeVariant(contract.runtimeVariant)
    ]
  };
}

function expandEnvelope(value: unknown): ByoaHandoffEnvelopeV2 {
  const compact = value as CompactHandoffV2;
  if (compact?.v !== 2 || !Array.isArray(compact.s) || !Array.isArray(compact.c)) {
    throw new Error("invalid compact handoff");
  }
  const [
    contractId,
    suiteId,
    suiteDigest,
    caseId,
    caseDigest,
    title,
    request,
    expectedToolIndex,
    argumentPredicate,
    allowedEffects,
    forbiddenEffects,
    replayPolicy,
    approvalClass,
    catalogDigest,
    buildCommit,
    contractCreatedAt,
    compactTools,
    runtimeVariantIndex
  ] = compact.c;
  const selectedToolNames = compactTools.map(([index]) => toolName(index));
  const descriptorOverrides = Object.fromEntries(
    compactTools.map(([index, toolTitle, description]) => [
      toolName(index),
      { title: toolTitle, description }
    ])
  );
  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
    selectedToolNames,
    descriptorOverrides
  });
  const expandedCatalogDigest = expandHex(catalogDigest, 32);
  const expandedSuiteId = expandUuid(suiteId, "suite_");
  const expandedSuiteDigest = expandHex(suiteDigest, 32);
  const expandedCaseId = expandUuid(caseId, "case_");
  const contract = {
    version: BYOA_CONTRACT_V3_VERSION,
    toolsetVersion: BYOA_DEMO_TOOLSET_V2_VERSION,
    contractId: expandUuid(contractId, "byoa_"),
    suiteId: expandedSuiteId,
    suiteDigest: expandedSuiteDigest,
    caseId: expandedCaseId,
    caseDigest: expandHex(caseDigest, 32),
    title,
    request,
    fixtureId: THURSTONE_DEMO_FIXTURE_ID,
    expectedAction: "call",
    expectedTool: toolName(expectedToolIndex),
    argumentPredicate: expandArgument(argumentPredicate),
    allowedEffects: expandEffects(allowedEffects),
    forbiddenEffects: expandEffects(forbiddenEffects),
    replayPolicy: replayPolicy === 0 ? "read_only" : "exactly_once",
    trustedStateSource: THURSTONE_DEMO_TRUSTED_STATE_SOURCE,
    approvalClass: approvalClass === 0 ? "read_only" : "consequential",
    catalogSnapshot,
    catalogDigest: expandedCatalogDigest,
    ...(expandRuntimeVariant(runtimeVariantIndex) !== undefined
      ? { runtimeVariant: expandRuntimeVariant(runtimeVariantIndex) }
      : {}),
    buildCommit: expandHex(buildCommit, 20),
    createdAt: contractCreatedAt
  } as const;
  const [createdAt, updatedAt, reasonCode] = compact.s;
  return parseHandoffEnvelopeV2({
    version: BYOA_HANDOFF_ENVELOPE_V2_VERSION,
    issuedAt: compact.i,
    expiresAt: compact.x,
    session: {
      version: "thurstone-byoa-session@2",
      runId: expandUuid(compact.r, "byoa_run_"),
      state: "HANDOFF_ISSUED",
      contract,
      lineage: {
        suiteId: expandedSuiteId,
        suiteDigest: expandedSuiteDigest,
        caseId: expandedCaseId,
        catalogDigest: expandedCatalogDigest
      },
      contractDigest: expandHex(compact.d, 32),
      regressionLink:
        compact.g === null
          ? null
          : {
              version: REGRESSION_RERUN_LINK_V2_VERSION,
              previousResultDigest: expandHex(compact.g[1], 32),
              regressionCaseDigest: compact.g[0] === null ? null : expandHex(compact.g[0], 32)
            },
      createdAt,
      updatedAt,
      expiresAt: compact.x,
      transitions: [{ from: "COMPILED", to: "HANDOFF_ISSUED", at: updatedAt, reasonCode }],
      terminalResultDigest: null
    }
  });
}

export function isByoaHandoffV2Token(token: string): boolean {
  return token.startsWith(`${BYOA_HANDOFF_V2_TOKEN_VERSION}.`);
}

export function createByoaHandoffEnvelopeV2(input: {
  readonly session: ByoaAgentSessionV2;
  readonly projection: AgentVisibleRunProjectionV2;
  readonly now?: Date;
}): ByoaHandoffEnvelopeV2 {
  byoaHandoffPrepareRequestV2Schema.parse({
    version: BYOA_HANDOFF_PREPARE_V2_VERSION,
    session: input.session,
    projection: input.projection
  });
  const now = input.now ?? new Date();
  if (now.getTime() <= Date.parse(input.session.updatedAt)) {
    throw new Error("Handoff v2 issuance must follow the HANDOFF_ISSUED transition.");
  }
  const expiresAt = new Date(
    Math.min(Date.parse(input.session.expiresAt), now.getTime() + BYOA_HANDOFF_TTL_MS)
  ).toISOString();
  if (Date.parse(expiresAt) <= now.getTime() + 30_000) {
    throw new Error("The BYOA handoff lifetime is too short.");
  }
  return parseHandoffEnvelopeV2({
    version: BYOA_HANDOFF_ENVELOPE_V2_VERSION,
    issuedAt: now.toISOString(),
    expiresAt,
    session: { ...input.session, expiresAt }
  });
}

export function sealByoaHandoffV2(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env
): string {
  let compacted: CompactHandoffV2;
  try {
    compacted = compactEnvelope(value);
  } catch {
    throw new Error("HANDOFF_COMPACT_INVALID");
  }
  let payload: Buffer;
  try {
    payload = Buffer.from(canonicalJson(compacted), "utf8");
  } catch {
    throw new Error("HANDOFF_PAYLOAD_INVALID");
  }
  if (payload.byteLength > BYOA_HANDOFF_MAX_BYTES) {
    throw new Error("BYOA handoff v2 is too large.");
  }
  let compressed: Buffer;
  try {
    compressed = brotliCompressSync(payload, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11
      }
    });
  } catch {
    throw new Error("HANDOFF_COMPRESSION_FAILED");
  }
  const iv = randomBytes(12);
  let cipher: CipherGCM;
  try {
    cipher = createCipheriv("aes-256-gcm", handoffKey(environment), iv);
  } catch {
    throw new Error("HANDOFF_ENCRYPTION_FAILED");
  }
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const token = [
    BYOA_HANDOFF_V2_TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url")
  ].join(".");
  if (Buffer.byteLength(token, "utf8") > BYOA_HANDOFF_TOKEN_MAX_BYTES) {
    throw new Error("HANDOFF_TOKEN_TOO_LARGE");
  }
  return token;
}

export function openByoaHandoffV2(
  token: string,
  input: { readonly environment?: NodeJS.ProcessEnv; readonly now?: Date } = {}
): ByoaHandoffEnvelopeV2 {
  if (Buffer.byteLength(token, "utf8") > BYOA_HANDOFF_TOKEN_MAX_BYTES) {
    throw new ByoaHandoffTokenV2Error("invalid_token");
  }
  const [version, ivEncoded, ciphertextEncoded, tagEncoded, extra] = token.split(".");
  if (
    version !== BYOA_HANDOFF_V2_TOKEN_VERSION ||
    !ivEncoded ||
    !ciphertextEncoded ||
    !tagEncoded ||
    extra !== undefined
  ) {
    throw new ByoaHandoffTokenV2Error("invalid_token");
  }
  let envelope: ByoaHandoffEnvelopeV2;
  try {
    const iv = decodeBase64Url(ivEncoded);
    const ciphertext = decodeBase64Url(ciphertextEncoded);
    const tag = decodeBase64Url(tagEncoded);
    if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength < 1) {
      throw new Error("invalid token dimensions");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      handoffKey(input.environment ?? process.env),
      iv
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = brotliDecompressSync(compressed, {
      maxOutputLength: BYOA_HANDOFF_MAX_BYTES + 1
    });
    if (plaintext.byteLength > BYOA_HANDOFF_MAX_BYTES) throw new Error("oversized payload");
    envelope = expandEnvelope(JSON.parse(plaintext.toString("utf8")) as unknown);
  } catch {
    throw new ByoaHandoffTokenV2Error("invalid_token");
  }
  if (Date.parse(envelope.expiresAt) <= (input.now ?? new Date()).getTime()) {
    throw new ByoaHandoffTokenV2Error("expired");
  }
  return envelope;
}
