import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Redis } from "@upstash/redis";
import { z } from "zod";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
  PROBE_MAX_CONTINUATION_CHARACTERS
} from "@/lib/probe/service-contract";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import {
  PROBE_RECOVERY_TTL_SECONDS,
  PROBE_RECOVERY_VERSION,
  PROBE_OPERATOR_TTL_SECONDS,
  probeRecoveryClaimsSchema,
  type ProbeRecoveryClaims
} from "@/lib/probe/session";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

export const PROBE_RUN_INDEX_VERSION = 1;
export const PROBE_RUN_INDEX_TTL_SECONDS = PROBE_RECOVERY_TTL_SECONDS;
export const PROBE_DOCUMENT_LEASE_SECONDS = 10 * 60;

export type ProbeRunIndexRedisClient = Pick<Redis, "eval" | "evalRo">;

export interface ProbeRunIndexKeyspace {
  readonly namespace: string;
}

export function createProbeRunIndexKeyspace(
  namespace = "tp:{webmcp26}:run-index"
): ProbeRunIndexKeyspace {
  if (!/^tp:\{webmcp26\}:run-index(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new ProbeRunIndexError("INVALID_NAMESPACE");
  }
  return Object.freeze({ namespace });
}

export const PRODUCTION_PROBE_RUN_INDEX_KEYSPACE = createProbeRunIndexKeyspace();

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const probeRunIndexPayloadSchema = z
  .object({
    version: z.literal(PROBE_RUN_INDEX_VERSION),
    activationHash: sha256,
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    launchHash: sha256,
    recoveryId: opaqueId,
    sessionId: opaqueId,
    runId: opaqueId,
    actorHash: sha256,
    continuation: z.string().min(32).max(PROBE_MAX_CONTINUATION_CHARACTERS),
    nextOrdinal: z.number().int().min(0).max(PROBE_CALIBRATION_ATTEMPT_CASE_COUNT),
    terminal: z.boolean(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict()
  .superRefine(({ nextOrdinal, terminal, issuedAt, expiresAt }, context) => {
    if (terminal !== (nextOrdinal === PROBE_CALIBRATION_ATTEMPT_CASE_COUNT)) {
      context.addIssue({
        code: "custom",
        path: ["terminal"],
        message: "Terminal state must match the exact case count."
      });
    }
    if (expiresAt - issuedAt !== PROBE_RUN_INDEX_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Run-index lifetime must be fixed."
      });
    }
  });

export type ProbeRunIndexPayload = z.infer<typeof probeRunIndexPayloadSchema>;

const PUT_RUN_INDEX_SCRIPT = `
local anchor_exists = redis.call("EXISTS", KEYS[1])
local index_exists = redis.call("EXISTS", KEYS[2])
if anchor_exists ~= index_exists then return {0, "PARTIAL_RUN_INDEX"} end

local function identity_matches(key)
  return redis.call("HGET", key, "activation_hash") == ARGV[1]
    and redis.call("HGET", key, "build_commit") == ARGV[2]
    and redis.call("HGET", key, "recovery_hash") == ARGV[3]
    and redis.call("HGET", key, "session_hash") == ARGV[4]
    and redis.call("HGET", key, "run_hash") == ARGV[5]
    and redis.call("HGET", key, "actor_hash") == ARGV[6]
    and redis.call("HGET", key, "launch_hash") == ARGV[7]
end

if anchor_exists == 1 then
  local ttl_ms = redis.call("PTTL", KEYS[2])
  if redis.call("PTTL", KEYS[1]) ~= -1
    or ttl_ms <= 0
    or not identity_matches(KEYS[1])
    or not identity_matches(KEYS[2])
    or redis.call("HGET", KEYS[2], "status") ~= "active"
    or redis.call("HGET", KEYS[2], "revision") ~= "0"
    or redis.call("HGET", KEYS[2], "payload_binding") ~= ARGV[8]
    or not redis.call("HGET", KEYS[2], "token")
  then
    return {0, "RUN_INDEX_CONFLICT"}
  end
  return {2, "STORED_EXISTING", redis.call("HGET", KEYS[2], "token"), ARGV[8],
    0, redis.call("HGET", KEYS[2], "created_at_ms"),
    redis.call("HGET", KEYS[2], "expires_at_ms"), ttl_ms}
end

local now = redis.call("TIME")
local created_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local ttl_ms = tonumber(ARGV[10])
local expires_at_ms = created_at_ms + ttl_ms
redis.call("HSET", KEYS[1],
  "activation_hash", ARGV[1], "build_commit", ARGV[2],
  "recovery_hash", ARGV[3], "session_hash", ARGV[4],
  "run_hash", ARGV[5], "actor_hash", ARGV[6],
  "launch_hash", ARGV[7],
  "created_at_ms", created_at_ms, "expires_at_ms", expires_at_ms)
redis.call("HSET", KEYS[2],
  "activation_hash", ARGV[1], "build_commit", ARGV[2],
  "recovery_hash", ARGV[3], "session_hash", ARGV[4],
  "run_hash", ARGV[5], "actor_hash", ARGV[6],
  "launch_hash", ARGV[7],
  "payload_binding", ARGV[8], "token", ARGV[9],
  "status", "active", "revision", "0",
  "created_at_ms", created_at_ms, "expires_at_ms", expires_at_ms)
if redis.call("PEXPIRE", KEYS[2], ttl_ms) ~= 1 then
  redis.call("DEL", KEYS[1], KEYS[2])
  return {0, "RUN_INDEX_EXPIRY_FAILED"}
end
return {1, "STORED_NEW", ARGV[9], ARGV[8], 0, created_at_ms, expires_at_ms, ttl_ms}
`;

const GET_RUN_INDEX_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("EXISTS", KEYS[2]) ~= 1 then return {0, "PARTIAL_RUN_INDEX"} end
local ttl_ms = redis.call("PTTL", KEYS[2])
if redis.call("PTTL", KEYS[1]) ~= -1 or ttl_ms <= 0
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "status") ~= "active"
then
  return {0, "RUN_INDEX_IDENTITY_MISMATCH"}
end
local token = redis.call("HGET", KEYS[2], "token")
local binding = redis.call("HGET", KEYS[2], "payload_binding")
local revision = redis.call("HGET", KEYS[2], "revision")
local created_at_ms = redis.call("HGET", KEYS[2], "created_at_ms")
local expires_at_ms = redis.call("HGET", KEYS[2], "expires_at_ms")
if not token or not binding or not revision or not created_at_ms or not expires_at_ms then
  return {0, "CORRUPT_RUN_INDEX"}
end
return {1, "FOUND", token, binding, revision, created_at_ms, expires_at_ms, ttl_ms}
`;

const GET_RUN_INDEX_BY_LAUNCH_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {2, "MISSING"}
end
local ttl_ms = redis.call("PTTL", KEYS[2])
if redis.call("PTTL", KEYS[1]) ~= -1 or ttl_ms <= 0
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "status") ~= "active"
then
  return {0, "RUN_INDEX_LAUNCH_MISMATCH"}
end
local token = redis.call("HGET", KEYS[2], "token")
local binding = redis.call("HGET", KEYS[2], "payload_binding")
local revision = redis.call("HGET", KEYS[2], "revision")
local created_at_ms = redis.call("HGET", KEYS[2], "created_at_ms")
local expires_at_ms = redis.call("HGET", KEYS[2], "expires_at_ms")
if not token or not binding or not revision or not created_at_ms or not expires_at_ms then
  return {0, "CORRUPT_RUN_INDEX"}
end
return {1, "FOUND", token, binding, revision, created_at_ms, expires_at_ms, ttl_ms}
`;

const CLAIM_DOCUMENT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_RUN_INDEX"}
end
local ttl_ms = redis.call("PTTL", KEYS[2])
if redis.call("PTTL", KEYS[1]) ~= -1 or ttl_ms <= 0
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "status") ~= "active"
then
  return {0, "RUN_INDEX_IDENTITY_MISMATCH"}
end
local revision = tonumber(redis.call("HGET", KEYS[2], "revision") or "-1")
if revision < 0 then return {0, "CORRUPT_RUN_INDEX"} end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local owner_revision = tonumber(redis.call("HGET", KEYS[2], "owner_revision") or "-1")
local owner_hash = redis.call("HGET", KEYS[2], "owner_hash")
local owner_expires_at_ms = tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0")
if owner_revision == revision and owner_expires_at_ms > now_ms then
  if owner_hash ~= ARGV[8] then return {0, "RUN_INDEX_DOCUMENT_OWNED"} end
  return {2, "OWNER_EXISTING", revision, owner_expires_at_ms, owner_expires_at_ms - now_ms}
end
local lease_ms = tonumber(ARGV[9])
local expires_at_ms = now_ms + lease_ms
redis.call("HSET", KEYS[2], "owner_revision", revision,
  "owner_hash", ARGV[8], "owner_expires_at_ms", expires_at_ms)
return {1, "OWNER_NEW", revision, expires_at_ms, lease_ms}
`;

const ASSERT_DOCUMENT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_RUN_INDEX"}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local revision = redis.call("HGET", KEYS[2], "revision")
if redis.call("PTTL", KEYS[2]) <= 0
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "owner_revision") ~= revision
  or redis.call("HGET", KEYS[2], "owner_hash") ~= ARGV[8]
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") <= now_ms
then
  return {0, "RUN_INDEX_DOCUMENT_NOT_OWNER"}
end
return {1, "OWNER_VERIFIED", revision,
  redis.call("HGET", KEYS[2], "owner_expires_at_ms")}
`;

const ADVANCE_RUN_INDEX_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "MISSING_RUN_INDEX"}
end
local ttl_ms = redis.call("PTTL", KEYS[2])
if redis.call("PTTL", KEYS[1]) ~= -1 or ttl_ms <= 0 then return {0, "EXPIRED_RUN_INDEX"} end
if redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "status") ~= "active"
then
  return {0, "RUN_INDEX_IDENTITY_MISMATCH"}
end
local revision = tonumber(redis.call("HGET", KEYS[2], "revision") or "-1")
local binding = redis.call("HGET", KEYS[2], "payload_binding")
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("HGET", KEYS[2], "owner_revision") ~= tostring(revision)
  or redis.call("HGET", KEYS[2], "owner_hash") ~= ARGV[12]
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") <= now_ms
then
  return {0, "RUN_INDEX_ADVANCE_OWNER_MISMATCH"}
end
if revision == tonumber(ARGV[8]) + 1 and binding == ARGV[9]
then
  return {2, "ADVANCED_EXISTING", redis.call("HGET", KEYS[2], "token"), binding,
    revision, redis.call("HGET", KEYS[2], "created_at_ms"),
    redis.call("HGET", KEYS[2], "expires_at_ms"), ttl_ms}
end
if revision ~= tonumber(ARGV[8]) or binding ~= ARGV[10] then
  return {0, "RUN_INDEX_ADVANCE_CONFLICT"}
end
redis.call("HSET", KEYS[2], "token", ARGV[11], "payload_binding", ARGV[9],
  "revision", revision + 1)
return {1, "ADVANCED_NEW", ARGV[11], ARGV[9], revision + 1,
  redis.call("HGET", KEYS[2], "created_at_ms"),
  redis.call("HGET", KEYS[2], "expires_at_ms"), redis.call("PTTL", KEYS[2])}
`;

const DELETE_UNSTARTED_RUN_INDEX_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 and redis.call("EXISTS", KEYS[2]) == 0 then
  return {2, "MISSING"}
end
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("EXISTS", KEYS[2]) ~= 1 then
  return {0, "PARTIAL_RUN_INDEX"}
end
local ttl_ms = redis.call("PTTL", KEYS[2])
if redis.call("PTTL", KEYS[1]) ~= -1 or ttl_ms <= 0
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "revision") ~= "0"
then
  return {0, "RUN_INDEX_NOT_UNSTARTED"}
end
local inflight_ttl = redis.call("PTTL", KEYS[6])
if redis.call("PTTL", KEYS[3]) ~= -1
  or redis.call("PTTL", KEYS[4]) ~= -1
  or redis.call("PTTL", KEYS[5]) ~= -1
  or (inflight_ttl ~= -1 and inflight_ttl ~= -2)
  or redis.call("HGET", KEYS[3], "status") ~= "open"
  or redis.call("HGET", KEYS[3], "guard_instance_id") ~= ARGV[8]
  or redis.call("HGET", KEYS[3], "policy_hash") ~= ARGV[9]
  or redis.call("HGET", KEYS[3], "script_hash") ~= ARGV[10]
  or redis.call("HGET", KEYS[3], "initialized_commit") ~= ARGV[11]
  or redis.call("HGET", KEYS[4], "claimed_calls") ~= ARGV[12]
  or redis.call("HGET", KEYS[4], "known_count") ~= ARGV[12]
  or redis.call("HGET", KEYS[4], "pending_count") ~= "0"
  or redis.call("HGET", KEYS[4], "uncertain_count") ~= "0"
  or redis.call("HGET", KEYS[5], "calibration") ~= ARGV[12]
  or redis.call("ZCARD", KEYS[6]) ~= 0
then
  return {0, "RUN_INDEX_GUARD_MISMATCH"}
end
if redis.call("EXISTS", KEYS[7]) == 1 then
  if redis.call("PTTL", KEYS[7]) ~= -1
    or redis.call("HGET", KEYS[7], "state") ~= "ISSUED"
    or redis.call("HGET", KEYS[7], "jti") ~= ARGV[13]
    or redis.call("HGET", KEYS[7], "purpose") ~= "calibration"
    or redis.call("HGET", KEYS[7], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[7], "policy_hash") ~= ARGV[9]
    or redis.call("HGET", KEYS[7], "script_hash") ~= ARGV[10]
  then
    return {0, "RUN_INDEX_AUTH_REVOKE_MISMATCH"}
  end
  redis.call("DEL", KEYS[7])
end
redis.call("DEL", KEYS[2], KEYS[1])
return {1, "DELETED"}
`;

const ACKNOWLEDGE_RUN_INDEX_SCRIPT = `
local data_exists = redis.call("EXISTS", KEYS[2])
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_RUN_ANCHOR"} end
if redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[7]
then
  return {0, "RUN_INDEX_IDENTITY_MISMATCH"}
end
if data_exists == 0 then
  if redis.call("HGET", KEYS[1], "ack_status") == "acknowledged"
    and redis.call("HGET", KEYS[1], "ack_revision") == "4"
    and redis.call("HGET", KEYS[1], "ack_payload_binding") == ARGV[9]
  then
    return {2, "ACKNOWLEDGED_EXISTING", redis.call("HGET", KEYS[1], "acknowledged_at_ms")}
  end
  return {0, "MISSING_RUN_INDEX"}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("PTTL", KEYS[2]) <= 0
  or redis.call("HGET", KEYS[2], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "recovery_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[2], "session_hash") ~= ARGV[4]
  or redis.call("HGET", KEYS[2], "run_hash") ~= ARGV[5]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[6]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "revision") ~= "4"
  or redis.call("HGET", KEYS[2], "owner_revision") ~= "4"
  or redis.call("HGET", KEYS[2], "owner_hash") ~= ARGV[8]
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") <= now_ms
  or redis.call("HGET", KEYS[2], "payload_binding") ~= ARGV[9]
then
  return {0, "RUN_INDEX_ACK_MISMATCH"}
end
local inflight_ttl = redis.call("PTTL", KEYS[6])
if redis.call("PTTL", KEYS[3]) ~= -1
  or redis.call("PTTL", KEYS[4]) ~= -1
  or redis.call("PTTL", KEYS[5]) ~= -1
  or (inflight_ttl ~= -1 and inflight_ttl ~= -2)
  or redis.call("HGET", KEYS[3], "status") ~= "open"
  or redis.call("HGET", KEYS[3], "guard_instance_id") ~= ARGV[10]
  or redis.call("HGET", KEYS[3], "policy_hash") ~= ARGV[11]
  or redis.call("HGET", KEYS[3], "script_hash") ~= ARGV[12]
  or redis.call("HGET", KEYS[3], "initialized_commit") ~= ARGV[13]
  or redis.call("HGET", KEYS[4], "claimed_calls") ~= ARGV[14]
  or redis.call("HGET", KEYS[4], "known_count") ~= ARGV[14]
  or redis.call("HGET", KEYS[4], "pending_count") ~= "0"
  or redis.call("HGET", KEYS[4], "uncertain_count") ~= "0"
  or redis.call("HGET", KEYS[5], "calibration") ~= ARGV[14]
  or redis.call("ZCARD", KEYS[6]) ~= 0
then
  return {0, "RUN_INDEX_ACK_GUARD_MISMATCH"}
end
redis.call("HSET", KEYS[1], "ack_status", "acknowledged", "ack_revision", "4",
  "ack_payload_binding", ARGV[9], "acknowledged_at_ms", now_ms)
redis.call("DEL", KEYS[2])
return {1, "ACKNOWLEDGED_NEW", now_ms}
`;

const ARM_OPERATOR_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("HGET", KEYS[1], "status") ~= "armed"
    or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[3]
  then
    return {0, "OPERATOR_ARM_CONFLICT"}
  end
  local armed_at_ms = tonumber(redis.call("HGET", KEYS[1], "armed_at_ms") or "-1")
  local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "expires_at_ms") or "-1")
  local now = redis.call("TIME")
  local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
  if armed_at_ms < 0 or expires_at_ms - armed_at_ms ~= tonumber(ARGV[4])
    or expires_at_ms <= now_ms
  then
    return {0, "OPERATOR_ARM_EXPIRED"}
  end
  return {2, "ARMED_EXISTING", armed_at_ms, expires_at_ms}
end
local now = redis.call("TIME")
local armed_at_ms = tonumber(now[1]) * 1000
local expires_at_ms = armed_at_ms + tonumber(ARGV[4])
redis.call("HSET", KEYS[1], "status", "armed", "activation_hash", ARGV[1],
  "build_commit", ARGV[2], "actor_hash", ARGV[3], "armed_at_ms", armed_at_ms,
  "expires_at_ms", expires_at_ms)
return {1, "ARMED_NEW", armed_at_ms, expires_at_ms}
`;

const ASSERT_OPERATOR_SCRIPT = `
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1
  or redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "status") ~= "armed"
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[3]
  or tonumber(redis.call("HGET", KEYS[1], "expires_at_ms") or "0") <= now_ms
then
  return {0, "OPERATOR_NOT_ARMED"}
end
return {1, "OPERATOR_VERIFIED"}
`;

export const PROBE_RUN_INDEX_SCRIPTS = Object.freeze({
  put: PUT_RUN_INDEX_SCRIPT,
  get: GET_RUN_INDEX_SCRIPT,
  getByLaunch: GET_RUN_INDEX_BY_LAUNCH_SCRIPT,
  claimDocument: CLAIM_DOCUMENT_SCRIPT,
  assertDocument: ASSERT_DOCUMENT_SCRIPT,
  advance: ADVANCE_RUN_INDEX_SCRIPT,
  deleteUnstarted: DELETE_UNSTARTED_RUN_INDEX_SCRIPT,
  acknowledge: ACKNOWLEDGE_RUN_INDEX_SCRIPT,
  armOperator: ARM_OPERATOR_SCRIPT,
  assertOperator: ASSERT_OPERATOR_SCRIPT
});

export class ProbeRunIndexError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly unknown[] = []
  ) {
    super(code);
    this.name = "ProbeRunIndexError";
  }
}

export interface ProbeRunIndexReceipt {
  readonly disposition: "new" | "existing" | "recovered";
  readonly payload: ProbeRunIndexPayload;
  readonly payloadBinding: string;
  readonly revision: number;
  readonly nextOrdinal: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly ttlRemainingMs: number;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function secretKey(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new ProbeRunIndexError("WEAK_ARTIFACT_SECRET");
  }
}

function keyedHash(label: string, value: string, secret: string): string {
  return createHmac("sha256", secretKey(secret))
    .update(`toolproof.probe.run-index.${label}.v1.${value}`)
    .digest("hex");
}

function identityArguments(recovery: ProbeRecoveryClaims, secret: string): string[] {
  return [
    recovery.activationHash,
    recovery.buildCommit,
    keyedHash("recovery", recovery.recoveryId, secret),
    keyedHash("session", recovery.sessionId, secret),
    keyedHash("run", recovery.runId, secret),
    recovery.actorHash,
    recovery.launchHash
  ];
}

export function probeRunIndexKeys(
  keyspace: ProbeRunIndexKeyspace,
  activationHash: string
): [string, string] {
  if (!/^[a-f0-9]{64}$/u.test(activationHash))
    throw new ProbeRunIndexError("INVALID_ACTIVATION_HASH");
  return [
    `${keyspace.namespace}:${activationHash}:anchor`,
    `${keyspace.namespace}:${activationHash}:data`
  ];
}

export function probeOperatorArmKey(
  keyspace: ProbeRunIndexKeyspace,
  activationHash: string
): string {
  return `${probeRunIndexKeys(keyspace, activationHash)[0].replace(/:anchor$/u, "")}:operator`;
}

function payloadBinding(payload: ProbeRunIndexPayload, secret: string): string {
  return createHmac("sha256", secretKey(secret))
    .update(`toolproof.probe.run-index.binding.v1.${canonicalJson(payload)}`)
    .digest("hex");
}

export function deriveProbeDocumentHash(documentId: string, secret: string): string {
  if (!/^document_[A-Za-z0-9_-]{22,64}$/u.test(documentId)) {
    throw new ProbeRunIndexError("INVALID_DOCUMENT_ID");
  }
  return keyedHash("document", documentId, secret);
}

function parseReply(reply: unknown): unknown[] {
  if (!Array.isArray(reply) || reply.length < 2) throw new ProbeRunIndexError("INVALID_REPLY");
  if (Number(reply[0]) === 0) {
    throw new ProbeRunIndexError(String(reply[1] ?? "DENIED"), reply.slice(2));
  }
  return reply;
}

function replyInteger(reply: unknown[], index: number): number {
  const raw = reply[index];
  if (!(
    (typeof raw === "number" && Number.isFinite(raw)) ||
    (typeof raw === "string" && /^\d+$/u.test(raw))
  )) {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ProbeRunIndexError("INVALID_REPLY");
  return value;
}

function decryptPayload(input: {
  readonly token: string;
  readonly binding: string;
  readonly secret: string;
}): ProbeRunIndexPayload {
  let payload: ProbeRunIndexPayload;
  try {
    payload = probeRunIndexPayloadSchema.parse(
      openProbeArtifact("run_index", input.token, input.secret)
    );
  } catch {
    throw new ProbeRunIndexError("INVALID_RUN_INDEX_ARTIFACT");
  }
  if (!safeEqual(payloadBinding(payload, input.secret), input.binding)) {
    throw new ProbeRunIndexError("RUN_INDEX_ARTIFACT_MISMATCH");
  }
  return payload;
}

function openPayload(input: {
  readonly token: string;
  readonly binding: string;
  readonly recovery: ProbeRecoveryClaims;
  readonly secret: string;
}): ProbeRunIndexPayload {
  const payload = decryptPayload(input);
  if (
    payload.activationHash !== input.recovery.activationHash ||
    payload.buildCommit !== input.recovery.buildCommit ||
    payload.launchHash !== input.recovery.launchHash ||
    payload.recoveryId !== input.recovery.recoveryId ||
    payload.sessionId !== input.recovery.sessionId ||
    payload.runId !== input.recovery.runId ||
    payload.actorHash !== input.recovery.actorHash ||
    payload.issuedAt !== input.recovery.issuedAt ||
    payload.expiresAt !== input.recovery.expiresAt
  ) {
    throw new ProbeRunIndexError("RUN_INDEX_ARTIFACT_MISMATCH");
  }
  return payload;
}

function recoveryFromPayload(payload: ProbeRunIndexPayload): ProbeRecoveryClaims {
  return probeRecoveryClaimsSchema.parse({
    version: PROBE_RECOVERY_VERSION,
    purpose: "calibration",
    activationHash: payload.activationHash,
    buildCommit: payload.buildCommit,
    launchHash: payload.launchHash,
    recoveryId: payload.recoveryId,
    sessionId: payload.sessionId,
    runId: payload.runId,
    actorHash: payload.actorHash,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt
  });
}

function receiptFromReply(input: {
  readonly reply: unknown[];
  readonly disposition: ProbeRunIndexReceipt["disposition"];
  readonly recovery: ProbeRecoveryClaims;
  readonly secret: string;
}): ProbeRunIndexReceipt {
  const token = String(input.reply[2] ?? "");
  const binding = String(input.reply[3] ?? "");
  if (!token || !/^[a-f0-9]{64}$/u.test(binding)) throw new ProbeRunIndexError("INVALID_REPLY");
  const revision = replyInteger(input.reply, 4);
  const createdAtMs = replyInteger(input.reply, 5);
  const expiresAtMs = replyInteger(input.reply, 6);
  const ttlRemainingMs = replyInteger(input.reply, 7);
  if (
    revision > PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
    expiresAtMs - createdAtMs !== PROBE_RUN_INDEX_TTL_SECONDS * 1_000 ||
    ttlRemainingMs < 1 ||
    ttlRemainingMs > PROBE_RUN_INDEX_TTL_SECONDS * 1_000
  ) {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  const payload = openPayload({ token, binding, recovery: input.recovery, secret: input.secret });
  if (payload.nextOrdinal !== revision) throw new ProbeRunIndexError("RUN_INDEX_ORDINAL_MISMATCH");
  return Object.freeze({
    disposition: input.disposition,
    payload,
    payloadBinding: binding,
    revision,
    nextOrdinal: payload.nextOrdinal,
    createdAtMs,
    expiresAtMs,
    ttlRemainingMs
  });
}

function initialPayload(input: {
  readonly recovery: ProbeRecoveryClaims;
  readonly continuation: string;
}): ProbeRunIndexPayload {
  return probeRunIndexPayloadSchema.parse({
    version: PROBE_RUN_INDEX_VERSION,
    activationHash: input.recovery.activationHash,
    buildCommit: input.recovery.buildCommit,
    launchHash: input.recovery.launchHash,
    recoveryId: input.recovery.recoveryId,
    sessionId: input.recovery.sessionId,
    runId: input.recovery.runId,
    actorHash: input.recovery.actorHash,
    continuation: input.continuation,
    nextOrdinal: 0,
    terminal: false,
    issuedAt: input.recovery.issuedAt,
    expiresAt: input.recovery.expiresAt
  });
}

export function terminalProbeRunIndexPayloadBinding(input: {
  readonly recovery: ProbeRecoveryClaims;
  readonly continuation: string;
  readonly artifactSecret: string;
}): string {
  const payload = probeRunIndexPayloadSchema.parse({
    version: PROBE_RUN_INDEX_VERSION,
    activationHash: input.recovery.activationHash,
    buildCommit: input.recovery.buildCommit,
    launchHash: input.recovery.launchHash,
    recoveryId: input.recovery.recoveryId,
    sessionId: input.recovery.sessionId,
    runId: input.recovery.runId,
    actorHash: input.recovery.actorHash,
    continuation: input.continuation,
    nextOrdinal: PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
    terminal: true,
    issuedAt: input.recovery.issuedAt,
    expiresAt: input.recovery.expiresAt
  });
  return payloadBinding(payload, input.artifactSecret);
}

export async function putProbeRunIndex(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly continuation: string;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<ProbeRunIndexReceipt> {
  const payload = initialPayload(input);
  const binding = payloadBinding(payload, input.artifactSecret);
  const token = sealProbeArtifact("run_index", payload, input.artifactSecret);
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      PUT_RUN_INDEX_SCRIPT,
      probeRunIndexKeys(keyspace, input.recovery.activationHash),
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        binding,
        token,
        String(PROBE_RUN_INDEX_TTL_SECONDS * 1_000)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "STORED_NEW" && status !== "STORED_EXISTING") {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  return receiptFromReply({
    reply,
    disposition: status === "STORED_NEW" ? "new" : "existing",
    recovery: input.recovery,
    secret: input.artifactSecret
  });
}

export async function getProbeRunIndex(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<ProbeRunIndexReceipt | null> {
  const reply = parseReply(
    await redis.evalRo<string[], unknown>(
      GET_RUN_INDEX_SCRIPT,
      probeRunIndexKeys(keyspace, input.recovery.activationHash),
      identityArguments(input.recovery, input.artifactSecret)
    )
  );
  if (String(reply[1]) === "MISSING") return null;
  if (String(reply[1]) !== "FOUND") throw new ProbeRunIndexError("INVALID_REPLY");
  return receiptFromReply({
    reply,
    disposition: "recovered",
    recovery: input.recovery,
    secret: input.artifactSecret
  });
}

export async function getProbeRunIndexByLaunch(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly activationHash: string;
    readonly buildCommit: string;
    readonly actorHash: string;
    readonly launchHash: string;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<{
  readonly recovery: ProbeRecoveryClaims;
  readonly index: ProbeRunIndexReceipt;
} | null> {
  if (!/^[a-f0-9]{40}$/u.test(input.buildCommit) || !/^[a-f0-9]{64}$/u.test(input.actorHash)) {
    throw new ProbeRunIndexError("INVALID_LAUNCH_BINDING");
  }
  const reply = parseReply(
    await redis.evalRo<string[], unknown>(
      GET_RUN_INDEX_BY_LAUNCH_SCRIPT,
      probeRunIndexKeys(keyspace, input.activationHash),
      [input.activationHash, input.buildCommit, input.actorHash, input.launchHash]
    )
  );
  if (String(reply[1]) === "MISSING") return null;
  if (String(reply[1]) !== "FOUND") throw new ProbeRunIndexError("INVALID_REPLY");
  const token = String(reply[2] ?? "");
  const binding = String(reply[3] ?? "");
  if (!token || !/^[a-f0-9]{64}$/u.test(binding)) throw new ProbeRunIndexError("INVALID_REPLY");
  const payload = decryptPayload({ token, binding, secret: input.artifactSecret });
  if (
    payload.activationHash !== input.activationHash ||
    payload.buildCommit !== input.buildCommit ||
    payload.actorHash !== input.actorHash ||
    payload.launchHash !== input.launchHash
  ) {
    throw new ProbeRunIndexError("RUN_INDEX_LAUNCH_MISMATCH");
  }
  const recovery = recoveryFromPayload(payload);
  return Object.freeze({
    recovery,
    index: receiptFromReply({
      reply,
      disposition: "recovered",
      recovery,
      secret: input.artifactSecret
    })
  });
}

export async function claimProbeRunDocument(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly documentId: string;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<{
  readonly disposition: "new" | "existing";
  readonly revision: number;
  readonly leaseExpiresAtMs: number;
}> {
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      CLAIM_DOCUMENT_SCRIPT,
      probeRunIndexKeys(keyspace, input.recovery.activationHash),
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        deriveProbeDocumentHash(input.documentId, input.artifactSecret),
        String(PROBE_DOCUMENT_LEASE_SECONDS * 1_000)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "OWNER_NEW" && status !== "OWNER_EXISTING") {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  const revision = replyInteger(reply, 2);
  const leaseExpiresAtMs = replyInteger(reply, 3);
  const remainingMs = replyInteger(reply, 4);
  if (
    revision > PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
    remainingMs < 1 ||
    remainingMs > PROBE_DOCUMENT_LEASE_SECONDS * 1_000
  ) {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  return Object.freeze({
    disposition: status === "OWNER_NEW" ? "new" : "existing",
    revision,
    leaseExpiresAtMs
  });
}

export async function assertProbeRunDocumentOwner(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly documentId: string;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<number> {
  const reply = parseReply(
    await redis.evalRo<string[], unknown>(
      ASSERT_DOCUMENT_SCRIPT,
      probeRunIndexKeys(keyspace, input.recovery.activationHash),
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        deriveProbeDocumentHash(input.documentId, input.artifactSecret)
      ]
    )
  );
  if (String(reply[1]) !== "OWNER_VERIFIED") throw new ProbeRunIndexError("INVALID_REPLY");
  return replyInteger(reply, 2);
}

export async function advanceProbeRunIndex(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly current: ProbeRunIndexReceipt;
    readonly continuation: string;
    readonly documentId: string;
    readonly artifactSecret: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<ProbeRunIndexReceipt> {
  if (
    input.current.nextOrdinal >= PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
    canonicalJson(input.current.payload) !==
      canonicalJson(probeRunIndexPayloadSchema.parse(input.current.payload))
  ) {
    throw new ProbeRunIndexError("INVALID_RUN_INDEX_ADVANCE");
  }
  const payload = probeRunIndexPayloadSchema.parse({
    ...input.current.payload,
    continuation: input.continuation,
    nextOrdinal: input.current.nextOrdinal + 1,
    terminal: input.current.nextOrdinal + 1 === PROBE_CALIBRATION_ATTEMPT_CASE_COUNT
  });
  const binding = payloadBinding(payload, input.artifactSecret);
  const token = sealProbeArtifact("run_index", payload, input.artifactSecret);
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      ADVANCE_RUN_INDEX_SCRIPT,
      probeRunIndexKeys(keyspace, input.recovery.activationHash),
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        String(input.current.revision),
        binding,
        input.current.payloadBinding,
        token,
        deriveProbeDocumentHash(input.documentId, input.artifactSecret)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "ADVANCED_NEW" && status !== "ADVANCED_EXISTING") {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  return receiptFromReply({
    reply,
    disposition: status === "ADVANCED_NEW" ? "new" : "existing",
    recovery: input.recovery,
    secret: input.artifactSecret
  });
}

export async function deleteUnstartedProbeRunIndex(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly artifactSecret: string;
    readonly guard: {
      readonly configKey: string;
      readonly totalsKey: string;
      readonly purposeCountsKey: string;
      readonly inflightKey: string;
      readonly guardInstanceId: string;
      readonly policyHash: string;
      readonly scriptHash: string;
      readonly initializedCommit: string;
      readonly baseCalibrationCalls: number;
      readonly authorizationKey: string;
      readonly jti: string;
    };
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<"deleted" | "missing"> {
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      DELETE_UNSTARTED_RUN_INDEX_SCRIPT,
      [
        ...probeRunIndexKeys(keyspace, input.recovery.activationHash),
        input.guard.configKey,
        input.guard.totalsKey,
        input.guard.purposeCountsKey,
        input.guard.inflightKey,
        input.guard.authorizationKey
      ],
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        input.guard.guardInstanceId,
        input.guard.policyHash,
        input.guard.scriptHash,
        input.guard.initializedCommit,
        String(input.guard.baseCalibrationCalls),
        input.guard.jti
      ]
    )
  );
  if (String(reply[1]) === "MISSING") return "missing";
  if (String(reply[1]) !== "DELETED") throw new ProbeRunIndexError("INVALID_REPLY");
  return "deleted";
}

export async function acknowledgeProbeRunIndex(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly recovery: ProbeRecoveryClaims;
    readonly documentId: string;
    readonly payloadBinding: string;
    readonly artifactSecret: string;
    readonly guard: {
      readonly configKey: string;
      readonly totalsKey: string;
      readonly purposeCountsKey: string;
      readonly inflightKey: string;
      readonly guardInstanceId: string;
      readonly policyHash: string;
      readonly scriptHash: string;
      readonly initializedCommit: string;
      readonly terminalCalibrationCalls: number;
    };
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<"new" | "existing"> {
  if (!/^[a-f0-9]{64}$/u.test(input.payloadBinding)) {
    throw new ProbeRunIndexError("INVALID_PAYLOAD_BINDING");
  }
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      ACKNOWLEDGE_RUN_INDEX_SCRIPT,
      [
        ...probeRunIndexKeys(keyspace, input.recovery.activationHash),
        input.guard.configKey,
        input.guard.totalsKey,
        input.guard.purposeCountsKey,
        input.guard.inflightKey
      ],
      [
        ...identityArguments(input.recovery, input.artifactSecret),
        deriveProbeDocumentHash(input.documentId, input.artifactSecret),
        input.payloadBinding,
        input.guard.guardInstanceId,
        input.guard.policyHash,
        input.guard.scriptHash,
        input.guard.initializedCommit,
        String(input.guard.terminalCalibrationCalls)
      ]
    )
  );
  if (String(reply[1]) === "ACKNOWLEDGED_NEW") return "new";
  if (String(reply[1]) === "ACKNOWLEDGED_EXISTING") return "existing";
  throw new ProbeRunIndexError("INVALID_REPLY");
}

export async function armProbeOperator(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly activationHash: string;
    readonly buildCommit: string;
    readonly actorHash: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<{
  readonly disposition: "new" | "existing";
  readonly armedAtMs: number;
  readonly expiresAtMs: number;
}> {
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      ARM_OPERATOR_SCRIPT,
      [probeOperatorArmKey(keyspace, input.activationHash)],
      [
        input.activationHash,
        input.buildCommit,
        input.actorHash,
        String(PROBE_OPERATOR_TTL_SECONDS * 1_000)
      ]
    )
  );
  const status = String(reply[1]);
  if (status !== "ARMED_NEW" && status !== "ARMED_EXISTING") {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  const armedAtMs = replyInteger(reply, 2);
  const expiresAtMs = replyInteger(reply, 3);
  if (expiresAtMs - armedAtMs !== PROBE_OPERATOR_TTL_SECONDS * 1_000) {
    throw new ProbeRunIndexError("INVALID_REPLY");
  }
  return Object.freeze({
    disposition: status === "ARMED_NEW" ? "new" : "existing",
    armedAtMs,
    expiresAtMs
  });
}

export async function assertProbeOperatorArmed(
  redis: ProbeRunIndexRedisClient,
  input: {
    readonly activationHash: string;
    readonly buildCommit: string;
    readonly actorHash: string;
  },
  keyspace: ProbeRunIndexKeyspace = PRODUCTION_PROBE_RUN_INDEX_KEYSPACE
): Promise<void> {
  const reply = parseReply(
    await redis.evalRo<string[], unknown>(
      ASSERT_OPERATOR_SCRIPT,
      [probeOperatorArmKey(keyspace, input.activationHash)],
      [input.activationHash, input.buildCommit, input.actorHash]
    )
  );
  if (String(reply[1]) !== "OPERATOR_VERIFIED") throw new ProbeRunIndexError("INVALID_REPLY");
}

export function probeRunIndexScriptHash(): Promise<string> {
  return canonicalSha256(PROBE_RUN_INDEX_SCRIPTS);
}
