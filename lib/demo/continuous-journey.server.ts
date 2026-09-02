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
  readonly previousRunId: string | null;
  readonly previousResultDigest: string | null;
  readonly currentToken: string | null;
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
redis.call("HSET", KEYS[1], "v", ARGV[1], "p", ARGV[2], "i", "0", "r", ARGV[3], "c", ARGV[4], "x", ARGV[5], "q", "[]", "pr", "", "pd", "", "pt", "")
redis.call("PEXPIREAT", KEYS[1], expires_at)
redis.call("SET", KEYS[2], ARGV[7], "PXAT", expires_at)
return {1, "STORED"}
`;

const GET_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "v", "p", "i", "r", "c", "x", "q", "pr", "pd", "pt")
if not values[1] then return {2, "MISSING"} end
return {1, ARGV[1], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8] or "", values[9] or "", values[10] or ""}
`;

const RECORD_RESULT_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "r", "q")
if not values[1] then return {0, "JOURNEY_MISSING"} end
local results = cjson.decode(values[2] or "[]")
for _, stored in ipairs(results) do
  local result = type(stored) == "string" and cjson.decode(stored) or stored
  if result.runId == ARGV[1] then
    if result.verdict == ARGV[2] and result.resultDigest == ARGV[3] then return {2, "RESULT_EXISTS"} end
    return {0, "JOURNEY_RESULT_CONFLICT"}
  end
end
if values[1] ~= ARGV[1] then return {0, "JOURNEY_RUN_MISMATCH"} end
local candidate = cjson.decode(ARGV[4])
if candidate.runId ~= ARGV[1] or candidate.verdict ~= ARGV[2] or candidate.resultDigest ~= ARGV[3] then
  return {0, "JOURNEY_RESULT_BINDING_MISMATCH"}
end
table.insert(results, ARGV[4])
redis.call("HSET", KEYS[1], "q", cjson.encode(results))
return {1, "RESULT_RECORDED"}
`;

const ADVANCE_SCRIPT = `
local values = redis.call("HMGET", KEYS[1], "i", "r", "c", "x", "pr", "pd", "pt", "q")
if not values[1] then return {0, "JOURNEY_MISSING"} end
if tonumber(values[1]) == tonumber(ARGV[4]) and values[2] == ARGV[5] and values[3] == ARGV[6]
  and values[5] == ARGV[1] and values[6] == ARGV[8] and values[7] == ARGV[9]
then return {2, "ADVANCE_EXISTING"} end
if values[2] ~= ARGV[1] or values[3] ~= ARGV[2] or tonumber(values[1]) ~= tonumber(ARGV[3]) then
  return {0, "JOURNEY_POSITION_MISMATCH"}
end
local results = cjson.decode(values[8] or "[]")
local stored = results[#results]
local result = type(stored) == "string" and cjson.decode(stored) or stored
if not result or result.runId ~= ARGV[1] or result.resultDigest ~= ARGV[8] then
  return {0, "JOURNEY_RESULT_UNVERIFIED"}
end
local expires_at = tonumber(values[4])
redis.call("HSET", KEYS[1], "i", ARGV[4], "r", ARGV[5], "c", ARGV[6], "pr", ARGV[1], "pd", ARGV[8], "pt", ARGV[9])
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

function decodeRedisJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseContinuousJourneyRedisRecord(reply: unknown): ContinuousJourneyRecord | null {
  if (!Array.isArray(reply) || reply.length < 2) throw new Error("invalid journey reply");
  if (Number(reply[0]) === 2) return null;
  if (
    Number(reply[0]) !== 1 ||
    reply.length < 12 ||
    String(reply[2]) !== BYOA_CONTINUOUS_JOURNEY_VERSION
  ) {
    throw new Error(String(reply[1]));
  }
  const journeyId = String(reply[1]);
  const plan = byoaContinuousJourneyPlanSchema.parse(decodeRedisJson(reply[3]));
  const position = Number(reply[4]);
  const currentRunId = String(reply[5]);
  const currentContractDigest = String(reply[6]);
  const expiresAtMs = Number(reply[7]);
  const rawResults = decodeRedisJson(reply[8] ?? []);
  const previousRunId = String(reply[9] ?? "");
  const previousResultDigest = String(reply[10] ?? "");
  const currentToken = String(reply[11] ?? "");
  const advanceReplayFieldCount = [previousRunId, previousResultDigest, currentToken].filter(
    (value) => value !== ""
  ).length;
  const hasAdvanceReplay = advanceReplayFieldCount === 3;
  if (
    plan.journeyId !== journeyId ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= plan.steps.length ||
    plan.steps[position]?.runId !== currentRunId ||
    plan.steps[position]?.contractDigest !== currentContractDigest ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    !Array.isArray(rawResults) ||
    (advanceReplayFieldCount !== 0 && advanceReplayFieldCount !== 3) ||
    (hasAdvanceReplay &&
      (!/^byoa_run_[0-9a-f-]{36}$/u.test(previousRunId) ||
        !/^[a-f0-9]{64}$/u.test(previousResultDigest) ||
        !currentToken.startsWith("tbh2.") ||
        Buffer.byteLength(currentToken, "utf8") > 3_800))
  ) {
    throw new Error("invalid journey record binding");
  }
  const results = rawResults.map((result, index) => {
    const decoded = decodeRedisJson(result);
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error("invalid journey result encoding");
    }
    const value = decoded as Record<string, unknown>;
    const runId = String(value.runId);
    const verdict = String(value.verdict);
    const resultDigest = String(value.resultDigest);
    if (
      plan.steps[index]?.runId !== runId ||
      !["pass", "issue", "incomplete", "unavailable"].includes(verdict) ||
      !/^[a-f0-9]{64}$/u.test(resultDigest)
    ) {
      throw new Error("invalid journey result binding");
    }
    return {
      runId,
      verdict: verdict as ContinuousJourneyRecord["results"][number]["verdict"],
      resultDigest,
      ownerSummary: byoaHandoffReportRequestV2Schema.shape.ownerSummary.parse(value.ownerSummary)
    };
  });
  if (
    ![position, position + 1].includes(results.length) ||
    (hasAdvanceReplay &&
      (position < 1 ||
        plan.steps[position - 1]?.runId !== previousRunId ||
        results.at(-1)?.runId !== previousRunId ||
        results.at(-1)?.resultDigest !== previousResultDigest))
  ) {
    throw new Error("invalid journey replay binding");
  }
  return Object.freeze({
    plan,
    position,
    currentRunId,
    currentContractDigest,
    expiresAtMs,
    previousRunId: hasAdvanceReplay ? previousRunId : null,
    previousResultDigest: hasAdvanceReplay ? previousResultDigest : null,
    currentToken: hasAdvanceReplay ? currentToken : null,
    results
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
      results: [],
      previousRunId: null,
      previousResultDigest: null,
      currentToken: null
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
  return parseContinuousJourneyRedisRecord(
    await redis(environment).evalRo(GET_SCRIPT, [journeyKey(journeyId)], [journeyId])
  );
}

export async function advanceContinuousJourney(
  record: ContinuousJourneyRecord,
  next: ByoaAgentSessionV2,
  nextToken: string,
  currentResultDigest: string,
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
      currentContractDigest: next.contractDigest,
      previousRunId: record.currentRunId,
      previousResultDigest: currentResultDigest,
      currentToken: nextToken
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
      record.plan.journeyId,
      currentResultDigest,
      nextToken
    ]
  );
  if (!Array.isArray(reply) || ![1, 2].includes(Number(reply[0])))
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
    [runId, verdict, resultDigest, canonicalJson({ runId, verdict, resultDigest, ownerSummary })]
  );
  if (!Array.isArray(reply) || Number(reply[0]) === 0)
    throw new Error(String((reply as unknown[])[1]));
}
