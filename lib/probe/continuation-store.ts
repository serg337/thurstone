import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Redis } from "@upstash/redis";
import { z } from "zod";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import { PROBE_RUN_INDEX_SCRIPTS } from "@/lib/probe/run-index";
import { PROBE_RECOVERY_TTL_SECONDS } from "@/lib/probe/session";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

export const PROBE_CONTINUATION_VERSION = 1;
export const PROBE_CONTINUATION_TTL_SECONDS = PROBE_RECOVERY_TTL_SECONDS;
export const PROBE_CONTINUATION_STAGES = ["issue", "decision", "native", "completion"] as const;

export type ProbeContinuationStage = (typeof PROBE_CONTINUATION_STAGES)[number];
export type ProbeContinuationRedisClient = Pick<Redis, "eval" | "evalRo">;

export interface ProbeContinuationKeyspace {
  readonly namespace: string;
}

export function createProbeContinuationKeyspace(
  namespace = "tp:{webmcp26}:continuation"
): ProbeContinuationKeyspace {
  if (!/^tp:\{webmcp26\}:continuation(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new ProbeContinuationError("INVALID_NAMESPACE");
  }
  return Object.freeze({ namespace });
}

export const PRODUCTION_PROBE_CONTINUATION_KEYSPACE = createProbeContinuationKeyspace();
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,96}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const continuationArtifactSchema = z
  .object({
    version: z.literal(PROBE_CONTINUATION_VERSION),
    jti: z.string().regex(OPAQUE_ID_PATTERN),
    stage: z.enum(PROBE_CONTINUATION_STAGES),
    payloadBinding: z.string().regex(SHA256_PATTERN),
    payload: z.json()
  })
  .strict();

const PUT_CONTINUATION_SCRIPT = `
local exists = redis.call("EXISTS", KEYS[1])
local admission_mode = ARGV[6]
if admission_mode == "run-owner" then
  local admission_now = redis.call("TIME")
  local admission_now_ms = tonumber(admission_now[1]) * 1000 + math.floor(tonumber(admission_now[2]) / 1000)
  local revision = redis.call("HGET", KEYS[3], "revision")
  if redis.call("EXISTS", KEYS[2]) ~= 1 or redis.call("EXISTS", KEYS[3]) ~= 1
    or redis.call("PTTL", KEYS[2]) ~= -1 or redis.call("PTTL", KEYS[3]) <= 0
    or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[7]
    or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[8]
    or redis.call("HGET", KEYS[3], "activation_hash") ~= ARGV[7]
    or redis.call("HGET", KEYS[3], "build_commit") ~= ARGV[8]
    or redis.call("HGET", KEYS[3], "status") ~= "active"
    or revision ~= ARGV[10]
    or redis.call("HGET", KEYS[3], "owner_revision") ~= revision
    or redis.call("HGET", KEYS[3], "owner_hash") ~= ARGV[9]
    or tonumber(redis.call("HGET", KEYS[3], "owner_expires_at_ms") or "0") <= admission_now_ms
  then
    return {0, "CONTINUATION_RUN_OWNER_MISMATCH"}
  end
elseif admission_mode == "grant-owner" then
  if redis.call("EXISTS", KEYS[2]) ~= 1
    or redis.call("PTTL", KEYS[2]) ~= -1
    or redis.call("HGET", KEYS[2], "state") ~= "IN_FLIGHT"
    or redis.call("HGET", KEYS[2], "jti") ~= ARGV[7]
    or redis.call("HGET", KEYS[2], "claims_hash") ~= ARGV[8]
    or redis.call("HGET", KEYS[2], "guard_instance_id") ~= ARGV[9]
    or redis.call("HGET", KEYS[2], "policy_hash") ~= ARGV[10]
    or redis.call("HGET", KEYS[2], "script_hash") ~= ARGV[11]
    or redis.call("HGET", KEYS[2], "run_activation_hash") ~= ARGV[12]
    or redis.call("HGET", KEYS[2], "run_build_commit") ~= ARGV[13]
    or redis.call("HGET", KEYS[2], "run_owner_hash") ~= ARGV[14]
    or redis.call("HGET", KEYS[2], "run_owner_revision") ~= ARGV[15]
    or redis.call("HGET", KEYS[2], "run_ordinal") ~= ARGV[15]
  then
    return {0, "CONTINUATION_GRANT_OWNER_MISMATCH"}
  end
elseif admission_mode ~= "none" then
  return {0, "INVALID_CONTINUATION_ADMISSION"}
end
if exists == 1 then
  local existing_jti = redis.call("HGET", KEYS[1], "jti")
  local existing_stage = redis.call("HGET", KEYS[1], "stage")
  local existing_binding = redis.call("HGET", KEYS[1], "payload_binding")
  local existing_token = redis.call("HGET", KEYS[1], "token")
  local created_at_ms = redis.call("HGET", KEYS[1], "created_at_ms")
  local expires_at_ms = redis.call("HGET", KEYS[1], "expires_at_ms")
  local ttl_ms = redis.call("PTTL", KEYS[1])
  if not existing_jti or not existing_stage or not existing_binding or not existing_token
    or not created_at_ms or not expires_at_ms or ttl_ms <= 0
  then
    return {0, "CORRUPT_CONTINUATION"}
  end
  if existing_jti ~= ARGV[1] or existing_stage ~= ARGV[2] then
    return {0, "CONTINUATION_IDENTITY_MISMATCH"}
  end
  if existing_binding ~= ARGV[3] then
    return {0, "CONTINUATION_CONFLICT"}
  end
  return {2, "STORED_EXISTING", existing_token, existing_binding,
    created_at_ms, expires_at_ms, ttl_ms}
end

local now = redis.call("TIME")
local created_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local ttl_ms = tonumber(ARGV[5])
local expires_at_ms = created_at_ms + ttl_ms
redis.call("HSET", KEYS[1],
  "jti", ARGV[1],
  "stage", ARGV[2],
  "payload_binding", ARGV[3],
  "token", ARGV[4],
  "created_at_ms", created_at_ms,
  "expires_at_ms", expires_at_ms
)
if redis.call("PEXPIRE", KEYS[1], ttl_ms) ~= 1 then
  redis.call("DEL", KEYS[1])
  return {0, "CONTINUATION_EXPIRY_FAILED"}
end
return {1, "STORED_NEW", ARGV[4], ARGV[3], created_at_ms, expires_at_ms, ttl_ms}
`;

const GET_CONTINUATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return {2, "MISSING"}
end
local existing_jti = redis.call("HGET", KEYS[1], "jti")
local existing_stage = redis.call("HGET", KEYS[1], "stage")
local existing_binding = redis.call("HGET", KEYS[1], "payload_binding")
local existing_token = redis.call("HGET", KEYS[1], "token")
local created_at_ms = redis.call("HGET", KEYS[1], "created_at_ms")
local expires_at_ms = redis.call("HGET", KEYS[1], "expires_at_ms")
local ttl_ms = redis.call("PTTL", KEYS[1])
if not existing_jti or not existing_stage or not existing_binding or not existing_token
  or not created_at_ms or not expires_at_ms or ttl_ms <= 0
then
  return {0, "CORRUPT_CONTINUATION"}
end
if existing_jti ~= ARGV[1] or existing_stage ~= ARGV[2] then
  return {0, "CONTINUATION_IDENTITY_MISMATCH"}
end
return {1, "FOUND", existing_token, existing_binding,
  created_at_ms, expires_at_ms, ttl_ms}
`;

export const PROBE_CONTINUATION_SCRIPTS = Object.freeze({
  put: PUT_CONTINUATION_SCRIPT,
  get: GET_CONTINUATION_SCRIPT
});

export class ProbeContinuationError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly unknown[] = []
  ) {
    super(code);
    this.name = "ProbeContinuationError";
  }
}

export interface ProbeContinuationReceipt<T> {
  readonly disposition: "new" | "existing" | "recovered";
  readonly jti: string;
  readonly stage: ProbeContinuationStage;
  readonly payloadBinding: string;
  readonly token: string;
  readonly payload: T;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly ttlRemainingMs: number;
}

export type ProbeContinuationAdmission =
  | {
      readonly mode: "run-owner";
      readonly anchorKey: string;
      readonly dataKey: string;
      readonly activationHash: string;
      readonly buildCommit: string;
      readonly ownerHash: string;
      readonly revision: number;
    }
  | {
      readonly mode: "grant-owner";
      readonly authorizationKey: string;
      readonly jti: string;
      readonly claimsHash: string;
      readonly guardInstanceId: string;
      readonly policyHash: string;
      readonly scriptHash: string;
      readonly activationHash: string;
      readonly buildCommit: string;
      readonly ownerHash: string;
      readonly revision: number;
    };

function assertJti(jti: string): string {
  if (!OPAQUE_ID_PATTERN.test(jti)) throw new ProbeContinuationError("INVALID_JTI");
  return jti;
}

function assertStage(stage: string): ProbeContinuationStage {
  if (!(PROBE_CONTINUATION_STAGES as readonly string[]).includes(stage)) {
    throw new ProbeContinuationError("INVALID_STAGE");
  }
  return stage as ProbeContinuationStage;
}

export function probeContinuationKey(
  keyspace: ProbeContinuationKeyspace,
  jti: string,
  stage: ProbeContinuationStage
): string {
  return `${keyspace.namespace}:${assertJti(jti)}:${assertStage(stage)}`;
}

function artifactKind(stage: ProbeContinuationStage): string {
  return `continuation_${stage}`;
}

function parseReply(reply: unknown): unknown[] {
  if (!Array.isArray(reply) || reply.length < 2) {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  if (Number(reply[0]) === 0) {
    throw new ProbeContinuationError(String(reply[1] ?? "DENIED"), reply.slice(2));
  }
  return reply;
}

function replyInteger(reply: unknown[], index: number): number {
  const raw = reply[index];
  if (!(
    (typeof raw === "number" && Number.isFinite(raw)) ||
    (typeof raw === "string" && /^\d+$/u.test(raw))
  )) {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  return parsed;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function payloadBinding(payload: unknown, secret: string): string {
  let key: Buffer;
  try {
    key = decodeProbeSigningSecret(secret);
  } catch {
    throw new ProbeContinuationError("WEAK_ARTIFACT_SECRET");
  }
  let canonical: string;
  try {
    canonical = canonicalJson(payload);
  } catch {
    throw new ProbeContinuationError("INVALID_PAYLOAD");
  }
  return createHmac("sha256", key)
    .update(`toolproof.probe.continuation.binding.v1.${canonical}`)
    .digest("hex");
}

function openStoredArtifact<T>(input: {
  readonly jti: string;
  readonly stage: ProbeContinuationStage;
  readonly token: string;
  readonly binding: string;
  readonly secret: string;
}): T {
  let parsed: z.infer<typeof continuationArtifactSchema>;
  try {
    parsed = continuationArtifactSchema.parse(
      openProbeArtifact(artifactKind(input.stage), input.token, input.secret)
    );
  } catch {
    throw new ProbeContinuationError("INVALID_CONTINUATION_ARTIFACT");
  }
  if (
    parsed.jti !== input.jti ||
    parsed.stage !== input.stage ||
    !safeEqual(parsed.payloadBinding, input.binding) ||
    !safeEqual(payloadBinding(parsed.payload, input.secret), input.binding)
  ) {
    throw new ProbeContinuationError("CONTINUATION_ARTIFACT_MISMATCH");
  }
  return parsed.payload as T;
}

function receiptFromReply<T>(input: {
  readonly reply: unknown[];
  readonly disposition: ProbeContinuationReceipt<T>["disposition"];
  readonly jti: string;
  readonly stage: ProbeContinuationStage;
  readonly secret: string;
}): ProbeContinuationReceipt<T> {
  const token = String(input.reply[2] ?? "");
  const binding = String(input.reply[3] ?? "");
  if (!token || !SHA256_PATTERN.test(binding)) {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  const createdAtMs = replyInteger(input.reply, 4);
  const expiresAtMs = replyInteger(input.reply, 5);
  const ttlRemainingMs = replyInteger(input.reply, 6);
  if (
    expiresAtMs <= createdAtMs ||
    expiresAtMs - createdAtMs !== PROBE_CONTINUATION_TTL_SECONDS * 1_000 ||
    ttlRemainingMs < 1 ||
    ttlRemainingMs > PROBE_CONTINUATION_TTL_SECONDS * 1_000
  ) {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  const payload = openStoredArtifact<T>({
    jti: input.jti,
    stage: input.stage,
    token,
    binding,
    secret: input.secret
  });
  return Object.freeze({
    disposition: input.disposition,
    jti: input.jti,
    stage: input.stage,
    payloadBinding: binding,
    token,
    payload,
    createdAtMs,
    expiresAtMs,
    ttlRemainingMs
  });
}

export function probeContinuationScriptHash(): Promise<string> {
  return canonicalSha256({
    stageContinuations: PROBE_CONTINUATION_SCRIPTS,
    runIndex: PROBE_RUN_INDEX_SCRIPTS
  });
}

export async function putProbeContinuation<T>(
  redis: ProbeContinuationRedisClient,
  input: {
    readonly jti: string;
    readonly stage: ProbeContinuationStage;
    readonly payload: T;
    readonly artifactSecret: string;
    readonly admission?: ProbeContinuationAdmission;
  },
  keyspace: ProbeContinuationKeyspace = PRODUCTION_PROBE_CONTINUATION_KEYSPACE
): Promise<ProbeContinuationReceipt<T>> {
  const jti = assertJti(input.jti);
  const stage = assertStage(input.stage);
  const binding = payloadBinding(input.payload, input.artifactSecret);
  const artifact = continuationArtifactSchema.parse({
    version: PROBE_CONTINUATION_VERSION,
    jti,
    stage,
    payloadBinding: binding,
    payload: input.payload
  });
  const token = sealProbeArtifact(artifactKind(stage), artifact, input.artifactSecret);
  const admission = input.admission;
  const admissionKeys: string[] = [];
  const admissionArguments: string[] = ["none"];
  if (admission?.mode === "run-owner") {
    if (
      !Number.isSafeInteger(admission.revision) ||
      admission.revision < 0 ||
      admission.revision > 4
    ) {
      throw new ProbeContinuationError("INVALID_RUN_OWNER_ADMISSION");
    }
    admissionKeys.push(admission.anchorKey, admission.dataKey);
    admissionArguments.splice(
      0,
      1,
      "run-owner",
      admission.activationHash,
      admission.buildCommit,
      admission.ownerHash,
      String(admission.revision)
    );
  } else if (admission?.mode === "grant-owner") {
    if (
      !Number.isSafeInteger(admission.revision) ||
      admission.revision < 0 ||
      admission.revision > 4
    ) {
      throw new ProbeContinuationError("INVALID_GRANT_OWNER_ADMISSION");
    }
    admissionKeys.push(admission.authorizationKey);
    admissionArguments.splice(
      0,
      1,
      "grant-owner",
      admission.jti,
      admission.claimsHash,
      admission.guardInstanceId,
      admission.policyHash,
      admission.scriptHash,
      admission.activationHash,
      admission.buildCommit,
      admission.ownerHash,
      String(admission.revision)
    );
  }
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      PUT_CONTINUATION_SCRIPT,
      [probeContinuationKey(keyspace, jti, stage), ...admissionKeys],
      [
        jti,
        stage,
        binding,
        token,
        String(PROBE_CONTINUATION_TTL_SECONDS * 1_000),
        ...admissionArguments
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "STORED_NEW" && status !== "STORED_EXISTING") {
    throw new ProbeContinuationError("INVALID_REPLY");
  }
  return receiptFromReply<T>({
    reply,
    disposition: status === "STORED_NEW" ? "new" : "existing",
    jti,
    stage,
    secret: input.artifactSecret
  });
}

export async function getProbeContinuation<T>(
  redis: ProbeContinuationRedisClient,
  input: {
    readonly jti: string;
    readonly stage: ProbeContinuationStage;
    readonly artifactSecret: string;
  },
  keyspace: ProbeContinuationKeyspace = PRODUCTION_PROBE_CONTINUATION_KEYSPACE
): Promise<ProbeContinuationReceipt<T> | null> {
  const jti = assertJti(input.jti);
  const stage = assertStage(input.stage);
  const reply = parseReply(
    await redis.evalRo<string[], unknown>(
      GET_CONTINUATION_SCRIPT,
      [probeContinuationKey(keyspace, jti, stage)],
      [jti, stage]
    )
  );
  if (String(reply[1]) === "MISSING") return null;
  if (String(reply[1]) !== "FOUND") throw new ProbeContinuationError("INVALID_REPLY");
  return receiptFromReply<T>({
    reply,
    disposition: "recovered",
    jti,
    stage,
    secret: input.artifactSecret
  });
}
