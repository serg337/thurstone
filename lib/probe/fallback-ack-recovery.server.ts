import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Redis } from "@upstash/redis";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { verifyGate2FallbackCalibrationBundleServer } from "@/lib/evidence/gate2-fallback-calibration-verifier.server";
import {
  PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST,
  PROBE_FALLBACK_ACK_RECOVERY_GUARD,
  PROBE_FALLBACK_ACK_RECOVERY_MIGRATION,
  PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID,
  PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID,
  PROBE_FALLBACK_ACK_RECOVERY_VERSION,
  probeFallbackAckRecoveryConfirmation
} from "@/lib/probe/fallback-ack-recovery-contract";
import { PRODUCTION_PROBE_KEYSPACE } from "@/lib/probe/ledger";
import {
  PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
  probeRunIndexKeys,
  probeRunIndexPayloadSchema
} from "@/lib/probe/run-index";
import { openProbeArtifact } from "@/lib/probe/server-artifact";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

export type ProbeFallbackAckRecoveryRedisClient = Pick<Redis, "eval" | "evalRo">;

export class ProbeFallbackAckRecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeFallbackAckRecoveryError";
  }
}

const READ_EXACT_RECOVERY_SCRIPT = `
local data_exists = redis.call("EXISTS", KEYS[2])
local current_time = redis.call("TIME")
local current_time_ms = tonumber(current_time[1]) * 1000 + math.floor(tonumber(current_time[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("PTTL", KEYS[1]) ~= -1 then
  return {0, "ACK_RECOVERY_ANCHOR_MISSING"}
end
if redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
then return {0, "ACK_RECOVERY_TARGET_MISMATCH"} end

local inflight_ttl = redis.call("PTTL", KEYS[7])
if redis.call("PTTL", KEYS[3]) ~= -1
  or redis.call("PTTL", KEYS[4]) ~= -1
  or redis.call("PTTL", KEYS[5]) ~= -1
  or redis.call("PTTL", KEYS[6]) ~= -1
  or (inflight_ttl ~= -1 and inflight_ttl ~= -2)
  or redis.call("HGET", KEYS[3], "schema_version") ~= "1"
  or redis.call("HGET", KEYS[3], "status") ~= "open"
  or redis.call("HGET", KEYS[3], "guard_instance_id") ~= ARGV[7]
  or redis.call("HGET", KEYS[3], "initialized_commit") ~= ARGV[8]
  or redis.call("HGET", KEYS[3], "policy_version") ~= ARGV[9]
  or redis.call("HGET", KEYS[3], "policy_hash") ~= ARGV[10]
  or redis.call("HGET", KEYS[3], "script_hash") ~= ARGV[11]
  or redis.call("HGET", KEYS[3], "model") ~= "gpt-5.6-terra"
  or redis.call("HGET", KEYS[3], "global_call_limit") ~= "160"
  or redis.call("HGET", KEYS[3], "spend_ceiling_nusd") ~= "10000000000"
  or redis.call("HGET", KEYS[3], "per_call_reservation_nusd") ~= "62500000"
  or redis.call("HGET", KEYS[3], "max_concurrency") ~= "1"
  or redis.call("HGET", KEYS[3], "challenge_closes_at_ms") ~= "1790208000000"
  or redis.call("HEXISTS", KEYS[3], "halt_reason") == 1
  or redis.call("HEXISTS", KEYS[3], "uncertain_jti") == 1
  or redis.call("HGET", KEYS[4], "claimed_calls") ~= "13"
  or redis.call("HGET", KEYS[4], "committed_nusd") ~= "812500000"
  or redis.call("HGET", KEYS[4], "pending_count") ~= "0"
  or redis.call("HGET", KEYS[4], "known_count") ~= "13"
  or redis.call("HGET", KEYS[4], "uncertain_count") ~= "0"
  or redis.call("HGET", KEYS[4], "known_actual_nusd") ~= "42165200"
  or redis.call("HGET", KEYS[4], "uncertain_upper_nusd") ~= "0"
  or redis.call("HGET", KEYS[4], "sequence") ~= "13"
  or redis.call("HGET", KEYS[5], "calibration") ~= "13"
  or redis.call("HGET", KEYS[5], "baseline") ~= "72"
  or redis.call("HGET", KEYS[5], "repair") ~= "2"
  or redis.call("HGET", KEYS[5], "revised") ~= "72"
  or redis.call("HGET", KEYS[5], "judge") ~= "1"
  or redis.call("HGET", KEYS[6], "calibration") ~= "13"
  or redis.call("HGET", KEYS[6], "baseline") ~= "0"
  or redis.call("HGET", KEYS[6], "repair") ~= "0"
  or redis.call("HGET", KEYS[6], "revised") ~= "0"
  or redis.call("HGET", KEYS[6], "judge") ~= "0"
  or redis.call("ZCARD", KEYS[7]) ~= 0
then return {0, "ACK_RECOVERY_GUARD_MISMATCH"} end

if redis.call("EXISTS", KEYS[8]) ~= 1 or redis.call("PTTL", KEYS[8]) ~= -1
  or redis.call("HGET", KEYS[8], "version") ~= ARGV[12]
  or redis.call("HGET", KEYS[8], "migration_id") ~= ARGV[13]
  or redis.call("HGET", KEYS[8], "migration_digest") ~= ARGV[14]
  or redis.call("HGET", KEYS[8], "predecessor_migration_id") ~= ARGV[15]
  or redis.call("HGET", KEYS[8], "predecessor_receipt_hash") ~= ARGV[16]
  or redis.call("HGET", KEYS[8], "prior_app_commit") ~= ARGV[17]
  or redis.call("HGET", KEYS[8], "prior_activation_hash") ~= ARGV[18]
  or redis.call("HGET", KEYS[8], "guard_instance_id") ~= ARGV[7]
  or redis.call("HGET", KEYS[8], "initialized_commit") ~= ARGV[8]
  or redis.call("HGET", KEYS[8], "migration_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[8], "migration_program_hash") ~= ARGV[19]
  or redis.call("HGET", KEYS[8], "next_policy_version") ~= ARGV[9]
  or redis.call("HGET", KEYS[8], "next_policy_hash") ~= ARGV[10]
  or redis.call("HGET", KEYS[8], "next_script_hash") ~= ARGV[11]
  or redis.call("HGET", KEYS[8], "next_runner_hash") ~= ARGV[20]
  or redis.call("HGET", KEYS[8], "known_actual_nusd") ~= "27992800"
  or redis.call("HGET", KEYS[8], "migrated_at_ms") ~= "1787914040602"
  or redis.call("HGET", KEYS[8], "prior_evidence_raw_sha256") ~= "56d568216d33598480fb91ed1dacdc5405c7363eef1d846d1cdff544c135caa2"
  or redis.call("HGET", KEYS[8], "prior_evidence_digest") ~= "9a8ac1e9a44dd047016bd6cdd6a809d8666f35c33540450516d69a124825f05e"
then return {0, "ACK_RECOVERY_MIGRATION_MISMATCH"} end

if data_exists == 0 then
  if redis.call("HGET", KEYS[1], "ack_status") ~= "acknowledged"
    or redis.call("HGET", KEYS[1], "ack_revision") ~= "4"
    or redis.call("HGET", KEYS[1], "ack_mode") ~= "operator_recovery"
    or redis.call("HGET", KEYS[1], "ack_evidence_digest") ~= ARGV[4]
    or redis.call("HGET", KEYS[1], "ack_raw_evidence_sha256") ~= ARGV[5]
    or redis.call("HGET", KEYS[1], "ack_repair_commit") ~= ARGV[3]
    or redis.call("HGET", KEYS[1], "ack_program_hash") ~= ARGV[6]
    or not redis.call("HGET", KEYS[1], "ack_payload_binding")
    or not redis.call("HGET", KEYS[1], "acknowledged_at_ms")
    or not redis.call("HGET", KEYS[1], "ack_confirmation")
    or not redis.call("HGET", KEYS[1], "ack_run_identity_digest")
    or not redis.call("HGET", KEYS[1], "ack_guard_snapshot_digest")
  then return {0, "ACK_RECOVERY_REPLAY_MISMATCH"} end
  return {2, "ACKNOWLEDGED_EXISTING",
    redis.call("HGET", KEYS[1], "recovery_hash"),
    redis.call("HGET", KEYS[1], "session_hash"),
    redis.call("HGET", KEYS[1], "run_hash"),
    redis.call("HGET", KEYS[1], "actor_hash"),
    redis.call("HGET", KEYS[1], "launch_hash"),
    redis.call("HGET", KEYS[1], "ack_payload_binding"), "", "",
    redis.call("HGET", KEYS[1], "acknowledged_at_ms"),
    redis.call("HGET", KEYS[1], "ack_confirmation"),
    redis.call("HGET", KEYS[1], "ack_run_identity_digest"),
    redis.call("HGET", KEYS[1], "ack_guard_snapshot_digest")}
end

if redis.call("PTTL", KEYS[2]) <= 0
  or redis.call("HGET", KEYS[2], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "revision") ~= "4"
  or redis.call("HGET", KEYS[2], "owner_revision") ~= "4"
  or not redis.call("HGET", KEYS[2], "owner_hash")
  or not redis.call("HGET", KEYS[2], "owner_expires_at_ms")
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") > current_time_ms
  or not redis.call("HGET", KEYS[2], "payload_binding")
  or not redis.call("HGET", KEYS[2], "token")
then return {0, "ACK_RECOVERY_DATA_MISMATCH"} end
for _, field in ipairs({"recovery_hash", "session_hash", "run_hash", "actor_hash", "launch_hash"}) do
  if redis.call("HGET", KEYS[1], field) ~= redis.call("HGET", KEYS[2], field) then
    return {0, "ACK_RECOVERY_IDENTITY_MISMATCH"}
  end
end
if redis.call("HEXISTS", KEYS[1], "ack_status") == 1
  or redis.call("HEXISTS", KEYS[1], "ack_revision") == 1
  or redis.call("HEXISTS", KEYS[1], "ack_payload_binding") == 1
then return {0, "ACK_RECOVERY_PARTIAL_ACK"} end
return {1, "ACK_RECOVERY_READY",
  redis.call("HGET", KEYS[2], "recovery_hash"),
  redis.call("HGET", KEYS[2], "session_hash"),
  redis.call("HGET", KEYS[2], "run_hash"),
  redis.call("HGET", KEYS[2], "actor_hash"),
  redis.call("HGET", KEYS[2], "launch_hash"),
  redis.call("HGET", KEYS[2], "payload_binding"),
  redis.call("HGET", KEYS[2], "token"),
  redis.call("HGET", KEYS[2], "owner_hash"), "0", "", "", ""}
`;

const RECOVER_EXACT_ACK_SCRIPT = `
local data_exists = redis.call("EXISTS", KEYS[2])
local current_time = redis.call("TIME")
local current_time_ms = tonumber(current_time[1]) * 1000 + math.floor(tonumber(current_time[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 or redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "recovery_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[1], "session_hash") ~= ARGV[8]
  or redis.call("HGET", KEYS[1], "run_hash") ~= ARGV[9]
  or redis.call("HGET", KEYS[1], "actor_hash") ~= ARGV[10]
  or redis.call("HGET", KEYS[1], "launch_hash") ~= ARGV[11]
then return {0, "ACK_RECOVERY_ANCHOR_MISMATCH"} end

local inflight_ttl = redis.call("PTTL", KEYS[7])
if redis.call("PTTL", KEYS[3]) ~= -1 or redis.call("PTTL", KEYS[4]) ~= -1
  or redis.call("PTTL", KEYS[5]) ~= -1 or redis.call("PTTL", KEYS[6]) ~= -1
  or (inflight_ttl ~= -1 and inflight_ttl ~= -2)
  or redis.call("HGET", KEYS[3], "schema_version") ~= "1"
  or redis.call("HGET", KEYS[3], "status") ~= "open"
  or redis.call("HGET", KEYS[3], "guard_instance_id") ~= ARGV[12]
  or redis.call("HGET", KEYS[3], "initialized_commit") ~= ARGV[13]
  or redis.call("HGET", KEYS[3], "policy_version") ~= ARGV[14]
  or redis.call("HGET", KEYS[3], "policy_hash") ~= ARGV[15]
  or redis.call("HGET", KEYS[3], "script_hash") ~= ARGV[16]
  or redis.call("HGET", KEYS[3], "model") ~= "gpt-5.6-terra"
  or redis.call("HGET", KEYS[3], "global_call_limit") ~= "160"
  or redis.call("HGET", KEYS[3], "spend_ceiling_nusd") ~= "10000000000"
  or redis.call("HGET", KEYS[3], "per_call_reservation_nusd") ~= "62500000"
  or redis.call("HGET", KEYS[3], "max_concurrency") ~= "1"
  or redis.call("HGET", KEYS[3], "challenge_closes_at_ms") ~= "1790208000000"
  or redis.call("HEXISTS", KEYS[3], "halt_reason") == 1
  or redis.call("HEXISTS", KEYS[3], "uncertain_jti") == 1
  or redis.call("HGET", KEYS[4], "claimed_calls") ~= "13"
  or redis.call("HGET", KEYS[4], "committed_nusd") ~= "812500000"
  or redis.call("HGET", KEYS[4], "pending_count") ~= "0"
  or redis.call("HGET", KEYS[4], "known_count") ~= "13"
  or redis.call("HGET", KEYS[4], "uncertain_count") ~= "0"
  or redis.call("HGET", KEYS[4], "known_actual_nusd") ~= "42165200"
  or redis.call("HGET", KEYS[4], "uncertain_upper_nusd") ~= "0"
  or redis.call("HGET", KEYS[4], "sequence") ~= "13"
  or redis.call("HGET", KEYS[5], "calibration") ~= "13"
  or redis.call("HGET", KEYS[5], "baseline") ~= "72"
  or redis.call("HGET", KEYS[5], "repair") ~= "2"
  or redis.call("HGET", KEYS[5], "revised") ~= "72"
  or redis.call("HGET", KEYS[5], "judge") ~= "1"
  or redis.call("HGET", KEYS[6], "calibration") ~= "13"
  or redis.call("HGET", KEYS[6], "baseline") ~= "0"
  or redis.call("HGET", KEYS[6], "repair") ~= "0"
  or redis.call("HGET", KEYS[6], "revised") ~= "0"
  or redis.call("HGET", KEYS[6], "judge") ~= "0"
  or redis.call("ZCARD", KEYS[7]) ~= 0
then return {0, "ACK_RECOVERY_GUARD_MISMATCH"} end

if redis.call("EXISTS", KEYS[8]) ~= 1 or redis.call("PTTL", KEYS[8]) ~= -1
  or redis.call("HGET", KEYS[8], "version") ~= ARGV[17]
  or redis.call("HGET", KEYS[8], "migration_id") ~= ARGV[18]
  or redis.call("HGET", KEYS[8], "migration_digest") ~= ARGV[19]
  or redis.call("HGET", KEYS[8], "predecessor_migration_id") ~= ARGV[20]
  or redis.call("HGET", KEYS[8], "predecessor_receipt_hash") ~= ARGV[21]
  or redis.call("HGET", KEYS[8], "prior_app_commit") ~= ARGV[22]
  or redis.call("HGET", KEYS[8], "prior_activation_hash") ~= ARGV[23]
  or redis.call("HGET", KEYS[8], "guard_instance_id") ~= ARGV[12]
  or redis.call("HGET", KEYS[8], "initialized_commit") ~= ARGV[13]
  or redis.call("HGET", KEYS[8], "migration_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[8], "migration_program_hash") ~= ARGV[24]
  or redis.call("HGET", KEYS[8], "next_policy_version") ~= ARGV[14]
  or redis.call("HGET", KEYS[8], "next_policy_hash") ~= ARGV[15]
  or redis.call("HGET", KEYS[8], "next_script_hash") ~= ARGV[16]
  or redis.call("HGET", KEYS[8], "next_runner_hash") ~= ARGV[25]
  or redis.call("HGET", KEYS[8], "known_actual_nusd") ~= "27992800"
  or redis.call("HGET", KEYS[8], "migrated_at_ms") ~= "1787914040602"
  or redis.call("HGET", KEYS[8], "prior_evidence_raw_sha256") ~= "56d568216d33598480fb91ed1dacdc5405c7363eef1d846d1cdff544c135caa2"
  or redis.call("HGET", KEYS[8], "prior_evidence_digest") ~= "9a8ac1e9a44dd047016bd6cdd6a809d8666f35c33540450516d69a124825f05e"
then return {0, "ACK_RECOVERY_MIGRATION_MISMATCH"} end

if data_exists == 0 then
  if redis.call("HGET", KEYS[1], "ack_status") == "acknowledged"
    and redis.call("HGET", KEYS[1], "ack_revision") == "4"
    and redis.call("HGET", KEYS[1], "ack_payload_binding") == ARGV[27]
    and redis.call("HGET", KEYS[1], "ack_mode") == "operator_recovery"
    and redis.call("HGET", KEYS[1], "ack_evidence_digest") == ARGV[4]
    and redis.call("HGET", KEYS[1], "ack_raw_evidence_sha256") == ARGV[5]
    and redis.call("HGET", KEYS[1], "ack_repair_commit") == ARGV[3]
    and redis.call("HGET", KEYS[1], "ack_program_hash") == ARGV[6]
    and redis.call("HGET", KEYS[1], "ack_confirmation") == ARGV[29]
    and redis.call("HGET", KEYS[1], "ack_run_identity_digest") == ARGV[30]
    and redis.call("HGET", KEYS[1], "ack_guard_snapshot_digest") == ARGV[31]
  then return {2, "ACKNOWLEDGED_EXISTING", redis.call("HGET", KEYS[1], "acknowledged_at_ms")} end
  return {0, "ACK_RECOVERY_REPLAY_MISMATCH"}
end
if redis.call("PTTL", KEYS[2]) <= 0
  or redis.call("HGET", KEYS[2], "status") ~= "active"
  or redis.call("HGET", KEYS[2], "activation_hash") ~= ARGV[1]
  or redis.call("HGET", KEYS[2], "build_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[2], "recovery_hash") ~= ARGV[7]
  or redis.call("HGET", KEYS[2], "session_hash") ~= ARGV[8]
  or redis.call("HGET", KEYS[2], "run_hash") ~= ARGV[9]
  or redis.call("HGET", KEYS[2], "actor_hash") ~= ARGV[10]
  or redis.call("HGET", KEYS[2], "launch_hash") ~= ARGV[11]
  or redis.call("HGET", KEYS[2], "revision") ~= "4"
  or redis.call("HGET", KEYS[2], "owner_revision") ~= "4"
  or redis.call("HGET", KEYS[2], "owner_hash") ~= ARGV[26]
  or not redis.call("HGET", KEYS[2], "owner_expires_at_ms")
  or tonumber(redis.call("HGET", KEYS[2], "owner_expires_at_ms") or "0") > current_time_ms
  or redis.call("HGET", KEYS[2], "payload_binding") ~= ARGV[27]
  or redis.call("HGET", KEYS[2], "token") ~= ARGV[28]
then return {0, "ACK_RECOVERY_DATA_MISMATCH"} end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[1],
  "ack_status", "acknowledged", "ack_revision", "4",
  "ack_payload_binding", ARGV[27], "acknowledged_at_ms", now_ms,
  "ack_mode", "operator_recovery", "ack_evidence_digest", ARGV[4],
  "ack_raw_evidence_sha256", ARGV[5], "ack_repair_commit", ARGV[3],
  "ack_program_hash", ARGV[6], "ack_confirmation", ARGV[29],
  "ack_run_identity_digest", ARGV[30], "ack_guard_snapshot_digest", ARGV[31])
redis.call("DEL", KEYS[2])
return {1, "ACKNOWLEDGED_NEW", now_ms}
`;

export const PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS = Object.freeze({
  preflight: READ_EXACT_RECOVERY_SCRIPT,
  recover: RECOVER_EXACT_ACK_SCRIPT
});

export async function probeFallbackAckRecoveryProgramHash(): Promise<string> {
  return canonicalSha256({
    version: PROBE_FALLBACK_ACK_RECOVERY_VERSION,
    preflight: READ_EXACT_RECOVERY_SCRIPT,
    recover: RECOVER_EXACT_ACK_SCRIPT
  });
}

function migrationKey(): string {
  return `${PRODUCTION_PROBE_KEYSPACE.namespace}:policy-migration:${PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationId}`;
}

function redisKeys(): string[] {
  return [
    ...probeRunIndexKeys(
      PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
      PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH
    ),
    PRODUCTION_PROBE_KEYSPACE.config,
    PRODUCTION_PROBE_KEYSPACE.totals,
    PRODUCTION_PROBE_KEYSPACE.purposeLimits,
    PRODUCTION_PROBE_KEYSPACE.purposeCounts,
    PRODUCTION_PROBE_KEYSPACE.inflight,
    migrationKey()
  ];
}

function commonArguments(input: { readonly repairCommit: string; readonly programHash: string }) {
  return [
    PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
    PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
    input.repairCommit,
    PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST,
    PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256,
    input.programHash,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.guardInstanceId,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.initializedCommit,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.policyVersion,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.policyHash,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.ledgerScriptHash,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.version,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationId,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationDigest,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.predecessorMigrationId,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.predecessorReceiptHash,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.priorAppCommit,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.priorActivationHash,
    PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationProgramHash,
    PROBE_FALLBACK_ACK_RECOVERY_GUARD.runnerContractHash
  ];
}

function strings(reply: unknown): string[] {
  if (!Array.isArray(reply) || reply.length < 2) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
  }
  if (Number(reply[0]) === 0) {
    throw new ProbeFallbackAckRecoveryError(String(reply[1] ?? "ACK_RECOVERY_DENIED"));
  }
  return reply.map((value) => String(value ?? ""));
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function keyedHash(label: string, value: string, signingSecret: string): string {
  return createHmac("sha256", decodeProbeSigningSecret(signingSecret))
    .update(`toolproof.probe.run-index.${label}.v1.${value}`)
    .digest("hex");
}

function payloadBinding(value: unknown, signingSecret: string): string {
  return createHmac("sha256", decodeProbeSigningSecret(signingSecret))
    .update(`toolproof.probe.run-index.binding.v1.${canonicalJson(value)}`)
    .digest("hex");
}

async function verifyEvidenceIfAvailable(
  pathOverride?: string
): Promise<"verified" | "not-available"> {
  const path = pathOverride
    ? resolve(pathOverride)
    : resolve(
        process.cwd(),
        ".toolproof-local/evidence/gate2/toolproof-gate2-fallback-42f65f0345ad-20260828T111429495Z.json"
      );
  if (!existsSync(path)) return "not-available";
  const bytes = await readFile(path);
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256
  ) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_EVIDENCE_RAW_SHA_MISMATCH");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_EVIDENCE_INVALID_JSON");
  }
  await verifyGate2FallbackCalibrationBundleServer(value);
  const record = value as Record<string, unknown>;
  if (
    record.activationHash !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH ||
    record.appCommit !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT ||
    record.runId !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID ||
    record.evidenceDigest !== PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST
  ) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_EVIDENCE_IDENTITY_MISMATCH");
  }
  return "verified";
}

export interface PreparedProbeFallbackAckRecovery {
  readonly disposition: "ready" | "existing";
  readonly repairCommit: string;
  readonly programHash: string;
  readonly payloadBinding: string;
  readonly guardSnapshotDigest: string;
  readonly runIdentityDigest: string;
  readonly confirmation: string;
  readonly evidence: "verified" | "not-available";
  readonly identityHashes: readonly [string, string, string, string, string];
  readonly token: string;
  readonly ownerHash: string;
}

export async function preflightProbeFallbackAckRecovery(
  redis: ProbeFallbackAckRecoveryRedisClient,
  input: {
    readonly repairCommit: string;
    readonly signingSecret: string;
    readonly evidencePath?: string;
  }
): Promise<PreparedProbeFallbackAckRecovery> {
  if (!/^[a-f0-9]{40}$/u.test(input.repairCommit)) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPAIR_COMMIT");
  }
  decodeProbeSigningSecret(input.signingSecret);
  const programHash = await probeFallbackAckRecoveryProgramHash();
  const evidence = await verifyEvidenceIfAvailable(input.evidencePath);
  const reply = strings(
    await redis.evalRo<string[], unknown>(
      READ_EXACT_RECOVERY_SCRIPT,
      redisKeys(),
      commonArguments({ repairCommit: input.repairCommit, programHash })
    )
  );
  const disposition = reply[1] === "ACK_RECOVERY_READY" ? "ready" : "existing";
  if (reply[1] !== "ACK_RECOVERY_READY" && reply[1] !== "ACKNOWLEDGED_EXISTING") {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
  }
  const identityHashes = reply.slice(2, 7) as unknown as [string, string, string, string, string];
  const [recoveryHash, sessionHash, runHash, actorHash, launchHash] = identityHashes;
  const binding = reply[7] ?? "";
  const token = reply[8] ?? "";
  const ownerHash = reply[9] ?? "";
  if (
    identityHashes.length !== 5 ||
    identityHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value)) ||
    !/^[a-f0-9]{64}$/u.test(binding)
  ) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
  }

  let runIdentityDigest: string;
  if (disposition === "ready") {
    if (!token || !/^[a-f0-9]{64}$/u.test(ownerHash)) {
      throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
    }
    let payload;
    try {
      payload = probeRunIndexPayloadSchema.parse(
        openProbeArtifact("run_index", token, input.signingSecret)
      );
    } catch {
      throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_TERMINAL_PAYLOAD_INVALID");
    }
    if (
      payload.activationHash !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH ||
      payload.buildCommit !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT ||
      payload.runId !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID ||
      payload.nextOrdinal !== 4 ||
      payload.terminal !== true ||
      keyedHash("recovery", payload.recoveryId, input.signingSecret) !== recoveryHash ||
      keyedHash("session", payload.sessionId, input.signingSecret) !== sessionHash ||
      keyedHash("run", payload.runId, input.signingSecret) !== runHash ||
      payload.actorHash !== actorHash ||
      payload.launchHash !== launchHash ||
      payloadBinding(payload, input.signingSecret) !== binding
    ) {
      throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_TERMINAL_PAYLOAD_MISMATCH");
    }
    runIdentityDigest = await canonicalSha256({
      activationHash: payload.activationHash,
      buildCommit: payload.buildCommit,
      runId: payload.runId,
      recoveryHash,
      sessionHash,
      runHash,
      actorHash,
      launchHash,
      continuationSha256: await sha256Hex(payload.continuation),
      payloadBinding: binding,
      nextOrdinal: payload.nextOrdinal,
      terminal: payload.terminal
    });
  } else {
    if (token || ownerHash) throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
    if (
      keyedHash("run", PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID, input.signingSecret) !== runHash
    ) {
      throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_REPLAY_RUN_MISMATCH");
    }
    runIdentityDigest = reply[12] ?? "";
    if (!/^[a-f0-9]{64}$/u.test(runIdentityDigest)) {
      throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_REPLAY_RUN_MISMATCH");
    }
  }
  const computedGuardSnapshotDigest = await canonicalSha256({
    guard: PROBE_FALLBACK_ACK_RECOVERY_GUARD,
    migration: PROBE_FALLBACK_ACK_RECOVERY_MIGRATION,
    activationHash: PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
    appCommit: PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT
  });
  const guardSnapshotDigest =
    disposition === "existing" ? (reply[13] ?? "") : computedGuardSnapshotDigest;
  if (
    !/^[a-f0-9]{64}$/u.test(guardSnapshotDigest) ||
    !safeEqual(guardSnapshotDigest, computedGuardSnapshotDigest)
  ) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_GUARD_DIGEST_MISMATCH");
  }
  const confirmation = await probeFallbackAckRecoveryConfirmation({
    repairCommit: input.repairCommit,
    programHash,
    terminalPayloadBinding: binding,
    guardSnapshotDigest,
    runIdentityDigest
  });
  if (disposition === "existing" && !safeEqual(reply[11] ?? "", confirmation)) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_REPLAY_CONFIRMATION_MISMATCH");
  }
  return Object.freeze({
    disposition,
    repairCommit: input.repairCommit,
    programHash,
    payloadBinding: binding,
    guardSnapshotDigest,
    runIdentityDigest,
    confirmation,
    evidence,
    identityHashes,
    token,
    ownerHash
  });
}

export async function recoverProbeFallbackAck(
  redis: ProbeFallbackAckRecoveryRedisClient,
  input: {
    readonly prepared: PreparedProbeFallbackAckRecovery;
    readonly confirmation: string;
  }
): Promise<{ readonly disposition: "new" | "existing"; readonly acknowledgedAtMs: number }> {
  if (!safeEqual(input.confirmation, input.prepared.confirmation)) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_CONFIRMATION_MISMATCH");
  }
  const reply = strings(
    await redis.eval<string[], unknown>(RECOVER_EXACT_ACK_SCRIPT, redisKeys(), [
      PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
      PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
      input.prepared.repairCommit,
      PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST,
      PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256,
      input.prepared.programHash,
      ...input.prepared.identityHashes,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.guardInstanceId,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.initializedCommit,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.policyVersion,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.policyHash,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.ledgerScriptHash,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.version,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationId,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationDigest,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.predecessorMigrationId,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.predecessorReceiptHash,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.priorAppCommit,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.priorActivationHash,
      PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationProgramHash,
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.runnerContractHash,
      input.prepared.ownerHash,
      input.prepared.payloadBinding,
      input.prepared.token,
      input.prepared.confirmation,
      input.prepared.runIdentityDigest,
      input.prepared.guardSnapshotDigest
    ])
  );
  if (reply[1] !== "ACKNOWLEDGED_NEW" && reply[1] !== "ACKNOWLEDGED_EXISTING") {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
  }
  const acknowledgedAtMs = Number(reply[2]);
  if (!Number.isSafeInteger(acknowledgedAtMs) || acknowledgedAtMs <= 0) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_INVALID_REPLY");
  }
  return Object.freeze({
    disposition: reply[1] === "ACKNOWLEDGED_NEW" ? "new" : "existing",
    acknowledgedAtMs
  });
}

export function assertProbeFallbackAckRecoveryProductionContext(environment: NodeJS.ProcessEnv): {
  readonly repairCommit: string;
  readonly signingSecret: string;
} {
  const repairCommit = environment.VERCEL_GIT_COMMIT_SHA;
  const signingSecret = environment.TOOLPROOF_SIGNING_SECRET;
  if (
    environment.VERCEL !== "1" ||
    environment.VERCEL_ENV !== "production" ||
    environment.VERCEL_PROJECT_ID !== PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID ||
    environment.TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID !== PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID ||
    !repairCommit ||
    !/^[a-f0-9]{40}$/u.test(repairCommit) ||
    environment.TOOLPROOF_PROBE_APPROVED_COMMIT !== repairCommit ||
    environment.TOOLPROOF_PROBE_ACTIVE_COMMIT !== PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT ||
    environment.TOOLPROOF_PROBE_ACTIVATION_HASH !==
      PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH ||
    environment.TOOLPROOF_PROBE_ACTIVATION_MODE !== "calibration" ||
    environment.TOOLPROOF_GUARD_INSTANCE_ID !== PROBE_FALLBACK_ACK_RECOVERY_GUARD.guardInstanceId ||
    environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT !==
      PROBE_FALLBACK_ACK_RECOVERY_GUARD.initializedCommit ||
    !signingSecret
  ) {
    throw new ProbeFallbackAckRecoveryError("ACK_RECOVERY_PRODUCTION_CONTEXT_REQUIRED");
  }
  decodeProbeSigningSecret(signingSecret);
  return { repairCommit, signingSecret };
}
