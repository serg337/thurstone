import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

export const SCORED_RUN_STORE_VERSION = "toolproof-scored-run-store@1.0.0";
export const SCORED_RUN_ATTEMPT_VERSION = "toolproof-scored-run-attempt@1.0.0";
export const SCORED_RUN_SCHEDULE_VERSION = "toolproof-scored-run-schedule@1.0.0";
export const SCORED_RUN_TTL_SECONDS = 4 * 60 * 60;
export const SCORED_RUN_OWNER_LEASE_SECONDS = 10 * 60;
export const SCORED_RUN_CASE_COUNT = 24;
export const SCORED_RUN_MAX_ATTEMPT_BYTES = 1_500_000;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const runnerCaseId = z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u);
const runId = z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u);

export const scoredRunIdentitySchema = z
  .object({
    phase: z.enum(["baseline", "revised"]),
    appCommit: gitCommit,
    reviewPackageHash: sha256,
    frozenProtocolHash: sha256,
    freezeCandidateHash: sha256,
    scheduleHash: sha256,
    runId,
    actorHash: sha256,
    phaseCallOffset: z.number().int().min(0).max(46),
    predecessorProtocolHash: sha256.nullable(),
    predecessorEvidenceDigest: sha256.nullable(),
    predecessorRunId: runId.nullable(),
    orderedRunnerCaseIds: z.array(runnerCaseId).length(SCORED_RUN_CASE_COUNT)
  })
  .strict()
  .superRefine(
    (
      {
        orderedRunnerCaseIds,
        phaseCallOffset,
        predecessorProtocolHash,
        predecessorEvidenceDigest,
        predecessorRunId
      },
      context
    ) => {
      if (new Set(orderedRunnerCaseIds).size !== SCORED_RUN_CASE_COUNT) {
        context.addIssue({
          code: "custom",
          path: ["orderedRunnerCaseIds"],
          message: "A scored schedule must contain 24 unique opaque runner IDs."
        });
      }
      const predecessorValues = [
        predecessorProtocolHash,
        predecessorEvidenceDigest,
        predecessorRunId
      ];
      const predecessorCount = predecessorValues.filter((value) => value !== null).length;
      if (predecessorCount !== 0 && predecessorCount !== predecessorValues.length) {
        context.addIssue({
          code: "custom",
          path: ["predecessorProtocolHash"],
          message: "Replacement predecessor bindings must be all present or all absent."
        });
      }
      if (phaseCallOffset > 0 && predecessorCount !== predecessorValues.length) {
        context.addIssue({
          code: "custom",
          path: ["phaseCallOffset"],
          message: "A nonzero phase offset requires an exact predecessor binding."
        });
      }
    }
  );

export type ScoredRunIdentity = z.infer<typeof scoredRunIdentitySchema>;

export const scoredRunAttemptSchema = z
  .object({
    version: z.literal(SCORED_RUN_ATTEMPT_VERSION),
    ordinal: z
      .number()
      .int()
      .min(0)
      .max(SCORED_RUN_CASE_COUNT - 1),
    attempt: z.union([z.literal(0), z.literal(1)]),
    runnerCaseId,
    disposition: z.enum(["scored", "infrastructure-invalid"]),
    infrastructureRetryEligible: z.boolean(),
    usableModelDecisionMade: z.boolean(),
    targetExecutionMade: z.boolean(),
    capturedAt: z.string().datetime({ offset: true }),
    evidence: z.json()
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.disposition === "scored" && attempt.infrastructureRetryEligible) {
      context.addIssue({
        code: "custom",
        path: ["infrastructureRetryEligible"],
        message: "A scored outcome is never retry-eligible."
      });
    }
    if (
      attempt.infrastructureRetryEligible &&
      (attempt.disposition !== "infrastructure-invalid" ||
        attempt.usableModelDecisionMade ||
        attempt.targetExecutionMade)
    ) {
      context.addIssue({
        code: "custom",
        path: ["infrastructureRetryEligible"],
        message: "Replacement is allowed only before a usable decision and target execution."
      });
    }
  });

export type ScoredRunAttempt = z.infer<typeof scoredRunAttemptSchema>;

const scoredRunScheduleArtifactSchema = z
  .object({
    version: z.literal(SCORED_RUN_SCHEDULE_VERSION),
    identity: scoredRunIdentitySchema,
    createdAt: z.string().datetime({ offset: true })
  })
  .strict();

export interface ScoredRunKeyspace {
  readonly namespace: string;
}

export function createScoredRunKeyspace(namespace = "tp:{webmcp26}:scored-run"): ScoredRunKeyspace {
  if (!/^tp:\{webmcp26\}:scored-run(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new ScoredRunStoreError("INVALID_NAMESPACE");
  }
  return Object.freeze({ namespace });
}

export const PRODUCTION_SCORED_RUN_KEYSPACE = createScoredRunKeyspace();

export interface ScoredRunRedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export class ScoredRunStoreError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly unknown[] = []
  ) {
    super(code);
    this.name = "ScoredRunStoreError";
  }
}

export interface ScoredRunProgress {
  readonly status: "active" | "terminal-complete" | "terminal-invalid" | "acknowledged";
  readonly phase: "baseline" | "revised";
  readonly completedCount: number;
  readonly remainingCount: number;
  readonly transportFailureCount: number;
  readonly attemptCount: number;
  readonly currentOrdinal: number;
  readonly currentAttempt: 0 | 1;
  readonly terminalReason: string | null;
  readonly evidenceDigest: string | null;
}

export interface ScoredRunSnapshot extends ScoredRunProgress {
  readonly identity: ScoredRunIdentity;
  readonly attempts: readonly ScoredRunAttempt[];
  /** The terminal disposition retained after status advances to acknowledged. */
  readonly terminalStatus: "terminal-complete" | "terminal-invalid" | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly ttlRemainingMs: number;
}

const CREATE_SCRIPT = `
local anchor_exists = redis.call("EXISTS", KEYS[1])
local data_exists = redis.call("EXISTS", KEYS[2])
if anchor_exists ~= data_exists then return {0, "PARTIAL_SCORED_RUN"} end
if anchor_exists == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("PTTL", KEYS[2]) <= 0
    or redis.call("HGET", KEYS[1], "identity_hash") ~= ARGV[1]
    or redis.call("HGET", KEYS[2], "identity_hash") ~= ARGV[1]
  then return {0, "SCORED_RUN_CONFLICT"} end
  return {2, "EXISTING", redis.call("HGET", KEYS[1], "created_at_ms"),
    redis.call("HGET", KEYS[2], "expires_at_ms"), redis.call("PTTL", KEYS[2])}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local expires_at_ms = now_ms + tonumber(ARGV[15])
redis.call("HSET", KEYS[1],
  "version", ARGV[2], "status", "active", "identity_hash", ARGV[1],
  "phase", ARGV[3], "app_commit", ARGV[4], "review_package_hash", ARGV[5],
  "frozen_protocol_hash", ARGV[6], "freeze_candidate_hash", ARGV[7],
  "schedule_hash", ARGV[8], "run_hash", ARGV[9], "actor_hash", ARGV[10],
  "attempt_count", "0", "completed_count", "0", "transport_failure_count", "0",
  "current_ordinal", "0", "current_attempt", "0", "created_at_ms", now_ms)
redis.call("HSET", KEYS[2],
  "version", ARGV[2], "status", "active", "identity_hash", ARGV[1],
  "schedule_token", ARGV[11], "current_runner_hash", ARGV[12],
  "owner_hash", ARGV[13], "owner_expires_at_ms", now_ms + tonumber(ARGV[14]),
  "attempt_count", "0", "completed_count", "0", "transport_failure_count", "0",
  "current_ordinal", "0", "current_attempt", "0", "created_at_ms", now_ms,
  "expires_at_ms", expires_at_ms)
if redis.call("PEXPIRE", KEYS[2], tonumber(ARGV[15])) ~= 1 then
  redis.call("DEL", KEYS[1], KEYS[2])
  return {0, "SCORED_RUN_EXPIRY_FAILED"}
end
return {1, "CREATED", now_ms, expires_at_ms, tonumber(ARGV[15])}
`;

const ACQUIRE_OWNER_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_SCORED_RUN"}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("HGET", KEYS[1], "identity_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "identity_hash") ~= ARGV[1]
  or redis.call("PTTL", KEYS[1]) ~= -1 or redis.call("PTTL", KEYS[2]) <= 0
then return {0, "SCORED_RUN_IDENTITY_MISMATCH"} end
if redis.call("HGET", KEYS[2], "status") ~= "active" then
  return {0, "SCORED_RUN_NOT_ACTIVE"}
end
local current_owner = redis.call("HGET", KEYS[2], "owner_hash")
local owner_expires = tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0")
if current_owner and current_owner ~= ARGV[2] and owner_expires > now_ms then
  return {0, "SCORED_RUN_OWNED"}
end
local next_expiry = now_ms + tonumber(ARGV[3])
redis.call("HSET", KEYS[2], "owner_hash", ARGV[2], "owner_expires_at_ms", next_expiry)
return {1, current_owner == ARGV[2] and "RENEWED" or "ACQUIRED", next_expiry}
`;

const RECORD_ATTEMPT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_SCORED_RUN"}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("PTTL", KEYS[1]) ~= -1 or redis.call("PTTL", KEYS[2]) <= 0
  or redis.call("HGET", KEYS[1], "identity_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "identity_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "owner_hash") ~= ARGV[2]
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") <= now_ms
then return {0, "SCORED_RUN_ADMISSION_INVALID"} end
if redis.call("HGET", KEYS[2], "current_ordinal") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "current_attempt") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "current_runner_hash") ~= ARGV[5]
then return {0, "SCORED_RUN_SEQUENCE_MISMATCH"} end
local field = "attempt_" .. ARGV[3] .. "_" .. ARGV[4]
local digest_field = "digest_" .. ARGV[3] .. "_" .. ARGV[4]
if redis.call("HEXISTS", KEYS[2], field) == 1 then
  if redis.call("HGET", KEYS[1], digest_field) == ARGV[7] then
    return {2, "ATTEMPT_EXISTING", redis.call("HGET", KEYS[1], "status"),
      redis.call("HGET", KEYS[1], "completed_count"),
      redis.call("HGET", KEYS[1], "current_ordinal"),
      redis.call("HGET", KEYS[1], "current_attempt")}
  end
  return {0, "SCORED_RUN_ATTEMPT_CONFLICT"}
end
redis.call("HSET", KEYS[2], field, ARGV[6])
redis.call("HSET", KEYS[1], digest_field, ARGV[7])
redis.call("HINCRBY", KEYS[1], "attempt_count", 1)
redis.call("HINCRBY", KEYS[2], "attempt_count", 1)
if ARGV[8] == "infrastructure-invalid" then
  redis.call("HINCRBY", KEYS[1], "transport_failure_count", 1)
  redis.call("HINCRBY", KEYS[2], "transport_failure_count", 1)
  if ARGV[9] == "1" and ARGV[4] == "0" then
    redis.call("HSET", KEYS[1], "current_attempt", "1")
    redis.call("HSET", KEYS[2], "current_attempt", "1")
    return {1, "REPLACEMENT_ADMITTED", "active",
      redis.call("HGET", KEYS[1], "completed_count"), ARGV[3], "1"}
  end
  redis.call("HSET", KEYS[1], "status", "terminal-invalid", "terminal_reason", ARGV[10],
    "terminal_at_ms", now_ms)
  redis.call("HSET", KEYS[2], "status", "terminal-invalid", "terminal_reason", ARGV[10],
    "terminal_at_ms", now_ms)
  return {1, "TERMINAL_INVALID", "terminal-invalid",
    redis.call("HGET", KEYS[1], "completed_count"), ARGV[3], ARGV[4]}
end
if ARGV[8] ~= "scored" or ARGV[9] ~= "0" then
  return {0, "SCORED_RUN_DISPOSITION_INVALID"}
end
local completed = redis.call("HINCRBY", KEYS[1], "completed_count", 1)
redis.call("HINCRBY", KEYS[2], "completed_count", 1)
local next_ordinal = tonumber(ARGV[3]) + 1
if next_ordinal == tonumber(ARGV[11]) then
  redis.call("HSET", KEYS[1], "status", "terminal-complete", "current_ordinal", next_ordinal,
    "current_attempt", "0", "terminal_at_ms", now_ms)
  redis.call("HSET", KEYS[2], "status", "terminal-complete", "current_ordinal", next_ordinal,
    "current_attempt", "0", "terminal_at_ms", now_ms)
  return {1, "TERMINAL_COMPLETE", "terminal-complete", completed, next_ordinal, "0"}
end
if not ARGV[12] or ARGV[12] == "" then return {0, "SCORED_RUN_NEXT_CASE_MISSING"} end
redis.call("HSET", KEYS[1], "current_ordinal", next_ordinal, "current_attempt", "0")
redis.call("HSET", KEYS[2], "current_ordinal", next_ordinal, "current_attempt", "0",
  "current_runner_hash", ARGV[12])
return {1, "RECORDED", "active", completed, next_ordinal, "0"}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
local anchor = redis.call("HGETALL", KEYS[1])
if redis.call("EXISTS", KEYS[2]) ~= 1 then return {1, "ANCHOR_ONLY", anchor} end
if redis.call("PTTL", KEYS[2]) <= 0 then return {0, "SCORED_RUN_DATA_EXPIRED"} end
return {1, "FOUND", anchor, redis.call("HGETALL", KEYS[2]), redis.call("PTTL", KEYS[2])}
`;

const READ_PERMANENT_EVIDENCE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("EXISTS", KEYS[2]) ~= 1 then return {2, "MISSING_EVIDENCE"} end
local anchor_status = redis.call("HGET", KEYS[1], "status")
local evidence_status = redis.call("HGET", KEYS[2], "status")
if redis.call("PTTL", KEYS[1]) ~= -1 or redis.call("PTTL", KEYS[2]) ~= -1
  or (anchor_status ~= "terminal-complete" and anchor_status ~= "terminal-invalid"
    and anchor_status ~= "acknowledged")
  or (evidence_status ~= "sealed" and evidence_status ~= "acknowledged")
  or (anchor_status == "acknowledged" and evidence_status ~= "acknowledged")
  or (anchor_status ~= "acknowledged" and evidence_status ~= "sealed")
  or redis.call("HGET", KEYS[1], "identity_hash") ~= redis.call("HGET", KEYS[2], "identity_hash")
  or redis.call("HGET", KEYS[1], "evidence_digest") ~= redis.call("HGET", KEYS[2], "evidence_digest")
  or redis.call("HGET", KEYS[1], "attempt_manifest_digest")
    ~= redis.call("HGET", KEYS[2], "attempt_manifest_digest")
  or redis.call("HGET", KEYS[1], "attempt_count") ~= redis.call("HGET", KEYS[2], "attempt_count")
  or redis.call("HGET", KEYS[1], "completed_count")
    ~= redis.call("HGET", KEYS[2], "completed_count")
  or redis.call("HGET", KEYS[2], "terminal_status")
    ~= (anchor_status == "acknowledged" and redis.call("HGET", KEYS[1], "terminal_status")
      or anchor_status)
then return {0, "PERMANENT_SCORED_EVIDENCE_MISMATCH"} end
return {1, "FOUND", redis.call("HGETALL", KEYS[1]), redis.call("HGETALL", KEYS[2])}
`;

const SEAL_EVIDENCE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_SCORED_RUN"}
end
if redis.call("HGET", KEYS[1], "identity_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "identity_hash") ~= ARGV[1]
  or redis.call("PTTL", KEYS[1]) ~= -1 or redis.call("PTTL", KEYS[2]) <= 0
then return {0, "SCORED_RUN_IDENTITY_MISMATCH"} end
local status = redis.call("HGET", KEYS[1], "status")
if (status ~= "terminal-complete" and status ~= "terminal-invalid")
  or redis.call("HGET", KEYS[2], "status") ~= status
  or redis.call("HGET", KEYS[1], "attempt_count") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "attempt_count") ~= ARGV[4]
then return {0, "SCORED_RUN_EVIDENCE_BOUNDARY_MISMATCH"} end
local data = redis.call("HGETALL", KEYS[2])
local schedule_token = nil
local attempt_tokens = 0
local copies_match = true
for index = 1, #data, 2 do
  local field = data[index]
  if field == "schedule_token" then
    schedule_token = data[index + 1]
    if redis.call("EXISTS", KEYS[3]) == 1
      and redis.call("HGET", KEYS[3], field) ~= data[index + 1]
    then copies_match = false end
  end
  if string.match(field, "^attempt_%d+_[01]$") then
    attempt_tokens = attempt_tokens + 1
    if redis.call("EXISTS", KEYS[3]) == 1
      and redis.call("HGET", KEYS[3], field) ~= data[index + 1]
    then copies_match = false end
  end
end
if not schedule_token or attempt_tokens ~= tonumber(ARGV[4]) then
  return {0, "SCORED_RUN_PERMANENT_COPY_INCOMPLETE"}
end
local existing = redis.call("HGET", KEYS[1], "evidence_status")
if existing then
  if existing == "verified"
    and redis.call("HGET", KEYS[1], "evidence_digest") == ARGV[2]
    and redis.call("HGET", KEYS[1], "attempt_manifest_digest") == ARGV[3]
    and redis.call("EXISTS", KEYS[3]) == 1
    and redis.call("PTTL", KEYS[3]) == -1
    and redis.call("HGET", KEYS[3], "status") == "sealed"
    and redis.call("HGET", KEYS[3], "identity_hash") == ARGV[1]
    and redis.call("HGET", KEYS[3], "evidence_digest") == ARGV[2]
    and redis.call("HGET", KEYS[3], "attempt_manifest_digest") == ARGV[3]
    and redis.call("HGET", KEYS[3], "attempt_count") == ARGV[4]
    and copies_match
  then return {2, "EVIDENCE_VERIFIED_EXISTING",
    redis.call("HGET", KEYS[1], "evidence_verified_at_ms")} end
  return {0, "SCORED_RUN_EVIDENCE_CONFLICT"}
end
if redis.call("EXISTS", KEYS[3]) == 1 then
  return {0, "PERMANENT_SCORED_EVIDENCE_CONFLICT"}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[3], "version", ARGV[5], "status", "sealed",
  "identity_hash", ARGV[1], "phase", redis.call("HGET", KEYS[1], "phase"),
  "terminal_status", status, "evidence_digest", ARGV[2],
  "attempt_manifest_digest", ARGV[3], "attempt_count", ARGV[4],
  "completed_count", redis.call("HGET", KEYS[1], "completed_count"),
  "transport_failure_count", redis.call("HGET", KEYS[1], "transport_failure_count"),
  "sealed_at_ms", now_ms, "schedule_token", schedule_token)
for index = 1, #data, 2 do
  local field = data[index]
  if string.match(field, "^attempt_%d+_[01]$") then
    redis.call("HSET", KEYS[3], field, data[index + 1])
  end
end
redis.call("HSET", KEYS[1], "evidence_status", "verified", "evidence_digest", ARGV[2],
  "attempt_manifest_digest", ARGV[3], "evidence_verified_at_ms", now_ms)
return {1, "EVIDENCE_VERIFIED_NEW", now_ms}
`;

const ACK_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_SCORED_RUN"} end
if redis.call("HGET", KEYS[1], "identity_hash") ~= ARGV[1] then
  return {0, "SCORED_RUN_IDENTITY_MISMATCH"}
end
local status = redis.call("HGET", KEYS[1], "status")
if redis.call("EXISTS", KEYS[3]) ~= 1 or redis.call("PTTL", KEYS[3]) ~= -1
  or redis.call("HGET", KEYS[3], "identity_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[3], "evidence_digest") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "evidence_digest") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "attempt_manifest_digest")
    ~= redis.call("HGET", KEYS[3], "attempt_manifest_digest")
  or redis.call("HGET", KEYS[1], "attempt_count")
    ~= redis.call("HGET", KEYS[3], "attempt_count")
then return {0, "SCORED_RUN_ACK_MISMATCH"} end
if status == "acknowledged" then
  if redis.call("HGET", KEYS[3], "status") ~= "acknowledged" then
    return {0, "SCORED_RUN_ACK_MISMATCH"}
  end
  redis.call("DEL", KEYS[2])
  return {2, "ACKNOWLEDGED_EXISTING", redis.call("HGET", KEYS[1], "acknowledged_at_ms")}
end
if status ~= "terminal-complete" and status ~= "terminal-invalid" then
  return {0, "SCORED_RUN_NOT_TERMINAL"}
end
if redis.call("HGET", KEYS[1], "evidence_status") ~= "verified"
  or redis.call("HGET", KEYS[3], "status") ~= "sealed"
  or redis.call("HGET", KEYS[3], "terminal_status") ~= status
then return {0, "SCORED_RUN_EVIDENCE_UNVERIFIED"} end
if redis.call("EXISTS", KEYS[2]) == 1
  and (redis.call("HGET", KEYS[2], "status") ~= status
    or redis.call("HGET", KEYS[2], "identity_hash") ~= ARGV[1]
    or redis.call("PTTL", KEYS[2]) <= 0)
then return {0, "SCORED_RUN_ACK_MISMATCH"} end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[1], "status", "acknowledged", "terminal_status", status,
  "evidence_digest", ARGV[2], "acknowledged_at_ms", now_ms)
redis.call("HSET", KEYS[3], "status", "acknowledged", "acknowledged_at_ms", now_ms)
redis.call("DEL", KEYS[2])
return {1, "ACKNOWLEDGED_NEW", now_ms}
`;

export const SCORED_RUN_STORE_SCRIPTS = Object.freeze({
  create: CREATE_SCRIPT,
  acquireOwner: ACQUIRE_OWNER_SCRIPT,
  recordAttempt: RECORD_ATTEMPT_SCRIPT,
  read: READ_SCRIPT,
  readPermanentEvidence: READ_PERMANENT_EVIDENCE_SCRIPT,
  sealEvidence: SEAL_EVIDENCE_SCRIPT,
  acknowledge: ACK_SCRIPT
});

function secretKey(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new ScoredRunStoreError("WEAK_ARTIFACT_SECRET");
  }
}

function keyedHash(label: string, value: string, secret: string): string {
  return createHmac("sha256", secretKey(secret))
    .update(`toolproof.scored-run.${label}.v1.${value}`)
    .digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export function scoredRunKeys(
  keyspace: ScoredRunKeyspace,
  phase: "baseline" | "revised",
  frozenProtocolHash: string,
  scoredRunId: string
): [string, string] {
  if (!/^[a-f0-9]{64}$/u.test(frozenProtocolHash)) {
    throw new ScoredRunStoreError("INVALID_FROZEN_PROTOCOL_HASH");
  }
  if (!/^run_[A-Za-z0-9_-]{22}$/u.test(scoredRunId)) {
    throw new ScoredRunStoreError("INVALID_RUN_ID");
  }
  const prefix = `${keyspace.namespace}:${phase}:${frozenProtocolHash}:${scoredRunId}`;
  return [`${prefix}:anchor`, `${prefix}:data`];
}

export function scoredRunEvidenceKey(
  keyspace: ScoredRunKeyspace,
  phase: "baseline" | "revised",
  frozenProtocolHash: string,
  scoredRunId: string
): string {
  return `${scoredRunKeys(keyspace, phase, frozenProtocolHash, scoredRunId)[0].replace(/:anchor$/u, "")}:evidence`;
}

export async function scoredRunIdentityHash(identityValue: unknown): Promise<string> {
  return canonicalSha256(scoredRunIdentitySchema.parse(identityValue));
}

export async function createScoredRunIdentity(
  input: Omit<ScoredRunIdentity, "scheduleHash">
): Promise<ScoredRunIdentity> {
  const scheduleHash = await canonicalSha256({
    version: SCORED_RUN_SCHEDULE_VERSION,
    orderedRunnerCaseIds: input.orderedRunnerCaseIds
  });
  return scoredRunIdentitySchema.parse({ ...input, scheduleHash });
}

function ownerHash(documentId: string, secret: string): string {
  if (!/^document_[A-Za-z0-9_-]{22,64}$/u.test(documentId)) {
    throw new ScoredRunStoreError("INVALID_DOCUMENT_ID");
  }
  return keyedHash("document", documentId, secret);
}

function runnerHash(runnerId: string, secret: string): string {
  return keyedHash("runner-case", runnerCaseId.parse(runnerId), secret);
}

function runHash(value: string, secret: string): string {
  return keyedHash("run", runId.parse(value), secret);
}

function parseReply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new ScoredRunStoreError("INVALID_REPLY");
  if (Number(value[0]) === 0) {
    throw new ScoredRunStoreError(String(value[1] ?? "DENIED"), value.slice(2));
  }
  return value;
}

function replyInteger(value: unknown): number {
  if (!(
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && /^\d+$/u.test(value))
  )) {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  return parsed;
}

function hashReply(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, String(nested)])
    );
  }
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  const result: Record<string, string> = {};
  for (let index = 0; index < value.length; index += 2) {
    result[String(value[index])] = String(value[index + 1]);
  }
  return result;
}

function progressFromAnchor(anchor: Record<string, string>): ScoredRunProgress {
  const status = anchor.status;
  if (
    status !== "active" &&
    status !== "terminal-complete" &&
    status !== "terminal-invalid" &&
    status !== "acknowledged"
  ) {
    throw new ScoredRunStoreError("INVALID_SCORED_RUN_STATUS");
  }
  const phase = anchor.phase;
  if (phase !== "baseline" && phase !== "revised") {
    throw new ScoredRunStoreError("INVALID_SCORED_RUN_PHASE");
  }
  const completedCount = replyInteger(anchor.completed_count);
  const currentOrdinal = replyInteger(anchor.current_ordinal);
  const currentAttempt = replyInteger(anchor.current_attempt);
  if (
    completedCount > SCORED_RUN_CASE_COUNT ||
    currentOrdinal > SCORED_RUN_CASE_COUNT ||
    currentAttempt > 1
  ) {
    throw new ScoredRunStoreError("INVALID_SCORED_RUN_COUNTERS");
  }
  return Object.freeze({
    status,
    phase,
    completedCount,
    remainingCount: SCORED_RUN_CASE_COUNT - completedCount,
    transportFailureCount: replyInteger(anchor.transport_failure_count),
    attemptCount: replyInteger(anchor.attempt_count),
    currentOrdinal,
    currentAttempt: currentAttempt as 0 | 1,
    terminalReason: anchor.terminal_reason ?? null,
    evidenceDigest: anchor.evidence_digest ?? null
  });
}

function terminalStatusFromAnchor(
  anchor: Record<string, string>,
  progress: ScoredRunProgress
): "terminal-complete" | "terminal-invalid" | null {
  if (progress.status === "terminal-complete" || progress.status === "terminal-invalid") {
    return progress.status;
  }
  if (progress.status === "active") return null;
  const terminalStatus = anchor.terminal_status;
  if (terminalStatus !== "terminal-complete" && terminalStatus !== "terminal-invalid") {
    throw new ScoredRunStoreError("INVALID_SCORED_RUN_TERMINAL_STATUS");
  }
  return terminalStatus;
}

function scheduleArtifact(identity: ScoredRunIdentity, createdAt: string) {
  return scoredRunScheduleArtifactSchema.parse({
    version: SCORED_RUN_SCHEDULE_VERSION,
    identity,
    createdAt
  });
}

export async function createScoredRun(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly documentId: string;
    readonly artifactSecret: string;
    readonly createdAt: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<{
  readonly disposition: "new" | "existing";
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  const identityHash = await scoredRunIdentityHash(identity);
  const scheduleToken = sealProbeArtifact(
    "scored_schedule",
    scheduleArtifact(identity, input.createdAt),
    input.artifactSecret
  );
  const reply = parseReply(
    await redis.eval(
      CREATE_SCRIPT,
      scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
      [
        identityHash,
        SCORED_RUN_STORE_VERSION,
        identity.phase,
        identity.appCommit,
        identity.reviewPackageHash,
        identity.frozenProtocolHash,
        identity.freezeCandidateHash,
        identity.scheduleHash,
        runHash(identity.runId, input.artifactSecret),
        identity.actorHash,
        scheduleToken,
        runnerHash(identity.orderedRunnerCaseIds[0]!, input.artifactSecret),
        ownerHash(input.documentId, input.artifactSecret),
        String(SCORED_RUN_OWNER_LEASE_SECONDS * 1_000),
        String(SCORED_RUN_TTL_SECONDS * 1_000)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "CREATED" && status !== "EXISTING") {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  return Object.freeze({
    disposition: status === "CREATED" ? "new" : "existing",
    createdAtMs: replyInteger(reply[2]),
    expiresAtMs: replyInteger(reply[3])
  });
}

export async function acquireScoredRunOwner(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly documentId: string;
    readonly artifactSecret: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<{ readonly disposition: "acquired" | "renewed"; readonly ownerExpiresAtMs: number }> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  const reply = parseReply(
    await redis.eval(
      ACQUIRE_OWNER_SCRIPT,
      scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
      [
        await scoredRunIdentityHash(identity),
        ownerHash(input.documentId, input.artifactSecret),
        String(SCORED_RUN_OWNER_LEASE_SECONDS * 1_000)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "ACQUIRED" && status !== "RENEWED") {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  return Object.freeze({
    disposition: status === "ACQUIRED" ? "acquired" : "renewed",
    ownerExpiresAtMs: replyInteger(reply[2])
  });
}

export async function recordScoredRunAttempt(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly documentId: string;
    readonly artifactSecret: string;
    readonly attempt: ScoredRunAttempt;
    readonly terminalReason?: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<ScoredRunProgress> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  const attempt = scoredRunAttemptSchema.parse(input.attempt);
  if (attempt.runnerCaseId !== identity.orderedRunnerCaseIds[attempt.ordinal]) {
    throw new ScoredRunStoreError("ATTEMPT_RUNNER_CASE_MISMATCH");
  }
  const bytes = canonicalJson(attempt);
  if (Buffer.byteLength(bytes, "utf8") > SCORED_RUN_MAX_ATTEMPT_BYTES) {
    throw new ScoredRunStoreError("ATTEMPT_TOO_LARGE");
  }
  const attemptDigest = await canonicalSha256(attempt);
  const token = sealProbeArtifact("scored_attempt", attempt, input.artifactSecret);
  const terminalReason = input.terminalReason ?? "schedule_infrastructure_failure";
  if (terminalReason.length < 1 || terminalReason.length > 160) {
    throw new ScoredRunStoreError("INVALID_TERMINAL_REASON");
  }
  const nextRunnerId = identity.orderedRunnerCaseIds[attempt.ordinal + 1];
  const reply = parseReply(
    await redis.eval(
      RECORD_ATTEMPT_SCRIPT,
      scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
      [
        await scoredRunIdentityHash(identity),
        ownerHash(input.documentId, input.artifactSecret),
        String(attempt.ordinal),
        String(attempt.attempt),
        runnerHash(attempt.runnerCaseId, input.artifactSecret),
        token,
        attemptDigest,
        attempt.disposition,
        attempt.infrastructureRetryEligible ? "1" : "0",
        terminalReason,
        String(SCORED_RUN_CASE_COUNT),
        nextRunnerId ? runnerHash(nextRunnerId, input.artifactSecret) : ""
      ]
    )
  );
  const progress = await readScoredRunProgress(
    redis,
    {
      phase: identity.phase,
      frozenProtocolHash: identity.frozenProtocolHash,
      runId: identity.runId
    },
    keyspace
  );
  if (
    !progress ||
    progress.status !== String(reply[2]) ||
    progress.completedCount !== replyInteger(reply[3]) ||
    progress.currentOrdinal !== replyInteger(reply[4]) ||
    progress.currentAttempt !== replyInteger(reply[5])
  ) {
    throw new ScoredRunStoreError("SCORED_RUN_POST_WRITE_MISMATCH");
  }
  return progress;
}

function openSchedule(token: string, identity: ScoredRunIdentity, secret: string): void {
  let value: unknown;
  try {
    value = openProbeArtifact("scored_schedule", token, secret);
  } catch {
    throw new ScoredRunStoreError("INVALID_SCORED_SCHEDULE_ARTIFACT");
  }
  const parsed = scoredRunScheduleArtifactSchema.parse(value);
  if (canonicalJson(parsed.identity) !== canonicalJson(identity)) {
    throw new ScoredRunStoreError("SCORED_SCHEDULE_ARTIFACT_MISMATCH");
  }
}

function openAttempt(token: string, secret: string): ScoredRunAttempt {
  let attempt: ScoredRunAttempt;
  try {
    attempt = scoredRunAttemptSchema.parse(openProbeArtifact("scored_attempt", token, secret));
  } catch {
    throw new ScoredRunStoreError("INVALID_SCORED_ATTEMPT_ARTIFACT");
  }
  return Object.freeze({ ...attempt, evidence: attempt.evidence });
}

export async function readScoredRun(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly artifactSecret: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<ScoredRunSnapshot | null> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  const reply = parseReply(
    await redis.evalRo(
      READ_SCRIPT,
      scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
      []
    )
  );
  if (String(reply[1]) === "MISSING") return null;
  const anchor = hashReply(reply[2]);
  const expectedIdentityHash = await scoredRunIdentityHash(identity);
  if (!safeEqual(anchor.identity_hash ?? "", expectedIdentityHash)) {
    throw new ScoredRunStoreError("SCORED_RUN_IDENTITY_MISMATCH");
  }
  const progress = progressFromAnchor(anchor);
  if (String(reply[1]) === "ANCHOR_ONLY") {
    if (progress.status !== "acknowledged") {
      throw new ScoredRunStoreError("SCORED_RUN_DATA_MISSING");
    }
    return Object.freeze({
      ...progress,
      identity,
      attempts: [],
      terminalStatus: terminalStatusFromAnchor(anchor, progress),
      createdAtMs: replyInteger(anchor.created_at_ms),
      expiresAtMs: 0,
      ttlRemainingMs: 0
    });
  }
  const data = hashReply(reply[3]);
  if (!safeEqual(data.identity_hash ?? "", expectedIdentityHash)) {
    throw new ScoredRunStoreError("SCORED_RUN_IDENTITY_MISMATCH");
  }
  openSchedule(String(data.schedule_token ?? ""), identity, input.artifactSecret);
  const attempts: ScoredRunAttempt[] = [];
  for (let ordinal = 0; ordinal < SCORED_RUN_CASE_COUNT; ordinal += 1) {
    for (let attemptIndex = 0; attemptIndex <= 1; attemptIndex += 1) {
      const suffix = `${ordinal}_${attemptIndex}`;
      const token = data[`attempt_${suffix}`];
      const digest = anchor[`digest_${suffix}`];
      if (!token && !digest) continue;
      if (!token || !digest || !/^[a-f0-9]{64}$/u.test(digest)) {
        throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_PARTIAL");
      }
      const opened = openAttempt(token, input.artifactSecret);
      if ((await canonicalSha256(opened)) !== digest) {
        throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_DIGEST_MISMATCH");
      }
      attempts.push(opened);
    }
  }
  if (attempts.length !== progress.attemptCount) {
    throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_COUNT_MISMATCH");
  }
  return Object.freeze({
    ...progress,
    identity,
    attempts: Object.freeze(attempts),
    terminalStatus: terminalStatusFromAnchor(anchor, progress),
    createdAtMs: replyInteger(data.created_at_ms),
    expiresAtMs: replyInteger(data.expires_at_ms),
    ttlRemainingMs: replyInteger(reply[4])
  });
}

export async function readScoredRunProgress(
  redis: ScoredRunRedisClient,
  input: Pick<ScoredRunIdentity, "phase" | "frozenProtocolHash" | "runId">,
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<ScoredRunProgress | null> {
  const reply = parseReply(
    await redis.evalRo(
      READ_SCRIPT,
      scoredRunKeys(keyspace, input.phase, input.frozenProtocolHash, input.runId),
      []
    )
  );
  if (String(reply[1]) === "MISSING") return null;
  return progressFromAnchor(hashReply(reply[2]));
}

export async function sealScoredRunEvidence(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly evidenceDigest: string;
    readonly attemptManifestDigest: string;
    readonly attemptCount: number;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<"new" | "existing"> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  if (
    !/^[a-f0-9]{64}$/u.test(input.evidenceDigest) ||
    !/^[a-f0-9]{64}$/u.test(input.attemptManifestDigest) ||
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount < 1 ||
    input.attemptCount > SCORED_RUN_CASE_COUNT * 2
  ) {
    throw new ScoredRunStoreError("INVALID_EVIDENCE_VERIFICATION");
  }
  const reply = parseReply(
    await redis.eval(
      SEAL_EVIDENCE_SCRIPT,
      [
        ...scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
        scoredRunEvidenceKey(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId)
      ],
      [
        await scoredRunIdentityHash(identity),
        input.evidenceDigest,
        input.attemptManifestDigest,
        String(input.attemptCount),
        SCORED_RUN_STORE_VERSION
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "EVIDENCE_VERIFIED_NEW" && status !== "EVIDENCE_VERIFIED_EXISTING") {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  return status === "EVIDENCE_VERIFIED_NEW" ? "new" : "existing";
}

export async function acknowledgeScoredRun(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly evidenceDigest: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<"new" | "existing"> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  if (!/^[a-f0-9]{64}$/u.test(input.evidenceDigest)) {
    throw new ScoredRunStoreError("INVALID_EVIDENCE_DIGEST");
  }
  const reply = parseReply(
    await redis.eval(
      ACK_SCRIPT,
      [
        ...scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
        scoredRunEvidenceKey(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId)
      ],
      [await scoredRunIdentityHash(identity), input.evidenceDigest]
    )
  );
  const status = String(reply[1]);
  if (status !== "ACKNOWLEDGED_NEW" && status !== "ACKNOWLEDGED_EXISTING") {
    throw new ScoredRunStoreError("INVALID_REPLY");
  }
  return status === "ACKNOWLEDGED_NEW" ? "new" : "existing";
}

export async function readPermanentScoredRun(
  redis: ScoredRunRedisClient,
  input: {
    readonly identity: ScoredRunIdentity;
    readonly artifactSecret: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<ScoredRunSnapshot | null> {
  const identity = scoredRunIdentitySchema.parse(input.identity);
  const reply = parseReply(
    await redis.evalRo(
      READ_PERMANENT_EVIDENCE_SCRIPT,
      [
        scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId)[0],
        scoredRunEvidenceKey(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId)
      ],
      []
    )
  );
  if (String(reply[1]) === "MISSING" || String(reply[1]) === "MISSING_EVIDENCE") return null;
  const anchor = hashReply(reply[2]);
  const evidence = hashReply(reply[3]);
  const expectedIdentityHash = await scoredRunIdentityHash(identity);
  if (
    !safeEqual(anchor.identity_hash ?? "", expectedIdentityHash) ||
    !safeEqual(evidence.identity_hash ?? "", expectedIdentityHash)
  ) {
    throw new ScoredRunStoreError("SCORED_RUN_IDENTITY_MISMATCH");
  }
  openSchedule(String(evidence.schedule_token ?? ""), identity, input.artifactSecret);
  const attempts: ScoredRunAttempt[] = [];
  for (let ordinal = 0; ordinal < SCORED_RUN_CASE_COUNT; ordinal += 1) {
    for (let attemptIndex = 0; attemptIndex <= 1; attemptIndex += 1) {
      const suffix = `${ordinal}_${attemptIndex}`;
      const token = evidence[`attempt_${suffix}`];
      const digest = anchor[`digest_${suffix}`];
      if (!token && !digest) continue;
      if (!token || !digest) throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_PARTIAL");
      const opened = openAttempt(token, input.artifactSecret);
      if ((await canonicalSha256(opened)) !== digest) {
        throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_DIGEST_MISMATCH");
      }
      attempts.push(opened);
    }
  }
  const attemptCount = replyInteger(evidence.attempt_count);
  const completedCount = replyInteger(evidence.completed_count);
  if (attempts.length !== attemptCount) {
    throw new ScoredRunStoreError("SCORED_RUN_ATTEMPT_COUNT_MISMATCH");
  }
  return Object.freeze({
    status: progressFromAnchor(anchor).status,
    phase: identity.phase,
    completedCount,
    remainingCount: SCORED_RUN_CASE_COUNT - completedCount,
    transportFailureCount: replyInteger(evidence.transport_failure_count),
    attemptCount,
    currentOrdinal: completedCount,
    currentAttempt: 0,
    terminalReason: anchor.terminal_reason ?? null,
    evidenceDigest: evidence.evidence_digest ?? null,
    identity,
    attempts: Object.freeze(attempts),
    terminalStatus: (() => {
      const value = evidence.terminal_status;
      if (value !== "terminal-complete" && value !== "terminal-invalid") {
        throw new ScoredRunStoreError("INVALID_SCORED_RUN_TERMINAL_STATUS");
      }
      return value;
    })(),
    createdAtMs: replyInteger(anchor.created_at_ms),
    expiresAtMs: 0,
    ttlRemainingMs: 0
  });
}

export async function readPermanentScoredRunById(
  redis: ScoredRunRedisClient,
  input: {
    readonly phase: "baseline" | "revised";
    readonly frozenProtocolHash: string;
    readonly runId: string;
    readonly artifactSecret: string;
  },
  keyspace: ScoredRunKeyspace = PRODUCTION_SCORED_RUN_KEYSPACE
): Promise<ScoredRunSnapshot | null> {
  const result = parseReply(
    await redis.evalRo(
      READ_PERMANENT_EVIDENCE_SCRIPT,
      [
        scoredRunKeys(keyspace, input.phase, input.frozenProtocolHash, input.runId)[0],
        scoredRunEvidenceKey(keyspace, input.phase, input.frozenProtocolHash, input.runId)
      ],
      []
    )
  );
  if (String(result[1]) === "MISSING" || String(result[1]) === "MISSING_EVIDENCE") {
    return null;
  }
  const evidence = hashReply(result[3]);
  let artifact: z.infer<typeof scoredRunScheduleArtifactSchema>;
  try {
    artifact = scoredRunScheduleArtifactSchema.parse(
      openProbeArtifact(
        "scored_schedule",
        String(evidence.schedule_token ?? ""),
        input.artifactSecret
      )
    );
  } catch {
    throw new ScoredRunStoreError("INVALID_SCORED_SCHEDULE_ARTIFACT");
  }
  if (
    artifact.identity.phase !== input.phase ||
    artifact.identity.frozenProtocolHash !== input.frozenProtocolHash ||
    artifact.identity.runId !== input.runId
  ) {
    throw new ScoredRunStoreError("SCORED_SCHEDULE_ARTIFACT_MISMATCH");
  }
  return readPermanentScoredRun(
    redis,
    { identity: artifact.identity, artifactSecret: input.artifactSecret },
    keyspace
  );
}
