import "server-only";

import { randomBytes } from "node:crypto";

import { createProbeRedis } from "@/lib/probe/ledger";

const SHORT_CODE_NAMESPACE = "tp:{webmcp26}:demo-handoff-short";
const shortCodePattern = /^ths2_[A-Za-z0-9_-]{24}$/u;

interface ShortCodeRedis {
  eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
  evalRo<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
}

interface FakeShortCodeRecord {
  readonly token: string;
  readonly expiresAtMs: number;
}

interface FakeShortCodeGlobal {
  __thurstoneHandoffShortCodes?: Map<string, FakeShortCodeRecord>;
}

const fakeGlobal = globalThis as typeof globalThis & FakeShortCodeGlobal;

const STORE_SCRIPT = `
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local expires_at_ms = tonumber(ARGV[2])
if not expires_at_ms or expires_at_ms <= now_ms then return {0, "SHORT_CODE_EXPIRED"} end
if redis.call("SET", KEYS[1], ARGV[1], "PXAT", expires_at_ms, "NX") == false then
  return {0, "SHORT_CODE_CONFLICT"}
end
return {1, "SHORT_CODE_STORED", now_ms, expires_at_ms}
`;

const RESOLVE_SCRIPT = `
local token = redis.call("GET", KEYS[1])
if not token then return {2, "SHORT_CODE_MISSING"} end
return {1, token}
`;

function key(code: string): string {
  return `${SHORT_CODE_NAMESPACE}:${code}`;
}

function fakeRecords(): Map<string, FakeShortCodeRecord> {
  fakeGlobal.__thurstoneHandoffShortCodes ??= new Map();
  return fakeGlobal.__thurstoneHandoffShortCodes;
}

function redis(environment: NodeJS.ProcessEnv): ShortCodeRedis {
  return createProbeRedis(environment) as unknown as ShortCodeRedis;
}

export function isByoaHandoffShortCode(value: string): boolean {
  return shortCodePattern.test(value);
}

export async function issueByoaHandoffShortCode(
  token: string,
  expiresAtMs: number,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> {
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error("SHORT_CODE_EXPIRED");
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = `ths2_${randomBytes(18).toString("base64url")}`;
    if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
      const records = fakeRecords();
      if (records.has(code)) continue;
      records.set(code, { token, expiresAtMs });
      return code;
    }
    const reply = await redis(environment).eval(
      STORE_SCRIPT,
      [key(code)],
      [token, `${expiresAtMs}`]
    );
    if (Array.isArray(reply) && Number(reply[0]) === 1) return code;
    if (!Array.isArray(reply) || String(reply[1]) !== "SHORT_CODE_CONFLICT") {
      throw new Error("SHORT_CODE_STORE_FAILED");
    }
  }
  throw new Error("SHORT_CODE_CONFLICT");
}

export async function resolveByoaHandoffV2Credential(
  credential: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  if (!isByoaHandoffShortCode(credential)) return credential;
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    const record = fakeRecords().get(credential);
    if (!record) return null;
    if (record.expiresAtMs <= Date.now()) {
      fakeRecords().delete(credential);
      return null;
    }
    return record.token;
  }
  const reply = await redis(environment).evalRo(RESOLVE_SCRIPT, [key(credential)], []);
  if (!Array.isArray(reply) || reply.length < 2) throw new Error("SHORT_CODE_RESOLVE_FAILED");
  if (Number(reply[0]) === 2) return null;
  if (Number(reply[0]) !== 1) throw new Error("SHORT_CODE_RESOLVE_FAILED");
  return String(reply[1]);
}
