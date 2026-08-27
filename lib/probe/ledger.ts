import "server-only";

import { Redis } from "@upstash/redis";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH,
  PROBE_MIGRATED_POLICY_VERSION,
  PROBE_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRESERVED_STATE,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_POLICY_MIGRATION_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_PURPOSE_CALL_LIMITS,
  createProbePolicyMigrationManifest,
  createProbePolicyMigrationReceipt,
  parseProbePolicyMigrationPriorReceipt,
  probePolicyMigrationDigest,
  type ProbePolicyMigrationKnownCall,
  type ProbePolicyMigrationPriorReceipt,
  type ProbePolicyMigrationReceipt,
  type ProbePolicyMigrationResult
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V03_POLICY_MIGRATION_VERSION,
  PROBE_V03_PREDECESSOR_MIGRATION_ID,
  PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V03_PREVIOUS_POLICY_HASH,
  PROBE_V03_PREVIOUS_POLICY_VERSION,
  createProbeV03PolicyMigrationManifest,
  createProbeV03PolicyMigrationReceipt,
  isProbeV03PolicyMigrationSourceStatus,
  parseProbeV03PolicyMigrationSourceReceipt,
  probeV03PolicyMigrationDigest,
  type ProbeV03PolicyMigrationReceipt,
  type ProbeV03PolicyMigrationResult,
  type ProbeV03PolicyMigrationSourceReceipt
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_INFLIGHT_LEASE_SECONDS,
  PROBE_ISSUE_RATE_WINDOW_SECONDS,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  PROBE_TOKEN_TTL_SECONDS,
  probePolicyHash,
  type ProbePurpose
} from "@/lib/probe/policy";

const PRODUCTION_NAMESPACE = "tp:{webmcp26}";

export interface ProbeLedgerKeyspace {
  readonly namespace: string;
  readonly config: string;
  readonly totals: string;
  readonly purposeLimits: string;
  readonly purposeCounts: string;
  readonly inflight: string;
}

export function createProbeLedgerKeyspace(
  namespace: string = PRODUCTION_NAMESPACE
): ProbeLedgerKeyspace {
  if (!/^tp:\{webmcp26\}(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new ProbeLedgerError("INVALID_NAMESPACE");
  }
  return Object.freeze({
    namespace,
    config: `${namespace}:config`,
    totals: `${namespace}:totals`,
    purposeLimits: `${namespace}:purpose-limits`,
    purposeCounts: `${namespace}:purpose-counts`,
    inflight: `${namespace}:inflight`
  });
}

export const PRODUCTION_PROBE_KEYSPACE = createProbeLedgerKeyspace();

const INIT_SCRIPT = `
local config_exists = redis.call("EXISTS", KEYS[1])
local existing = redis.call("HGET", KEYS[1], "guard_instance_id")
if existing then
  if existing == ARGV[1]
    and redis.call("HGET", KEYS[1], "policy_hash") == ARGV[2]
    and redis.call("HGET", KEYS[1], "script_hash") == ARGV[3]
    and redis.call("HGET", KEYS[1], "global_call_limit") == ARGV[4]
    and redis.call("HGET", KEYS[1], "spend_ceiling_nusd") == ARGV[5]
    and redis.call("HGET", KEYS[1], "per_call_reservation_nusd") == ARGV[6]
    and redis.call("HGET", KEYS[1], "challenge_closes_at_ms") == ARGV[7]
    and redis.call("HGET", KEYS[1], "policy_version") == ARGV[8]
    and redis.call("HGET", KEYS[1], "model") == ARGV[9]
    and redis.call("HGET", KEYS[1], "max_concurrency") == ARGV[10]
    and redis.call("HGET", KEYS[3], "calibration") == ARGV[12]
    and redis.call("HGET", KEYS[3], "baseline") == ARGV[13]
    and redis.call("HGET", KEYS[3], "repair") == ARGV[14]
    and redis.call("HGET", KEYS[3], "revised") == ARGV[15]
    and redis.call("HGET", KEYS[3], "judge") == ARGV[16]
    and redis.call("HGET", KEYS[1], "initialized_commit") == ARGV[17]
  then
    return {2, "ALREADY_INITIALIZED", existing, ARGV[2], ARGV[3]}
  end
  return {0, "CONFIG_MISMATCH"}
end

if config_exists > 0 or redis.call("EXISTS", KEYS[2], KEYS[3], KEYS[4], KEYS[5]) > 0 then
  return {0, "PARTIAL_STATE"}
end

redis.call("HSET", KEYS[1],
  "schema_version", "1",
  "status", "open",
  "guard_instance_id", ARGV[1],
  "policy_hash", ARGV[2],
  "script_hash", ARGV[3],
  "policy_version", ARGV[8],
  "model", ARGV[9],
  "global_call_limit", ARGV[4],
  "spend_ceiling_nusd", ARGV[5],
  "per_call_reservation_nusd", ARGV[6],
  "max_concurrency", ARGV[10],
  "challenge_closes_at_ms", ARGV[7],
  "initialized_at_ms", ARGV[11],
  "initialized_commit", ARGV[17]
)
redis.call("HSET", KEYS[2],
  "claimed_calls", "0",
  "committed_nusd", "0",
  "pending_count", "0",
  "known_count", "0",
  "uncertain_count", "0",
  "known_actual_nusd", "0",
  "uncertain_upper_nusd", "0",
  "sequence", "0"
)
redis.call("HSET", KEYS[3],
  "calibration", ARGV[12],
  "baseline", ARGV[13],
  "repair", ARGV[14],
  "revised", ARGV[15],
  "judge", ARGV[16]
)
redis.call("HSET", KEYS[4],
  "calibration", "0",
  "baseline", "0",
  "repair", "0",
  "revised", "0",
  "judge", "0"
)

return {1, "INITIALIZED", ARGV[1], ARGV[2], ARGV[3]}
`;

const ISSUE_SCRIPT = `
local config_status = redis.call("HGET", KEYS[1], "status")
if not config_status then return {0, "MISSING_GUARD"} end
if config_status ~= "open" then return {0, "GUARD_NOT_OPEN"} end
if redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1] then return {0, "GUARD_MISMATCH"} end
if redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2] then return {0, "POLICY_MISMATCH"} end
if redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3] then return {0, "SCRIPT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[12] then return {0, "COMMIT_MISMATCH"} end

local now = redis.call("TIME")
local now_seconds = tonumber(now[1])
local now_ms = now_seconds * 1000 + math.floor(tonumber(now[2]) / 1000)
local closes_ms = tonumber(redis.call("HGET", KEYS[1], "challenge_closes_at_ms") or "0")
if now_seconds * 1000 >= closes_ms then return {0, "CHALLENGE_CLOSED"} end

if ARGV[13] == "1" then
  local revision = redis.call("HGET", KEYS[6], "revision")
  if redis.call("EXISTS", KEYS[5]) ~= 1
    or redis.call("EXISTS", KEYS[6]) ~= 1
    or redis.call("PTTL", KEYS[5]) ~= -1
    or redis.call("PTTL", KEYS[6]) <= 0
    or redis.call("HGET", KEYS[5], "activation_hash") ~= ARGV[14]
    or redis.call("HGET", KEYS[5], "build_commit") ~= ARGV[15]
    or redis.call("HGET", KEYS[6], "activation_hash") ~= ARGV[14]
    or redis.call("HGET", KEYS[6], "build_commit") ~= ARGV[15]
    or redis.call("HGET", KEYS[6], "status") ~= "active"
    or revision ~= ARGV[18]
    or redis.call("HGET", KEYS[6], "owner_revision") ~= revision
    or redis.call("HGET", KEYS[6], "owner_revision") ~= ARGV[17]
    or redis.call("HGET", KEYS[6], "owner_hash") ~= ARGV[16]
    or tonumber(redis.call("HGET", KEYS[6], "owner_expires_at_ms") or "0") <= now_ms
  then
    return {0, "RUN_ADMISSION_INVALID"}
  end
elseif ARGV[13] ~= "0" then
  return {0, "RUN_ADMISSION_MODE_INVALID"}
end

local existing_jti = redis.call("GET", KEYS[2])
if existing_jti then
  local existing_state = redis.call("HGET", KEYS[3], "state")
  local existing_claims = redis.call("HGET", KEYS[3], "claims_hash")
  local existing_expiry = tonumber(redis.call("HGET", KEYS[3], "expires_at") or "0")
  if existing_jti == ARGV[4]
    and existing_state == "ISSUED"
    and existing_claims == ARGV[5]
    and existing_expiry > now_seconds
  then
    return {2, "ISSUED_EXISTING", existing_jti,
      redis.call("HGET", KEYS[3], "issued_at"), existing_expiry}
  end
  return {0, "SUBJECT_ALREADY_CLAIMED"}
end

local issue_bucket = tostring(math.floor(now_seconds / tonumber(ARGV[10])))
local issued_in_bucket = tonumber(redis.call("HGET", KEYS[4], issue_bucket) or "0")
if issued_in_bucket >= tonumber(ARGV[11]) then return {0, "ISSUE_RATE_LIMIT"} end

local expires_at = now_seconds + tonumber(ARGV[9])
redis.call("SET", KEYS[2], ARGV[4])
redis.call("HSET", KEYS[3],
  "state", "ISSUED",
  "jti", ARGV[4],
  "claims_hash", ARGV[5],
  "purpose", ARGV[6],
  "subject_hash", ARGV[7],
  "actor_hash", ARGV[8],
  "issued_at", now_seconds,
  "expires_at", expires_at,
  "guard_instance_id", ARGV[1],
  "policy_hash", ARGV[2],
  "script_hash", ARGV[3]
)
redis.call("HINCRBY", KEYS[4], issue_bucket, 1)

return {1, "ISSUED_NEW", ARGV[4], now_seconds, expires_at}
`;

const BEGIN_SCRIPT = `
local config_status = redis.call("HGET", KEYS[1], "status")
if not config_status then return {0, "MISSING_GUARD"} end
if config_status ~= "open" then return {0, "GUARD_NOT_OPEN"} end
if redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1] then return {0, "GUARD_MISMATCH"} end
if redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2] then return {0, "POLICY_MISMATCH"} end
if redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3] then return {0, "SCRIPT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[20] then return {0, "COMMIT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "global_call_limit") ~= ARGV[8]
  or redis.call("HGET", KEYS[1], "spend_ceiling_nusd") ~= ARGV[9]
  or redis.call("HGET", KEYS[1], "per_call_reservation_nusd") ~= ARGV[10]
  or redis.call("HGET", KEYS[1], "max_concurrency") ~= ARGV[11]
  or redis.call("HGET", KEYS[1], "policy_version") ~= ARGV[12]
  or redis.call("HGET", KEYS[1], "model") ~= ARGV[13]
  or redis.call("HGET", KEYS[1], "challenge_closes_at_ms") ~= ARGV[14]
  or redis.call("HGET", KEYS[3], "calibration") ~= ARGV[15]
  or redis.call("HGET", KEYS[3], "baseline") ~= ARGV[16]
  or redis.call("HGET", KEYS[3], "repair") ~= ARGV[17]
  or redis.call("HGET", KEYS[3], "revised") ~= ARGV[18]
  or redis.call("HGET", KEYS[3], "judge") ~= ARGV[19]
  or redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[20]
  or redis.call("HEXISTS", KEYS[1], "halt_reason") == 1
  or redis.call("HEXISTS", KEYS[1], "uncertain_jti") == 1
then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "CONFIG_DRIFT")
  return {0, "CONFIG_DRIFT"}
end

local state = redis.call("HGET", KEYS[6], "state")
if not state then return {0, "UNKNOWN_TOKEN"} end
if state ~= "ISSUED" then return {0, "TOKEN_NOT_ISSUED", state} end
if redis.call("HGET", KEYS[6], "jti") ~= ARGV[7] then return {0, "JTI_MISMATCH"} end
if redis.call("HGET", KEYS[6], "claims_hash") ~= ARGV[4] then return {0, "CLAIMS_MISMATCH"} end
if redis.call("HGET", KEYS[6], "purpose") ~= ARGV[5] then return {0, "PURPOSE_MISMATCH"} end

local now = redis.call("TIME")
local now_seconds = tonumber(now[1])
local now_ms = now_seconds * 1000 + math.floor(tonumber(now[2]) / 1000)
if now_seconds * 1000 >= tonumber(ARGV[14]) then return {0, "CHALLENGE_CLOSED"} end
if ARGV[21] == "1" then
  local revision = redis.call("HGET", KEYS[8], "revision")
  if redis.call("EXISTS", KEYS[7]) ~= 1
    or redis.call("EXISTS", KEYS[8]) ~= 1
    or redis.call("PTTL", KEYS[7]) ~= -1
    or redis.call("PTTL", KEYS[8]) <= 0
    or redis.call("HGET", KEYS[7], "activation_hash") ~= ARGV[22]
    or redis.call("HGET", KEYS[7], "build_commit") ~= ARGV[23]
    or redis.call("HGET", KEYS[8], "activation_hash") ~= ARGV[22]
    or redis.call("HGET", KEYS[8], "build_commit") ~= ARGV[23]
    or redis.call("HGET", KEYS[8], "status") ~= "active"
    or revision ~= ARGV[26]
    or redis.call("HGET", KEYS[8], "owner_revision") ~= revision
    or redis.call("HGET", KEYS[8], "owner_revision") ~= ARGV[25]
    or redis.call("HGET", KEYS[8], "owner_hash") ~= ARGV[24]
    or tonumber(redis.call("HGET", KEYS[8], "owner_expires_at_ms") or "0") <= now_ms
  then
    return {0, "RUN_ADMISSION_INVALID"}
  end
elseif ARGV[21] ~= "0" then
  return {0, "RUN_ADMISSION_MODE_INVALID"}
end
if tonumber(redis.call("HGET", KEYS[6], "expires_at") or "0") <= now_seconds then
  redis.call("HSET", KEYS[6], "state", "EXPIRED", "expired_at", now_seconds)
  return {0, "TOKEN_EXPIRED"}
end

local stale = redis.call("ZRANGEBYSCORE", KEYS[5], "-inf", now_seconds, "LIMIT", 0, 1)
if #stale > 0 then return {0, "STALE_INFLIGHT_REQUIRES_REAP", stale[1]} end
local active = tonumber(redis.call("ZCARD", KEYS[5]))
if active >= tonumber(redis.call("HGET", KEYS[1], "max_concurrency") or "0") then
  return {0, "CONCURRENCY_LIMIT"}
end

if redis.call("HEXISTS", KEYS[2], "claimed_calls") == 0
  or redis.call("HEXISTS", KEYS[2], "committed_nusd") == 0
  or redis.call("HEXISTS", KEYS[2], "pending_count") == 0
  or redis.call("HEXISTS", KEYS[2], "known_count") == 0
  or redis.call("HEXISTS", KEYS[2], "uncertain_count") == 0
  or redis.call("HEXISTS", KEYS[2], "known_actual_nusd") == 0
  or redis.call("HEXISTS", KEYS[2], "uncertain_upper_nusd") == 0
  or redis.call("HEXISTS", KEYS[2], "sequence") == 0
  or redis.call("HEXISTS", KEYS[4], "calibration") == 0
  or redis.call("HEXISTS", KEYS[4], "baseline") == 0
  or redis.call("HEXISTS", KEYS[4], "repair") == 0
  or redis.call("HEXISTS", KEYS[4], "revised") == 0
  or redis.call("HEXISTS", KEYS[4], "judge") == 0
then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MISSING_COUNTER")
  return {0, "MISSING_COUNTER"}
end

local claimed = tonumber(redis.call("HGET", KEYS[2], "claimed_calls"))
local committed = tonumber(redis.call("HGET", KEYS[2], "committed_nusd"))
local pending = tonumber(redis.call("HGET", KEYS[2], "pending_count"))
local known = tonumber(redis.call("HGET", KEYS[2], "known_count"))
local uncertain = tonumber(redis.call("HGET", KEYS[2], "uncertain_count"))
local known_actual = tonumber(redis.call("HGET", KEYS[2], "known_actual_nusd"))
local uncertain_upper = tonumber(redis.call("HGET", KEYS[2], "uncertain_upper_nusd"))
local sequence_value = tonumber(redis.call("HGET", KEYS[2], "sequence"))
local global_limit = tonumber(redis.call("HGET", KEYS[1], "global_call_limit") or "0")
local spend_limit = tonumber(redis.call("HGET", KEYS[1], "spend_ceiling_nusd") or "0")
local reservation = tonumber(redis.call("HGET", KEYS[1], "per_call_reservation_nusd") or "0")
local purpose_count = tonumber(redis.call("HGET", KEYS[4], ARGV[5]))
local purpose_limit = tonumber(redis.call("HGET", KEYS[3], ARGV[5]) or "0")
local calibration_count = tonumber(redis.call("HGET", KEYS[4], "calibration"))
local baseline_count = tonumber(redis.call("HGET", KEYS[4], "baseline"))
local repair_count = tonumber(redis.call("HGET", KEYS[4], "repair"))
local revised_count = tonumber(redis.call("HGET", KEYS[4], "revised"))
local judge_count = tonumber(redis.call("HGET", KEYS[4], "judge"))
local function is_nonnegative_integer(value)
  return value ~= nil and value >= 0 and value == math.floor(value)
end
if not is_nonnegative_integer(claimed)
  or not is_nonnegative_integer(committed)
  or not is_nonnegative_integer(pending)
  or not is_nonnegative_integer(known)
  or not is_nonnegative_integer(uncertain)
  or not is_nonnegative_integer(known_actual)
  or not is_nonnegative_integer(uncertain_upper)
  or not is_nonnegative_integer(sequence_value)
  or not is_nonnegative_integer(calibration_count)
  or not is_nonnegative_integer(baseline_count)
  or not is_nonnegative_integer(repair_count)
  or not is_nonnegative_integer(revised_count)
  or not is_nonnegative_integer(judge_count)
then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MALFORMED_COUNTER")
  return {0, "MALFORMED_COUNTER"}
end
local purpose_sum = calibration_count + baseline_count + repair_count + revised_count + judge_count
if committed ~= claimed * reservation
  or pending + known + uncertain ~= claimed
  or purpose_sum ~= claimed
  or sequence_value ~= claimed
  or active ~= pending
  or known_actual > known * reservation
  or uncertain_upper ~= uncertain * reservation
  or calibration_count > tonumber(ARGV[15])
  or baseline_count > tonumber(ARGV[16])
  or repair_count > tonumber(ARGV[17])
  or revised_count > tonumber(ARGV[18])
  or judge_count > tonumber(ARGV[19])
then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "COUNTER_DRIFT")
  return {0, "COUNTER_DRIFT"}
end
if claimed + 1 > global_limit then return {0, "GLOBAL_CALL_LIMIT"} end
if purpose_count + 1 > purpose_limit then return {0, "PURPOSE_CALL_LIMIT"} end
if committed + reservation > spend_limit then return {0, "SPEND_LIMIT"} end

local sequence = redis.call("HINCRBY", KEYS[2], "sequence", 1)
local lease_expires = now_seconds + tonumber(ARGV[6])
redis.call("HINCRBY", KEYS[2], "claimed_calls", 1)
redis.call("HINCRBY", KEYS[2], "committed_nusd", reservation)
redis.call("HINCRBY", KEYS[2], "pending_count", 1)
redis.call("HINCRBY", KEYS[4], ARGV[5], 1)
redis.call("HSET", KEYS[6],
  "state", "IN_FLIGHT",
  "reservation_nusd", reservation,
  "dispatch_sequence", sequence,
  "dispatch_at", now_seconds,
  "lease_expires_at", lease_expires
)
if ARGV[21] == "1" then
  redis.call("HSET", KEYS[6],
    "run_activation_hash", ARGV[22],
    "run_build_commit", ARGV[23],
    "run_owner_hash", ARGV[24],
    "run_owner_revision", ARGV[25],
    "run_ordinal", ARGV[26]
  )
end
redis.call("ZADD", KEYS[5], lease_expires, ARGV[7])

return {1, "GRANTED_NEW", sequence, claimed + 1, committed + reservation, lease_expires}
`;

const SETTLE_KNOWN_SCRIPT = `
local config_status = redis.call("HGET", KEYS[1], "status")
if not config_status then return {0, "MISSING_GUARD"} end
if redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1] then return {0, "GUARD_MISMATCH"} end
if redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2] then return {0, "POLICY_MISMATCH"} end
if redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3] then return {0, "SCRIPT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[9] then return {0, "COMMIT_MISMATCH"} end

local state = redis.call("HGET", KEYS[4], "state")
if not state then return {0, "UNKNOWN_TOKEN"} end
local jti = redis.call("HGET", KEYS[4], "jti")
if not jti then return {0, "MISSING_JTI"} end
if state == "KNOWN" then
  if redis.call("HGET", KEYS[4], "settlement_digest") == ARGV[6] then
    return {2, "KNOWN_EXISTING", redis.call("HGET", KEYS[4], "actual_nusd")}
  end
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "CONFLICTING_SETTLEMENT")
  return {0, "CONFLICTING_SETTLEMENT"}
end
if state ~= "IN_FLIGHT" and state ~= "UNCERTAIN" then return {0, "TOKEN_NOT_SETTLEABLE", state} end

local reservation = tonumber(redis.call("HGET", KEYS[4], "reservation_nusd") or "-1")
local actual = tonumber(ARGV[4])
if reservation < 0 or actual < 0 then return {0, "INVALID_COST"} end
if redis.call("EXISTS", KEYS[5]) == 1 then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "DUPLICATE_PROVIDER_RESPONSE")
  return {0, "DUPLICATE_PROVIDER_RESPONSE"}
end
if actual > reservation then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "COST_OVER_RESERVATION")
  return {0, "COST_OVER_RESERVATION"}
end

if state == "IN_FLIGHT" then
  local removed = redis.call("ZREM", KEYS[3], jti)
  if removed ~= 1 then
    redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MISSING_INFLIGHT_LEASE")
    return {0, "MISSING_INFLIGHT_LEASE"}
  end
  redis.call("HINCRBY", KEYS[2], "pending_count", -1)
else
  redis.call("HINCRBY", KEYS[2], "uncertain_count", -1)
  redis.call("HINCRBY", KEYS[2], "uncertain_upper_nusd", -reservation)
  if redis.call("HGET", KEYS[1], "uncertain_jti") == jti then
    redis.call("HDEL", KEYS[1], "uncertain_jti")
    if config_status == "quarantined" and redis.call("HEXISTS", KEYS[1], "halt_reason") == 0 then
      redis.call("HSET", KEYS[1], "status", "open")
    end
  end
end
redis.call("HINCRBY", KEYS[2], "known_count", 1)
redis.call("HINCRBY", KEYS[2], "known_actual_nusd", actual)
redis.call("SET", KEYS[5], jti)
redis.call("HSET", KEYS[4],
  "state", "KNOWN",
  "actual_nusd", actual,
  "provider_response_hash", ARGV[5],
  "settlement_digest", ARGV[6],
  "usage_hash", ARGV[7],
  "settled_at_ms", ARGV[8]
)

return {1, "KNOWN_NEW", actual,
  redis.call("HGET", KEYS[2], "claimed_calls"),
  redis.call("HGET", KEYS[2], "committed_nusd")}
`;

const SETTLE_UNCERTAIN_SCRIPT = `
local config_status = redis.call("HGET", KEYS[1], "status")
if not config_status then return {0, "MISSING_GUARD"} end
if config_status == "halted" then return {0, "GUARD_HALTED"} end
if redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1] then return {0, "GUARD_MISMATCH"} end
if redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2] then return {0, "POLICY_MISMATCH"} end
if redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3] then return {0, "SCRIPT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[8] then return {0, "COMMIT_MISMATCH"} end

local state = redis.call("HGET", KEYS[4], "state")
if redis.call("HGET", KEYS[4], "jti") ~= ARGV[4] then return {0, "JTI_MISMATCH"} end
if state == "UNCERTAIN" then
  if redis.call("HGET", KEYS[4], "settlement_digest") == ARGV[5] then
    return {2, "UNCERTAIN_EXISTING", redis.call("HGET", KEYS[4], "reservation_nusd")}
  end
  return {0, "CONFLICTING_SETTLEMENT"}
end
if state ~= "IN_FLIGHT" then return {0, "TOKEN_NOT_IN_FLIGHT", state} end

local reservation = tonumber(redis.call("HGET", KEYS[4], "reservation_nusd") or "-1")
if reservation < 0 then return {0, "INVALID_RESERVATION"} end
local removed = redis.call("ZREM", KEYS[3], ARGV[4])
if removed ~= 1 then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MISSING_INFLIGHT_LEASE")
  return {0, "MISSING_INFLIGHT_LEASE"}
end
redis.call("HINCRBY", KEYS[2], "pending_count", -1)
redis.call("HINCRBY", KEYS[2], "uncertain_count", 1)
redis.call("HINCRBY", KEYS[2], "uncertain_upper_nusd", reservation)
redis.call("HSET", KEYS[1], "status", "quarantined", "uncertain_jti", ARGV[4])
redis.call("HSET", KEYS[4],
  "state", "UNCERTAIN",
  "settlement_digest", ARGV[5],
  "uncertain_reason", ARGV[6],
  "settled_at_ms", ARGV[7]
)

return {1, "UNCERTAIN_NEW", reservation,
  redis.call("HGET", KEYS[2], "claimed_calls"),
  redis.call("HGET", KEYS[2], "committed_nusd")}
`;

const REAP_SCRIPT = `
local config_status = redis.call("HGET", KEYS[1], "status")
if not config_status then return {0, "MISSING_GUARD"} end
if config_status == "halted" then return {0, "GUARD_HALTED"} end
if redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1] then return {0, "GUARD_MISMATCH"} end
if redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2] then return {0, "POLICY_MISMATCH"} end
if redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3] then return {0, "SCRIPT_MISMATCH"} end
if redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[6] then return {0, "COMMIT_MISMATCH"} end

local state = redis.call("HGET", KEYS[4], "state")
if redis.call("HGET", KEYS[4], "jti") ~= ARGV[4] then return {0, "JTI_MISMATCH"} end
if state == "UNCERTAIN" then
  if redis.call("HGET", KEYS[4], "settlement_digest") == ARGV[5] then
    return {2, "UNCERTAIN_EXISTING"}
  end
  return {0, "CONFLICTING_SETTLEMENT"}
end
if state ~= "IN_FLIGHT" then return {0, "TOKEN_NOT_IN_FLIGHT", state} end
local lease = tonumber(redis.call("ZSCORE", KEYS[3], ARGV[4]) or "0")
local now = redis.call("TIME")
local now_seconds = tonumber(now[1])
if lease == 0 then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MISSING_INFLIGHT_LEASE")
  return {0, "MISSING_INFLIGHT_LEASE"}
end
if lease > now_seconds then return {0, "LEASE_NOT_EXPIRED"} end

local reservation = tonumber(redis.call("HGET", KEYS[4], "reservation_nusd") or "-1")
if reservation < 0 then return {0, "INVALID_RESERVATION"} end
local removed = redis.call("ZREM", KEYS[3], ARGV[4])
if removed ~= 1 then
  redis.call("HSET", KEYS[1], "status", "halted", "halt_reason", "MISSING_INFLIGHT_LEASE")
  return {0, "MISSING_INFLIGHT_LEASE"}
end
redis.call("HINCRBY", KEYS[2], "pending_count", -1)
redis.call("HINCRBY", KEYS[2], "uncertain_count", 1)
redis.call("HINCRBY", KEYS[2], "uncertain_upper_nusd", reservation)
redis.call("HSET", KEYS[1], "status", "quarantined", "uncertain_jti", ARGV[4])
redis.call("HSET", KEYS[4],
  "state", "UNCERTAIN",
  "settlement_digest", ARGV[5],
  "uncertain_reason", "lease_expired",
  "settled_at_ms", now_seconds * 1000
)
return {1, "UNCERTAIN_NEW", reservation}
`;

const MIGRATE_POLICY_SCRIPT = `
local receipt_exists = redis.call("EXISTS", KEYS[6])

local function core_state_matches()
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("PTTL", KEYS[2]) ~= -1
    or redis.call("PTTL", KEYS[3]) ~= -1
    or redis.call("PTTL", KEYS[4]) ~= -1
    or redis.call("HGET", KEYS[1], "schema_version") ~= "1"
    or redis.call("HGET", KEYS[1], "status") ~= "open"
    or redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[7]
    or redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[8]
    or redis.call("HGET", KEYS[1], "global_call_limit") ~= ARGV[15]
    or redis.call("HGET", KEYS[1], "spend_ceiling_nusd") ~= ARGV[16]
    or redis.call("HGET", KEYS[1], "per_call_reservation_nusd") ~= ARGV[17]
    or redis.call("HGET", KEYS[1], "model") ~= ARGV[18]
    or redis.call("HGET", KEYS[1], "max_concurrency") ~= ARGV[19]
    or redis.call("HGET", KEYS[1], "challenge_closes_at_ms") ~= ARGV[20]
    or redis.call("HEXISTS", KEYS[1], "halt_reason") == 1
    or redis.call("HEXISTS", KEYS[1], "uncertain_jti") == 1
    or redis.call("HGET", KEYS[2], "claimed_calls") ~= ARGV[31]
    or redis.call("HGET", KEYS[2], "committed_nusd") ~= ARGV[32]
    or redis.call("HGET", KEYS[2], "pending_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_count") ~= ARGV[33]
    or redis.call("HGET", KEYS[2], "uncertain_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_actual_nusd") ~= ARGV[34]
    or redis.call("HGET", KEYS[2], "uncertain_upper_nusd") ~= "0"
    or redis.call("HGET", KEYS[2], "sequence") ~= ARGV[35]
    or redis.call("HGET", KEYS[4], "calibration") ~= ARGV[31]
    or redis.call("HGET", KEYS[4], "baseline") ~= "0"
    or redis.call("HGET", KEYS[4], "repair") ~= "0"
    or redis.call("HGET", KEYS[4], "revised") ~= "0"
    or redis.call("HGET", KEYS[4], "judge") ~= "0"
    or redis.call("ZCARD", KEYS[5]) ~= 0
  then
    return false
  end
  return true
end

local function config_matches(policy_version, policy_hash, script_hash, calibration_limit,
  baseline_limit, repair_limit, revised_limit, judge_limit)
  return redis.call("HGET", KEYS[1], "policy_version") == policy_version
    and redis.call("HGET", KEYS[1], "policy_hash") == policy_hash
    and redis.call("HGET", KEYS[1], "script_hash") == script_hash
    and redis.call("HGET", KEYS[3], "calibration") == calibration_limit
    and redis.call("HGET", KEYS[3], "baseline") == baseline_limit
    and redis.call("HGET", KEYS[3], "repair") == repair_limit
    and redis.call("HGET", KEYS[3], "revised") == revised_limit
    and redis.call("HGET", KEYS[3], "judge") == judge_limit
end

local function calls_match()
  if tonumber(ARGV[36]) ~= 4 then return false end
  local seen_jti = {}
  local seen_response = {}
  local actual_sum = 0
  for ordinal = 0, 3 do
    local arg_base = 37 + ordinal * 7
    local ordinal_value = tonumber(ARGV[arg_base])
    local jti = ARGV[arg_base + 1]
    local dispatch_sequence = ARGV[arg_base + 2]
    local actual_nusd = ARGV[arg_base + 3]
    local provider_hash = ARGV[arg_base + 4]
    local settlement_digest = ARGV[arg_base + 5]
    local usage_hash = ARGV[arg_base + 6]
    local auth_key = KEYS[7 + ordinal * 2]
    local provider_key = KEYS[8 + ordinal * 2]
    if ordinal_value ~= ordinal
      or dispatch_sequence ~= tostring(ordinal + 1)
      or seen_jti[jti]
      or seen_response[provider_hash]
      or redis.call("PTTL", auth_key) ~= -1
      or redis.call("PTTL", provider_key) ~= -1
      or redis.call("HGET", auth_key, "state") ~= "KNOWN"
      or redis.call("HGET", auth_key, "jti") ~= jti
      or redis.call("HGET", auth_key, "purpose") ~= "calibration"
      or redis.call("HGET", auth_key, "guard_instance_id") ~= ARGV[7]
      or redis.call("HGET", auth_key, "policy_hash") ~= ARGV[10]
      or redis.call("HGET", auth_key, "script_hash") ~= ARGV[11]
      or redis.call("HGET", auth_key, "reservation_nusd") ~= ARGV[17]
      or redis.call("HGET", auth_key, "dispatch_sequence") ~= dispatch_sequence
      or redis.call("HGET", auth_key, "actual_nusd") ~= actual_nusd
      or redis.call("HGET", auth_key, "provider_response_hash") ~= provider_hash
      or redis.call("HGET", auth_key, "settlement_digest") ~= settlement_digest
      or redis.call("HGET", auth_key, "usage_hash") ~= usage_hash
      or tonumber(redis.call("HGET", auth_key, "settled_at_ms") or "-1") < 0
      or redis.call("GET", provider_key) ~= jti
    then
      return false
    end
    seen_jti[jti] = true
    seen_response[provider_hash] = true
    actual_sum = actual_sum + tonumber(actual_nusd)
  end
  return actual_sum == tonumber(ARGV[34])
end

if receipt_exists == 1 then
  if redis.call("PTTL", KEYS[6]) ~= -1
    or redis.call("HGET", KEYS[6], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[6], "migration_id") ~= ARGV[2]
    or redis.call("HGET", KEYS[6], "migration_digest") ~= ARGV[3]
    or redis.call("HGET", KEYS[6], "prior_app_commit") ~= ARGV[4]
    or redis.call("HGET", KEYS[6], "prior_activation_hash") ~= ARGV[5]
    or redis.call("HGET", KEYS[6], "prior_evidence_digest") ~= ARGV[6]
    or redis.call("HGET", KEYS[6], "guard_instance_id") ~= ARGV[7]
    or redis.call("HGET", KEYS[6], "initialized_commit") ~= ARGV[8]
    or redis.call("HGET", KEYS[6], "previous_policy_version") ~= ARGV[9]
    or redis.call("HGET", KEYS[6], "previous_policy_hash") ~= ARGV[10]
    or redis.call("HGET", KEYS[6], "previous_script_hash") ~= ARGV[11]
    or redis.call("HGET", KEYS[6], "next_policy_version") ~= ARGV[12]
    or redis.call("HGET", KEYS[6], "next_policy_hash") ~= ARGV[13]
    or redis.call("HGET", KEYS[6], "next_script_hash") ~= ARGV[14]
    or redis.call("HGET", KEYS[6], "migration_commit") ~= ARGV[65]
  then
    return {0, "MIGRATION_RECEIPT_CONFLICT"}
  end
  for ordinal = 0, 3 do
    local arg_base = 37 + ordinal * 7
    local prefix = "call_" .. tostring(ordinal) .. "_"
    if redis.call("HGET", KEYS[6], prefix .. "ordinal") ~= ARGV[arg_base]
      or redis.call("HGET", KEYS[6], prefix .. "jti") ~= ARGV[arg_base + 1]
      or redis.call("HGET", KEYS[6], prefix .. "dispatch_sequence") ~= ARGV[arg_base + 2]
      or redis.call("HGET", KEYS[6], prefix .. "actual_nusd") ~= ARGV[arg_base + 3]
      or redis.call("HGET", KEYS[6], prefix .. "provider_response_hash") ~= ARGV[arg_base + 4]
      or redis.call("HGET", KEYS[6], prefix .. "settlement_digest") ~= ARGV[arg_base + 5]
      or redis.call("HGET", KEYS[6], prefix .. "usage_hash") ~= ARGV[arg_base + 6]
    then
      return {0, "MIGRATION_RECEIPT_CONFLICT"}
    end
  end
  if not core_state_matches()
    or not config_matches(ARGV[12], ARGV[13], ARGV[14], ARGV[26], ARGV[27], ARGV[28],
      ARGV[29], ARGV[30])
    or not calls_match()
  then
    return {0, "MIGRATION_REPLAY_STATE_MISMATCH"}
  end
  return {2, "MIGRATED_EXISTING", redis.call("HGET", KEYS[6], "migrated_at_ms")}
end

if not core_state_matches() then return {0, "MIGRATION_STATE_MISMATCH"} end
if not config_matches(ARGV[9], ARGV[10], ARGV[11], ARGV[21], ARGV[22], ARGV[23],
  ARGV[24], ARGV[25])
then
  return {0, "MIGRATION_OLD_CONFIG_MISMATCH"}
end
if not calls_match() then return {0, "MIGRATION_KNOWN_CALL_MISMATCH"} end
local now = redis.call("TIME")
local migrated_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if migrated_at_ms >= tonumber(ARGV[20]) then return {0, "CHALLENGE_CLOSED"} end

redis.call("HSET", KEYS[1],
  "policy_version", ARGV[12],
  "policy_hash", ARGV[13],
  "script_hash", ARGV[14]
)
redis.call("HSET", KEYS[3], "calibration", ARGV[26], "judge", ARGV[30])
redis.call("HSET", KEYS[6],
  "version", ARGV[1],
  "migration_id", ARGV[2],
  "migration_digest", ARGV[3],
  "prior_app_commit", ARGV[4],
  "prior_activation_hash", ARGV[5],
  "prior_evidence_digest", ARGV[6],
  "guard_instance_id", ARGV[7],
  "initialized_commit", ARGV[8],
  "previous_policy_version", ARGV[9],
  "previous_policy_hash", ARGV[10],
  "previous_script_hash", ARGV[11],
  "next_policy_version", ARGV[12],
  "next_policy_hash", ARGV[13],
  "next_script_hash", ARGV[14],
  "migration_commit", ARGV[65],
  "migrated_at_ms", migrated_at_ms
)
for ordinal = 0, 3 do
  local arg_base = 37 + ordinal * 7
  local prefix = "call_" .. tostring(ordinal) .. "_"
  redis.call("HSET", KEYS[6],
    prefix .. "ordinal", ARGV[arg_base],
    prefix .. "jti", ARGV[arg_base + 1],
    prefix .. "dispatch_sequence", ARGV[arg_base + 2],
    prefix .. "actual_nusd", ARGV[arg_base + 3],
    prefix .. "provider_response_hash", ARGV[arg_base + 4],
    prefix .. "settlement_digest", ARGV[arg_base + 5],
    prefix .. "usage_hash", ARGV[arg_base + 6]
  )
end
return {1, "MIGRATED_NEW", migrated_at_ms}
`;

const READ_POLICY_MIGRATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_MIGRATION_RECEIPT"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "MIGRATION_RECEIPT_EXPIRES"} end
local values = {1,
  redis.call("HGET", KEYS[1], "version"),
  redis.call("HGET", KEYS[1], "migration_id"),
  redis.call("HGET", KEYS[1], "migration_digest"),
  redis.call("HGET", KEYS[1], "prior_app_commit"),
  redis.call("HGET", KEYS[1], "prior_activation_hash"),
  redis.call("HGET", KEYS[1], "prior_evidence_digest"),
  redis.call("HGET", KEYS[1], "guard_instance_id"),
  redis.call("HGET", KEYS[1], "initialized_commit"),
  redis.call("HGET", KEYS[1], "previous_policy_version"),
  redis.call("HGET", KEYS[1], "previous_policy_hash"),
  redis.call("HGET", KEYS[1], "previous_script_hash"),
  redis.call("HGET", KEYS[1], "next_policy_version"),
  redis.call("HGET", KEYS[1], "next_policy_hash"),
  redis.call("HGET", KEYS[1], "next_script_hash"),
  redis.call("HGET", KEYS[1], "migrated_at_ms"),
  redis.call("HGET", KEYS[1], "migration_commit")}
for ordinal = 0, 3 do
  local prefix = "call_" .. tostring(ordinal) .. "_"
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "ordinal"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "jti"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "dispatch_sequence"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "actual_nusd"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "provider_response_hash"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "settlement_digest"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "usage_hash"))
end
return values
`;

const MIGRATE_POLICY_V03_SCRIPT = `
local predecessor_exists = redis.call("EXISTS", KEYS[6])
local receipt_exists = redis.call("EXISTS", KEYS[7])

local function core_state_matches()
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("PTTL", KEYS[2]) ~= -1
    or redis.call("PTTL", KEYS[3]) ~= -1
    or redis.call("PTTL", KEYS[4]) ~= -1
    or redis.call("PTTL", KEYS[5]) ~= -1
    or redis.call("HGET", KEYS[1], "schema_version") ~= "1"
    or redis.call("HGET", KEYS[1], "status") ~= "open"
    or redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[9]
    or redis.call("HGET", KEYS[1], "global_call_limit") ~= ARGV[16]
    or redis.call("HGET", KEYS[1], "spend_ceiling_nusd") ~= ARGV[17]
    or redis.call("HGET", KEYS[1], "per_call_reservation_nusd") ~= ARGV[18]
    or redis.call("HGET", KEYS[1], "model") ~= ARGV[19]
    or redis.call("HGET", KEYS[1], "max_concurrency") ~= ARGV[20]
    or redis.call("HGET", KEYS[1], "challenge_closes_at_ms") ~= ARGV[21]
    or redis.call("HEXISTS", KEYS[1], "halt_reason") == 1
    or redis.call("HEXISTS", KEYS[1], "uncertain_jti") == 1
    or redis.call("HGET", KEYS[2], "claimed_calls") ~= ARGV[32]
    or redis.call("HGET", KEYS[2], "committed_nusd") ~= ARGV[33]
    or redis.call("HGET", KEYS[2], "pending_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_count") ~= ARGV[34]
    or redis.call("HGET", KEYS[2], "uncertain_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_actual_nusd") ~= ARGV[35]
    or redis.call("HGET", KEYS[2], "uncertain_upper_nusd") ~= "0"
    or redis.call("HGET", KEYS[2], "sequence") ~= ARGV[36]
    or redis.call("HGET", KEYS[4], "calibration") ~= ARGV[32]
    or redis.call("HGET", KEYS[4], "baseline") ~= "0"
    or redis.call("HGET", KEYS[4], "repair") ~= "0"
    or redis.call("HGET", KEYS[4], "revised") ~= "0"
    or redis.call("HGET", KEYS[4], "judge") ~= "0"
    or redis.call("ZCARD", KEYS[5]) ~= 0
  then
    return false
  end
  return true
end

local function config_matches(policy_version, policy_hash, script_hash, calibration_limit,
  baseline_limit, repair_limit, revised_limit, judge_limit)
  return redis.call("HGET", KEYS[1], "policy_version") == policy_version
    and redis.call("HGET", KEYS[1], "policy_hash") == policy_hash
    and redis.call("HGET", KEYS[1], "script_hash") == script_hash
    and redis.call("HGET", KEYS[3], "calibration") == calibration_limit
    and redis.call("HGET", KEYS[3], "baseline") == baseline_limit
    and redis.call("HGET", KEYS[3], "repair") == repair_limit
    and redis.call("HGET", KEYS[3], "revised") == revised_limit
    and redis.call("HGET", KEYS[3], "judge") == judge_limit
end

local function predecessor_matches()
  if predecessor_exists ~= 1 or redis.call("PTTL", KEYS[6]) ~= -1
    or redis.call("HGET", KEYS[6], "version") ~= ARGV[74]
    or redis.call("HGET", KEYS[6], "migration_id") ~= ARGV[6]
    or redis.call("HGET", KEYS[6], "migration_digest") ~= ARGV[75]
    or redis.call("HGET", KEYS[6], "prior_app_commit") ~= ARGV[76]
    or redis.call("HGET", KEYS[6], "prior_activation_hash") ~= ARGV[77]
    or redis.call("HGET", KEYS[6], "prior_evidence_digest") ~= ARGV[78]
    or redis.call("HGET", KEYS[6], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[6], "initialized_commit") ~= ARGV[9]
    or redis.call("HGET", KEYS[6], "previous_policy_version") ~= ARGV[79]
    or redis.call("HGET", KEYS[6], "previous_policy_hash") ~= ARGV[80]
    or redis.call("HGET", KEYS[6], "previous_script_hash") ~= ARGV[81]
    or redis.call("HGET", KEYS[6], "next_policy_version") ~= ARGV[82]
    or redis.call("HGET", KEYS[6], "next_policy_hash") ~= ARGV[83]
    or redis.call("HGET", KEYS[6], "next_script_hash") ~= ARGV[84]
    or redis.call("HGET", KEYS[6], "migration_commit") ~= ARGV[85]
    or redis.call("HGET", KEYS[6], "migrated_at_ms") ~= ARGV[86]
  then
    return false
  end
  for ordinal = 0, 3 do
    local arg_base = 38 + ordinal * 7
    local prefix = "call_" .. tostring(ordinal) .. "_"
    if redis.call("HGET", KEYS[6], prefix .. "ordinal") ~= ARGV[arg_base]
      or redis.call("HGET", KEYS[6], prefix .. "jti") ~= ARGV[arg_base + 1]
      or redis.call("HGET", KEYS[6], prefix .. "dispatch_sequence") ~= ARGV[arg_base + 2]
      or redis.call("HGET", KEYS[6], prefix .. "actual_nusd") ~= ARGV[arg_base + 3]
      or redis.call("HGET", KEYS[6], prefix .. "provider_response_hash") ~= ARGV[arg_base + 4]
      or redis.call("HGET", KEYS[6], prefix .. "settlement_digest") ~= ARGV[arg_base + 5]
      or redis.call("HGET", KEYS[6], prefix .. "usage_hash") ~= ARGV[arg_base + 6]
    then
      return false
    end
  end
  return true
end

local function calls_match()
  if tonumber(ARGV[37]) ~= 5 then return false end
  local seen_jti = {}
  local seen_response = {}
  local actual_sum = 0
  for ordinal = 0, 4 do
    local arg_base = 38 + ordinal * 7
    local jti = ARGV[arg_base + 1]
    local dispatch_sequence = ARGV[arg_base + 2]
    local actual_nusd = ARGV[arg_base + 3]
    local provider_hash = ARGV[arg_base + 4]
    local auth_key = KEYS[8 + ordinal * 2]
    local provider_key = KEYS[9 + ordinal * 2]
    local expected_policy_hash = ARGV[80]
    local expected_script_hash = ARGV[81]
    if ordinal == 4 then
      expected_policy_hash = ARGV[11]
      expected_script_hash = ARGV[12]
    end
    if tonumber(ARGV[arg_base]) ~= ordinal
      or dispatch_sequence ~= tostring(ordinal + 1)
      or seen_jti[jti]
      or seen_response[provider_hash]
      or redis.call("PTTL", auth_key) ~= -1
      or redis.call("PTTL", provider_key) ~= -1
      or redis.call("HGET", auth_key, "state") ~= "KNOWN"
      or redis.call("HGET", auth_key, "jti") ~= jti
      or redis.call("HGET", auth_key, "purpose") ~= "calibration"
      or redis.call("HGET", auth_key, "guard_instance_id") ~= ARGV[8]
      or redis.call("HGET", auth_key, "policy_hash") ~= expected_policy_hash
      or redis.call("HGET", auth_key, "script_hash") ~= expected_script_hash
      or redis.call("HGET", auth_key, "reservation_nusd") ~= ARGV[18]
      or redis.call("HGET", auth_key, "dispatch_sequence") ~= dispatch_sequence
      or redis.call("HGET", auth_key, "actual_nusd") ~= actual_nusd
      or redis.call("HGET", auth_key, "provider_response_hash") ~= provider_hash
      or redis.call("HGET", auth_key, "settlement_digest") ~= ARGV[arg_base + 5]
      or redis.call("HGET", auth_key, "usage_hash") ~= ARGV[arg_base + 6]
      or tonumber(redis.call("HGET", auth_key, "settled_at_ms") or "-1") < 0
      or redis.call("GET", provider_key) ~= jti
    then
      return false
    end
    seen_jti[jti] = true
    seen_response[provider_hash] = true
    actual_sum = actual_sum + tonumber(actual_nusd)
  end
  return actual_sum == tonumber(ARGV[35])
end

local function receipt_matches()
  if redis.call("PTTL", KEYS[7]) ~= -1
    or redis.call("HGET", KEYS[7], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[7], "migration_id") ~= ARGV[2]
    or redis.call("HGET", KEYS[7], "migration_digest") ~= ARGV[3]
    or redis.call("HGET", KEYS[7], "prior_app_commit") ~= ARGV[4]
    or redis.call("HGET", KEYS[7], "prior_activation_hash") ~= ARGV[5]
    or redis.call("HGET", KEYS[7], "predecessor_migration_id") ~= ARGV[6]
    or redis.call("HGET", KEYS[7], "predecessor_receipt_hash") ~= ARGV[7]
    or redis.call("HGET", KEYS[7], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[7], "initialized_commit") ~= ARGV[9]
    or redis.call("HGET", KEYS[7], "previous_policy_version") ~= ARGV[10]
    or redis.call("HGET", KEYS[7], "previous_policy_hash") ~= ARGV[11]
    or redis.call("HGET", KEYS[7], "previous_script_hash") ~= ARGV[12]
    or redis.call("HGET", KEYS[7], "next_policy_version") ~= ARGV[13]
    or redis.call("HGET", KEYS[7], "next_policy_hash") ~= ARGV[14]
    or redis.call("HGET", KEYS[7], "next_script_hash") ~= ARGV[15]
    or redis.call("HGET", KEYS[7], "known_actual_nusd") ~= ARGV[35]
    or redis.call("HGET", KEYS[7], "migration_commit") ~= ARGV[73]
  then
    return false
  end
  for ordinal = 0, 4 do
    local arg_base = 38 + ordinal * 7
    local prefix = "call_" .. tostring(ordinal) .. "_"
    if redis.call("HGET", KEYS[7], prefix .. "ordinal") ~= ARGV[arg_base]
      or redis.call("HGET", KEYS[7], prefix .. "jti") ~= ARGV[arg_base + 1]
      or redis.call("HGET", KEYS[7], prefix .. "dispatch_sequence") ~= ARGV[arg_base + 2]
      or redis.call("HGET", KEYS[7], prefix .. "actual_nusd") ~= ARGV[arg_base + 3]
      or redis.call("HGET", KEYS[7], prefix .. "provider_response_hash") ~= ARGV[arg_base + 4]
      or redis.call("HGET", KEYS[7], prefix .. "settlement_digest") ~= ARGV[arg_base + 5]
      or redis.call("HGET", KEYS[7], prefix .. "usage_hash") ~= ARGV[arg_base + 6]
    then
      return false
    end
  end
  return true
end

if receipt_exists == 1 then
  if not receipt_matches() then return {0, "V03_MIGRATION_RECEIPT_CONFLICT"} end
  if not core_state_matches()
    or not config_matches(ARGV[13], ARGV[14], ARGV[15], ARGV[27], ARGV[28], ARGV[29],
      ARGV[30], ARGV[31])
    or not predecessor_matches()
    or not calls_match()
  then
    return {0, "V03_MIGRATION_REPLAY_STATE_MISMATCH"}
  end
  return {2, "V03_MIGRATED_EXISTING", redis.call("HGET", KEYS[7], "migrated_at_ms")}
end

if not core_state_matches() then return {0, "V03_MIGRATION_STATE_MISMATCH"} end
if not config_matches(ARGV[10], ARGV[11], ARGV[12], ARGV[22], ARGV[23], ARGV[24],
  ARGV[25], ARGV[26])
then
  return {0, "V03_MIGRATION_OLD_CONFIG_MISMATCH"}
end
if not predecessor_matches() then return {0, "V03_PREDECESSOR_RECEIPT_MISMATCH"} end
if not calls_match() then return {0, "V03_MIGRATION_KNOWN_CALL_MISMATCH"} end
local now = redis.call("TIME")
local migrated_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if migrated_at_ms >= tonumber(ARGV[21]) then return {0, "CHALLENGE_CLOSED"} end

redis.call("HSET", KEYS[1],
  "policy_version", ARGV[13],
  "policy_hash", ARGV[14],
  "script_hash", ARGV[15]
)
redis.call("HSET", KEYS[3], "calibration", ARGV[27], "judge", ARGV[31])
redis.call("HSET", KEYS[7],
  "version", ARGV[1],
  "migration_id", ARGV[2],
  "migration_digest", ARGV[3],
  "prior_app_commit", ARGV[4],
  "prior_activation_hash", ARGV[5],
  "predecessor_migration_id", ARGV[6],
  "predecessor_receipt_hash", ARGV[7],
  "guard_instance_id", ARGV[8],
  "initialized_commit", ARGV[9],
  "previous_policy_version", ARGV[10],
  "previous_policy_hash", ARGV[11],
  "previous_script_hash", ARGV[12],
  "next_policy_version", ARGV[13],
  "next_policy_hash", ARGV[14],
  "next_script_hash", ARGV[15],
  "known_actual_nusd", ARGV[35],
  "migration_commit", ARGV[73],
  "migrated_at_ms", migrated_at_ms
)
for ordinal = 0, 4 do
  local arg_base = 38 + ordinal * 7
  local prefix = "call_" .. tostring(ordinal) .. "_"
  redis.call("HSET", KEYS[7],
    prefix .. "ordinal", ARGV[arg_base],
    prefix .. "jti", ARGV[arg_base + 1],
    prefix .. "dispatch_sequence", ARGV[arg_base + 2],
    prefix .. "actual_nusd", ARGV[arg_base + 3],
    prefix .. "provider_response_hash", ARGV[arg_base + 4],
    prefix .. "settlement_digest", ARGV[arg_base + 5],
    prefix .. "usage_hash", ARGV[arg_base + 6]
  )
end
return {1, "V03_MIGRATED_NEW", migrated_at_ms}
`;

const READ_POLICY_V03_MIGRATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_V03_MIGRATION_RECEIPT"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "V03_MIGRATION_RECEIPT_EXPIRES"} end
local values = {1,
  redis.call("HGET", KEYS[1], "version"),
  redis.call("HGET", KEYS[1], "migration_id"),
  redis.call("HGET", KEYS[1], "migration_digest"),
  redis.call("HGET", KEYS[1], "prior_app_commit"),
  redis.call("HGET", KEYS[1], "prior_activation_hash"),
  redis.call("HGET", KEYS[1], "predecessor_migration_id"),
  redis.call("HGET", KEYS[1], "predecessor_receipt_hash"),
  redis.call("HGET", KEYS[1], "guard_instance_id"),
  redis.call("HGET", KEYS[1], "initialized_commit"),
  redis.call("HGET", KEYS[1], "previous_policy_version"),
  redis.call("HGET", KEYS[1], "previous_policy_hash"),
  redis.call("HGET", KEYS[1], "previous_script_hash"),
  redis.call("HGET", KEYS[1], "next_policy_version"),
  redis.call("HGET", KEYS[1], "next_policy_hash"),
  redis.call("HGET", KEYS[1], "next_script_hash"),
  redis.call("HGET", KEYS[1], "known_actual_nusd"),
  redis.call("HGET", KEYS[1], "migrated_at_ms"),
  redis.call("HGET", KEYS[1], "migration_commit")}
for ordinal = 0, 4 do
  local prefix = "call_" .. tostring(ordinal) .. "_"
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "ordinal"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "jti"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "dispatch_sequence"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "actual_nusd"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "provider_response_hash"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "settlement_digest"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "usage_hash"))
end
return values
`;

const STATUS_SCRIPT = `
local instance = redis.call("HGET", KEYS[1], "guard_instance_id")
if not instance then return {0, "MISSING_GUARD"} end
return {1,
  redis.call("HGET", KEYS[1], "status"),
  instance,
  redis.call("HGET", KEYS[1], "policy_hash"),
  redis.call("HGET", KEYS[1], "script_hash"),
  redis.call("HGET", KEYS[2], "claimed_calls"),
  redis.call("HGET", KEYS[2], "committed_nusd"),
  redis.call("HGET", KEYS[2], "pending_count"),
  redis.call("HGET", KEYS[2], "known_count"),
  redis.call("HGET", KEYS[2], "uncertain_count"),
  redis.call("HGET", KEYS[2], "known_actual_nusd"),
  redis.call("HGET", KEYS[2], "uncertain_upper_nusd"),
  redis.call("HGET", KEYS[1], "policy_version"),
  redis.call("HGET", KEYS[1], "model"),
  redis.call("HGET", KEYS[1], "global_call_limit"),
  redis.call("HGET", KEYS[1], "spend_ceiling_nusd"),
  redis.call("HGET", KEYS[1], "per_call_reservation_nusd"),
  redis.call("HGET", KEYS[1], "max_concurrency"),
  redis.call("HGET", KEYS[1], "challenge_closes_at_ms"),
  redis.call("HGET", KEYS[1], "initialized_commit"),
  redis.call("HGET", KEYS[3], "calibration"),
  redis.call("HGET", KEYS[3], "baseline"),
  redis.call("HGET", KEYS[3], "repair"),
  redis.call("HGET", KEYS[3], "revised"),
  redis.call("HGET", KEYS[3], "judge"),
  redis.call("HGET", KEYS[4], "calibration"),
  redis.call("HGET", KEYS[4], "baseline"),
  redis.call("HGET", KEYS[4], "repair"),
  redis.call("HGET", KEYS[4], "revised"),
  redis.call("HGET", KEYS[4], "judge"),
  redis.call("ZCARD", KEYS[5]),
  redis.call("HGET", KEYS[2], "sequence"),
  redis.call("HEXISTS", KEYS[1], "halt_reason"),
  redis.call("HEXISTS", KEYS[1], "uncertain_jti")}
`;

export const PROBE_LEDGER_SCRIPTS = Object.freeze({
  init: INIT_SCRIPT,
  issue: ISSUE_SCRIPT,
  begin: BEGIN_SCRIPT,
  settleKnown: SETTLE_KNOWN_SCRIPT,
  settleUncertain: SETTLE_UNCERTAIN_SCRIPT,
  reap: REAP_SCRIPT,
  migratePolicy: MIGRATE_POLICY_SCRIPT,
  readPolicyMigration: READ_POLICY_MIGRATION_SCRIPT,
  migratePolicyV03: MIGRATE_POLICY_V03_SCRIPT,
  readPolicyMigrationV03: READ_POLICY_V03_MIGRATION_SCRIPT,
  status: STATUS_SCRIPT
});

export type ProbeRedisClient = Pick<Redis, "eval" | "evalRo">;
export type ProbeRedisDiscoveryClient = ProbeRedisClient &
  Pick<Redis, "scan" | "hgetall" | "get" | "pttl">;

export class ProbeLedgerError extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly unknown[] = []
  ) {
    super(code);
    this.name = "ProbeLedgerError";
  }
}

export interface ProbeGuardIdentity {
  readonly guardInstanceId: string;
  readonly policyHash: string;
  readonly scriptHash: string;
  readonly initializedCommit: string;
}

export interface ProbeRunAdmission {
  readonly anchorKey: string;
  readonly dataKey: string;
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly ownerHash: string;
  readonly ownerRevision: number;
  readonly ordinal: number;
}

export interface IssueAuthorizationInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly claimsHash: string;
  readonly purpose: ProbePurpose;
  readonly subjectHash: string;
  readonly actorHash: string;
  readonly runAdmission?: ProbeRunAdmission;
}

export interface BeginCallInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly claimsHash: string;
  readonly purpose: ProbePurpose;
  readonly runAdmission?: ProbeRunAdmission;
}

export interface KnownSettlementInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly actualNanoUsd: number;
  readonly providerResponseHash: string;
  readonly settlementDigest: string;
  readonly usageHash: string;
  readonly settledAtMs?: number;
}

export interface UncertainSettlementInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly settlementDigest: string;
  readonly reason: string;
  readonly settledAtMs?: number;
}

export interface ReapProbeCallInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly settlementDigest: string;
}

export interface MigrateProbeGuardPolicyInput {
  readonly priorReceipt: ProbePolicyMigrationPriorReceipt;
  readonly migrationCommit: string;
}

export interface MigrateProbeGuardPolicyV03Input {
  readonly sourceReceipt: ProbeV03PolicyMigrationSourceReceipt;
  readonly predecessorReceipt: ProbePolicyMigrationReceipt;
  readonly migrationCommit: string;
}

export interface ProbeGuardStatus extends ProbeGuardIdentity {
  readonly status: "open" | "quarantined" | "halted";
  readonly claimedCalls: number;
  readonly committedNanoUsd: number;
  readonly pendingCount: number;
  readonly knownCount: number;
  readonly uncertainCount: number;
  readonly knownActualNanoUsd: number;
  readonly uncertainUpperNanoUsd: number;
  readonly policyVersion: string;
  readonly model: string;
  readonly globalCallLimit: number;
  readonly spendCeilingNanoUsd: number;
  readonly perCallReservationNanoUsd: number;
  readonly maxConcurrency: number;
  readonly challengeClosesAtMs: number;
  readonly purposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly purposeCounts: Readonly<Record<ProbePurpose, number>>;
  readonly inflightCount: number;
  readonly sequence: number;
  readonly haltMarkerPresent: boolean;
  readonly uncertainMarkerPresent: boolean;
}

function opaque(value: string, field: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(value)) throw new ProbeLedgerError(`INVALID_${field}`);
  return value;
}

function hash(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new ProbeLedgerError(`INVALID_${field}`);
  return value;
}

function integer(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ProbeLedgerError(`INVALID_${field}`);
  return value;
}

function gitCommit(value: string, field = "INITIALIZED_COMMIT"): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new ProbeLedgerError(`INVALID_${field}`);
  return value;
}

function runAdmissionBinding(
  admission: ProbeRunAdmission | undefined,
  fallbackKey: string
): { readonly keys: readonly [string, string]; readonly arguments: readonly string[] } {
  if (!admission) {
    return {
      keys: [fallbackKey, fallbackKey],
      arguments: ["0", "0".repeat(64), "0".repeat(40), "0".repeat(64), "0", "0"]
    };
  }
  hash(admission.activationHash, "RUN_ADMISSION_ACTIVATION_HASH");
  gitCommit(admission.buildCommit, "RUN_ADMISSION_BUILD_COMMIT");
  hash(admission.ownerHash, "RUN_ADMISSION_OWNER_HASH");
  integer(admission.ownerRevision, "RUN_ADMISSION_OWNER_REVISION");
  integer(admission.ordinal, "RUN_ADMISSION_ORDINAL");
  if (admission.ownerRevision !== admission.ordinal || admission.ordinal > 3) {
    throw new ProbeLedgerError("INVALID_RUN_ADMISSION_REVISION");
  }
  const basePattern = /^tp:\{webmcp26\}:run-index(?::[a-z0-9_-]{1,64})*$/u;
  const anchorSuffix = `:${admission.activationHash}:anchor`;
  if (!admission.anchorKey.endsWith(anchorSuffix)) {
    throw new ProbeLedgerError("INVALID_RUN_ADMISSION_KEY");
  }
  const base = admission.anchorKey.slice(0, -anchorSuffix.length);
  if (!basePattern.test(base) || admission.dataKey !== `${base}:${admission.activationHash}:data`) {
    throw new ProbeLedgerError("INVALID_RUN_ADMISSION_KEY");
  }
  return {
    keys: [admission.anchorKey, admission.dataKey],
    arguments: [
      "1",
      admission.activationHash,
      admission.buildCommit,
      admission.ownerHash,
      String(admission.ownerRevision),
      String(admission.ordinal)
    ]
  };
}

function parseReply(reply: unknown): unknown[] {
  if (!Array.isArray(reply) || reply.length < 2) throw new ProbeLedgerError("INVALID_REPLY");
  if (Number(reply[0]) === 0) {
    throw new ProbeLedgerError(String(reply[1] ?? "DENIED"), reply.slice(2));
  }
  return reply;
}

function replyInteger(reply: unknown[], index: number): number {
  const raw = reply[index];
  if (!(
    (typeof raw === "number" && Number.isFinite(raw)) ||
    (typeof raw === "string" && /^\d+$/u.test(raw))
  )) {
    throw new ProbeLedgerError("INVALID_REPLY");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ProbeLedgerError("INVALID_REPLY");
  return parsed;
}

export function probeAuthorizationKey(keyspace: ProbeLedgerKeyspace, jti: string): string {
  return `${keyspace.namespace}:auth:${opaque(jti, "JTI")}`;
}

function authKey(keyspace: ProbeLedgerKeyspace, jti: string): string {
  return probeAuthorizationKey(keyspace, jti);
}

function subjectKey(keyspace: ProbeLedgerKeyspace, subjectHash: string): string {
  return `${keyspace.namespace}:subject:${subjectHash}`;
}

function issueRateKey(
  keyspace: ProbeLedgerKeyspace,
  purpose: ProbePurpose,
  actorHash: string
): string {
  return `${keyspace.namespace}:issue-rate:${purpose}:${actorHash}`;
}

function providerResponseKey(keyspace: ProbeLedgerKeyspace, responseHash: string): string {
  return `${keyspace.namespace}:provider:${responseHash}`;
}

export function probePolicyMigrationKey(
  keyspace: ProbeLedgerKeyspace,
  migrationId: string = PROBE_POLICY_MIGRATION_ID
): string {
  return `${keyspace.namespace}:policy-migration:${opaque(migrationId, "MIGRATION_ID")}`;
}

export function probeV03PolicyMigrationKey(
  keyspace: ProbeLedgerKeyspace,
  migrationId: string = PROBE_V03_POLICY_MIGRATION_ID
): string {
  return `${keyspace.namespace}:policy-migration:${opaque(migrationId, "V03_MIGRATION_ID")}`;
}

export function createProbeRedis(environment: NodeJS.ProcessEnv = process.env): Redis {
  const url = environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL;
  const token = environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN;
  if (!url || !token) throw new ProbeLedgerError("MISSING_DURABLE_STORE");
  return new Redis({ url, token, enableTelemetry: false, readYourWrites: true });
}

export function probeLedgerScriptHash(): Promise<string> {
  return canonicalSha256(PROBE_LEDGER_SCRIPTS);
}

function policyMigrationArguments(
  manifest: ReturnType<typeof createProbePolicyMigrationManifest>,
  migrationDigest: string
): string[] {
  return [
    manifest.version,
    manifest.migrationId,
    migrationDigest,
    manifest.priorAppCommit,
    manifest.priorActivationHash,
    manifest.priorEvidenceDigest,
    manifest.guardInstanceId,
    manifest.initializedCommit,
    manifest.previousPolicyVersion,
    manifest.previousPolicyHash,
    manifest.previousScriptHash,
    manifest.nextPolicyVersion,
    manifest.nextPolicyHash,
    manifest.nextScriptHash,
    String(PROBE_GLOBAL_CALL_LIMIT),
    String(PROBE_LIFETIME_SPEND_CEILING_NANO_USD),
    String(PROBE_PER_CALL_RESERVATION_NANO_USD),
    PROBE_MODEL,
    String(PROBE_MAX_CONCURRENCY),
    String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
    String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.calibration),
    String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.baseline),
    String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.repair),
    String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.revised),
    String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.judge),
    String(PROBE_MIGRATED_PURPOSE_CALL_LIMITS.calibration),
    String(PROBE_MIGRATED_PURPOSE_CALL_LIMITS.baseline),
    String(PROBE_MIGRATED_PURPOSE_CALL_LIMITS.repair),
    String(PROBE_MIGRATED_PURPOSE_CALL_LIMITS.revised),
    String(PROBE_MIGRATED_PURPOSE_CALL_LIMITS.judge),
    String(PROBE_POLICY_MIGRATION_PRESERVED_STATE.claimedCalls),
    String(PROBE_POLICY_MIGRATION_PRESERVED_STATE.committedNanoUsd),
    String(PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownCalls),
    String(PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownActualNanoUsd),
    String(PROBE_POLICY_MIGRATION_PRESERVED_STATE.sequence),
    String(manifest.knownCalls.length),
    ...manifest.knownCalls.flatMap((call) => [
      String(call.ordinal),
      call.jti,
      String(call.dispatchSequence),
      String(call.actualNanoUsd),
      call.providerResponseHash,
      call.settlementDigest,
      call.usageHash
    ]),
    manifest.migrationCommit
  ];
}

async function migrationManifestFromReadReply(reply: unknown[]): Promise<{
  readonly manifest: ReturnType<typeof createProbePolicyMigrationManifest>;
  readonly migrationDigest: string;
  readonly migratedAtMs: number;
}> {
  if (String(reply[1]) !== PROBE_POLICY_MIGRATION_VERSION) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_VERSION_MISMATCH");
  }
  const knownCalls = Array.from({ length: 4 }, (_unused, ordinal) => {
    const offset = 17 + ordinal * 7;
    return {
      ordinal: replyInteger(reply, offset),
      jti: String(reply[offset + 1]),
      dispatchSequence: replyInteger(reply, offset + 2),
      actualNanoUsd: replyInteger(reply, offset + 3),
      providerResponseHash: String(reply[offset + 4]),
      settlementDigest: String(reply[offset + 5]),
      usageHash: String(reply[offset + 6])
    };
  });
  const priorReceipt = parseProbePolicyMigrationPriorReceipt({
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: String(reply[2]),
    priorAppCommit: String(reply[4]),
    priorActivationHash: String(reply[5]),
    priorEvidenceDigest: String(reply[6]),
    guardInstanceId: String(reply[7]),
    initializedCommit: String(reply[8]),
    previousPolicyVersion: String(reply[9]),
    previousPolicyHash: String(reply[10]),
    previousScriptHash: String(reply[11]),
    knownCalls
  });
  const nextPolicyHash = PROBE_MIGRATED_POLICY_HASH;
  const nextScriptHash = PROBE_MIGRATED_LEDGER_SCRIPT_HASH;
  if (
    String(reply[12]) !== PROBE_MIGRATED_POLICY_VERSION ||
    String(reply[13]) !== nextPolicyHash ||
    String(reply[14]) !== nextScriptHash
  ) {
    throw new ProbeLedgerError("MIGRATION_NEXT_IDENTITY_MISMATCH");
  }
  return {
    manifest: createProbePolicyMigrationManifest({
      priorReceipt,
      migrationCommit: String(reply[16]),
      nextPolicyHash,
      nextScriptHash
    }),
    migrationDigest: hash(String(reply[3]), "MIGRATION_DIGEST"),
    migratedAtMs: replyInteger(reply, 15)
  };
}

export async function readProbePolicyMigrationReceipt(
  redis: ProbeRedisClient,
  input: { readonly expectedReceiptHash?: string } = {},
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbePolicyMigrationReceipt> {
  if (input.expectedReceiptHash !== undefined) {
    hash(input.expectedReceiptHash, "MIGRATION_RECEIPT_HASH");
  }
  const reply = parseReply(
    await redis.evalRo<[], unknown>(
      READ_POLICY_MIGRATION_SCRIPT,
      [probePolicyMigrationKey(keyspace)],
      []
    )
  );
  const parsed = await migrationManifestFromReadReply(reply);
  const receipt = await createProbePolicyMigrationReceipt(
    parsed.manifest,
    parsed.migrationDigest,
    parsed.migratedAtMs
  );
  if (
    input.expectedReceiptHash !== undefined &&
    receipt.receiptHash !== input.expectedReceiptHash
  ) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export async function migrateProbeGuardPolicy(
  redis: ProbeRedisClient,
  input: MigrateProbeGuardPolicyInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbePolicyMigrationResult> {
  const priorReceipt = parseProbePolicyMigrationPriorReceipt(input.priorReceipt);
  const nextPolicyHash = PROBE_MIGRATED_POLICY_HASH;
  const nextScriptHash = PROBE_MIGRATED_LEDGER_SCRIPT_HASH;
  const manifest = createProbePolicyMigrationManifest({
    priorReceipt,
    migrationCommit: gitCommit(input.migrationCommit, "MIGRATION_COMMIT"),
    nextPolicyHash,
    nextScriptHash
  });
  const migrationDigest = await probePolicyMigrationDigest(manifest);
  const keys = [
    keyspace.config,
    keyspace.totals,
    keyspace.purposeLimits,
    keyspace.purposeCounts,
    keyspace.inflight,
    probePolicyMigrationKey(keyspace),
    ...manifest.knownCalls.flatMap((call) => [
      authKey(keyspace, call.jti),
      providerResponseKey(keyspace, call.providerResponseHash)
    ])
  ];
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      MIGRATE_POLICY_SCRIPT,
      keys,
      policyMigrationArguments(manifest, migrationDigest)
    )
  );
  const disposition = Number(reply[0]) === 1 ? "new" : "existing";
  if (reply[1] !== "MIGRATED_NEW" && reply[1] !== "MIGRATED_EXISTING") {
    throw new ProbeLedgerError("AMBIGUOUS_POLICY_MIGRATION");
  }
  const expectedReceipt = await createProbePolicyMigrationReceipt(
    manifest,
    migrationDigest,
    replyInteger(reply, 2)
  );
  const receipt = await readProbePolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: expectedReceipt.receiptHash },
    keyspace
  );
  return Object.freeze({ disposition, receipt });
}

function durableInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProbeLedgerError(`INVALID_${field}`);
  }
  return parsed;
}

/**
 * Finds the one sequence-five KNOWN tombstone without printing or persisting any opaque record.
 * Production uses the frozen predecessor receipt hash; isolated tests may pin their own receipt.
 */
export async function discoverProbeV03PolicyMigrationSource(
  redis: ProbeRedisDiscoveryClient,
  input: {
    readonly guardInstanceId: string;
    readonly initializedCommit: string;
    readonly expectedPredecessorReceiptHash?: string;
  },
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly predecessorReceipt: ProbePolicyMigrationReceipt;
  readonly sourceReceipt: ProbeV03PolicyMigrationSourceReceipt;
}> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  gitCommit(input.initializedCommit);
  const expectedPredecessorReceiptHash =
    input.expectedPredecessorReceiptHash ?? PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH;
  hash(expectedPredecessorReceiptHash, "PREDECESSOR_MIGRATION_RECEIPT_HASH");
  const predecessorReceipt = await readProbePolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: expectedPredecessorReceiptHash },
    keyspace
  );
  if (
    predecessorReceipt.guardInstanceId !== input.guardInstanceId ||
    predecessorReceipt.initializedCommit !== input.initializedCommit
  ) {
    throw new ProbeLedgerError("V03_PREDECESSOR_IDENTITY_MISMATCH");
  }
  const status = await readProbeGuardStatus(redis, keyspace);
  if (
    !isProbeV03PolicyMigrationSourceStatus(status, {
      guardInstanceId: input.guardInstanceId,
      initializedCommit: input.initializedCommit
    })
  ) {
    throw new ProbeLedgerError("V03_MIGRATION_SOURCE_STATUS_MISMATCH");
  }

  const authPattern = `${keyspace.namespace}:auth:*`;
  const authKeys = new Set<string>();
  let cursor = "0";
  for (let page = 0; page < 32; page += 1) {
    const [nextCursor, keys] = await redis.scan(cursor, { match: authPattern, count: 100 });
    for (const key of keys) authKeys.add(key);
    if (authKeys.size > 1_024) throw new ProbeLedgerError("V03_DISCOVERY_KEY_LIMIT");
    cursor = nextCursor;
    if (cursor === "0") break;
    if (page === 31) throw new ProbeLedgerError("V03_DISCOVERY_PAGE_LIMIT");
  }
  const providerPattern = `${keyspace.namespace}:provider:*`;
  const providerKeys = new Set<string>();
  cursor = "0";
  for (let page = 0; page < 32; page += 1) {
    const [nextCursor, keys] = await redis.scan(cursor, { match: providerPattern, count: 100 });
    for (const key of keys) providerKeys.add(key);
    if (providerKeys.size > 1_024) throw new ProbeLedgerError("V03_DISCOVERY_KEY_LIMIT");
    cursor = nextCursor;
    if (cursor === "0") break;
    if (page === 31) throw new ProbeLedgerError("V03_DISCOVERY_PAGE_LIMIT");
  }

  const discoveredKnownCalls = new Map<number, ProbePolicyMigrationKnownCall>();
  for (const key of authKeys) {
    const auth = await redis.hgetall<Record<string, unknown>>(key);
    if (!auth || String(auth.state ?? "") !== "KNOWN") continue;
    const dispatchSequence = durableInteger(auth.dispatch_sequence, "V03_DISCOVERY_SEQUENCE");
    if (
      dispatchSequence < 1 ||
      dispatchSequence > 5 ||
      discoveredKnownCalls.has(dispatchSequence)
    ) {
      throw new ProbeLedgerError("V03_DISCOVERY_ORPHAN_KNOWN_CALL");
    }
    const ordinal = dispatchSequence - 1;
    const jti = opaque(String(auth.jti ?? ""), "V03_DISCOVERY_JTI");
    const providerResponseHash = hash(
      String(auth.provider_response_hash ?? ""),
      "V03_DISCOVERY_PROVIDER_RESPONSE_HASH"
    );
    const call: ProbePolicyMigrationKnownCall = Object.freeze({
      ordinal,
      jti,
      dispatchSequence,
      actualNanoUsd: durableInteger(auth.actual_nusd, "V03_DISCOVERY_ACTUAL_COST"),
      providerResponseHash,
      settlementDigest: hash(
        String(auth.settlement_digest ?? ""),
        "V03_DISCOVERY_SETTLEMENT_DIGEST"
      ),
      usageHash: hash(String(auth.usage_hash ?? ""), "V03_DISCOVERY_USAGE_HASH")
    });
    const historical = ordinal < 4;
    const expectedHistoricalCall = historical ? predecessorReceipt.knownCalls[ordinal] : undefined;
    const expectedPolicyHash = historical
      ? PROBE_PREVIOUS_POLICY_HASH
      : PROBE_V03_PREVIOUS_POLICY_HASH;
    const expectedScriptHash = historical
      ? PROBE_PREVIOUS_LEDGER_SCRIPT_HASH
      : PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH;
    if (
      key !== authKey(keyspace, jti) ||
      String(auth.purpose ?? "") !== "calibration" ||
      String(auth.guard_instance_id ?? "") !== input.guardInstanceId ||
      String(auth.policy_hash ?? "") !== expectedPolicyHash ||
      String(auth.script_hash ?? "") !== expectedScriptHash ||
      durableInteger(auth.reservation_nusd, "V03_DISCOVERY_RESERVATION") !==
        PROBE_PER_CALL_RESERVATION_NANO_USD ||
      call.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD ||
      durableInteger(auth.settled_at_ms, "V03_DISCOVERY_SETTLED_AT") < 0 ||
      (await redis.pttl(key)) !== -1 ||
      (await redis.pttl(providerResponseKey(keyspace, providerResponseHash))) !== -1 ||
      (await redis.get(providerResponseKey(keyspace, providerResponseHash))) !== jti ||
      (historical && canonicalJson(call) !== canonicalJson(expectedHistoricalCall))
    ) {
      throw new ProbeLedgerError("V03_DISCOVERY_RECORD_MISMATCH");
    }
    discoveredKnownCalls.set(dispatchSequence, call);
  }
  if (
    discoveredKnownCalls.size !== 5 ||
    Array.from({ length: 5 }, (_unused, index) => discoveredKnownCalls.has(index + 1)).some(
      (present) => !present
    )
  ) {
    throw new ProbeLedgerError("V03_DISCOVERY_KNOWN_SET_MISMATCH");
  }

  const knownCalls = Object.freeze(
    Array.from({ length: 5 }, (_unused, index) => discoveredKnownCalls.get(index + 1)!)
  );
  const expectedProviderKeys = new Set(
    knownCalls.map((call) => providerResponseKey(keyspace, call.providerResponseHash))
  );
  if (
    providerKeys.size !== expectedProviderKeys.size ||
    [...providerKeys].some((key) => !expectedProviderKeys.has(key))
  ) {
    throw new ProbeLedgerError("V03_DISCOVERY_ORPHAN_PROVIDER_RECORD");
  }
  const knownActualNanoUsd = knownCalls.reduce((sum, call) => sum + call.actualNanoUsd, 0);
  if (knownActualNanoUsd !== status.knownActualNanoUsd) {
    throw new ProbeLedgerError("V03_DISCOVERY_COST_MISMATCH");
  }
  const sourceReceipt = await parseProbeV03PolicyMigrationSourceReceipt(
    {
      version: PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V03_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      predecessorMigrationId: PROBE_V03_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: predecessorReceipt.receiptHash,
      guardInstanceId: input.guardInstanceId,
      initializedCommit: input.initializedCommit,
      previousPolicyVersion: PROBE_V03_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V03_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      preserved: {
        ...PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownActualNanoUsd
      },
      knownCalls
    },
    predecessorReceipt
  );
  return Object.freeze({ predecessorReceipt, sourceReceipt });
}

function probeV03PolicyMigrationArguments(
  manifest: Awaited<ReturnType<typeof createProbeV03PolicyMigrationManifest>>,
  predecessor: ProbePolicyMigrationReceipt,
  migrationDigest: string
): string[] {
  return [
    manifest.version,
    manifest.migrationId,
    migrationDigest,
    manifest.priorAppCommit,
    manifest.priorActivationHash,
    manifest.predecessorMigrationId,
    manifest.predecessorMigrationReceiptHash,
    manifest.guardInstanceId,
    manifest.initializedCommit,
    manifest.previousPolicyVersion,
    manifest.previousPolicyHash,
    manifest.previousScriptHash,
    manifest.nextPolicyVersion,
    manifest.nextPolicyHash,
    manifest.nextScriptHash,
    String(manifest.globalCallLimit),
    String(manifest.lifetimeSpendCeilingNanoUsd),
    String(manifest.perCallReservationNanoUsd),
    PROBE_MODEL,
    String(PROBE_MAX_CONCURRENCY),
    String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
    String(manifest.previousPurposeLimits.calibration),
    String(manifest.previousPurposeLimits.baseline),
    String(manifest.previousPurposeLimits.repair),
    String(manifest.previousPurposeLimits.revised),
    String(manifest.previousPurposeLimits.judge),
    String(manifest.nextPurposeLimits.calibration),
    String(manifest.nextPurposeLimits.baseline),
    String(manifest.nextPurposeLimits.repair),
    String(manifest.nextPurposeLimits.revised),
    String(manifest.nextPurposeLimits.judge),
    String(manifest.preserved.claimedCalls),
    String(manifest.preserved.committedNanoUsd),
    String(manifest.preserved.knownCalls),
    String(manifest.preserved.knownActualNanoUsd),
    String(manifest.preserved.sequence),
    String(manifest.knownCalls.length),
    ...manifest.knownCalls.flatMap((call) => [
      String(call.ordinal),
      call.jti,
      String(call.dispatchSequence),
      String(call.actualNanoUsd),
      call.providerResponseHash,
      call.settlementDigest,
      call.usageHash
    ]),
    manifest.migrationCommit,
    predecessor.version,
    predecessor.migrationDigest,
    predecessor.priorAppCommit,
    predecessor.priorActivationHash,
    predecessor.priorEvidenceDigest,
    predecessor.previousPolicyVersion,
    predecessor.previousPolicyHash,
    predecessor.previousScriptHash,
    predecessor.nextPolicyVersion,
    predecessor.nextPolicyHash,
    predecessor.nextScriptHash,
    predecessor.migrationCommit,
    String(predecessor.migratedAtMs)
  ];
}

export async function readProbeV03PolicyMigrationReceipt(
  redis: ProbeRedisClient,
  input: {
    readonly expectedReceiptHash?: string;
    readonly expectedPredecessorReceiptHash?: string;
  } = {},
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeV03PolicyMigrationReceipt> {
  if (input.expectedReceiptHash !== undefined) {
    hash(input.expectedReceiptHash, "V03_MIGRATION_RECEIPT_HASH");
  }
  const predecessorReceipt = await readProbePolicyMigrationReceipt(
    redis,
    {
      expectedReceiptHash:
        input.expectedPredecessorReceiptHash ?? PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH
    },
    keyspace
  );
  const reply = parseReply(
    await redis.evalRo<[], unknown>(
      READ_POLICY_V03_MIGRATION_SCRIPT,
      [probeV03PolicyMigrationKey(keyspace)],
      []
    )
  );
  if (
    String(reply[1]) !== PROBE_V03_POLICY_MIGRATION_VERSION ||
    String(reply[2]) !== PROBE_V03_POLICY_MIGRATION_ID
  ) {
    throw new ProbeLedgerError("V03_MIGRATION_RECEIPT_IDENTITY_MISMATCH");
  }
  const knownCalls = Array.from({ length: 5 }, (_unused, ordinal) => {
    const offset = 19 + ordinal * 7;
    return {
      ordinal: replyInteger(reply, offset),
      jti: String(reply[offset + 1]),
      dispatchSequence: replyInteger(reply, offset + 2),
      actualNanoUsd: replyInteger(reply, offset + 3),
      providerResponseHash: String(reply[offset + 4]),
      settlementDigest: String(reply[offset + 5]),
      usageHash: String(reply[offset + 6])
    };
  });
  const sourceReceipt = await parseProbeV03PolicyMigrationSourceReceipt(
    {
      version: PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: String(reply[2]),
      priorAppCommit: String(reply[4]),
      priorActivationHash: String(reply[5]),
      predecessorMigrationId: String(reply[6]),
      predecessorMigrationReceiptHash: String(reply[7]),
      guardInstanceId: String(reply[8]),
      initializedCommit: String(reply[9]),
      previousPolicyVersion: String(reply[10]),
      previousPolicyHash: String(reply[11]),
      previousScriptHash: String(reply[12]),
      preserved: {
        ...PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownActualNanoUsd: replyInteger(reply, 16)
      },
      knownCalls
    },
    predecessorReceipt
  );
  const nextPolicyHash = await probePolicyHash();
  const nextScriptHash = await probeLedgerScriptHash();
  if (
    String(reply[13]) !== PROBE_POLICY_VERSION ||
    String(reply[14]) !== nextPolicyHash ||
    String(reply[15]) !== nextScriptHash
  ) {
    throw new ProbeLedgerError("V03_MIGRATION_NEXT_IDENTITY_MISMATCH");
  }
  const manifest = await createProbeV03PolicyMigrationManifest({
    sourceReceipt,
    predecessorReceipt,
    migrationCommit: String(reply[18]),
    nextPolicyHash,
    nextScriptHash
  });
  const receipt = await createProbeV03PolicyMigrationReceipt(
    manifest,
    hash(String(reply[3]), "V03_MIGRATION_DIGEST"),
    replyInteger(reply, 17)
  );
  if (
    input.expectedReceiptHash !== undefined &&
    receipt.receiptHash !== input.expectedReceiptHash
  ) {
    throw new ProbeLedgerError("V03_MIGRATION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export async function migrateProbeGuardPolicyV03(
  redis: ProbeRedisClient,
  input: MigrateProbeGuardPolicyV03Input,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeV03PolicyMigrationResult> {
  const sourceReceipt = await parseProbeV03PolicyMigrationSourceReceipt(
    input.sourceReceipt,
    input.predecessorReceipt
  );
  const nextPolicyHash = await probePolicyHash();
  const nextScriptHash = await probeLedgerScriptHash();
  const manifest = await createProbeV03PolicyMigrationManifest({
    sourceReceipt,
    predecessorReceipt: input.predecessorReceipt,
    migrationCommit: gitCommit(input.migrationCommit, "V03_MIGRATION_COMMIT"),
    nextPolicyHash,
    nextScriptHash
  });
  const migrationDigest = await probeV03PolicyMigrationDigest(manifest);
  const keys = [
    keyspace.config,
    keyspace.totals,
    keyspace.purposeLimits,
    keyspace.purposeCounts,
    keyspace.inflight,
    probePolicyMigrationKey(keyspace, manifest.predecessorMigrationId),
    probeV03PolicyMigrationKey(keyspace, manifest.migrationId),
    ...manifest.knownCalls.flatMap((call) => [
      authKey(keyspace, call.jti),
      providerResponseKey(keyspace, call.providerResponseHash)
    ])
  ];
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      MIGRATE_POLICY_V03_SCRIPT,
      keys,
      probeV03PolicyMigrationArguments(manifest, input.predecessorReceipt, migrationDigest)
    )
  );
  if (reply[1] !== "V03_MIGRATED_NEW" && reply[1] !== "V03_MIGRATED_EXISTING") {
    throw new ProbeLedgerError("AMBIGUOUS_V03_POLICY_MIGRATION");
  }
  const disposition = Number(reply[0]) === 1 ? "new" : "existing";
  const expectedReceipt = await createProbeV03PolicyMigrationReceipt(
    manifest,
    migrationDigest,
    replyInteger(reply, 2)
  );
  const receipt = await readProbeV03PolicyMigrationReceipt(
    redis,
    {
      expectedReceiptHash: expectedReceipt.receiptHash,
      expectedPredecessorReceiptHash: input.predecessorReceipt.receiptHash
    },
    keyspace
  );
  return Object.freeze({ disposition, receipt });
}

export async function initializeProbeGuard(
  redis: ProbeRedisClient,
  identity: ProbeGuardIdentity,
  initializedAtMs: number = Date.now(),
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<"INITIALIZED" | "ALREADY_INITIALIZED"> {
  opaque(identity.guardInstanceId, "GUARD_INSTANCE");
  hash(identity.policyHash, "POLICY_HASH");
  hash(identity.scriptHash, "SCRIPT_HASH");
  gitCommit(identity.initializedCommit);
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      INIT_SCRIPT,
      [
        keyspace.config,
        keyspace.totals,
        keyspace.purposeLimits,
        keyspace.purposeCounts,
        keyspace.inflight
      ],
      [
        identity.guardInstanceId,
        identity.policyHash,
        identity.scriptHash,
        String(PROBE_GLOBAL_CALL_LIMIT),
        String(PROBE_LIFETIME_SPEND_CEILING_NANO_USD),
        String(PROBE_PER_CALL_RESERVATION_NANO_USD),
        String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
        PROBE_POLICY_VERSION,
        PROBE_MODEL,
        String(PROBE_MAX_CONCURRENCY),
        String(initializedAtMs),
        String(PROBE_PURPOSE_CALL_LIMITS.calibration),
        String(PROBE_PURPOSE_CALL_LIMITS.baseline),
        String(PROBE_PURPOSE_CALL_LIMITS.repair),
        String(PROBE_PURPOSE_CALL_LIMITS.revised),
        String(PROBE_PURPOSE_CALL_LIMITS.judge),
        identity.initializedCommit
      ]
    )
  );
  return Number(reply[0]) === 1 ? "INITIALIZED" : "ALREADY_INITIALIZED";
}

export async function issueProbeAuthorization(
  redis: ProbeRedisClient,
  input: IssueAuthorizationInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly disposition: "new" | "existing";
  readonly issuedAt: number;
  readonly expiresAt: number;
}> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  opaque(input.jti, "JTI");
  hash(input.policyHash, "POLICY_HASH");
  hash(input.scriptHash, "SCRIPT_HASH");
  gitCommit(input.initializedCommit);
  hash(input.claimsHash, "CLAIMS_HASH");
  hash(input.subjectHash, "SUBJECT_HASH");
  hash(input.actorHash, "ACTOR_HASH");
  const admission = runAdmissionBinding(input.runAdmission, keyspace.config);
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      ISSUE_SCRIPT,
      [
        keyspace.config,
        subjectKey(keyspace, input.subjectHash),
        authKey(keyspace, input.jti),
        issueRateKey(keyspace, input.purpose, input.actorHash),
        ...admission.keys
      ],
      [
        input.guardInstanceId,
        input.policyHash,
        input.scriptHash,
        input.jti,
        input.claimsHash,
        input.purpose,
        input.subjectHash,
        input.actorHash,
        String(PROBE_TOKEN_TTL_SECONDS),
        String(PROBE_ISSUE_RATE_WINDOW_SECONDS),
        String(PROBE_PURPOSE_CALL_LIMITS[input.purpose]),
        input.initializedCommit,
        ...admission.arguments
      ]
    )
  );
  return {
    disposition: Number(reply[0]) === 1 ? "new" : "existing",
    issuedAt: replyInteger(reply, 3),
    expiresAt: replyInteger(reply, 4)
  };
}

export async function beginProbeCall(
  redis: ProbeRedisClient,
  input: BeginCallInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly sequence: number;
  readonly claimedCalls: number;
  readonly committedNanoUsd: number;
  readonly leaseExpiresAt: number;
}> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  opaque(input.jti, "JTI");
  hash(input.policyHash, "POLICY_HASH");
  hash(input.scriptHash, "SCRIPT_HASH");
  gitCommit(input.initializedCommit);
  hash(input.claimsHash, "CLAIMS_HASH");
  const admission = runAdmissionBinding(input.runAdmission, keyspace.config);
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      BEGIN_SCRIPT,
      [
        keyspace.config,
        keyspace.totals,
        keyspace.purposeLimits,
        keyspace.purposeCounts,
        keyspace.inflight,
        authKey(keyspace, input.jti),
        ...admission.keys
      ],
      [
        input.guardInstanceId,
        input.policyHash,
        input.scriptHash,
        input.claimsHash,
        input.purpose,
        String(PROBE_INFLIGHT_LEASE_SECONDS),
        input.jti,
        String(PROBE_GLOBAL_CALL_LIMIT),
        String(PROBE_LIFETIME_SPEND_CEILING_NANO_USD),
        String(PROBE_PER_CALL_RESERVATION_NANO_USD),
        String(PROBE_MAX_CONCURRENCY),
        PROBE_POLICY_VERSION,
        PROBE_MODEL,
        String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
        String(PROBE_PURPOSE_CALL_LIMITS.calibration),
        String(PROBE_PURPOSE_CALL_LIMITS.baseline),
        String(PROBE_PURPOSE_CALL_LIMITS.repair),
        String(PROBE_PURPOSE_CALL_LIMITS.revised),
        String(PROBE_PURPOSE_CALL_LIMITS.judge),
        input.initializedCommit,
        ...admission.arguments
      ]
    )
  );
  if (reply[1] !== "GRANTED_NEW") throw new ProbeLedgerError("AMBIGUOUS_GRANT");
  return {
    sequence: replyInteger(reply, 2),
    claimedCalls: replyInteger(reply, 3),
    committedNanoUsd: replyInteger(reply, 4),
    leaseExpiresAt: replyInteger(reply, 5)
  };
}

export async function settleProbeCallKnown(
  redis: ProbeRedisClient,
  input: KnownSettlementInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{ readonly disposition: "new" | "existing"; readonly actualNanoUsd: number }> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  opaque(input.jti, "JTI");
  hash(input.policyHash, "POLICY_HASH");
  hash(input.scriptHash, "SCRIPT_HASH");
  gitCommit(input.initializedCommit);
  hash(input.providerResponseHash, "PROVIDER_RESPONSE_HASH");
  hash(input.settlementDigest, "SETTLEMENT_DIGEST");
  hash(input.usageHash, "USAGE_HASH");
  integer(input.actualNanoUsd, "ACTUAL_COST");
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      SETTLE_KNOWN_SCRIPT,
      [
        keyspace.config,
        keyspace.totals,
        keyspace.inflight,
        authKey(keyspace, input.jti),
        providerResponseKey(keyspace, input.providerResponseHash)
      ],
      [
        input.guardInstanceId,
        input.policyHash,
        input.scriptHash,
        String(input.actualNanoUsd),
        input.providerResponseHash,
        input.settlementDigest,
        input.usageHash,
        String(input.settledAtMs ?? Date.now()),
        input.initializedCommit
      ]
    )
  );
  return {
    disposition: Number(reply[0]) === 1 ? "new" : "existing",
    actualNanoUsd: replyInteger(reply, 2)
  };
}

export async function settleProbeCallUncertain(
  redis: ProbeRedisClient,
  input: UncertainSettlementInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{ readonly disposition: "new" | "existing"; readonly upperBoundNanoUsd: number }> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  opaque(input.jti, "JTI");
  hash(input.policyHash, "POLICY_HASH");
  hash(input.scriptHash, "SCRIPT_HASH");
  gitCommit(input.initializedCommit);
  hash(input.settlementDigest, "SETTLEMENT_DIGEST");
  if (!/^[a-z0-9_]{3,64}$/u.test(input.reason)) throw new ProbeLedgerError("INVALID_REASON");
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      SETTLE_UNCERTAIN_SCRIPT,
      [keyspace.config, keyspace.totals, keyspace.inflight, authKey(keyspace, input.jti)],
      [
        input.guardInstanceId,
        input.policyHash,
        input.scriptHash,
        input.jti,
        input.settlementDigest,
        input.reason,
        String(input.settledAtMs ?? Date.now()),
        input.initializedCommit
      ]
    )
  );
  return {
    disposition: Number(reply[0]) === 1 ? "new" : "existing",
    upperBoundNanoUsd: replyInteger(reply, 2)
  };
}

export async function reapExpiredProbeCall(
  redis: ProbeRedisClient,
  input: ReapProbeCallInput,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{ readonly disposition: "new" | "existing"; readonly upperBoundNanoUsd?: number }> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  opaque(input.jti, "JTI");
  hash(input.policyHash, "POLICY_HASH");
  hash(input.scriptHash, "SCRIPT_HASH");
  gitCommit(input.initializedCommit);
  hash(input.settlementDigest, "SETTLEMENT_DIGEST");
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      REAP_SCRIPT,
      [keyspace.config, keyspace.totals, keyspace.inflight, authKey(keyspace, input.jti)],
      [
        input.guardInstanceId,
        input.policyHash,
        input.scriptHash,
        input.jti,
        input.settlementDigest,
        input.initializedCommit
      ]
    )
  );
  return Number(reply[0]) === 1
    ? { disposition: "new", upperBoundNanoUsd: replyInteger(reply, 2) }
    : { disposition: "existing" };
}

export async function readProbeGuardStatus(
  redis: ProbeRedisClient,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeGuardStatus> {
  const reply = parseReply(
    await redis.evalRo<[], unknown>(
      STATUS_SCRIPT,
      [
        keyspace.config,
        keyspace.totals,
        keyspace.purposeLimits,
        keyspace.purposeCounts,
        keyspace.inflight
      ],
      []
    )
  );
  const status = String(reply[1]);
  if (status !== "open" && status !== "quarantined" && status !== "halted") {
    throw new ProbeLedgerError("INVALID_GUARD_STATUS");
  }
  return {
    status,
    guardInstanceId: String(reply[2]),
    policyHash: String(reply[3]),
    scriptHash: String(reply[4]),
    claimedCalls: replyInteger(reply, 5),
    committedNanoUsd: replyInteger(reply, 6),
    pendingCount: replyInteger(reply, 7),
    knownCount: replyInteger(reply, 8),
    uncertainCount: replyInteger(reply, 9),
    knownActualNanoUsd: replyInteger(reply, 10),
    uncertainUpperNanoUsd: replyInteger(reply, 11),
    policyVersion: String(reply[12]),
    model: String(reply[13]),
    globalCallLimit: replyInteger(reply, 14),
    spendCeilingNanoUsd: replyInteger(reply, 15),
    perCallReservationNanoUsd: replyInteger(reply, 16),
    maxConcurrency: replyInteger(reply, 17),
    challengeClosesAtMs: replyInteger(reply, 18),
    initializedCommit: String(reply[19]),
    purposeLimits: {
      calibration: replyInteger(reply, 20),
      baseline: replyInteger(reply, 21),
      repair: replyInteger(reply, 22),
      revised: replyInteger(reply, 23),
      judge: replyInteger(reply, 24)
    },
    purposeCounts: {
      calibration: replyInteger(reply, 25),
      baseline: replyInteger(reply, 26),
      repair: replyInteger(reply, 27),
      revised: replyInteger(reply, 28),
      judge: replyInteger(reply, 29)
    },
    inflightCount: replyInteger(reply, 30),
    sequence: replyInteger(reply, 31),
    haltMarkerPresent: replyInteger(reply, 32) === 1,
    uncertainMarkerPresent: replyInteger(reply, 33) === 1
  };
}
