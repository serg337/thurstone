import "server-only";

import { createHash } from "node:crypto";

import { createProbeRedis } from "@/lib/probe/ledger";

export const BYOA_HANDOFF_LEDGER_V2_VERSION = "thurstone-byoa-handoff-ledger@2" as const;
export const BYOA_HANDOFF_LEDGER_V2_NAMESPACE = "tp:{webmcp26}:demo-handoff-v2" as const;
export const BYOA_HANDOFF_LEDGER_V2_MAX_TTL_MS = 15 * 60 * 1000;
export const BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS = 120 * 1000;
export const BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS = 5 * 1000;
/** Provider-independent issuance window enforced atomically by Redis server time. */
export const BYOA_HANDOFF_LEDGER_V2_ISSUE_WINDOW_MS = 60 * 1000;
/** Maximum newly issued v2 handoffs in one rolling issuance window. */
export const BYOA_HANDOFF_LEDGER_V2_ISSUE_LIMIT = 60;
/** Maximum concurrently active, unexpired v2 handoffs. */
export const BYOA_HANDOFF_LEDGER_V2_ACTIVE_LIMIT = 200;
export const BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY =
  `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:issuance-rate` as const;
export const BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY =
  `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:active` as const;

const runIdPattern = /^byoa_run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

export type ByoaHandoffLedgerV2State =
  | "ISSUED"
  | "CLAIMED"
  | "RECEIVED"
  | "STARTED"
  | "SETTLED"
  | "TIMED_OUT"
  | "UNAVAILABLE"
  | "REVOKED";

export interface ByoaHandoffLedgerV2Redis {
  eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
  evalRo<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
}

export interface ByoaHandoffLedgerV2Binding {
  readonly runId: string;
  readonly contractDigest: string;
  readonly token: string;
}

export interface ByoaHandoffLedgerV2ContextBinding extends ByoaHandoffLedgerV2Binding {
  readonly freshContextId: string;
}

export interface ByoaHandoffLedgerV2Receipt {
  readonly disposition: string;
  readonly state: ByoaHandoffLedgerV2State;
  readonly serverTimeMs: number;
  readonly expiresAtMs: number;
  readonly startedAtMs: number | null;
}

export interface ByoaHandoffLedgerV2Status {
  readonly state: ByoaHandoffLedgerV2State;
  readonly contractDigest: string;
  readonly tokenDigest: string;
  readonly freshContextDigest: string | null;
  readonly issuedAtMs: number;
  readonly claimedAtMs: number | null;
  readonly receivedAtMs: number | null;
  readonly startedAtMs: number | null;
  readonly terminalAtMs: number | null;
  readonly expiresAtMs: number;
  readonly ttlMs: number;
  readonly verdict: "pass" | "issue" | "incomplete" | "unavailable" | null;
  readonly resultDigest: string | null;
}

export class ByoaHandoffLedgerV2Error extends Error {
  constructor(
    readonly code: string,
    readonly details: readonly unknown[] = []
  ) {
    super(code);
    this.name = "ByoaHandoffLedgerV2Error";
  }
}

const ISSUE_SCRIPT = `
-- thurstone:demo-handoff-v2:issue
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local expires_at_ms = tonumber(ARGV[4])
if not expires_at_ms or expires_at_ms <= now_ms then return {0, "HANDOFF_EXPIRED"} end
if expires_at_ms - now_ms > tonumber(ARGV[5]) then return {0, "HANDOFF_TTL_INVALID"} end

if redis.call("EXISTS", KEYS[1]) == 1 then
  local state = redis.call("HGET", KEYS[1], "s")
  if state == "ISSUED"
    and redis.call("HGET", KEYS[1], "v") == ARGV[1]
    and redis.call("HGET", KEYS[1], "c") == ARGV[2]
    and redis.call("HGET", KEYS[1], "t") == ARGV[3]
    and redis.call("HGET", KEYS[1], "x") == ARGV[4]
  then
    return {2, "ISSUE_EXISTING", state, now_ms, expires_at_ms, 0}
  end
  return {0, "HANDOFF_ISSUE_CONFLICT", state or "MISSING"}
end

redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now_ms - tonumber(ARGV[6]))
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now_ms)
local issued_in_window = tonumber(redis.call("ZCARD", KEYS[2]) or "0")
if issued_in_window >= tonumber(ARGV[7]) then
  return {0, "HANDOFF_ISSUE_RATE_LIMIT", tostring(issued_in_window)}
end
local active_count = tonumber(redis.call("ZCARD", KEYS[3]) or "0")
if active_count >= tonumber(ARGV[8]) then
  return {0, "HANDOFF_ACTIVE_LIMIT", tostring(active_count)}
end

redis.call("HSET", KEYS[1],
  "v", ARGV[1],
  "s", "ISSUED",
  "c", ARGV[2],
  "t", ARGV[3],
  "x", ARGV[4],
  "i", tostring(now_ms)
)
redis.call("PEXPIREAT", KEYS[1], expires_at_ms)
redis.call("ZADD", KEYS[2], now_ms, ARGV[3])
redis.call("PEXPIRE", KEYS[2], tonumber(ARGV[6]) + 1000)
redis.call("ZADD", KEYS[3], expires_at_ms, ARGV[3])
redis.call("PEXPIRE", KEYS[3], tonumber(ARGV[5]) + 1000)
return {1, "ISSUED_NEW", "ISSUED", now_ms, expires_at_ms, 0}
`;

const CLAIM_SCRIPT = `
-- thurstone:demo-handoff-v2:claim
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
local context = redis.call("HGET", KEYS[1], "f")
if state == "ISSUED" then
  redis.call("HSET", KEYS[1], "s", "CLAIMED", "f", ARGV[4], "k", tostring(now_ms))
  return {1, "CLAIMED_NEW", "CLAIMED", now_ms, expires_at_ms, 0}
end
if context == ARGV[4] and state ~= "REVOKED" then
  return {2, "CLAIM_EXISTING", state, now_ms, expires_at_ms,
    tonumber(redis.call("HGET", KEYS[1], "a") or "0")}
end
return {0, "HANDOFF_ALREADY_CLAIMED", state or "MISSING"}
`;

const RECEIVE_SCRIPT = `
-- thurstone:demo-handoff-v2:receive
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
if state == "CLAIMED" then
  redis.call("HSET", KEYS[1], "s", "RECEIVED", "r", tostring(now_ms))
  return {1, "RECEIVED_NEW", "RECEIVED", now_ms, expires_at_ms, 0}
end
if state == "RECEIVED" then
  return {2, "RECEIVED_EXISTING", state, now_ms, expires_at_ms, 0}
end
return {0, "HANDOFF_RECEIVE_INVALID_STATE", state or "MISSING"}
`;

const START_SCRIPT = `
-- thurstone:demo-handoff-v2:start
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
if state ~= "RECEIVED" then return {0, "HANDOFF_START_INVALID_STATE", state or "MISSING"} end
if expires_at_ms - now_ms < tonumber(ARGV[5]) + tonumber(ARGV[6]) then
  return {0, "HANDOFF_LIFETIME_INSUFFICIENT", tostring(expires_at_ms - now_ms)}
end
redis.call("HSET", KEYS[1], "s", "STARTED", "a", tostring(now_ms))
return {1, "STARTED_NEW", "STARTED", now_ms, expires_at_ms, now_ms}
`;

const TERMINAL_SCRIPT = `
-- thurstone:demo-handoff-v2:terminal
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
if state ~= "STARTED" then return {0, "HANDOFF_TERMINAL_INVALID_STATE", state or "MISSING"} end
if ARGV[5] ~= "SETTLED" and ARGV[5] ~= "UNAVAILABLE" then
  return {0, "HANDOFF_TERMINAL_INVALID_TARGET"}
end
local started_at_ms = tonumber(redis.call("HGET", KEYS[1], "a") or "0")
redis.call("HSET", KEYS[1], "s", ARGV[5], "z", tostring(now_ms))
redis.call("ZREM", KEYS[2], ARGV[3])
return {1, ARGV[5] .. "_NEW", ARGV[5], now_ms, expires_at_ms, started_at_ms}
`;

const TIMEOUT_SCRIPT = `
-- thurstone:demo-handoff-v2:timeout
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
if state ~= "STARTED" then return {0, "HANDOFF_TIMEOUT_INVALID_STATE", state or "MISSING"} end
local started_at_ms = tonumber(redis.call("HGET", KEYS[1], "a") or "0")
if now_ms < started_at_ms + tonumber(ARGV[5]) then
  return {0, "HANDOFF_TIMEOUT_EARLY", tostring(started_at_ms + tonumber(ARGV[5]) - now_ms)}
end
redis.call("HSET", KEYS[1], "s", "TIMED_OUT", "z", tostring(now_ms))
redis.call("ZREM", KEYS[2], ARGV[3])
return {1, "TIMED_OUT_NEW", "TIMED_OUT", now_ms, expires_at_ms, started_at_ms}
`;

const REVEAL_SCRIPT = `
-- thurstone:demo-handoff-v2:reveal
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end

local state = redis.call("HGET", KEYS[1], "s")
if state ~= "SETTLED" and state ~= "TIMED_OUT" and state ~= "UNAVAILABLE" then
  return {0, "HANDOFF_REVEAL_TOO_EARLY", state or "MISSING"}
end
return {1, "REVEAL_GRANTED", state, now_ms, expires_at_ms,
  tonumber(redis.call("HGET", KEYS[1], "a") or "0")}
`;

const REVOKE_SCRIPT = `
-- thurstone:demo-handoff-v2:revoke
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
local expires_at_ms = tonumber(redis.call("HGET", KEYS[1], "x") or "0")
if expires_at_ms <= now_ms or redis.call("PTTL", KEYS[1]) <= 0 then
  return {0, "HANDOFF_EXPIRED"}
end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
then return {0, "HANDOFF_BINDING_MISMATCH"} end
local state = redis.call("HGET", KEYS[1], "s")
if state == "REVOKED" then
  redis.call("ZREM", KEYS[2], ARGV[3])
  return {2, "REVOKED_EXISTING", state, now_ms, expires_at_ms, 0}
end
if state ~= "ISSUED" then return {0, "HANDOFF_REVOKE_INVALID_STATE", state or "MISSING"} end
redis.call("HSET", KEYS[1], "s", "REVOKED", "z", tostring(now_ms))
redis.call("ZREM", KEYS[2], ARGV[3])
return {1, "REVOKED_NEW", "REVOKED", now_ms, expires_at_ms, 0}
`;

const READ_SCRIPT = `
-- thurstone:demo-handoff-v2:read
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
return {1, "FOUND",
  redis.call("HGET", KEYS[1], "s"),
  redis.call("HGET", KEYS[1], "c"),
  redis.call("HGET", KEYS[1], "t"),
  redis.call("HGET", KEYS[1], "f") or "",
  redis.call("HGET", KEYS[1], "i") or "0",
  redis.call("HGET", KEYS[1], "k") or "0",
  redis.call("HGET", KEYS[1], "r") or "0",
  redis.call("HGET", KEYS[1], "a") or "0",
  redis.call("HGET", KEYS[1], "z") or "0",
  redis.call("HGET", KEYS[1], "x") or "0",
  redis.call("PTTL", KEYS[1]),
  redis.call("HGET", KEYS[1], "q") or "",
  redis.call("HGET", KEYS[1], "d") or ""}
`;

const REPORT_SCRIPT = `
-- thurstone:demo-handoff-v2:report
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "HANDOFF_MISSING"} end
if redis.call("HGET", KEYS[1], "v") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "c") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "t") ~= ARGV[3]
  or redis.call("HGET", KEYS[1], "f") ~= ARGV[4]
then return {0, "HANDOFF_BINDING_MISMATCH"} end
local state = redis.call("HGET", KEYS[1], "s")
local verdict = ARGV[5]
if (state == "SETTLED" and verdict ~= "pass" and verdict ~= "issue")
  or (state == "TIMED_OUT" and verdict ~= "incomplete")
  or (state == "UNAVAILABLE" and verdict ~= "unavailable")
then return {0, "HANDOFF_RESULT_STATE_MISMATCH", state or "MISSING"} end
local existing_verdict = redis.call("HGET", KEYS[1], "q")
local existing_digest = redis.call("HGET", KEYS[1], "d")
if existing_verdict then
  if existing_verdict == verdict and existing_digest == ARGV[6] then
    return {2, "RESULT_EXISTING", state, now_ms, tonumber(redis.call("HGET", KEYS[1], "x") or "0"),
      tonumber(redis.call("HGET", KEYS[1], "a") or "0")}
  end
  return {0, "HANDOFF_RESULT_CONFLICT"}
end
redis.call("HSET", KEYS[1], "q", verdict, "d", ARGV[6])
return {1, "RESULT_RECORDED", state, now_ms, tonumber(redis.call("HGET", KEYS[1], "x") or "0"),
  tonumber(redis.call("HGET", KEYS[1], "a") or "0")}
`;

export const BYOA_HANDOFF_LEDGER_V2_SCRIPTS = Object.freeze({
  issue: ISSUE_SCRIPT,
  claim: CLAIM_SCRIPT,
  receive: RECEIVE_SCRIPT,
  start: START_SCRIPT,
  terminal: TERMINAL_SCRIPT,
  timeout: TIMEOUT_SCRIPT,
  reveal: REVEAL_SCRIPT,
  revoke: REVOKE_SCRIPT,
  read: READ_SCRIPT,
  report: REPORT_SCRIPT
});

function digestSecret(kind: "token" | "context", value: string): string {
  if (value.length < 16 || value.length > 8 * 1024) {
    throw new ByoaHandoffLedgerV2Error(`INVALID_${kind.toUpperCase()}`);
  }
  return createHash("sha256")
    .update(`thurstone:demo-handoff-v2:${kind}\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function digestByoaHandoffV2Token(token: string): string {
  return digestSecret("token", token);
}

export function digestByoaHandoffV2Context(freshContextId: string): string {
  return digestSecret("context", freshContextId);
}

export function byoaHandoffLedgerV2Key(runId: string): string {
  if (!runIdPattern.test(runId)) throw new ByoaHandoffLedgerV2Error("INVALID_RUN_ID");
  const key = `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:${runId}`;
  if (
    !/^tp:\{webmcp26\}:demo-handoff-v2:byoa_run_[0-9a-f-]{36}$/u.test(key) ||
    key !== `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:${runId}`
  ) {
    throw new ByoaHandoffLedgerV2Error("INVALID_HANDOFF_KEY");
  }
  return key;
}

interface BrowserFakeRecord {
  version: string;
  state: ByoaHandoffLedgerV2State;
  contractDigest: string;
  tokenDigest: string;
  freshContextDigest: string | null;
  issuedAtMs: number;
  claimedAtMs: number | null;
  receivedAtMs: number | null;
  startedAtMs: number | null;
  terminalAtMs: number | null;
  expiresAtMs: number;
  verdict: "pass" | "issue" | "incomplete" | "unavailable" | null;
  resultDigest: string | null;
}

const browserFakeGlobal = globalThis as typeof globalThis & {
  __thurstoneByoaHandoffLedgerV2?: Map<string, BrowserFakeRecord>;
  __thurstoneByoaHandoffIssueRateV2?: Map<string, number>;
  __thurstoneByoaHandoffActiveV2?: Map<string, number>;
};

class BrowserFakeByoaHandoffLedgerV2Redis implements ByoaHandoffLedgerV2Redis {
  private readonly records =
    browserFakeGlobal.__thurstoneByoaHandoffLedgerV2 ??
    (browserFakeGlobal.__thurstoneByoaHandoffLedgerV2 = new Map());
  private readonly issuanceRate =
    browserFakeGlobal.__thurstoneByoaHandoffIssueRateV2 ??
    (browserFakeGlobal.__thurstoneByoaHandoffIssueRateV2 = new Map());
  private readonly active =
    browserFakeGlobal.__thurstoneByoaHandoffActiveV2 ??
    (browserFakeGlobal.__thurstoneByoaHandoffActiveV2 = new Map());

  private record(key: string): BrowserFakeRecord | undefined {
    const record = this.records.get(key);
    if (record && record.expiresAtMs <= Date.now()) {
      this.records.delete(key);
      this.active.delete(record.tokenDigest);
      return undefined;
    }
    return record;
  }

  private reapGuard(now: number, issueWindowMs: number): void {
    for (const [tokenDigest, issuedAtMs] of this.issuanceRate) {
      if (issuedAtMs <= now - issueWindowMs) this.issuanceRate.delete(tokenDigest);
    }
    for (const [tokenDigest, expiresAtMs] of this.active) {
      if (expiresAtMs <= now) this.active.delete(tokenDigest);
    }
  }

  async eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult> {
    return this.execute(script, keys, args) as TResult;
  }

  async evalRo<TResult = unknown>(
    script: string,
    keys: string[],
    args: string[]
  ): Promise<TResult> {
    return this.execute(script, keys, args) as TResult;
  }

  private execute(script: string, keys: string[], args: string[]): unknown {
    const key = keys[0];
    if (!key || !key.startsWith(`${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:byoa_run_`)) {
      return [0, "INVALID_HANDOFF_KEY"];
    }
    const now = Date.now();
    const record = this.record(key);
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.issue) {
      if (
        keys[1] !== BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY ||
        keys[2] !== BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY
      ) {
        return [0, "INVALID_HANDOFF_GUARD_KEY"];
      }
      const expiresAtMs = Number(args[3]);
      if (expiresAtMs <= now) return [0, "HANDOFF_EXPIRED"];
      if (expiresAtMs - now > Number(args[4])) return [0, "HANDOFF_TTL_INVALID"];
      if (record) {
        return record.state === "ISSUED" &&
          record.version === args[0] &&
          record.contractDigest === args[1] &&
          record.tokenDigest === args[2] &&
          record.expiresAtMs === expiresAtMs
          ? [2, "ISSUE_EXISTING", record.state, now, expiresAtMs, 0]
          : [0, "HANDOFF_ISSUE_CONFLICT", record.state];
      }
      const issueWindowMs = Number(args[5]);
      this.reapGuard(now, issueWindowMs);
      if (this.issuanceRate.size >= Number(args[6])) {
        return [0, "HANDOFF_ISSUE_RATE_LIMIT", String(this.issuanceRate.size)];
      }
      if (this.active.size >= Number(args[7])) {
        return [0, "HANDOFF_ACTIVE_LIMIT", String(this.active.size)];
      }
      this.records.set(key, {
        version: args[0]!,
        state: "ISSUED",
        contractDigest: args[1]!,
        tokenDigest: args[2]!,
        freshContextDigest: null,
        issuedAtMs: now,
        claimedAtMs: null,
        receivedAtMs: null,
        startedAtMs: null,
        terminalAtMs: null,
        expiresAtMs,
        verdict: null,
        resultDigest: null
      });
      this.issuanceRate.set(args[2]!, now);
      this.active.set(args[2]!, expiresAtMs);
      return [1, "ISSUED_NEW", "ISSUED", now, expiresAtMs, 0];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.read && !record) {
      return [2, "MISSING"];
    }
    if (!record) return [0, "HANDOFF_MISSING"];
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.read) {
      return [
        1,
        "FOUND",
        record.state,
        record.contractDigest,
        record.tokenDigest,
        record.freshContextDigest ?? "",
        record.issuedAtMs,
        record.claimedAtMs ?? 0,
        record.receivedAtMs ?? 0,
        record.startedAtMs ?? 0,
        record.terminalAtMs ?? 0,
        record.expiresAtMs,
        Math.max(0, record.expiresAtMs - now),
        record.verdict ?? "",
        record.resultDigest ?? ""
      ];
    }
    const contextBound =
      record.version === args[0] &&
      record.contractDigest === args[1] &&
      record.tokenDigest === args[2];
    if (!contextBound) return [0, "HANDOFF_BINDING_MISMATCH"];
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.revoke) {
      if (keys[1] !== BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY) {
        return [0, "INVALID_HANDOFF_GUARD_KEY"];
      }
      if (record.state === "REVOKED") {
        this.active.delete(record.tokenDigest);
        return [2, "REVOKED_EXISTING", "REVOKED", now, record.expiresAtMs, 0];
      }
      if (record.state !== "ISSUED") return [0, "HANDOFF_REVOKE_INVALID_STATE", record.state];
      record.state = "REVOKED";
      record.terminalAtMs = now;
      this.active.delete(record.tokenDigest);
      return [1, "REVOKED_NEW", "REVOKED", now, record.expiresAtMs, 0];
    }
    const context = args[3];
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.claim) {
      if (record.state === "ISSUED") {
        record.state = "CLAIMED";
        record.freshContextDigest = context!;
        record.claimedAtMs = now;
        return [1, "CLAIMED_NEW", "CLAIMED", now, record.expiresAtMs, 0];
      }
      return record.freshContextDigest === context && record.state !== "REVOKED"
        ? [2, "CLAIM_EXISTING", record.state, now, record.expiresAtMs, record.startedAtMs ?? 0]
        : [0, "HANDOFF_ALREADY_CLAIMED", record.state];
    }
    if (record.freshContextDigest !== context) return [0, "HANDOFF_BINDING_MISMATCH"];
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.report) {
      const verdict = args[4] as BrowserFakeRecord["verdict"];
      const digest = args[5]!;
      const valid =
        (record.state === "SETTLED" && (verdict === "pass" || verdict === "issue")) ||
        (record.state === "TIMED_OUT" && verdict === "incomplete") ||
        (record.state === "UNAVAILABLE" && verdict === "unavailable");
      if (!valid) return [0, "HANDOFF_RESULT_STATE_MISMATCH", record.state];
      if (record.verdict !== null) {
        return record.verdict === verdict && record.resultDigest === digest
          ? [2, "RESULT_EXISTING", record.state, now, record.expiresAtMs, record.startedAtMs ?? 0]
          : [0, "HANDOFF_RESULT_CONFLICT"];
      }
      record.verdict = verdict;
      record.resultDigest = digest;
      return [1, "RESULT_RECORDED", record.state, now, record.expiresAtMs, record.startedAtMs ?? 0];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.receive) {
      if (record.state === "CLAIMED") {
        record.state = "RECEIVED";
        record.receivedAtMs = now;
        return [1, "RECEIVED_NEW", "RECEIVED", now, record.expiresAtMs, 0];
      }
      return record.state === "RECEIVED"
        ? [2, "RECEIVED_EXISTING", "RECEIVED", now, record.expiresAtMs, 0]
        : [0, "HANDOFF_RECEIVE_INVALID_STATE", record.state];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.start) {
      if (record.state !== "RECEIVED") return [0, "HANDOFF_START_INVALID_STATE", record.state];
      if (record.expiresAtMs - now < Number(args[4]) + Number(args[5])) {
        return [0, "HANDOFF_LIFETIME_INSUFFICIENT", String(record.expiresAtMs - now)];
      }
      record.state = "STARTED";
      record.startedAtMs = now;
      return [1, "STARTED_NEW", "STARTED", now, record.expiresAtMs, now];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.terminal) {
      if (keys[1] !== BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY) {
        return [0, "INVALID_HANDOFF_GUARD_KEY"];
      }
      if (record.state !== "STARTED") {
        return [0, "HANDOFF_TERMINAL_INVALID_STATE", record.state];
      }
      const target = args[4];
      if (target !== "SETTLED" && target !== "UNAVAILABLE") {
        return [0, "HANDOFF_TERMINAL_INVALID_TARGET"];
      }
      record.state = target;
      record.terminalAtMs = now;
      this.active.delete(record.tokenDigest);
      return [1, `${target}_NEW`, target, now, record.expiresAtMs, record.startedAtMs ?? 0];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.timeout) {
      if (keys[1] !== BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY) {
        return [0, "INVALID_HANDOFF_GUARD_KEY"];
      }
      if (record.state !== "STARTED") return [0, "HANDOFF_TIMEOUT_INVALID_STATE", record.state];
      const dueAt = (record.startedAtMs ?? 0) + Number(args[4]);
      if (now < dueAt) return [0, "HANDOFF_TIMEOUT_EARLY", String(dueAt - now)];
      record.state = "TIMED_OUT";
      record.terminalAtMs = now;
      this.active.delete(record.tokenDigest);
      return [1, "TIMED_OUT_NEW", "TIMED_OUT", now, record.expiresAtMs, record.startedAtMs ?? 0];
    }
    if (script === BYOA_HANDOFF_LEDGER_V2_SCRIPTS.reveal) {
      return ["SETTLED", "TIMED_OUT", "UNAVAILABLE"].includes(record.state)
        ? [1, "REVEAL_GRANTED", record.state, now, record.expiresAtMs, record.startedAtMs ?? 0]
        : [0, "HANDOFF_REVEAL_TOO_EARLY", record.state];
    }
    return [0, "UNKNOWN_HANDOFF_OPERATION"];
  }
}

export function createByoaHandoffLedgerV2Redis(
  environment: NodeJS.ProcessEnv = process.env
): ByoaHandoffLedgerV2Redis {
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    if (environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production") {
      throw new ByoaHandoffLedgerV2Error("BROWSER_FAKE_LEDGER_FORBIDDEN");
    }
    return new BrowserFakeByoaHandoffLedgerV2Redis();
  }
  return createProbeRedis(environment) as unknown as ByoaHandoffLedgerV2Redis;
}

export function resetByoaHandoffLedgerV2FakeForTests(
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (environment.NODE_ENV !== "test") {
    throw new ByoaHandoffLedgerV2Error("BROWSER_FAKE_RESET_FORBIDDEN");
  }
  browserFakeGlobal.__thurstoneByoaHandoffLedgerV2?.clear();
  browserFakeGlobal.__thurstoneByoaHandoffIssueRateV2?.clear();
  browserFakeGlobal.__thurstoneByoaHandoffActiveV2?.clear();
}

function assertDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) throw new ByoaHandoffLedgerV2Error(`INVALID_${label}`);
}

function parseInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  return parsed;
}

function parseReply(reply: unknown): ByoaHandoffLedgerV2Receipt {
  if (!Array.isArray(reply) || reply.length < 2) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  if (Number(reply[0]) === 0) {
    throw new ByoaHandoffLedgerV2Error(String(reply[1] ?? "HANDOFF_DENIED"), reply.slice(2));
  }
  const state = String(reply[2]) as ByoaHandoffLedgerV2State;
  if (
    ![
      "ISSUED",
      "CLAIMED",
      "RECEIVED",
      "STARTED",
      "SETTLED",
      "TIMED_OUT",
      "UNAVAILABLE",
      "REVOKED"
    ].includes(state)
  ) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  const startedAtMs = parseInteger(reply[5] ?? 0);
  return Object.freeze({
    disposition: String(reply[1]),
    state,
    serverTimeMs: parseInteger(reply[3]),
    expiresAtMs: parseInteger(reply[4]),
    startedAtMs: startedAtMs === 0 ? null : startedAtMs
  });
}

function bindingArguments(input: ByoaHandoffLedgerV2ContextBinding): string[] {
  assertDigest(input.contractDigest, "CONTRACT_DIGEST");
  return [
    BYOA_HANDOFF_LEDGER_V2_VERSION,
    input.contractDigest,
    digestByoaHandoffV2Token(input.token),
    digestByoaHandoffV2Context(input.freshContextId)
  ];
}

export async function issueByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2Binding & { readonly expiresAtMs: number }
): Promise<ByoaHandoffLedgerV2Receipt> {
  assertDigest(input.contractDigest, "CONTRACT_DIGEST");
  if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= 0) {
    throw new ByoaHandoffLedgerV2Error("INVALID_EXPIRES_AT");
  }
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.issue,
      [
        byoaHandoffLedgerV2Key(input.runId),
        BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY,
        BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY
      ],
      [
        BYOA_HANDOFF_LEDGER_V2_VERSION,
        input.contractDigest,
        digestByoaHandoffV2Token(input.token),
        String(input.expiresAtMs),
        String(BYOA_HANDOFF_LEDGER_V2_MAX_TTL_MS),
        String(BYOA_HANDOFF_LEDGER_V2_ISSUE_WINDOW_MS),
        String(BYOA_HANDOFF_LEDGER_V2_ISSUE_LIMIT),
        String(BYOA_HANDOFF_LEDGER_V2_ACTIVE_LIMIT)
      ]
    )
  );
}

export async function claimByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.claim,
      [byoaHandoffLedgerV2Key(input.runId)],
      bindingArguments(input)
    )
  );
}

export async function receiveByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.receive,
      [byoaHandoffLedgerV2Key(input.runId)],
      bindingArguments(input)
    )
  );
}

export async function startByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.start,
      [byoaHandoffLedgerV2Key(input.runId)],
      [
        ...bindingArguments(input),
        String(BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS),
        String(BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS)
      ]
    )
  );
}

export async function settleByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding,
  terminal: "SETTLED" | "UNAVAILABLE"
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.terminal,
      [byoaHandoffLedgerV2Key(input.runId), BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY],
      [...bindingArguments(input), terminal]
    )
  );
}

export async function timeoutByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.timeout,
      [byoaHandoffLedgerV2Key(input.runId), BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY],
      [...bindingArguments(input), String(BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS)]
    )
  );
}

export async function reportByoaHandoffV2Result(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding & {
    readonly verdict: "pass" | "issue" | "incomplete" | "unavailable";
    readonly resultDigest: string;
  }
): Promise<ByoaHandoffLedgerV2Receipt> {
  assertDigest(input.resultDigest, "RESULT_DIGEST");
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.report,
      [byoaHandoffLedgerV2Key(input.runId)],
      [...bindingArguments(input), input.verdict, input.resultDigest]
    )
  );
}

export async function grantByoaHandoffV2Reveal(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2ContextBinding
): Promise<ByoaHandoffLedgerV2Receipt> {
  return parseReply(
    await redis.evalRo(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.reveal,
      [byoaHandoffLedgerV2Key(input.runId)],
      bindingArguments(input)
    )
  );
}

export async function revokeByoaHandoffV2(
  redis: ByoaHandoffLedgerV2Redis,
  input: ByoaHandoffLedgerV2Binding
): Promise<ByoaHandoffLedgerV2Receipt> {
  assertDigest(input.contractDigest, "CONTRACT_DIGEST");
  return parseReply(
    await redis.eval(
      BYOA_HANDOFF_LEDGER_V2_SCRIPTS.revoke,
      [byoaHandoffLedgerV2Key(input.runId), BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY],
      [BYOA_HANDOFF_LEDGER_V2_VERSION, input.contractDigest, digestByoaHandoffV2Token(input.token)]
    )
  );
}

function nullableInteger(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed === 0 ? null : parsed;
}

export async function readByoaHandoffV2Status(
  redis: ByoaHandoffLedgerV2Redis,
  runId: string
): Promise<ByoaHandoffLedgerV2Status | null> {
  const reply = await redis.evalRo<unknown>(
    BYOA_HANDOFF_LEDGER_V2_SCRIPTS.read,
    [byoaHandoffLedgerV2Key(runId)],
    []
  );
  if (!Array.isArray(reply) || reply.length < 2) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  if (Number(reply[0]) === 2 && String(reply[1]) === "MISSING") return null;
  if (reply.length < 15) throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  if (Number(reply[0]) !== 1 || String(reply[1]) !== "FOUND") {
    throw new ByoaHandoffLedgerV2Error(String(reply[1] ?? "INVALID_LEDGER_REPLY"));
  }
  const state = String(reply[2]) as ByoaHandoffLedgerV2State;
  if (!digestPattern.test(String(reply[3])) || !digestPattern.test(String(reply[4]))) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  const context = String(reply[5] ?? "");
  if (context !== "" && !digestPattern.test(context)) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  const verdict = String(reply[13] ?? "");
  const resultDigest = String(reply[14] ?? "");
  if (
    (verdict !== "" && !["pass", "issue", "incomplete", "unavailable"].includes(verdict)) ||
    (resultDigest !== "" && !digestPattern.test(resultDigest)) ||
    (verdict === "") !== (resultDigest === "")
  ) {
    throw new ByoaHandoffLedgerV2Error("INVALID_LEDGER_REPLY");
  }
  return Object.freeze({
    state,
    contractDigest: String(reply[3]),
    tokenDigest: String(reply[4]),
    freshContextDigest: context === "" ? null : context,
    issuedAtMs: parseInteger(reply[6]),
    claimedAtMs: nullableInteger(reply[7]),
    receivedAtMs: nullableInteger(reply[8]),
    startedAtMs: nullableInteger(reply[9]),
    terminalAtMs: nullableInteger(reply[10]),
    expiresAtMs: parseInteger(reply[11]),
    ttlMs: parseInteger(reply[12]),
    verdict: verdict === "" ? null : (verdict as ByoaHandoffLedgerV2Status["verdict"]),
    resultDigest: resultDigest === "" ? null : resultDigest
  });
}
