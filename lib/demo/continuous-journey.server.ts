import "server-only";

import { type ByoaAgentSessionV2 } from "@/lib/demo/agent-session-v2";
import {
  BYOA_CONTINUOUS_JOURNEY_VERSION,
  byoaContinuousJourneyPlanSchema,
  byoaHandoffReportRequestV2Schema,
  type ByoaContinuousJourneyPlan
} from "@/lib/demo/agent-handoff-v2";
import { createProbeRedis } from "@/lib/probe/ledger";
import { canonicalJson } from "@/lib/evidence/digest";

const JOURNEY_NAMESPACE = "tp:{webmcp26}:demo-journey";
const JOURNEY_MAX_TTL_MS = 15 * 60 * 1000;

export interface ContinuousJourneyRecord {
  readonly plan: ByoaContinuousJourneyPlan;
  readonly position: number;
  readonly currentRunId: string;
  readonly currentContractDigest: string;
  readonly expiresAtMs: number;
  readonly results: readonly {
    readonly runId: string;
    readonly verdict: "pass" | "issue" | "incomplete" | "unavailable";
    readonly resultDigest: string;
    readonly ownerSummary: ReturnType<
      typeof byoaHandoffReportRequestV2Schema.shape.ownerSummary.parse
    >;
  }[];
}

interface JourneyRedis {
  eval<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
  evalRo<TResult = unknown>(script: string, keys: string[], args: string[]): Promise<TResult>;
}

const PUT_SCRIPT = `
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local expires_at = tonumber(ARGV[5])
if not expires_at or expires_at <= now_ms or expires_at - now_ms > tonumber(ARGV[6]) then
  return {0, "JOURNEY_TTL_INVALID"}
end
if redis.call("EXISTS", KEYS[1]) == 1 then return {0, "JOURNEY_EXISTS"} end
redis.call("HSET", KEYS[1], "v", ARGV[1], "p", ARGV[2], "i", "0", "r", ARGV[3], "c", ARGV[4], "x", ARGV[5], "q", "[]")
redis.call("PEXPIREAT", KEYS[1], expires_at)
redis.call("SET", KEYS[2], ARGV[7], "PXAT", expires_at)
return {1, "STORED"}
`;

const GET_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "v", "p", "i", "r", "c", "x", "q")
if not values[1] then return {2, "MISSING"} end
return {1, ARGV[1], values[1], values[2], values[3], values[4], values[5], values[6], values[7]}
`;

const RECORD_RESULT_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "r", "q")
if not values[1] then return {0, "JOURNEY_MISSING"} end
local results = cjson.decode(values[2] or "[]")
for _, result in ipairs(results) do
  if result.runId == ARGV[1] then
    if result.verdict == ARGV[2] and result.resultDigest == ARGV[3] then return {2, "RESULT_EXISTS"} end
    return {0, "JOURNEY_RESULT_CONFLICT"}
  end
end
if values[1] ~= ARGV[1] then return {0, "JOURNEY_RUN_MISMATCH"} end
table.insert(results, {runId=ARGV[1], verdict=ARGV[2], resultDigest=ARGV[3], ownerSummary=cjson.decode(ARGV[4])})
redis.call("HSET", KEYS[1], "q", cjson.encode(results))
return {1, "RESULT_RECORDED"}
`;

const ADVANCE_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "i", "r", "c", "x")
if not values[1] then return {0, "JOURNEY_MISSING"} end
if values[2] ~= ARGV[1] or values[3] ~= ARGV[2] or tonumber(values[1]) ~= tonumber(ARGV[3]) then
  return {0, "JOURNEY_POSITION_MISMATCH"}
end
local expires_at = tonumber(values[4])
redis.call("HSET", KEYS[1], "i", ARGV[4], "r", ARGV[5], "c", ARGV[6])
redis.call("SET", KEYS[2], ARGV[7], "PXAT", expires_at)
return {1, "ADVANCED"}
`;

const fakeRecords = new Map<string, ContinuousJourneyRecord>();
const fakeRunIndex = new Map<string, string>();

function journeyKey(id: string): string {
  if (!/^journey_[0-9a-f-]{36}$/u.test(id)) throw new Error("invalid journey id");
  return `${JOURNEY_NAMESPACE}:${id}`;
}

function runKey(runId: string): string {
  return `${JOURNEY_NAMESPACE}:run:${runId}`;
}

function redis(environment: NodeJS.ProcessEnv): JourneyRedis {
  return createProbeRedis(environment) as unknown as JourneyRedis;
}

function parseRecord(reply: unknown): ContinuousJourneyRecord | null {
  if (!Array.isArray(reply) || reply.length < 2) throw new Error("invalid journey reply");
  if (Number(reply[0]) === 2) return null;
  if (Number(reply[0]) !== 1 || reply.length < 9) throw new Error(String(reply[1]));
  return Object.freeze({
    plan: byoaContinuousJourneyPlanSchema.parse(JSON.parse(String(reply[3])) as unknown),
    position: Number(reply[4]),
    currentRunId: String(reply[5]),
    currentContractDigest: String(reply[6]),
    expiresAtMs: Number(reply[7]),
    results: (JSON.parse(String(reply[8] ?? "[]")) as unknown[]).map((result) => {
      const value = result as Record<string, unknown>;
      return {
        runId: String(value.runId),
        verdict: String(value.verdict) as ContinuousJourneyRecord["results"][number]["verdict"],
        resultDigest: String(value.resultDigest),
        ownerSummary: byoaHandoffReportRequestV2Schema.shape.ownerSummary.parse(value.ownerSummary)
      };
    })
  });
}

export async function storeContinuousJourney(
  value: unknown,
  expiresAtMs: number,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const plan = byoaContinuousJourneyPlanSchema.parse(value);
  const first = plan.steps[0]!;
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    fakeRecords.set(plan.journeyId, {
      plan,
      position: 0,
      currentRunId: first.runId,
      currentContractDigest: first.contractDigest,
      expiresAtMs,
      results: []
    });
    fakeRunIndex.set(first.runId, plan.journeyId);
    return;
  }
  const reply = await redis(environment).eval(
    PUT_SCRIPT,
    [journeyKey(plan.journeyId), runKey(first.runId)],
    [
      BYOA_CONTINUOUS_JOURNEY_VERSION,
      canonicalJson(plan),
      first.runId,
      first.contractDigest,
      String(expiresAtMs),
      String(JOURNEY_MAX_TTL_MS),
      plan.journeyId
    ]
  );
  if (!Array.isArray(reply) || Number(reply[0]) !== 1)
    throw new Error(String((reply as unknown[])[1]));
}

export async function readContinuousJourneyByRun(
  runId: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<ContinuousJourneyRecord | null> {
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    const id = fakeRunIndex.get(runId);
    return id ? (fakeRecords.get(id) ?? null) : null;
  }
  const indexReply = await redis(environment).evalRo<unknown>(
    `local id = redis.call("GET", KEYS[1]); if not id then return {2, "MISSING"} end; return {1, id}`,
    [runKey(runId)],
    []
  );
  if (!Array.isArray(indexReply) || Number(indexReply[0]) === 2) return null;
  const journeyId = String(indexReply[1]);
  return parseRecord(
    await redis(environment).evalRo(GET_SCRIPT, [journeyKey(journeyId)], [journeyId])
  );
}

export async function advanceContinuousJourney(
  record: ContinuousJourneyRecord,
  next: ByoaAgentSessionV2,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const nextPosition = record.position + 1;
  if (record.plan.steps[nextPosition]?.contract.caseId !== next.contract.caseId) {
    throw new Error("The next journey step does not match the frozen plan.");
  }
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    fakeRecords.set(record.plan.journeyId, {
      ...record,
      position: nextPosition,
      currentRunId: next.runId,
      currentContractDigest: next.contractDigest
    });
    fakeRunIndex.set(next.runId, record.plan.journeyId);
    return;
  }
  const reply = await redis(environment).eval(
    ADVANCE_SCRIPT,
    [journeyKey(record.plan.journeyId), runKey(next.runId)],
    [
      record.currentRunId,
      record.currentContractDigest,
      String(record.position),
      String(nextPosition),
      next.runId,
      next.contractDigest,
      record.plan.journeyId
    ]
  );
  if (!Array.isArray(reply) || Number(reply[0]) !== 1)
    throw new Error(String((reply as unknown[])[1]));
}

export async function recordContinuousJourneyResult(
  runId: string,
  verdict: "pass" | "issue" | "incomplete" | "unavailable",
  resultDigest: string,
  ownerSummary: ReturnType<typeof byoaHandoffReportRequestV2Schema.shape.ownerSummary.parse>,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const record = await readContinuousJourneyByRun(runId, environment);
  if (record === null) return;
  if (environment.TOOLPROOF_BROWSER_FAKE_PROBE === "1") {
    const existing = record.results.find((result) => result.runId === runId);
    if (existing && (existing.verdict !== verdict || existing.resultDigest !== resultDigest)) {
      throw new Error("JOURNEY_RESULT_CONFLICT");
    }
    if (!existing) {
      fakeRecords.set(record.plan.journeyId, {
        ...record,
        results: [...record.results, { runId, verdict, resultDigest, ownerSummary }]
      });
    }
    return;
  }
  const reply = await redis(environment).eval(
    RECORD_RESULT_SCRIPT,
    [journeyKey(record.plan.journeyId)],
    [runId, verdict, resultDigest, canonicalJson(ownerSummary)]
  );
  if (!Array.isArray(reply) || Number(reply[0]) === 0)
    throw new Error(String((reply as unknown[])[1]));
}
