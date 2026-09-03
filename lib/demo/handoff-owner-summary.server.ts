import "server-only";

import { z } from "zod";

import {
  byoaHandoffReportRequestV2Schema,
  type ByoaOwnerResultSummaryV1
} from "@/lib/demo/agent-handoff-v2";
import { canonicalJson } from "@/lib/evidence/digest";
import { createProbeRedis } from "@/lib/probe/ledger";

export const BYOA_OWNER_SUMMARY_VERSION = "thurstone-byoa-owner-summary@1" as const;
export const BYOA_OWNER_SUMMARY_TTL_MS = 15 * 60 * 1000;
const NAMESPACE = "tp:{webmcp26}:demo-handoff-owner-summary";

const envelopeSchema = z
  .object({
    version: z.literal(BYOA_OWNER_SUMMARY_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerSummary: byoaHandoffReportRequestV2Schema.shape.ownerSummary
  })
  .strict();

export type ByoaOwnerSummaryEnvelope = z.infer<typeof envelopeSchema>;

interface SummaryRedis {
  eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
  evalRo<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
}

interface FakeSummaryGlobal {
  __thurstoneByoaOwnerSummaries?: Map<string, string>;
}

const fakeGlobal = globalThis as typeof globalThis & FakeSummaryGlobal;

const STORE_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then
  if existing == ARGV[1] then return {2, "EXISTING"} end
  return {0, "CONFLICT"}
end
redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
return {1, "STORED"}
`;

const READ_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if not value then return {2, "MISSING"} end
return {1, value}
`;

function keyFor(runId: string): string {
  if (!/^byoa_run_[0-9a-f-]{36}$/u.test(runId)) throw new Error("invalid owner summary run ID");
  return `${NAMESPACE}:${runId}`;
}

function redis(environment: NodeJS.ProcessEnv): SummaryRedis {
  return createProbeRedis(environment) as unknown as SummaryRedis;
}

function fakeStore(): Map<string, string> {
  fakeGlobal.__thurstoneByoaOwnerSummaries ??= new Map();
  return fakeGlobal.__thurstoneByoaOwnerSummaries;
}

export async function storeByoaOwnerSummary(
  input: {
    readonly runId: string;
    readonly contractDigest: string;
    readonly resultDigest: string;
    readonly ownerSummary: ByoaOwnerResultSummaryV1;
  },
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const envelope = envelopeSchema.parse({ version: BYOA_OWNER_SUMMARY_VERSION, ...input });
  const bytes = canonicalJson(envelope);
  const key = keyFor(input.runId);
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    if (environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production") {
      throw new Error("browser fake owner summary forbidden in production");
    }
    const existing = fakeStore().get(key);
    if (existing !== undefined && existing !== bytes) throw new Error("owner summary conflict");
    fakeStore().set(key, bytes);
    return;
  }
  const reply = await redis(environment).eval(
    STORE_SCRIPT,
    [key],
    [bytes, String(BYOA_OWNER_SUMMARY_TTL_MS)]
  );
  if (!Array.isArray(reply) || ![1, 2].includes(Number(reply[0]))) {
    throw new Error("owner summary store failed");
  }
}

export async function readByoaOwnerSummary(
  runId: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<ByoaOwnerSummaryEnvelope | null> {
  const key = keyFor(runId);
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    const bytes = fakeStore().get(key);
    return bytes === undefined ? null : envelopeSchema.parse(JSON.parse(bytes));
  }
  const reply = await redis(environment).evalRo(READ_SCRIPT, [key], []);
  if (!Array.isArray(reply) || reply.length < 2) throw new Error("invalid owner summary reply");
  if (Number(reply[0]) === 2) return null;
  if (Number(reply[0]) !== 1) throw new Error("owner summary read failed");
  return envelopeSchema.parse(JSON.parse(String(reply[1])));
}

export function resetByoaOwnerSummariesForTests(
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (environment.NODE_ENV !== "test") throw new Error("owner summary reset is test-only");
  fakeStore().clear();
}
