import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_CHALLENGE_ID,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_INFLIGHT_LEASE_SECONDS,
  PROBE_INPUT_NANO_USD_PER_TOKEN,
  PROBE_ISSUE_RATE_WINDOW_SECONDS,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_OUTPUT_NANO_USD_PER_TOKEN,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PRODUCTION_ORIGIN,
  PROBE_PROVIDER,
  PROBE_PURPOSE_CALL_LIMITS,
  PROBE_REGIONAL_UPLIFT_BASIS_POINTS,
  PROBE_TOKEN_TTL_SECONDS,
  type ProbePurpose
} from "@/lib/probe/policy";

export const PROBE_POLICY_MIGRATION_VERSION = "toolproof-probe-policy-migration@1.0.0";
export const PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION =
  "toolproof-probe-policy-migration-prior@1.0.0";
export const PROBE_POLICY_MIGRATION_ID = "migration_gate2_calibration_attempt_2";
export const PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT = "64c3095a1098de30ac266ed2344873da6545875a";
export const PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH =
  "ec1d684b2df95b8e5ca3e8589d7e871b72fc48a2eb9dcbe3d125f4283724933d";
export const PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST =
  "016f607f498384bcac2d60474aaa3f3373635cd662bb2eb4d7bb71b0b223b863";

export const PROBE_PREVIOUS_POLICY_VERSION = "toolproof-probe-policy@0.1.0";
export const PROBE_PREVIOUS_POLICY_HASH =
  "9289f1def645e9ccc71a3ef95320281cef937be5ec1329beaf57f22b4b2c7939";
export const PROBE_PREVIOUS_LEDGER_SCRIPT_HASH =
  "41d351ad5d1adb81b0c6a90aa930cf1ae932b053d58b097c0283846728b798d2";
export const PROBE_PREVIOUS_PURPOSE_CALL_LIMITS: Readonly<Record<ProbePurpose, number>> =
  Object.freeze({
    calibration: 4,
    baseline: 72,
    repair: 2,
    revised: 72,
    judge: 10
  });
export const PROBE_PREVIOUS_POLICY_MANIFEST = Object.freeze({
  version: PROBE_PREVIOUS_POLICY_VERSION,
  challengeId: PROBE_CHALLENGE_ID,
  provider: PROBE_PROVIDER,
  model: PROBE_MODEL,
  productionOrigin: PROBE_PRODUCTION_ORIGIN,
  challengeClosesAt: PROBE_CHALLENGE_CLOSES_AT,
  purposes: PROBE_PREVIOUS_PURPOSE_CALL_LIMITS,
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

export const PROBE_POLICY_MIGRATION_PRESERVED_STATE = Object.freeze({
  claimedCalls: 4,
  knownCalls: 4,
  pendingCalls: 0,
  uncertainCalls: 0,
  inflightCalls: 0,
  committedNanoUsd: 250_000_000,
  knownActualNanoUsd: 11_360_800,
  uncertainUpperNanoUsd: 0,
  sequence: 4,
  purposeCounts: Object.freeze({
    calibration: 4,
    baseline: 0,
    repair: 0,
    revised: 0,
    judge: 0
  })
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export interface ProbePolicyMigrationKnownCall {
  readonly ordinal: number;
  readonly jti: string;
  readonly dispatchSequence: number;
  readonly actualNanoUsd: number;
  readonly providerResponseHash: string;
  readonly settlementDigest: string;
  readonly usageHash: string;
}

export interface ProbePolicyMigrationPriorReceipt {
  readonly version: typeof PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION;
  readonly migrationId: typeof PROBE_POLICY_MIGRATION_ID;
  readonly priorAppCommit: typeof PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT;
  readonly priorActivationHash: typeof PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH;
  readonly priorEvidenceDigest: typeof PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly previousPolicyVersion: typeof PROBE_PREVIOUS_POLICY_VERSION;
  readonly previousPolicyHash: typeof PROBE_PREVIOUS_POLICY_HASH;
  readonly previousScriptHash: typeof PROBE_PREVIOUS_LEDGER_SCRIPT_HASH;
  readonly knownCalls: readonly ProbePolicyMigrationKnownCall[];
}

export interface ProbePolicyMigrationManifest {
  readonly version: typeof PROBE_POLICY_MIGRATION_VERSION;
  readonly migrationId: typeof PROBE_POLICY_MIGRATION_ID;
  readonly migrationCommit: string;
  readonly priorAppCommit: typeof PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT;
  readonly priorActivationHash: typeof PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH;
  readonly priorEvidenceDigest: typeof PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly previousPolicyVersion: typeof PROBE_PREVIOUS_POLICY_VERSION;
  readonly previousPolicyHash: typeof PROBE_PREVIOUS_POLICY_HASH;
  readonly previousScriptHash: typeof PROBE_PREVIOUS_LEDGER_SCRIPT_HASH;
  readonly nextPolicyVersion: typeof PROBE_POLICY_VERSION;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
  readonly previousPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly nextPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly globalCallLimit: number;
  readonly lifetimeSpendCeilingNanoUsd: number;
  readonly perCallReservationNanoUsd: number;
  readonly preserved: typeof PROBE_POLICY_MIGRATION_PRESERVED_STATE;
  readonly knownCalls: readonly ProbePolicyMigrationKnownCall[];
}

export interface ProbePolicyMigrationReceiptCore extends ProbePolicyMigrationManifest {
  readonly migrationDigest: string;
  readonly migratedAtMs: number;
}

export interface ProbePolicyMigrationReceipt extends ProbePolicyMigrationReceiptCore {
  readonly receiptHash: string;
}

export interface ProbePolicyMigrationResult {
  readonly disposition: "new" | "existing";
  readonly receipt: ProbePolicyMigrationReceipt;
}

export class ProbePolicyMigrationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbePolicyMigrationContractError";
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProbePolicyMigrationContractError(code);
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProbePolicyMigrationContractError(code);
  }
  return value as Record<string, unknown>;
}

function stringLiteral<T extends string>(value: unknown, expected: T, code: string): T {
  if (value !== expected) throw new ProbePolicyMigrationContractError(code);
  return expected;
}

function opaque(value: unknown, code: string): string {
  if (typeof value !== "string" || !OPAQUE_PATTERN.test(value)) {
    throw new ProbePolicyMigrationContractError(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ProbePolicyMigrationContractError(code);
  }
  return value;
}

function gitCommit(value: unknown, code: string): string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    throw new ProbePolicyMigrationContractError(code);
  }
  return value;
}

function safeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProbePolicyMigrationContractError(code);
  }
  return value;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function parseKnownCalls(value: unknown): readonly ProbePolicyMigrationKnownCall[] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ProbePolicyMigrationContractError("invalid_known_calls");
  }
  const seenJtis = new Set<string>();
  const seenResponses = new Set<string>();
  let actualTotal = 0;
  const calls = value.map((entry, ordinal) => {
    const call = record(entry, "invalid_known_call");
    exactKeys(
      call,
      [
        "ordinal",
        "jti",
        "dispatchSequence",
        "actualNanoUsd",
        "providerResponseHash",
        "settlementDigest",
        "usageHash"
      ],
      "invalid_known_call_shape"
    );
    const parsed: ProbePolicyMigrationKnownCall = {
      ordinal: safeInteger(call.ordinal, "invalid_known_call_ordinal"),
      jti: opaque(call.jti, "invalid_known_call_jti"),
      dispatchSequence: safeInteger(call.dispatchSequence, "invalid_known_call_sequence"),
      actualNanoUsd: safeInteger(call.actualNanoUsd, "invalid_known_call_cost"),
      providerResponseHash: hash(call.providerResponseHash, "invalid_known_call_response_hash"),
      settlementDigest: hash(call.settlementDigest, "invalid_known_call_settlement_digest"),
      usageHash: hash(call.usageHash, "invalid_known_call_usage_hash")
    };
    if (parsed.ordinal !== ordinal || parsed.dispatchSequence !== ordinal + 1) {
      throw new ProbePolicyMigrationContractError("known_call_order_mismatch");
    }
    if (parsed.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD) {
      throw new ProbePolicyMigrationContractError("known_call_cost_over_reservation");
    }
    if (seenJtis.has(parsed.jti) || seenResponses.has(parsed.providerResponseHash)) {
      throw new ProbePolicyMigrationContractError("duplicate_known_call");
    }
    seenJtis.add(parsed.jti);
    seenResponses.add(parsed.providerResponseHash);
    actualTotal += parsed.actualNanoUsd;
    return parsed;
  });
  if (actualTotal !== PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownActualNanoUsd) {
    throw new ProbePolicyMigrationContractError("known_call_cost_sum_mismatch");
  }
  return deepFreeze(canonicalClone(calls));
}

export function parseProbePolicyMigrationPriorReceipt(
  value: unknown
): ProbePolicyMigrationPriorReceipt {
  const receipt = record(value, "invalid_prior_receipt");
  exactKeys(
    receipt,
    [
      "version",
      "migrationId",
      "priorAppCommit",
      "priorActivationHash",
      "priorEvidenceDigest",
      "guardInstanceId",
      "initializedCommit",
      "previousPolicyVersion",
      "previousPolicyHash",
      "previousScriptHash",
      "knownCalls"
    ],
    "invalid_prior_receipt_shape"
  );
  return deepFreeze({
    version: stringLiteral(
      receipt.version,
      PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
      "prior_receipt_version_mismatch"
    ),
    migrationId: stringLiteral(
      receipt.migrationId,
      PROBE_POLICY_MIGRATION_ID,
      "migration_id_mismatch"
    ),
    priorAppCommit: stringLiteral(
      receipt.priorAppCommit,
      PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      "prior_app_commit_mismatch"
    ),
    priorActivationHash: stringLiteral(
      receipt.priorActivationHash,
      PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      "prior_activation_hash_mismatch"
    ),
    priorEvidenceDigest: stringLiteral(
      receipt.priorEvidenceDigest,
      PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
      "prior_evidence_digest_mismatch"
    ),
    guardInstanceId: opaque(receipt.guardInstanceId, "invalid_guard_instance"),
    initializedCommit: gitCommit(receipt.initializedCommit, "invalid_initialized_commit"),
    previousPolicyVersion: stringLiteral(
      receipt.previousPolicyVersion,
      PROBE_PREVIOUS_POLICY_VERSION,
      "previous_policy_version_mismatch"
    ),
    previousPolicyHash: stringLiteral(
      receipt.previousPolicyHash,
      PROBE_PREVIOUS_POLICY_HASH,
      "previous_policy_hash_mismatch"
    ),
    previousScriptHash: stringLiteral(
      receipt.previousScriptHash,
      PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      "previous_script_hash_mismatch"
    ),
    knownCalls: parseKnownCalls(receipt.knownCalls)
  });
}

export function createProbePolicyMigrationManifest(input: {
  readonly priorReceipt: ProbePolicyMigrationPriorReceipt;
  readonly migrationCommit: string;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
}): ProbePolicyMigrationManifest {
  const prior = parseProbePolicyMigrationPriorReceipt(input.priorReceipt);
  if (
    PROBE_POLICY_VERSION !== "toolproof-probe-policy@0.2.0" ||
    canonicalJson(PROBE_PURPOSE_CALL_LIMITS) !==
      canonicalJson({ calibration: 8, baseline: 72, repair: 2, revised: 72, judge: 6 }) ||
    Object.values(PROBE_PURPOSE_CALL_LIMITS).reduce((sum, value) => sum + value, 0) !==
      PROBE_GLOBAL_CALL_LIMIT
  ) {
    throw new ProbePolicyMigrationContractError("next_policy_not_frozen");
  }
  return deepFreeze(
    canonicalClone({
      version: PROBE_POLICY_MIGRATION_VERSION,
      migrationId: PROBE_POLICY_MIGRATION_ID,
      migrationCommit: gitCommit(input.migrationCommit, "invalid_migration_commit"),
      priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
      guardInstanceId: prior.guardInstanceId,
      initializedCommit: prior.initializedCommit,
      previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      nextPolicyVersion: PROBE_POLICY_VERSION,
      nextPolicyHash: hash(input.nextPolicyHash, "invalid_next_policy_hash"),
      nextScriptHash: hash(input.nextScriptHash, "invalid_next_script_hash"),
      previousPurposeLimits: PROBE_PREVIOUS_PURPOSE_CALL_LIMITS,
      nextPurposeLimits: PROBE_PURPOSE_CALL_LIMITS,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      preserved: PROBE_POLICY_MIGRATION_PRESERVED_STATE,
      knownCalls: prior.knownCalls
    })
  );
}

export function probePolicyMigrationDigest(
  manifest: ProbePolicyMigrationManifest
): Promise<string> {
  return canonicalSha256(manifest);
}

export function probePolicyMigrationReceiptHash(
  receipt: ProbePolicyMigrationReceiptCore | ProbePolicyMigrationReceipt
): Promise<string> {
  const core = { ...receipt } as ProbePolicyMigrationReceiptCore & { receiptHash?: string };
  delete core.receiptHash;
  return canonicalSha256(core);
}

export async function createProbePolicyMigrationReceipt(
  manifest: ProbePolicyMigrationManifest,
  migrationDigest: string,
  migratedAtMs: number
): Promise<ProbePolicyMigrationReceipt> {
  const expectedDigest = await probePolicyMigrationDigest(manifest);
  if (migrationDigest !== expectedDigest) {
    throw new ProbePolicyMigrationContractError("migration_digest_mismatch");
  }
  safeInteger(migratedAtMs, "invalid_migrated_at");
  const core = deepFreeze(
    canonicalClone({ ...manifest, migrationDigest: expectedDigest, migratedAtMs })
  );
  return deepFreeze({ ...core, receiptHash: await probePolicyMigrationReceiptHash(core) });
}
