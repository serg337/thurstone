import "server-only";

import {
  PRODUCTION_PROBE_KEYSPACE,
  probeAuthorizationKey,
  type ProbeGuardIdentity,
  type ProbeRedisClient
} from "@/lib/probe/ledger";
import { PROBE_PURPOSES, type ProbePurpose } from "@/lib/probe/policy";

export type ScoredLedgerRecordState = "ISSUED" | "IN_FLIGHT" | "KNOWN" | "UNCERTAIN" | "EXPIRED";

export interface ScoredLedgerRecord {
  readonly state: ScoredLedgerRecordState;
  readonly jti: string;
  readonly claimsHash: string;
  readonly purpose: ProbePurpose;
  readonly dispatchSequence: number | null;
  readonly actualNanoUsd: number | null;
  readonly providerResponseHash: string | null;
  readonly settlementDigest: string | null;
  readonly usageHash: string | null;
}

export class ScoredLedgerRecordError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredLedgerRecordError";
  }
}

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "guard_instance_id") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "policy_hash") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "script_hash") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "jti") ~= ARGV[4]
then return {0, "SCORED_LEDGER_RECORD_MISMATCH"} end
return {1, "FOUND", redis.call("HGETALL", KEYS[1])}
`;

function hashReply(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, String(nested)])
    );
  }
  if (!Array.isArray(value) || value.length % 2 !== 0) {
    throw new ScoredLedgerRecordError("INVALID_REPLY");
  }
  const result: Record<string, string> = {};
  for (let index = 0; index < value.length; index += 2) {
    result[String(value[index])] = String(value[index + 1]);
  }
  return result;
}

function integer(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/u.test(value)) throw new ScoredLedgerRecordError("INVALID_RECORD");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ScoredLedgerRecordError("INVALID_RECORD");
  }
  return parsed;
}

function optionalHash(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new ScoredLedgerRecordError("INVALID_RECORD");
  return value;
}

export async function readScoredLedgerRecord(
  redis: ProbeRedisClient,
  input: ProbeGuardIdentity & { readonly jti: string }
): Promise<ScoredLedgerRecord | null> {
  const result = await redis.evalRo<string[], unknown>(
    READ_SCRIPT,
    [probeAuthorizationKey(PRODUCTION_PROBE_KEYSPACE, input.jti)],
    [input.guardInstanceId, input.policyHash, input.scriptHash, input.jti]
  );
  if (!Array.isArray(result) || result.length < 2) {
    throw new ScoredLedgerRecordError("INVALID_REPLY");
  }
  if (Number(result[0]) === 0) {
    throw new ScoredLedgerRecordError(String(result[1] ?? "DENIED"));
  }
  if (String(result[1]) === "MISSING") return null;
  const record = hashReply(result[2]);
  const state = record.state as ScoredLedgerRecordState;
  const purpose = record.purpose as ProbePurpose;
  if (
    !["ISSUED", "IN_FLIGHT", "KNOWN", "UNCERTAIN", "EXPIRED"].includes(state) ||
    !PROBE_PURPOSES.includes(purpose) ||
    record.jti !== input.jti ||
    !/^[a-f0-9]{64}$/u.test(record.claims_hash ?? "")
  ) {
    throw new ScoredLedgerRecordError("INVALID_RECORD");
  }
  return Object.freeze({
    state,
    jti: record.jti,
    claimsHash: record.claims_hash!,
    purpose,
    dispatchSequence: integer(record.dispatch_sequence),
    actualNanoUsd: integer(record.actual_nusd),
    providerResponseHash: optionalHash(record.provider_response_hash),
    settlementDigest: optionalHash(record.settlement_digest),
    usageHash: optionalHash(record.usage_hash)
  });
}
