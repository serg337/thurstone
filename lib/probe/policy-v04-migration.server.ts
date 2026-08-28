import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH as PROBE_V01_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH as PROBE_V01_POLICY_HASH,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH as PROBE_V00_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH as PROBE_V00_POLICY_HASH,
  type ProbePolicyMigrationKnownCall
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH,
  PROBE_V03_POLICY_MIGRATION_VERSION,
  type ProbeV03PolicyMigrationReceipt
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_MIGRATED_POLICY_HASH,
  PROBE_V04_MIGRATED_POLICY_VERSION,
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  PROBE_V04_PREDECESSOR_MIGRATION_ID,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V04_PREVIOUS_POLICY_HASH,
  PROBE_V04_PREVIOUS_POLICY_VERSION,
  PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
  createProbeV04PolicyMigrationManifest,
  createProbeV04PolicyMigrationReceipt,
  isProbeV04PolicyMigrationSourceStatus,
  parseProbeV04PolicyMigrationSourceReceipt,
  probeV04PolicyMigrationDigest,
  type ProbeV04PolicyMigrationReceipt,
  type ProbeV04PolicyMigrationResult,
  type ProbeV04PolicyMigrationSourceReceipt
} from "@/lib/probe/policy-v04-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD
} from "@/lib/probe/policy";
import {
  PRODUCTION_PROBE_KEYSPACE,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  readProbeV03PolicyMigrationReceipt,
  type ProbeLedgerKeyspace,
  type ProbeRedisClient,
  type ProbeRedisDiscoveryClient
} from "@/lib/probe/ledger";

/**
 * Dormant v0.3 -> v0.4 transition. It is intentionally not part of any operator CLI,
 * build hook, route, or activation path until the separately reserved live-migration gate.
 */
const MIGRATE_POLICY_V04_SCRIPT = `
local predecessor_exists = redis.call("EXISTS", KEYS[6])
local receipt_exists = redis.call("EXISTS", KEYS[7])

local function core_state_matches()
  local inflight_ttl = redis.call("PTTL", KEYS[5])
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("PTTL", KEYS[2]) ~= -1
    or redis.call("PTTL", KEYS[3]) ~= -1
    or redis.call("PTTL", KEYS[4]) ~= -1
    or (inflight_ttl ~= -1 and inflight_ttl ~= -2)
    or redis.call("HGET", KEYS[1], "schema_version") ~= "1"
    or redis.call("HGET", KEYS[1], "status") ~= "open"
    or redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[1], "initialized_commit") ~= ARGV[9]
    or redis.call("HGET", KEYS[1], "global_call_limit") ~= ARGV[18]
    or redis.call("HGET", KEYS[1], "spend_ceiling_nusd") ~= ARGV[19]
    or redis.call("HGET", KEYS[1], "per_call_reservation_nusd") ~= ARGV[20]
    or redis.call("HGET", KEYS[1], "model") ~= ARGV[21]
    or redis.call("HGET", KEYS[1], "max_concurrency") ~= ARGV[22]
    or redis.call("HGET", KEYS[1], "challenge_closes_at_ms") ~= ARGV[23]
    or redis.call("HEXISTS", KEYS[1], "halt_reason") == 1
    or redis.call("HEXISTS", KEYS[1], "uncertain_jti") == 1
    or redis.call("HGET", KEYS[2], "claimed_calls") ~= ARGV[34]
    or redis.call("HGET", KEYS[2], "committed_nusd") ~= ARGV[35]
    or redis.call("HGET", KEYS[2], "pending_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_count") ~= ARGV[36]
    or redis.call("HGET", KEYS[2], "uncertain_count") ~= "0"
    or redis.call("HGET", KEYS[2], "known_actual_nusd") ~= ARGV[37]
    or redis.call("HGET", KEYS[2], "uncertain_upper_nusd") ~= "0"
    or redis.call("HGET", KEYS[2], "sequence") ~= ARGV[38]
    or redis.call("HGET", KEYS[4], "calibration") ~= ARGV[34]
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
    or redis.call("HGET", KEYS[6], "version") ~= ARGV[104]
    or redis.call("HGET", KEYS[6], "migration_id") ~= ARGV[6]
    or redis.call("HGET", KEYS[6], "migration_digest") ~= ARGV[105]
    or redis.call("HGET", KEYS[6], "prior_app_commit") ~= ARGV[106]
    or redis.call("HGET", KEYS[6], "prior_activation_hash") ~= ARGV[107]
    or redis.call("HGET", KEYS[6], "predecessor_migration_id") ~= ARGV[108]
    or redis.call("HGET", KEYS[6], "predecessor_receipt_hash") ~= ARGV[109]
    or redis.call("HGET", KEYS[6], "guard_instance_id") ~= ARGV[8]
    or redis.call("HGET", KEYS[6], "initialized_commit") ~= ARGV[9]
    or redis.call("HGET", KEYS[6], "previous_policy_version") ~= ARGV[110]
    or redis.call("HGET", KEYS[6], "previous_policy_hash") ~= ARGV[111]
    or redis.call("HGET", KEYS[6], "previous_script_hash") ~= ARGV[112]
    or redis.call("HGET", KEYS[6], "next_policy_version") ~= ARGV[113]
    or redis.call("HGET", KEYS[6], "next_policy_hash") ~= ARGV[114]
    or redis.call("HGET", KEYS[6], "next_script_hash") ~= ARGV[115]
    or redis.call("HGET", KEYS[6], "migration_commit") ~= ARGV[116]
    or redis.call("HGET", KEYS[6], "migrated_at_ms") ~= ARGV[117]
    or redis.call("HGET", KEYS[6], "known_actual_nusd") ~= ARGV[118]
  then
    return false
  end
  for ordinal = 0, 4 do
    local arg_base = 119 + ordinal * 7
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
  if tonumber(ARGV[39]) ~= 9 then return false end
  local seen_jti = {}
  local seen_response = {}
  local actual_sum = 0
  for ordinal = 0, 8 do
    local arg_base = 40 + ordinal * 7
    local jti = ARGV[arg_base + 1]
    local dispatch_sequence = ARGV[arg_base + 2]
    local actual_nusd = ARGV[arg_base + 3]
    local provider_hash = ARGV[arg_base + 4]
    local auth_key = KEYS[8 + ordinal * 2]
    local provider_key = KEYS[9 + ordinal * 2]
    local expected_policy_hash = ARGV[154]
    local expected_script_hash = ARGV[155]
    if ordinal == 4 then
      expected_policy_hash = ARGV[156]
      expected_script_hash = ARGV[157]
    elseif ordinal >= 5 then
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
      or redis.call("HGET", auth_key, "reservation_nusd") ~= ARGV[20]
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
  return actual_sum == tonumber(ARGV[37])
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
    or redis.call("HGET", KEYS[7], "previous_runner_hash") ~= ARGV[13]
    or redis.call("HGET", KEYS[7], "next_policy_version") ~= ARGV[14]
    or redis.call("HGET", KEYS[7], "next_policy_hash") ~= ARGV[15]
    or redis.call("HGET", KEYS[7], "next_script_hash") ~= ARGV[16]
    or redis.call("HGET", KEYS[7], "next_runner_hash") ~= ARGV[17]
    or redis.call("HGET", KEYS[7], "known_actual_nusd") ~= ARGV[37]
    or redis.call("HGET", KEYS[7], "migration_commit") ~= ARGV[103]
    or redis.call("HGET", KEYS[7], "migration_program_hash") ~= ARGV[158]
    or redis.call("HGET", KEYS[7], "prior_evidence_raw_sha256") ~= ARGV[159]
    or redis.call("HGET", KEYS[7], "prior_evidence_digest") ~= ARGV[160]
  then
    return false
  end
  for ordinal = 0, 8 do
    local arg_base = 40 + ordinal * 7
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
  if not receipt_matches() then return {0, "V04_MIGRATION_RECEIPT_CONFLICT"} end
  if not core_state_matches()
    or not config_matches(ARGV[14], ARGV[15], ARGV[16], ARGV[29], ARGV[30], ARGV[31],
      ARGV[32], ARGV[33])
    or not predecessor_matches()
    or not calls_match()
  then
    return {0, "V04_MIGRATION_REPLAY_STATE_MISMATCH"}
  end
  return {2, "V04_MIGRATED_EXISTING", redis.call("HGET", KEYS[7], "migrated_at_ms")}
end

if not core_state_matches() then return {0, "V04_MIGRATION_STATE_MISMATCH"} end
if not config_matches(ARGV[10], ARGV[11], ARGV[12], ARGV[24], ARGV[25], ARGV[26],
  ARGV[27], ARGV[28])
then
  return {0, "V04_MIGRATION_OLD_CONFIG_MISMATCH"}
end
if not predecessor_matches() then return {0, "V04_PREDECESSOR_RECEIPT_MISMATCH"} end
if not calls_match() then return {0, "V04_MIGRATION_KNOWN_CALL_MISMATCH"} end
local now = redis.call("TIME")
local migrated_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if migrated_at_ms >= tonumber(ARGV[23]) then return {0, "CHALLENGE_CLOSED"} end

redis.call("HSET", KEYS[1],
  "policy_version", ARGV[14],
  "policy_hash", ARGV[15],
  "script_hash", ARGV[16]
)
redis.call("HSET", KEYS[3], "calibration", ARGV[29], "judge", ARGV[33])
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
  "previous_runner_hash", ARGV[13],
  "next_policy_version", ARGV[14],
  "next_policy_hash", ARGV[15],
  "next_script_hash", ARGV[16],
  "next_runner_hash", ARGV[17],
  "known_actual_nusd", ARGV[37],
  "migration_commit", ARGV[103],
  "migration_program_hash", ARGV[158],
  "prior_evidence_raw_sha256", ARGV[159],
  "prior_evidence_digest", ARGV[160],
  "migrated_at_ms", migrated_at_ms
)
for ordinal = 0, 8 do
  local arg_base = 40 + ordinal * 7
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
return {1, "V04_MIGRATED_NEW", migrated_at_ms}
`;

const READ_POLICY_V04_MIGRATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_V04_MIGRATION_RECEIPT"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "V04_MIGRATION_RECEIPT_EXPIRES"} end
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
  redis.call("HGET", KEYS[1], "previous_runner_hash"),
  redis.call("HGET", KEYS[1], "next_policy_version"),
  redis.call("HGET", KEYS[1], "next_policy_hash"),
  redis.call("HGET", KEYS[1], "next_script_hash"),
  redis.call("HGET", KEYS[1], "next_runner_hash"),
  redis.call("HGET", KEYS[1], "known_actual_nusd"),
  redis.call("HGET", KEYS[1], "migrated_at_ms"),
  redis.call("HGET", KEYS[1], "migration_commit"),
  redis.call("HGET", KEYS[1], "migration_program_hash")}
for ordinal = 0, 8 do
  local prefix = "call_" .. tostring(ordinal) .. "_"
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "ordinal"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "jti"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "dispatch_sequence"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "actual_nusd"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "provider_response_hash"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "settlement_digest"))
  table.insert(values, redis.call("HGET", KEYS[1], prefix .. "usage_hash"))
end
table.insert(values, redis.call("HGET", KEYS[1], "prior_evidence_raw_sha256"))
table.insert(values, redis.call("HGET", KEYS[1], "prior_evidence_digest"))
return values
`;

export const PROBE_V04_POLICY_MIGRATION_SCRIPTS = Object.freeze({
  migrate: MIGRATE_POLICY_V04_SCRIPT,
  read: READ_POLICY_V04_MIGRATION_SCRIPT
});
export const PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH =
  "63b192b247399e710334caaed8766f78dd1c9fd73cf65f148d8e81d63a62cf59";

export function probeV04PolicyMigrationProgramHash(): Promise<string> {
  return canonicalSha256(PROBE_V04_POLICY_MIGRATION_SCRIPTS);
}

async function assertFrozenMigrationProgram(): Promise<string> {
  const actual = await probeV04PolicyMigrationProgramHash();
  if (actual !== PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH) {
    throw new Error("V04_MIGRATION_PROGRAM_DRIFT");
  }
  return actual;
}

export interface MigrateProbeGuardPolicyV04Input {
  readonly sourceReceipt: ProbeV04PolicyMigrationSourceReceipt;
  readonly predecessorReceipt: ProbeV03PolicyMigrationReceipt;
  readonly migrationCommit: string;
}

function opaque(value: string, field: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(value)) throw new Error(`INVALID_${field}`);
  return value;
}

function hash(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`INVALID_${field}`);
  return value;
}

function gitCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("INVALID_GIT_COMMIT");
  return value;
}

function durableInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`INVALID_${field}`);
  return parsed;
}

function parseReply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("INVALID_REDIS_REPLY");
  if (Number(value[0]) === 0) throw new Error(String(value[1]));
  return value;
}

function migrationKey(keyspace: ProbeLedgerKeyspace, migrationId: string): string {
  return `${keyspace.namespace}:policy-migration:${opaque(migrationId, "MIGRATION_ID")}`;
}

function authKey(keyspace: ProbeLedgerKeyspace, jti: string): string {
  return `${keyspace.namespace}:auth:${opaque(jti, "JTI")}`;
}

function providerKey(keyspace: ProbeLedgerKeyspace, responseHash: string): string {
  return `${keyspace.namespace}:provider:${hash(responseHash, "PROVIDER_RESPONSE_HASH")}`;
}

function historicalIdentity(ordinal: number): { policyHash: string; scriptHash: string } {
  if (ordinal < 4) {
    return { policyHash: PROBE_V00_POLICY_HASH, scriptHash: PROBE_V00_LEDGER_SCRIPT_HASH };
  }
  if (ordinal === 4) {
    return { policyHash: PROBE_V01_POLICY_HASH, scriptHash: PROBE_V01_LEDGER_SCRIPT_HASH };
  }
  return {
    policyHash: PROBE_V03_MIGRATED_POLICY_HASH,
    scriptHash: PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH
  };
}

export function buildProbeV04PolicyMigrationArguments(
  manifest: Awaited<ReturnType<typeof createProbeV04PolicyMigrationManifest>>,
  predecessor: ProbeV03PolicyMigrationReceipt,
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
    manifest.previousRunnerHash,
    manifest.nextPolicyVersion,
    manifest.nextPolicyHash,
    manifest.nextScriptHash,
    manifest.nextRunnerHash,
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
    predecessor.predecessorMigrationId,
    predecessor.predecessorMigrationReceiptHash,
    predecessor.previousPolicyVersion,
    predecessor.previousPolicyHash,
    predecessor.previousScriptHash,
    predecessor.nextPolicyVersion,
    predecessor.nextPolicyHash,
    predecessor.nextScriptHash,
    predecessor.migrationCommit,
    String(predecessor.migratedAtMs),
    String(predecessor.preserved.knownActualNanoUsd),
    ...predecessor.knownCalls.flatMap((call) => [
      String(call.ordinal),
      call.jti,
      String(call.dispatchSequence),
      String(call.actualNanoUsd),
      call.providerResponseHash,
      call.settlementDigest,
      call.usageHash
    ]),
    PROBE_V00_POLICY_HASH,
    PROBE_V00_LEDGER_SCRIPT_HASH,
    PROBE_V01_POLICY_HASH,
    PROBE_V01_LEDGER_SCRIPT_HASH,
    manifest.migrationProgramHash,
    manifest.priorEvidenceRawSha256,
    manifest.priorEvidenceDigest
  ];
}

export async function discoverProbeV04PolicyMigrationSource(
  redis: ProbeRedisDiscoveryClient,
  input: { readonly guardInstanceId: string; readonly initializedCommit: string },
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly predecessorReceipt: ProbeV03PolicyMigrationReceipt;
  readonly sourceReceipt: ProbeV04PolicyMigrationSourceReceipt;
}> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  gitCommit(input.initializedCommit);
  const predecessorReceipt = await readProbeV03PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH },
    keyspace
  );
  if (
    predecessorReceipt.guardInstanceId !== input.guardInstanceId ||
    predecessorReceipt.initializedCommit !== input.initializedCommit
  ) {
    throw new Error("V04_PREDECESSOR_IDENTITY_MISMATCH");
  }
  const status = await readProbeGuardStatus(redis, keyspace);
  if (
    !isProbeV04PolicyMigrationSourceStatus(status, {
      guardInstanceId: input.guardInstanceId,
      initializedCommit: input.initializedCommit,
      knownActualNanoUsd: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd
    })
  ) {
    throw new Error("V04_MIGRATION_SOURCE_STATUS_MISMATCH");
  }

  const scanExact = async (pattern: string): Promise<Set<string>> => {
    const keys = new Set<string>();
    let cursor = "0";
    for (let page = 0; page < 32; page += 1) {
      const [nextCursor, pageKeys] = await redis.scan(cursor, { match: pattern, count: 100 });
      for (const key of pageKeys) keys.add(key);
      if (keys.size > 1_024) throw new Error("V04_DISCOVERY_KEY_LIMIT");
      cursor = nextCursor;
      if (cursor === "0") return keys;
    }
    throw new Error("V04_DISCOVERY_PAGE_LIMIT");
  };
  const authKeys = await scanExact(`${keyspace.namespace}:auth:*`);
  const providerKeys = await scanExact(`${keyspace.namespace}:provider:*`);
  const calls = new Map<number, ProbePolicyMigrationKnownCall>();
  for (const key of authKeys) {
    const auth = await redis.hgetall<Record<string, unknown>>(key);
    if (!auth || String(auth.state ?? "") !== "KNOWN") {
      throw new Error("V04_DISCOVERY_ORPHAN_AUTH_RECORD");
    }
    const dispatchSequence = durableInteger(auth.dispatch_sequence, "V04_DISCOVERY_SEQUENCE");
    if (dispatchSequence < 1 || dispatchSequence > 9 || calls.has(dispatchSequence)) {
      throw new Error("V04_DISCOVERY_ORPHAN_KNOWN_CALL");
    }
    const ordinal = dispatchSequence - 1;
    const jti = opaque(String(auth.jti ?? ""), "V04_DISCOVERY_JTI");
    const providerResponseHash = hash(
      String(auth.provider_response_hash ?? ""),
      "V04_DISCOVERY_PROVIDER_RESPONSE_HASH"
    );
    const call = Object.freeze({
      ordinal,
      jti,
      dispatchSequence,
      actualNanoUsd: durableInteger(auth.actual_nusd, "V04_DISCOVERY_ACTUAL_COST"),
      providerResponseHash,
      settlementDigest: hash(
        String(auth.settlement_digest ?? ""),
        "V04_DISCOVERY_SETTLEMENT_DIGEST"
      ),
      usageHash: hash(String(auth.usage_hash ?? ""), "V04_DISCOVERY_USAGE_HASH")
    });
    const identity = historicalIdentity(ordinal);
    if (
      key !== authKey(keyspace, jti) ||
      String(auth.purpose ?? "") !== "calibration" ||
      String(auth.guard_instance_id ?? "") !== input.guardInstanceId ||
      String(auth.policy_hash ?? "") !== identity.policyHash ||
      String(auth.script_hash ?? "") !== identity.scriptHash ||
      durableInteger(auth.reservation_nusd, "V04_DISCOVERY_RESERVATION") !==
        PROBE_PER_CALL_RESERVATION_NANO_USD ||
      call.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD ||
      durableInteger(auth.settled_at_ms, "V04_DISCOVERY_SETTLED_AT") < 0 ||
      (await redis.pttl(key)) !== -1 ||
      (await redis.pttl(providerKey(keyspace, providerResponseHash))) !== -1 ||
      (await redis.get(providerKey(keyspace, providerResponseHash))) !== jti ||
      (ordinal < 5 && canonicalJson(call) !== canonicalJson(predecessorReceipt.knownCalls[ordinal]))
    ) {
      throw new Error("V04_DISCOVERY_RECORD_MISMATCH");
    }
    calls.set(dispatchSequence, call);
  }
  if (
    authKeys.size !== 9 ||
    calls.size !== 9 ||
    Array.from({ length: 9 }, (_unused, index) => calls.has(index + 1)).some((present) => !present)
  ) {
    throw new Error("V04_DISCOVERY_KNOWN_SET_MISMATCH");
  }
  const knownCalls = Object.freeze(
    Array.from({ length: 9 }, (_unused, index) => calls.get(index + 1)!)
  );
  const expectedProviderKeys = new Set(
    knownCalls.map((call) => providerKey(keyspace, call.providerResponseHash))
  );
  if (
    providerKeys.size !== expectedProviderKeys.size ||
    [...providerKeys].some((key) => !expectedProviderKeys.has(key))
  ) {
    throw new Error("V04_DISCOVERY_ORPHAN_PROVIDER_RECORD");
  }
  if (
    knownCalls.reduce((sum, call) => sum + call.actualNanoUsd, 0) !==
    PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd
  ) {
    throw new Error("V04_DISCOVERY_COST_MISMATCH");
  }
  const sourceReceipt = await parseProbeV04PolicyMigrationSourceReceipt(
    {
      version: PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V04_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
      priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
      predecessorMigrationId: PROBE_V04_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: predecessorReceipt.receiptHash,
      guardInstanceId: input.guardInstanceId,
      initializedCommit: input.initializedCommit,
      previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
      preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
      knownCalls
    },
    predecessorReceipt
  );
  return Object.freeze({ predecessorReceipt, sourceReceipt });
}

export async function readProbeV04PolicyMigrationReceipt(
  redis: ProbeRedisClient,
  input: { readonly expectedReceiptHash?: string } = {},
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeV04PolicyMigrationReceipt> {
  if (input.expectedReceiptHash !== undefined) {
    hash(input.expectedReceiptHash, "V04_MIGRATION_RECEIPT_HASH");
  }
  const predecessorReceipt = await readProbeV03PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH },
    keyspace
  );
  const expectedMigrationProgramHash = await assertFrozenMigrationProgram();
  const reply = parseReply(
    await redis.evalRo<[], unknown>(
      READ_POLICY_V04_MIGRATION_SCRIPT,
      [migrationKey(keyspace, PROBE_V04_POLICY_MIGRATION_ID)],
      []
    )
  );
  if (
    String(reply[1]) !== PROBE_V04_POLICY_MIGRATION_VERSION ||
    String(reply[2]) !== PROBE_V04_POLICY_MIGRATION_ID
  ) {
    throw new Error("V04_MIGRATION_RECEIPT_IDENTITY_MISMATCH");
  }
  const knownCalls = Array.from({ length: 9 }, (_unused, ordinal) => {
    const offset = 22 + ordinal * 7;
    return {
      ordinal: durableInteger(reply[offset], "V04_RECEIPT_ORDINAL"),
      jti: String(reply[offset + 1]),
      dispatchSequence: durableInteger(reply[offset + 2], "V04_RECEIPT_SEQUENCE"),
      actualNanoUsd: durableInteger(reply[offset + 3], "V04_RECEIPT_COST"),
      providerResponseHash: String(reply[offset + 4]),
      settlementDigest: String(reply[offset + 5]),
      usageHash: String(reply[offset + 6])
    };
  });
  const sourceReceipt = await parseProbeV04PolicyMigrationSourceReceipt(
    {
      version: PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: String(reply[2]),
      priorAppCommit: String(reply[4]),
      priorActivationHash: String(reply[5]),
      priorEvidenceRawSha256: String(reply[85]),
      priorEvidenceDigest: String(reply[86]),
      predecessorMigrationId: String(reply[6]),
      predecessorMigrationReceiptHash: String(reply[7]),
      guardInstanceId: String(reply[8]),
      initializedCommit: String(reply[9]),
      previousPolicyVersion: String(reply[10]),
      previousPolicyHash: String(reply[11]),
      previousScriptHash: String(reply[12]),
      previousRunnerHash: String(reply[13]),
      preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
      knownCalls
    },
    predecessorReceipt
  );
  const manifest = await createProbeV04PolicyMigrationManifest({
    sourceReceipt,
    predecessorReceipt,
    migrationCommit: String(reply[20]),
    nextPolicyHash: String(reply[15]),
    nextScriptHash: String(reply[16]),
    nextRunnerHash: String(reply[17]),
    migrationProgramHash: String(reply[21])
  });
  if (
    String(reply[14]) !== PROBE_V04_MIGRATED_POLICY_VERSION ||
    manifest.nextRunnerHash !== PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH ||
    manifest.migrationProgramHash !== expectedMigrationProgramHash
  ) {
    throw new Error("V04_MIGRATION_NEXT_IDENTITY_MISMATCH");
  }
  const receipt = await createProbeV04PolicyMigrationReceipt(
    manifest,
    hash(String(reply[3]), "V04_MIGRATION_DIGEST"),
    durableInteger(reply[19], "V04_MIGRATED_AT")
  );
  if (
    input.expectedReceiptHash !== undefined &&
    receipt.receiptHash !== input.expectedReceiptHash
  ) {
    throw new Error("V04_MIGRATION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export async function migrateProbeGuardPolicyV04(
  redis: ProbeRedisClient,
  input: MigrateProbeGuardPolicyV04Input,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeV04PolicyMigrationResult> {
  const sourceReceipt = await parseProbeV04PolicyMigrationSourceReceipt(
    input.sourceReceipt,
    input.predecessorReceipt
  );
  const manifest = await createProbeV04PolicyMigrationManifest({
    sourceReceipt,
    predecessorReceipt: input.predecessorReceipt,
    migrationCommit: gitCommit(input.migrationCommit),
    nextPolicyHash: PROBE_V04_MIGRATED_POLICY_HASH,
    nextScriptHash: await probeLedgerScriptHash(),
    nextRunnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
    migrationProgramHash: await assertFrozenMigrationProgram()
  });
  const migrationDigest = await probeV04PolicyMigrationDigest(manifest);
  const keys = [
    keyspace.config,
    keyspace.totals,
    keyspace.purposeLimits,
    keyspace.purposeCounts,
    keyspace.inflight,
    migrationKey(keyspace, manifest.predecessorMigrationId),
    migrationKey(keyspace, manifest.migrationId),
    ...manifest.knownCalls.flatMap((call) => [
      authKey(keyspace, call.jti),
      providerKey(keyspace, call.providerResponseHash)
    ])
  ];
  const reply = parseReply(
    await redis.eval<string[], unknown>(
      MIGRATE_POLICY_V04_SCRIPT,
      keys,
      buildProbeV04PolicyMigrationArguments(manifest, input.predecessorReceipt, migrationDigest)
    )
  );
  if (reply[1] !== "V04_MIGRATED_NEW" && reply[1] !== "V04_MIGRATED_EXISTING") {
    throw new Error("AMBIGUOUS_V04_POLICY_MIGRATION");
  }
  const disposition = Number(reply[0]) === 1 ? "new" : "existing";
  const expectedReceipt = await createProbeV04PolicyMigrationReceipt(
    manifest,
    migrationDigest,
    durableInteger(reply[2], "V04_MIGRATED_AT")
  );
  const receipt = await readProbeV04PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: expectedReceipt.receiptHash },
    keyspace
  );
  return Object.freeze({ disposition, receipt });
}

if (
  PROBE_GLOBAL_CALL_LIMIT !== 160 ||
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD !== 10_000_000_000 ||
  PROBE_V03_POLICY_MIGRATION_VERSION !== "toolproof-probe-policy-migration-v03@1.0.0"
) {
  throw new Error("V04_MIGRATION_FROZEN_BOUNDARY_MISMATCH");
}
