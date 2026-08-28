import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH as PROBE_V01_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH as PROBE_V01_POLICY_HASH,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH as PROBE_V00_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH as PROBE_V00_POLICY_HASH,
  type ProbePolicyMigrationKnownCall
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V04_MIGRATED_POLICY_HASH
} from "@/lib/probe/policy-v04-migration-contract";
import {
  PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
  readProbeV04PolicyMigrationReceipt
} from "@/lib/probe/policy-v04-migration.server";
import {
  PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V05_MIGRATED_POLICY_HASH,
  PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_POLICY_MIGRATION_ID,
  PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V05_POLICY_MIGRATION_VERSION,
  PROBE_V05_PREDECESSOR_MIGRATION_ID,
  PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
  createProbeV05PolicyMigrationManifest,
  createProbeV05PolicyMigrationReceipt,
  isProbeV05PolicyMigrationSourceStatus,
  parseProbeV05PolicyMigrationSourceReceipt,
  probeV05PolicyMigrationDigest,
  type ProbeV05AckAnchor,
  type ProbeV05PolicyMigrationManifest,
  type ProbeV05PolicyMigrationReceipt,
  type ProbeV05PolicyMigrationSourceReceipt
} from "@/lib/probe/policy-v05-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  probePolicyHash
} from "@/lib/probe/policy";
import {
  PRODUCTION_PROBE_KEYSPACE,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  type ProbeLedgerKeyspace,
  type ProbeRedisClient,
  type ProbeRedisDiscoveryClient
} from "@/lib/probe/ledger";
import { PRODUCTION_PROBE_RUN_INDEX_KEYSPACE, probeRunIndexKeys } from "@/lib/probe/run-index";

const MIGRATE_POLICY_V05_SCRIPT = `
local receipt_exists = redis.call("EXISTS", KEYS[7])

local function core_matches(version, policy_hash, script_hash, cal, baseline, repair, revised, judge)
  local inflight_ttl = redis.call("PTTL", KEYS[5])
  return redis.call("PTTL", KEYS[1]) == -1
    and redis.call("PTTL", KEYS[2]) == -1
    and redis.call("PTTL", KEYS[3]) == -1
    and redis.call("PTTL", KEYS[4]) == -1
    and (inflight_ttl == -1 or inflight_ttl == -2)
    and redis.call("HGET", KEYS[1], "schema_version") == "1"
    and redis.call("HGET", KEYS[1], "status") == "open"
    and redis.call("HGET", KEYS[1], "guard_instance_id") == ARGV[168]
    and redis.call("HGET", KEYS[1], "initialized_commit") == ARGV[169]
    and redis.call("HGET", KEYS[1], "policy_version") == version
    and redis.call("HGET", KEYS[1], "policy_hash") == policy_hash
    and redis.call("HGET", KEYS[1], "script_hash") == script_hash
    and redis.call("HGET", KEYS[1], "global_call_limit") == "160"
    and redis.call("HGET", KEYS[1], "spend_ceiling_nusd") == "10000000000"
    and redis.call("HGET", KEYS[1], "per_call_reservation_nusd") == "62500000"
    and redis.call("HGET", KEYS[1], "model") == "gpt-5.6-terra"
    and redis.call("HGET", KEYS[1], "max_concurrency") == "1"
    and redis.call("HGET", KEYS[1], "challenge_closes_at_ms") == ARGV[11]
    and redis.call("HEXISTS", KEYS[1], "halt_reason") == 0
    and redis.call("HEXISTS", KEYS[1], "uncertain_jti") == 0
    and redis.call("HGET", KEYS[2], "claimed_calls") == ARGV[14]
    and redis.call("HGET", KEYS[2], "committed_nusd") == ARGV[15]
    and redis.call("HGET", KEYS[2], "pending_count") == "0"
    and redis.call("HGET", KEYS[2], "known_count") == ARGV[16]
    and redis.call("HGET", KEYS[2], "uncertain_count") == "0"
    and redis.call("HGET", KEYS[2], "known_actual_nusd") == ARGV[17]
    and redis.call("HGET", KEYS[2], "uncertain_upper_nusd") == "0"
    and redis.call("HGET", KEYS[2], "sequence") == ARGV[18]
    and redis.call("HGET", KEYS[3], "calibration") == cal
    and redis.call("HGET", KEYS[3], "baseline") == baseline
    and redis.call("HGET", KEYS[3], "repair") == repair
    and redis.call("HGET", KEYS[3], "revised") == revised
    and redis.call("HGET", KEYS[3], "judge") == judge
    and redis.call("HGET", KEYS[4], "calibration") == ARGV[14]
    and redis.call("HGET", KEYS[4], "baseline") == "0"
    and redis.call("HGET", KEYS[4], "repair") == "0"
    and redis.call("HGET", KEYS[4], "revised") == "0"
    and redis.call("HGET", KEYS[4], "judge") == "0"
    and redis.call("ZCARD", KEYS[5]) == 0
end

local function predecessor_matches()
  return redis.call("EXISTS", KEYS[6]) == 1 and redis.call("PTTL", KEYS[6]) == -1
    and redis.call("HGET", KEYS[6], "version") == ARGV[147]
    and redis.call("HGET", KEYS[6], "migration_id") == ARGV[148]
    and redis.call("HGET", KEYS[6], "migration_digest") == ARGV[149]
    and redis.call("HGET", KEYS[6], "migration_commit") == ARGV[150]
    and redis.call("HGET", KEYS[6], "migration_program_hash") == ARGV[151]
end

local function ack_matches()
  return redis.call("EXISTS", KEYS[8]) == 1 and redis.call("PTTL", KEYS[8]) == -1
    and redis.call("EXISTS", KEYS[9]) == 0
    and redis.call("HGET", KEYS[8], "activation_hash") == ARGV[152]
    and redis.call("HGET", KEYS[8], "build_commit") == ARGV[153]
    and redis.call("HGET", KEYS[8], "ack_repair_commit") == ARGV[154]
    and redis.call("HGET", KEYS[8], "ack_program_hash") == ARGV[155]
    and redis.call("HGET", KEYS[8], "ack_evidence_digest") == ARGV[156]
    and redis.call("HGET", KEYS[8], "ack_raw_evidence_sha256") == ARGV[157]
    and redis.call("HGET", KEYS[8], "ack_status") == "acknowledged"
    and redis.call("HGET", KEYS[8], "ack_revision") == "4"
    and redis.call("HGET", KEYS[8], "ack_mode") == "operator_recovery"
    and redis.call("HGET", KEYS[8], "ack_confirmation") == ARGV[158]
    and redis.call("HGET", KEYS[8], "ack_run_identity_digest") == ARGV[159]
    and redis.call("HGET", KEYS[8], "ack_guard_snapshot_digest") == ARGV[160]
    and redis.call("HGET", KEYS[8], "acknowledged_at_ms") == ARGV[161]
    and redis.call("HGET", KEYS[8], "recovery_hash") == ARGV[162]
    and redis.call("HGET", KEYS[8], "session_hash") == ARGV[163]
    and redis.call("HGET", KEYS[8], "run_hash") == ARGV[164]
    and redis.call("HGET", KEYS[8], "actor_hash") == ARGV[165]
    and redis.call("HGET", KEYS[8], "launch_hash") == ARGV[166]
    and redis.call("HGET", KEYS[8], "ack_payload_binding") == ARGV[167]
end

local function calls_match()
  if tonumber(ARGV[29]) ~= 13 then return false end
  local actual_sum = 0
  local seen_jti = {}
  local seen_provider = {}
  for ordinal = 0, 12 do
    local base = 30 + ordinal * 9
    local auth_key = KEYS[10 + ordinal * 2]
    local provider_key = KEYS[11 + ordinal * 2]
    local jti = ARGV[base + 1]
    local response = ARGV[base + 4]
    if tonumber(ARGV[base]) ~= ordinal or ARGV[base + 2] ~= tostring(ordinal + 1)
      or seen_jti[jti] or seen_provider[response]
      or redis.call("PTTL", auth_key) ~= -1 or redis.call("PTTL", provider_key) ~= -1
      or redis.call("HGET", auth_key, "state") ~= "KNOWN"
      or redis.call("HGET", auth_key, "jti") ~= jti
      or redis.call("HGET", auth_key, "purpose") ~= "calibration"
      or redis.call("HGET", auth_key, "guard_instance_id") ~= ARGV[168]
      or redis.call("HGET", auth_key, "policy_hash") ~= ARGV[base + 7]
      or redis.call("HGET", auth_key, "script_hash") ~= ARGV[base + 8]
      or redis.call("HGET", auth_key, "reservation_nusd") ~= "62500000"
      or redis.call("HGET", auth_key, "dispatch_sequence") ~= ARGV[base + 2]
      or redis.call("HGET", auth_key, "actual_nusd") ~= ARGV[base + 3]
      or redis.call("HGET", auth_key, "provider_response_hash") ~= response
      or redis.call("HGET", auth_key, "settlement_digest") ~= ARGV[base + 5]
      or redis.call("HGET", auth_key, "usage_hash") ~= ARGV[base + 6]
      or tonumber(redis.call("HGET", auth_key, "settled_at_ms") or "-1") < 0
      or redis.call("GET", provider_key) ~= jti
    then return false end
    seen_jti[jti] = true
    seen_provider[response] = true
    actual_sum = actual_sum + tonumber(ARGV[base + 3])
  end
  return actual_sum == tonumber(ARGV[17])
end

local function receipt_matches()
  return redis.call("PTTL", KEYS[7]) == -1
    and redis.call("HGET", KEYS[7], "version") == ARGV[2]
    and redis.call("HGET", KEYS[7], "migration_id") == ARGV[3]
    and redis.call("HGET", KEYS[7], "migration_digest") == ARGV[4]
    and redis.call("HGET", KEYS[7], "manifest_json") == ARGV[1]
    and redis.call("HGET", KEYS[7], "migration_program_hash") == ARGV[12]
    and redis.call("HGET", KEYS[7], "migration_commit") == ARGV[13]
end

if receipt_exists == 1 then
  if not receipt_matches() then return {0, "V05_MIGRATION_RECEIPT_CONFLICT"} end
  if not core_matches(ARGV[8], ARGV[9], ARGV[10], ARGV[24], ARGV[25], ARGV[26], ARGV[27], ARGV[28])
    or not predecessor_matches() or not ack_matches() or not calls_match()
  then return {0, "V05_MIGRATION_REPLAY_STATE_MISMATCH"} end
  return {2, "V05_MIGRATED_EXISTING", redis.call("HGET", KEYS[7], "migrated_at_ms")}
end

if not core_matches(ARGV[5], ARGV[6], ARGV[7], ARGV[19], ARGV[20], ARGV[21], ARGV[22], ARGV[23])
then return {0, "V05_MIGRATION_STATE_MISMATCH"} end
if not predecessor_matches() then return {0, "V05_PREDECESSOR_RECEIPT_MISMATCH"} end
if not ack_matches() then return {0, "V05_ACK_ANCHOR_MISMATCH"} end
if not calls_match() then return {0, "V05_MIGRATION_KNOWN_CALL_MISMATCH"} end
local now = redis.call("TIME")
local migrated_at_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if migrated_at_ms >= tonumber(ARGV[11]) then return {0, "CHALLENGE_CLOSED"} end

redis.call("HSET", KEYS[1], "policy_version", ARGV[8], "policy_hash", ARGV[9], "script_hash", ARGV[10])
redis.call("HSET", KEYS[3], "calibration", ARGV[24], "baseline", ARGV[25], "repair", ARGV[26], "revised", ARGV[27], "judge", ARGV[28])
redis.call("HSET", KEYS[7],
  "version", ARGV[2], "migration_id", ARGV[3], "migration_digest", ARGV[4],
  "manifest_json", ARGV[1], "migration_program_hash", ARGV[12],
  "migration_commit", ARGV[13], "migrated_at_ms", migrated_at_ms)
return {1, "V05_MIGRATED_NEW", migrated_at_ms}
`;

const READ_POLICY_V05_MIGRATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_V05_MIGRATION_RECEIPT"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "V05_MIGRATION_RECEIPT_EXPIRES"} end
return {1, redis.call("HGET", KEYS[1], "version"), redis.call("HGET", KEYS[1], "migration_id"),
  redis.call("HGET", KEYS[1], "migration_digest"), redis.call("HGET", KEYS[1], "manifest_json"),
  redis.call("HGET", KEYS[1], "migration_program_hash"), redis.call("HGET", KEYS[1], "migration_commit"),
  redis.call("HGET", KEYS[1], "migrated_at_ms")}
`;

export const PROBE_V05_POLICY_MIGRATION_SCRIPTS = Object.freeze({
  migrate: MIGRATE_POLICY_V05_SCRIPT,
  read: READ_POLICY_V05_MIGRATION_SCRIPT
});
export const PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH =
  "f5cf62fc0d10ea1a7c7e5aaafa93baf5c243dce40b18df5b82ac987a473a29cf";
export function probeV05PolicyMigrationProgramHash() {
  return canonicalSha256(PROBE_V05_POLICY_MIGRATION_SCRIPTS);
}

function opaque(value: string, field: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(value)) throw new Error(`INVALID_${field}`);
  return value;
}
function hash(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`INVALID_${field}`);
  return value;
}
function commit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("INVALID_GIT_COMMIT");
  return value;
}
function integer(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`INVALID_${field}`);
  return parsed;
}
function migrationKey(keyspace: ProbeLedgerKeyspace, id: string) {
  return `${keyspace.namespace}:policy-migration:${opaque(id, "MIGRATION_ID")}`;
}
function authKey(keyspace: ProbeLedgerKeyspace, jti: string) {
  return `${keyspace.namespace}:auth:${opaque(jti, "JTI")}`;
}
function providerKey(keyspace: ProbeLedgerKeyspace, response: string) {
  return `${keyspace.namespace}:provider:${hash(response, "PROVIDER_RESPONSE_HASH")}`;
}
function reply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("INVALID_REDIS_REPLY");
  if (Number(value[0]) === 0) throw new Error(String(value[1]));
  return value;
}

function historicalIdentity(ordinal: number) {
  if (ordinal < 4)
    return { policyHash: PROBE_V00_POLICY_HASH, scriptHash: PROBE_V00_LEDGER_SCRIPT_HASH };
  if (ordinal === 4)
    return { policyHash: PROBE_V01_POLICY_HASH, scriptHash: PROBE_V01_LEDGER_SCRIPT_HASH };
  if (ordinal < 9)
    return {
      policyHash: PROBE_V03_MIGRATED_POLICY_HASH,
      scriptHash: PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH
    };
  return {
    policyHash: PROBE_V04_MIGRATED_POLICY_HASH,
    scriptHash: PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH
  };
}

export function buildProbeV05PolicyMigrationArguments(
  manifest: ProbeV05PolicyMigrationManifest,
  predecessor: Awaited<ReturnType<typeof readProbeV04PolicyMigrationReceipt>>,
  digest: string
): string[] {
  const ack = manifest.ackAnchor;
  return [
    canonicalJson(manifest),
    manifest.version,
    manifest.migrationId,
    digest,
    manifest.previousPolicyVersion,
    manifest.previousPolicyHash,
    manifest.previousScriptHash,
    manifest.nextPolicyVersion,
    manifest.nextPolicyHash,
    manifest.nextScriptHash,
    String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
    manifest.migrationProgramHash,
    manifest.migrationCommit,
    String(manifest.preserved.claimedCalls),
    String(manifest.preserved.committedNanoUsd),
    String(manifest.preserved.knownCalls),
    String(manifest.preserved.knownActualNanoUsd),
    String(manifest.preserved.sequence),
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
    String(manifest.knownCalls.length),
    ...manifest.knownCalls.flatMap((call) => {
      const identity = historicalIdentity(call.ordinal);
      return [
        String(call.ordinal),
        call.jti,
        String(call.dispatchSequence),
        String(call.actualNanoUsd),
        call.providerResponseHash,
        call.settlementDigest,
        call.usageHash,
        identity.policyHash,
        identity.scriptHash
      ];
    }),
    predecessor.version,
    predecessor.migrationId,
    predecessor.migrationDigest,
    predecessor.migrationCommit,
    predecessor.migrationProgramHash,
    ack.activationHash,
    ack.buildCommit,
    ack.repairCommit,
    ack.programHash,
    ack.evidenceDigest,
    ack.rawEvidenceSha256,
    ack.confirmation,
    ack.runIdentityDigest,
    ack.guardSnapshotDigest,
    String(ack.acknowledgedAtMs),
    ack.recoveryHash,
    ack.sessionHash,
    ack.runHash,
    ack.actorHash,
    ack.launchHash,
    ack.payloadBinding,
    manifest.guardInstanceId,
    manifest.initializedCommit
  ];
}

async function readAckAnchor(redis: ProbeRedisDiscoveryClient): Promise<ProbeV05AckAnchor> {
  const [anchorKey, dataKey] = probeRunIndexKeys(
    PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
    PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH
  );
  const [anchor, anchorTtl, dataTtl] = await Promise.all([
    redis.hgetall<Record<string, unknown>>(anchorKey),
    redis.pttl(anchorKey),
    redis.pttl(dataKey)
  ]);
  if (!anchor || anchorTtl !== -1 || dataTtl !== -2)
    throw new Error("V05_ACK_ANCHOR_DURABILITY_MISMATCH");
  const value: ProbeV05AckAnchor = {
    activationHash: String(anchor.activation_hash ?? ""),
    buildCommit: String(anchor.build_commit ?? ""),
    recoveryHash: String(anchor.recovery_hash ?? ""),
    sessionHash: String(anchor.session_hash ?? ""),
    runHash: String(anchor.run_hash ?? ""),
    actorHash: String(anchor.actor_hash ?? ""),
    launchHash: String(anchor.launch_hash ?? ""),
    ackStatus: String(anchor.ack_status ?? ""),
    ackRevision: integer(anchor.ack_revision, "ACK_REVISION"),
    ackMode: String(anchor.ack_mode ?? ""),
    evidenceDigest: String(anchor.ack_evidence_digest ?? ""),
    rawEvidenceSha256: String(anchor.ack_raw_evidence_sha256 ?? ""),
    repairCommit: String(anchor.ack_repair_commit ?? ""),
    programHash: String(anchor.ack_program_hash ?? ""),
    payloadBinding: String(anchor.ack_payload_binding ?? ""),
    acknowledgedAtMs: integer(anchor.acknowledged_at_ms, "ACKNOWLEDGED_AT"),
    confirmation: String(anchor.ack_confirmation ?? ""),
    runIdentityDigest: String(anchor.ack_run_identity_digest ?? ""),
    guardSnapshotDigest: String(anchor.ack_guard_snapshot_digest ?? ""),
    encryptedDataPresent: false
  };
  return Object.freeze(value);
}

export async function discoverProbeV05PolicyMigrationSource(
  redis: ProbeRedisDiscoveryClient,
  input: { readonly guardInstanceId: string; readonly initializedCommit: string },
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly predecessorReceipt: Awaited<ReturnType<typeof readProbeV04PolicyMigrationReceipt>>;
  readonly sourceReceipt: ProbeV05PolicyMigrationSourceReceipt;
}> {
  opaque(input.guardInstanceId, "GUARD_INSTANCE");
  commit(input.initializedCommit);
  const predecessorReceipt = await readProbeV04PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH },
    keyspace
  );
  const status = await readProbeGuardStatus(redis, keyspace);
  if (!isProbeV05PolicyMigrationSourceStatus(status, input))
    throw new Error("V05_MIGRATION_SOURCE_STATUS_MISMATCH");
  const scan = async (pattern: string) => {
    const keys = new Set<string>();
    let cursor = "0";
    for (let page = 0; page < 32; page += 1) {
      const [next, found] = await redis.scan(cursor, { match: pattern, count: 100 });
      for (const key of found) keys.add(key);
      if (keys.size > 1024) throw new Error("V05_DISCOVERY_KEY_LIMIT");
      if (next === "0") return keys;
      cursor = next;
    }
    throw new Error("V05_DISCOVERY_PAGE_LIMIT");
  };
  const authKeys = await scan(`${keyspace.namespace}:auth:*`);
  const providerKeys = await scan(`${keyspace.namespace}:provider:*`);
  if (authKeys.size !== 13 || providerKeys.size !== 13)
    throw new Error("V05_DISCOVERY_KNOWN_SET_MISMATCH");
  const calls = new Map<number, ProbePolicyMigrationKnownCall>();
  for (const key of authKeys) {
    const auth = await redis.hgetall<Record<string, unknown>>(key);
    if (!auth || String(auth.state ?? "") !== "KNOWN")
      throw new Error("V05_DISCOVERY_ORPHAN_AUTH_RECORD");
    const sequence = integer(auth.dispatch_sequence, "V05_DISCOVERY_SEQUENCE");
    const ordinal = sequence - 1;
    const identity = historicalIdentity(ordinal);
    const call = Object.freeze({
      ordinal,
      jti: opaque(String(auth.jti ?? ""), "V05_DISCOVERY_JTI"),
      dispatchSequence: sequence,
      actualNanoUsd: integer(auth.actual_nusd, "V05_DISCOVERY_COST"),
      providerResponseHash: hash(
        String(auth.provider_response_hash ?? ""),
        "V05_DISCOVERY_RESPONSE"
      ),
      settlementDigest: hash(String(auth.settlement_digest ?? ""), "V05_DISCOVERY_SETTLEMENT"),
      usageHash: hash(String(auth.usage_hash ?? ""), "V05_DISCOVERY_USAGE")
    });
    const pkey = providerKey(keyspace, call.providerResponseHash);
    if (
      ordinal < 0 ||
      ordinal > 12 ||
      calls.has(sequence) ||
      key !== authKey(keyspace, call.jti) ||
      String(auth.purpose ?? "") !== "calibration" ||
      String(auth.guard_instance_id ?? "") !== input.guardInstanceId ||
      String(auth.policy_hash ?? "") !== identity.policyHash ||
      String(auth.script_hash ?? "") !== identity.scriptHash ||
      integer(auth.reservation_nusd, "V05_DISCOVERY_RESERVATION") !==
        PROBE_PER_CALL_RESERVATION_NANO_USD ||
      call.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD ||
      integer(auth.settled_at_ms, "V05_DISCOVERY_SETTLED_AT") < 0 ||
      (await redis.pttl(key)) !== -1 ||
      (await redis.pttl(pkey)) !== -1 ||
      (await redis.get(pkey)) !== call.jti
    )
      throw new Error("V05_DISCOVERY_RECORD_MISMATCH");
    calls.set(sequence, call);
  }
  const knownCalls = Object.freeze(
    Array.from({ length: 13 }, (_unused, index) => calls.get(index + 1)!)
  );
  if (
    knownCalls.some((call) => !call) ||
    (await canonicalSha256(knownCalls)) !==
      "03c4632b3fc75914f107528965c11959c9e39bed8354f7c9a46d599cc34a3e2b"
  )
    throw new Error("V05_DISCOVERY_CALL_DIGEST_MISMATCH");
  const expectedProviders = new Set(
    knownCalls.map((call) => providerKey(keyspace, call.providerResponseHash))
  );
  if ([...providerKeys].some((key) => !expectedProviders.has(key)))
    throw new Error("V05_DISCOVERY_ORPHAN_PROVIDER_RECORD");
  const ackAnchor = await readAckAnchor(redis);
  const sourceReceipt = await parseProbeV05PolicyMigrationSourceReceipt(
    {
      version: PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V05_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
      priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
      priorReproducerRawSha256: PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
      priorReproducerEvidenceDigest: PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
      predecessorMigrationId: PROBE_V05_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
      guardInstanceId: input.guardInstanceId,
      initializedCommit: input.initializedCommit,
      previousPolicyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
      previousRunnerHash: PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
      preserved: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
      knownCalls,
      ackAnchor
    },
    predecessorReceipt
  );
  return Object.freeze({ predecessorReceipt, sourceReceipt });
}

export async function readProbeV05PolicyMigrationReceipt(
  redis: ProbeRedisClient,
  input: { readonly expectedReceiptHash?: string } = {},
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<ProbeV05PolicyMigrationReceipt> {
  const predecessor = await readProbeV04PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH },
    keyspace
  );
  const result = reply(
    await redis.evalRo<[], unknown>(
      READ_POLICY_V05_MIGRATION_SCRIPT,
      [migrationKey(keyspace, PROBE_V05_POLICY_MIGRATION_ID)],
      []
    )
  );
  if (
    String(result[1]) !== PROBE_V05_POLICY_MIGRATION_VERSION ||
    String(result[2]) !== PROBE_V05_POLICY_MIGRATION_ID
  )
    throw new Error("V05_MIGRATION_RECEIPT_IDENTITY_MISMATCH");
  let stored: unknown;
  try {
    stored = JSON.parse(String(result[4]));
  } catch {
    throw new Error("V05_MIGRATION_MANIFEST_INVALID");
  }
  const storedManifest = stored as ProbeV05PolicyMigrationManifest;
  const sourceReceipt: ProbeV05PolicyMigrationSourceReceipt = {
    version: PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION,
    migrationId: storedManifest.migrationId,
    priorAppCommit: storedManifest.priorAppCommit,
    priorActivationHash: storedManifest.priorActivationHash,
    priorEvidenceRawSha256: storedManifest.priorEvidenceRawSha256,
    priorEvidenceDigest: storedManifest.priorEvidenceDigest,
    priorReproducerRawSha256: storedManifest.priorReproducerRawSha256,
    priorReproducerEvidenceDigest: storedManifest.priorReproducerEvidenceDigest,
    predecessorMigrationId: storedManifest.predecessorMigrationId,
    predecessorMigrationReceiptHash: storedManifest.predecessorMigrationReceiptHash,
    guardInstanceId: storedManifest.guardInstanceId,
    initializedCommit: storedManifest.initializedCommit,
    previousPolicyVersion: storedManifest.previousPolicyVersion,
    previousPolicyHash: storedManifest.previousPolicyHash,
    previousScriptHash: storedManifest.previousScriptHash,
    previousRunnerHash: storedManifest.previousRunnerHash,
    preserved: storedManifest.preserved,
    knownCalls: storedManifest.knownCalls,
    ackAnchor: storedManifest.ackAnchor
  };
  const manifest = await createProbeV05PolicyMigrationManifest({
    sourceReceipt,
    predecessorReceipt: predecessor,
    migrationCommit: String(result[6]),
    nextPolicyHash: storedManifest.nextPolicyHash,
    nextScriptHash: storedManifest.nextScriptHash,
    nextRunnerHash: storedManifest.nextRunnerHash,
    migrationProgramHash: String(result[5])
  });
  const receipt = await createProbeV05PolicyMigrationReceipt(
    manifest,
    hash(String(result[3]), "V05_MIGRATION_DIGEST"),
    integer(result[7], "V05_MIGRATED_AT")
  );
  if (input.expectedReceiptHash && receipt.receiptHash !== input.expectedReceiptHash)
    throw new Error("V05_MIGRATION_RECEIPT_HASH_MISMATCH");
  return receipt;
}

export async function migrateProbeGuardPolicyV05(
  redis: ProbeRedisClient,
  input: {
    readonly sourceReceipt: ProbeV05PolicyMigrationSourceReceipt;
    readonly predecessorReceipt: Awaited<ReturnType<typeof readProbeV04PolicyMigrationReceipt>>;
    readonly migrationCommit: string;
  },
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<{
  readonly disposition: "new" | "existing";
  readonly receipt: ProbeV05PolicyMigrationReceipt;
}> {
  const actualProgramHash = await probeV05PolicyMigrationProgramHash();
  if (actualProgramHash !== PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH)
    throw new Error("V05_MIGRATION_PROGRAM_DRIFT");
  const manifest = await createProbeV05PolicyMigrationManifest({
    sourceReceipt: input.sourceReceipt,
    predecessorReceipt: input.predecessorReceipt,
    migrationCommit: commit(input.migrationCommit),
    nextPolicyHash: await probePolicyHash(),
    nextScriptHash: await probeLedgerScriptHash(),
    nextRunnerHash: await fallbackRunnerContractHash(),
    migrationProgramHash: actualProgramHash
  });
  const digest = await probeV05PolicyMigrationDigest(manifest);
  const [anchorKey, dataKey] = probeRunIndexKeys(
    PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
    manifest.priorActivationHash
  );
  const keys = [
    keyspace.config,
    keyspace.totals,
    keyspace.purposeLimits,
    keyspace.purposeCounts,
    keyspace.inflight,
    migrationKey(keyspace, manifest.predecessorMigrationId),
    migrationKey(keyspace, manifest.migrationId),
    anchorKey,
    dataKey,
    ...manifest.knownCalls.flatMap((call) => [
      authKey(keyspace, call.jti),
      providerKey(keyspace, call.providerResponseHash)
    ])
  ];
  const result = reply(
    await redis.eval<string[], unknown>(
      MIGRATE_POLICY_V05_SCRIPT,
      keys,
      buildProbeV05PolicyMigrationArguments(manifest, input.predecessorReceipt, digest)
    )
  );
  if (result[1] !== "V05_MIGRATED_NEW" && result[1] !== "V05_MIGRATED_EXISTING")
    throw new Error("AMBIGUOUS_V05_POLICY_MIGRATION");
  const expected = await createProbeV05PolicyMigrationReceipt(
    manifest,
    digest,
    integer(result[2], "V05_MIGRATED_AT")
  );
  const receipt = await readProbeV05PolicyMigrationReceipt(
    redis,
    { expectedReceiptHash: expected.receiptHash },
    keyspace
  );
  return Object.freeze({
    disposition: result[1] === "V05_MIGRATED_NEW" ? "new" : "existing",
    receipt
  });
}

if (
  PROBE_GLOBAL_CALL_LIMIT !== 160 ||
  PROBE_MAX_CONCURRENCY !== 1 ||
  PROBE_MODEL !== "gpt-5.6-terra" ||
  String(PROBE_V05_MIGRATED_POLICY_HASH) === String(PROBE_V05_PREVIOUS_POLICY_HASH) ||
  PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH !== PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH ||
  String(PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH) ===
    String(PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH) ||
  PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH !==
    "63b192b247399e710334caaed8766f78dd1c9fd73cf65f148d8e81d63a62cf59"
)
  throw new Error("V05_MIGRATION_FROZEN_BOUNDARY_MISMATCH");
