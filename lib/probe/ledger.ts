import "server-only";

import { Redis } from "@upstash/redis";

import { canonicalSha256 } from "@/lib/evidence/digest";
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
local closes_ms = tonumber(redis.call("HGET", KEYS[1], "challenge_closes_at_ms") or "0")
if now_seconds * 1000 >= closes_ms then return {0, "CHALLENGE_CLOSED"} end

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
if now_seconds * 1000 >= tonumber(ARGV[14]) then return {0, "CHALLENGE_CLOSED"} end
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
  status: STATUS_SCRIPT
});

export type ProbeRedisClient = Pick<Redis, "eval" | "evalRo">;

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

export interface IssueAuthorizationInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly claimsHash: string;
  readonly purpose: ProbePurpose;
  readonly subjectHash: string;
  readonly actorHash: string;
}

export interface BeginCallInput extends ProbeGuardIdentity {
  readonly jti: string;
  readonly claimsHash: string;
  readonly purpose: ProbePurpose;
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

function gitCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new ProbeLedgerError("INVALID_INITIALIZED_COMMIT");
  return value;
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

function authKey(keyspace: ProbeLedgerKeyspace, jti: string): string {
  return `${keyspace.namespace}:auth:${jti}`;
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

export function createProbeRedis(environment: NodeJS.ProcessEnv = process.env): Redis {
  const url = environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL;
  const token = environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN;
  if (!url || !token) throw new ProbeLedgerError("MISSING_DURABLE_STORE");
  return new Redis({ url, token, enableTelemetry: false, readYourWrites: true });
}

export function probeLedgerScriptHash(): Promise<string> {
  return canonicalSha256(PROBE_LEDGER_SCRIPTS);
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
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      ISSUE_SCRIPT,
      [
        keyspace.config,
        subjectKey(keyspace, input.subjectHash),
        authKey(keyspace, input.jti),
        issueRateKey(keyspace, input.purpose, input.actorHash)
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
        input.initializedCommit
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
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      BEGIN_SCRIPT,
      [
        keyspace.config,
        keyspace.totals,
        keyspace.purposeLimits,
        keyspace.purposeCounts,
        keyspace.inflight,
        authKey(keyspace, input.jti)
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
        input.initializedCommit
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
