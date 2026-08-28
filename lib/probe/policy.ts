import { canonicalSha256 } from "@/lib/evidence/digest";

export const PROBE_POLICY_VERSION = "toolproof-probe-policy@0.5.0";
export const PROBE_CHALLENGE_ID = "webmcp-2026";
export const PROBE_PROVIDER = "OpenAI";
export const PROBE_MODEL = "gpt-5.6-terra";
export const PROBE_PRODUCTION_ORIGIN = "https://toolproof-rust.vercel.app";
export const PROBE_CHALLENGE_CLOSES_AT = "2026-09-24T00:00:00.000Z";

export const PROBE_PURPOSES = ["calibration", "baseline", "repair", "revised", "judge"] as const;
export type ProbePurpose = (typeof PROBE_PURPOSES)[number];

export const PROBE_PURPOSE_CALL_LIMITS: Readonly<Record<ProbePurpose, number>> = Object.freeze({
  calibration: 17,
  baseline: 70,
  repair: 2,
  revised: 70,
  judge: 1
});

export const PROBE_GLOBAL_CALL_LIMIT = 160;
export const PROBE_LIFETIME_SPEND_CEILING_NANO_USD = 10_000_000_000;
export const PROBE_PER_CALL_RESERVATION_NANO_USD = 62_500_000;
export const PROBE_MAX_INPUT_TOKENS = 3_000;
export const PROBE_MAX_OUTPUT_TOKENS = 400;
export const PROBE_INPUT_NANO_USD_PER_TOKEN = 2_000;
export const PROBE_OUTPUT_NANO_USD_PER_TOKEN = 12_000;
export const PROBE_REGIONAL_UPLIFT_BASIS_POINTS = 1_000;
export const PROBE_MAX_CONCURRENCY = 1;
export const PROBE_TOKEN_TTL_SECONDS = 120;
export const PROBE_ISSUE_RATE_WINDOW_SECONDS = 3_600;
export const PROBE_INFLIGHT_LEASE_SECONDS = 45;

export interface ProbeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

export function calculateProbeCostNanoUsd(usage: ProbeUsage): number {
  requireNonNegativeInteger(usage.inputTokens, "inputTokens");
  requireNonNegativeInteger(usage.outputTokens, "outputTokens");

  const baseCost =
    usage.inputTokens * PROBE_INPUT_NANO_USD_PER_TOKEN +
    usage.outputTokens * PROBE_OUTPUT_NANO_USD_PER_TOKEN;

  return Math.ceil((baseCost * (10_000 + PROBE_REGIONAL_UPLIFT_BASIS_POINTS)) / 10_000);
}

export const PROBE_POLICY_MANIFEST = Object.freeze({
  version: PROBE_POLICY_VERSION,
  challengeId: PROBE_CHALLENGE_ID,
  provider: PROBE_PROVIDER,
  model: PROBE_MODEL,
  productionOrigin: PROBE_PRODUCTION_ORIGIN,
  challengeClosesAt: PROBE_CHALLENGE_CLOSES_AT,
  purposes: PROBE_PURPOSE_CALL_LIMITS,
  globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
  lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
  maximumInputTokens: PROBE_MAX_INPUT_TOKENS,
  maximumOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  inputNanoUsdPerToken: PROBE_INPUT_NANO_USD_PER_TOKEN,
  outputNanoUsdPerToken: PROBE_OUTPUT_NANO_USD_PER_TOKEN,
  regionalUpliftBasisPoints: PROBE_REGIONAL_UPLIFT_BASIS_POINTS,
  maximumConcurrency: PROBE_MAX_CONCURRENCY,
  tokenTtlSeconds: PROBE_TOKEN_TTL_SECONDS,
  issueRateWindowSeconds: PROBE_ISSUE_RATE_WINDOW_SECONDS,
  inflightLeaseSeconds: PROBE_INFLIGHT_LEASE_SECONDS
});

export function probePolicyHash(): Promise<string> {
  return canonicalSha256(PROBE_POLICY_MANIFEST);
}

const allocatedCalls = Object.values(PROBE_PURPOSE_CALL_LIMITS).reduce(
  (total, limit) => total + limit,
  0
);
const maximumConfiguredCost = calculateProbeCostNanoUsd({
  inputTokens: PROBE_MAX_INPUT_TOKENS,
  outputTokens: PROBE_MAX_OUTPUT_TOKENS
});

if (allocatedCalls !== PROBE_GLOBAL_CALL_LIMIT) {
  throw new Error("Probe purpose allocations must equal the lifetime call limit.");
}

if (maximumConfiguredCost > PROBE_PER_CALL_RESERVATION_NANO_USD) {
  throw new Error("Probe per-call reservation is below the frozen request envelope.");
}

if (
  PROBE_GLOBAL_CALL_LIMIT * PROBE_PER_CALL_RESERVATION_NANO_USD !==
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD
) {
  throw new Error("Probe reservations must bind the full challenge-lifetime ceiling exactly.");
}
