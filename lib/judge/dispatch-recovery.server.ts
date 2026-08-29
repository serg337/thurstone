import "server-only";

import {
  PRODUCTION_PROBE_KEYSPACE,
  type ProbeLedgerKeyspace,
  type ProbeRedisClient
} from "@/lib/probe/ledger";

const READ_JUDGE_DISPATCH_SCRIPT = `
local uncertain_jti = redis.call("HGET", KEYS[1], "uncertain_jti")
if uncertain_jti then
  local auth_key = ARGV[1] .. ":auth:" .. uncertain_jti
  if redis.call("HGET", auth_key, "jti") ~= uncertain_jti
    or redis.call("HGET", auth_key, "purpose") ~= "judge"
    or redis.call("HGET", auth_key, "state") ~= "UNCERTAIN"
  then return {0, "UNCERTAIN_AUTH_MISMATCH"} end
  return {1, "uncertain", uncertain_jti,
    redis.call("HGET", auth_key, "settlement_digest"),
    redis.call("HGET", auth_key, "uncertain_reason") or "unknown",
    redis.call("HGET", auth_key, "settled_at_ms") or "0"}
end

local inflight = redis.call("ZRANGE", KEYS[2], 0, -1, "WITHSCORES")
if #inflight == 0 then return {1, "empty"} end
if #inflight ~= 2 then return {0, "INFLIGHT_CARDINALITY_INVALID"} end
local jti = inflight[1]
local lease_expires_at = inflight[2]
local auth_key = ARGV[1] .. ":auth:" .. jti
if redis.call("HGET", auth_key, "jti") ~= jti
  or redis.call("HGET", auth_key, "purpose") ~= "judge"
  or redis.call("HGET", auth_key, "state") ~= "IN_FLIGHT"
  or redis.call("HGET", auth_key, "lease_expires_at") ~= lease_expires_at
then return {0, "INFLIGHT_AUTH_MISMATCH"} end
return {1, "inflight", jti, lease_expires_at,
  redis.call("HGET", auth_key, "dispatch_at") or "0"}
`;

export const JUDGE_DEMO_DISPATCH_RECOVERY_SCRIPTS = Object.freeze({
  read: READ_JUDGE_DISPATCH_SCRIPT
});

export type JudgeDemoDispatchState =
  | { readonly state: "empty" }
  | {
      readonly state: "inflight";
      readonly jti: string;
      readonly leaseExpiresAt: number;
      readonly dispatchedAt: number;
    }
  | {
      readonly state: "uncertain";
      readonly jti: string;
      readonly settlementDigest: string;
      readonly reason: string;
      readonly settledAtMs: number;
    };

function integer(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("judge_demo_dispatch_recovery_reply_invalid");
  }
  return parsed;
}

function hash(value: unknown): string {
  const parsed = String(value);
  if (!/^[a-f0-9]{64}$/u.test(parsed)) {
    throw new Error("judge_demo_dispatch_recovery_reply_invalid");
  }
  return parsed;
}

export async function readJudgeDemoDispatchState(
  redis: ProbeRedisClient,
  keyspace: ProbeLedgerKeyspace = PRODUCTION_PROBE_KEYSPACE
): Promise<JudgeDemoDispatchState> {
  const reply = await redis.evalRo<[string], unknown>(
    READ_JUDGE_DISPATCH_SCRIPT,
    [keyspace.config, keyspace.inflight],
    [keyspace.namespace]
  );
  if (!Array.isArray(reply) || Number(reply[0]) !== 1) {
    throw new Error(
      Array.isArray(reply) && reply[1]
        ? String(reply[1])
        : "judge_demo_dispatch_recovery_reply_invalid"
    );
  }
  const state = String(reply[1]);
  if (state === "empty") return Object.freeze({ state });
  const jti = String(reply[2]);
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(jti)) {
    throw new Error("judge_demo_dispatch_recovery_reply_invalid");
  }
  if (state === "inflight") {
    return Object.freeze({
      state,
      jti,
      leaseExpiresAt: integer(reply[3]),
      dispatchedAt: integer(reply[4])
    });
  }
  if (state === "uncertain") {
    return Object.freeze({
      state,
      jti,
      settlementDigest: hash(reply[3]),
      reason: String(reply[4]).slice(0, 160),
      settledAtMs: integer(reply[5])
    });
  }
  throw new Error("judge_demo_dispatch_recovery_reply_invalid");
}
