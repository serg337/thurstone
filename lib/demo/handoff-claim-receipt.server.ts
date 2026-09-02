import "server-only";

import { createHash } from "node:crypto";

import { createProbeRedis } from "@/lib/probe/ledger";

export const HANDOFF_CLAIM_RECEIPT_VERSION = "thurstone-handoff-claim-receipt@1" as const;
export const HANDOFF_CLAIM_RECEIPT_TTL_MS = 15 * 60 * 1000;
const RECEIPT_NAMESPACE = "tp:{webmcp26}:demo-handoff-claim";

export type HandoffClaimFailureReason =
  | "expired"
  | "already_claimed"
  | "binding_mismatch"
  | "ledger_record_missing"
  | "revoked"
  | "invalid_token"
  | "ledger_unavailable";

export interface HandoffClaimFailureReceipt {
  readonly version: typeof HANDOFF_CLAIM_RECEIPT_VERSION;
  readonly reason: HandoffClaimFailureReason;
  readonly observedAtMs: number;
  readonly attemptCount: number;
  readonly requestRevealed: false;
  readonly toolsRegistered: false;
  readonly nativeInvocationCount: 0;
}

interface ClaimReceiptRedis {
  eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
  evalRo<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
}

const RECORD_SCRIPT = `
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local count = redis.call("HINCRBY", KEYS[1], "n", 1)
redis.call("HSET", KEYS[1], "v", ARGV[1], "r", ARGV[2], "a", tostring(now_ms))
redis.call("PEXPIRE", KEYS[1], ARGV[3])
return {1, ARGV[1], ARGV[2], now_ms, count}
`;

const READ_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "v", "r", "a", "n")
if not values[1] then return {2, "MISSING"} end
return {1, values[1], values[2], values[3], values[4]}
`;

interface FakeClaimReceiptGlobal {
  __thurstoneHandoffClaimReceipts?: Map<string, HandoffClaimFailureReceipt>;
}

const fakeGlobal = globalThis as typeof globalThis & FakeClaimReceiptGlobal;

function tokenDigest(token: string): string {
  return createHash("sha256")
    .update("thurstone:handoff-claim\0", "utf8")
    .update(token)
    .digest("hex");
}

function receiptKey(token: string): string {
  return `${RECEIPT_NAMESPACE}:${tokenDigest(token)}`;
}

function fakeReceipts(): Map<string, HandoffClaimFailureReceipt> {
  fakeGlobal.__thurstoneHandoffClaimReceipts ??= new Map();
  return fakeGlobal.__thurstoneHandoffClaimReceipts;
}

function redis(environment: NodeJS.ProcessEnv): ClaimReceiptRedis {
  return createProbeRedis(environment) as unknown as ClaimReceiptRedis;
}

function parseReceipt(reply: unknown): HandoffClaimFailureReceipt | null {
  if (!Array.isArray(reply) || reply.length < 2) throw new Error("invalid claim receipt reply");
  if (Number(reply[0]) === 2) return null;
  if (Number(reply[0]) !== 1 || reply.length < 5) throw new Error("invalid claim receipt reply");
  const version = String(reply[1]);
  const reason = String(reply[2]) as HandoffClaimFailureReason;
  const observedAtMs = Number(reply[3]);
  const attemptCount = Number(reply[4]);
  if (
    version !== HANDOFF_CLAIM_RECEIPT_VERSION ||
    ![
      "expired",
      "already_claimed",
      "binding_mismatch",
      "ledger_record_missing",
      "revoked",
      "invalid_token",
      "ledger_unavailable"
    ].includes(reason) ||
    !Number.isSafeInteger(observedAtMs) ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1
  ) {
    throw new Error("invalid claim receipt reply");
  }
  return Object.freeze({
    version: HANDOFF_CLAIM_RECEIPT_VERSION,
    reason,
    observedAtMs,
    attemptCount,
    requestRevealed: false,
    toolsRegistered: false,
    nativeInvocationCount: 0
  });
}

export async function recordHandoffClaimFailure(
  token: string,
  reason: HandoffClaimFailureReason,
  environment: NodeJS.ProcessEnv = process.env
): Promise<HandoffClaimFailureReceipt> {
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    const key = receiptKey(token);
    const previous = fakeReceipts().get(key);
    const receipt = Object.freeze({
      version: HANDOFF_CLAIM_RECEIPT_VERSION,
      reason,
      observedAtMs: Date.now(),
      attemptCount: (previous?.attemptCount ?? 0) + 1,
      requestRevealed: false as const,
      toolsRegistered: false as const,
      nativeInvocationCount: 0 as const
    });
    fakeReceipts().set(key, receipt);
    return receipt;
  }
  const receipt = parseReceipt(
    await redis(environment).eval(
      RECORD_SCRIPT,
      [receiptKey(token)],
      [HANDOFF_CLAIM_RECEIPT_VERSION, reason, String(HANDOFF_CLAIM_RECEIPT_TTL_MS)]
    )
  );
  if (receipt === null) throw new Error("claim failure receipt was not stored");
  return receipt;
}

export async function readHandoffClaimFailure(
  token: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<HandoffClaimFailureReceipt | null> {
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    return fakeReceipts().get(receiptKey(token)) ?? null;
  }
  return parseReceipt(await redis(environment).evalRo(READ_SCRIPT, [receiptKey(token)], []));
}

export function resetHandoffClaimReceiptsForTests(
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (environment.NODE_ENV !== "test") throw new Error("claim receipt reset is test-only");
  fakeReceipts().clear();
}
