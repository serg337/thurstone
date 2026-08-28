import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import { type ProbePolicyMigrationKnownCall } from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH,
  PROBE_V03_MIGRATED_POLICY_VERSION,
  PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V03_POLICY_MIGRATION_ID,
  probeV03PolicyMigrationReceiptHash,
  type ProbeV03PolicyMigrationReceipt
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash,
  type ProbePurpose
} from "@/lib/probe/policy";

export const PROBE_V04_POLICY_MIGRATION_VERSION = "toolproof-probe-policy-migration-v04@1.0.0";
export const PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION =
  "toolproof-probe-policy-migration-v04-source@1.0.0";
export const PROBE_V04_POLICY_MIGRATION_ID = "migration_gate2_googlechromelabs_fallback_1";
export const PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT =
  "2ca1f277b27b727c4a336b83b12bca77be1cc938";
export const PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH =
  "9321638a281240419d3eebdd056733b2e91b1633db5d1245e135dc28490b2beb";
export const PROBE_V04_PREDECESSOR_MIGRATION_ID = PROBE_V03_POLICY_MIGRATION_ID;
export const PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH =
  "6f63c8879535b7b3a5a3edf7c908fdd1783057fccd134b03df78e2573a1462e6";
export const PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST =
  "646ccd92826281c798663b594efcd52cedfd7ba0905c4ddf752a160c6d54a063";
export const PROBE_V04_PRESERVED_KNOWN_ACTUAL_NANO_USD = 27_992_800 as const;
export const PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256 =
  "56d568216d33598480fb91ed1dacdc5405c7363eef1d846d1cdff544c135caa2";
export const PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST =
  "9a8ac1e9a44dd047016bd6cdd6a809d8666f35c33540450516d69a124825f05e";
export const PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH =
  "4c80afcd9f1f2e659a45b6a50b01a478434c522121edeb0ba5c923311a22444b";
export const PROBE_V04_PREVIOUS_POLICY_VERSION = PROBE_V03_MIGRATED_POLICY_VERSION;
export const PROBE_V04_PREVIOUS_POLICY_HASH = PROBE_V03_MIGRATED_POLICY_HASH;
export const PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH = PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH;
export const PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS = PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS;

export const PROBE_V04_MIGRATED_POLICY_VERSION = "toolproof-probe-policy@0.4.0";
export const PROBE_V04_MIGRATED_POLICY_HASH =
  "4c70f123b0e3bc9b31477e976e51604e570e1475ef1d315a21615553e0be2b77";
export const PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH = PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH;
export const PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH =
  "ccdb4f578a37cf0b774c195a855c3d2fa3352fbd5ccdbee3b89eb1c5d5185ecc";
export const PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS = Object.freeze({
  calibration: 13,
  baseline: 72,
  repair: 2,
  revised: 72,
  judge: 1
}) satisfies Readonly<Record<ProbePurpose, number>>;

export const PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE = Object.freeze({
  claimedCalls: 9 as const,
  knownCalls: 9 as const,
  pendingCalls: 0 as const,
  uncertainCalls: 0 as const,
  inflightCalls: 0 as const,
  committedNanoUsd: 562_500_000 as const,
  knownActualNanoUsd: PROBE_V04_PRESERVED_KNOWN_ACTUAL_NANO_USD,
  uncertainUpperNanoUsd: 0 as const,
  sequence: 9 as const,
  purposeCounts: Object.freeze({
    calibration: 9 as const,
    baseline: 0 as const,
    repair: 0 as const,
    revised: 0 as const,
    judge: 0 as const
  })
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export interface ProbeV04PolicyMigrationPreservedState {
  readonly claimedCalls: 9;
  readonly knownCalls: 9;
  readonly pendingCalls: 0;
  readonly uncertainCalls: 0;
  readonly inflightCalls: 0;
  readonly committedNanoUsd: 562_500_000;
  readonly knownActualNanoUsd: 27_992_800;
  readonly uncertainUpperNanoUsd: 0;
  readonly sequence: 9;
  readonly purposeCounts: Readonly<{
    calibration: 9;
    baseline: 0;
    repair: 0;
    revised: 0;
    judge: 0;
  }>;
}

export interface ProbeV04PolicyMigrationSourceReceipt {
  readonly version: typeof PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION;
  readonly migrationId: typeof PROBE_V04_POLICY_MIGRATION_ID;
  readonly priorAppCommit: typeof PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT;
  readonly priorActivationHash: typeof PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH;
  readonly priorEvidenceRawSha256: typeof PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256;
  readonly priorEvidenceDigest: typeof PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST;
  readonly predecessorMigrationId: typeof PROBE_V04_PREDECESSOR_MIGRATION_ID;
  readonly predecessorMigrationReceiptHash: string;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly previousPolicyVersion: typeof PROBE_V04_PREVIOUS_POLICY_VERSION;
  readonly previousPolicyHash: typeof PROBE_V04_PREVIOUS_POLICY_HASH;
  readonly previousScriptHash: typeof PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH;
  readonly previousRunnerHash: typeof PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH;
  readonly preserved: ProbeV04PolicyMigrationPreservedState;
  readonly knownCalls: readonly ProbePolicyMigrationKnownCall[];
}

export interface ProbeV04PolicyMigrationManifest extends Omit<
  ProbeV04PolicyMigrationSourceReceipt,
  "version"
> {
  readonly version: typeof PROBE_V04_POLICY_MIGRATION_VERSION;
  readonly migrationCommit: string;
  readonly nextPolicyVersion: typeof PROBE_V04_MIGRATED_POLICY_VERSION;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
  readonly nextRunnerHash: string;
  readonly migrationProgramHash: string;
  readonly previousPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly nextPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly globalCallLimit: number;
  readonly lifetimeSpendCeilingNanoUsd: number;
  readonly perCallReservationNanoUsd: number;
}

export interface ProbeV04PolicyMigrationReceiptCore extends ProbeV04PolicyMigrationManifest {
  readonly migrationDigest: string;
  readonly migratedAtMs: number;
}

export interface ProbeV04PolicyMigrationReceipt extends ProbeV04PolicyMigrationReceiptCore {
  readonly receiptHash: string;
}

export interface ProbeV04PolicyMigrationResult {
  readonly disposition: "new" | "existing";
  readonly receipt: ProbeV04PolicyMigrationReceipt;
}

export interface ProbeV04PolicyMigrationSourceStatus {
  readonly status: string;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly scriptHash: string;
  readonly model: string;
  readonly globalCallLimit: number;
  readonly spendCeilingNanoUsd: number;
  readonly perCallReservationNanoUsd: number;
  readonly maxConcurrency: number;
  readonly challengeClosesAtMs: number;
  readonly claimedCalls: number;
  readonly committedNanoUsd: number;
  readonly pendingCount: number;
  readonly knownCount: number;
  readonly uncertainCount: number;
  readonly knownActualNanoUsd: number;
  readonly uncertainUpperNanoUsd: number;
  readonly purposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly purposeCounts: Readonly<Record<ProbePurpose, number>>;
  readonly inflightCount: number;
  readonly sequence: number;
  readonly haltMarkerPresent: boolean;
  readonly uncertainMarkerPresent: boolean;
}

export class ProbeV04PolicyMigrationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeV04PolicyMigrationContractError";
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProbeV04PolicyMigrationContractError(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProbeV04PolicyMigrationContractError(code);
  }
}

function literal<T extends string>(value: unknown, expected: T, code: string): T {
  if (value !== expected) throw new ProbeV04PolicyMigrationContractError(code);
  return expected;
}

function opaque(value: unknown, code: string): string {
  if (typeof value !== "string" || !OPAQUE_PATTERN.test(value)) {
    throw new ProbeV04PolicyMigrationContractError(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ProbeV04PolicyMigrationContractError(code);
  }
  return value;
}

function gitCommit(value: unknown, code: string): string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    throw new ProbeV04PolicyMigrationContractError(code);
  }
  return value;
}

function integer(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProbeV04PolicyMigrationContractError(code);
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

function parsePreservedState(value: unknown): ProbeV04PolicyMigrationPreservedState {
  const state = record(value, "invalid_preserved_state");
  exactKeys(
    state,
    [
      "claimedCalls",
      "knownCalls",
      "pendingCalls",
      "uncertainCalls",
      "inflightCalls",
      "committedNanoUsd",
      "knownActualNanoUsd",
      "uncertainUpperNanoUsd",
      "sequence",
      "purposeCounts"
    ],
    "invalid_preserved_state_shape"
  );
  const fixed = PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  const purposeCounts = record(state.purposeCounts, "invalid_preserved_purpose_counts");
  exactKeys(
    purposeCounts,
    ["calibration", "baseline", "repair", "revised", "judge"],
    "invalid_preserved_purpose_counts_shape"
  );
  const parsed: ProbeV04PolicyMigrationPreservedState = {
    claimedCalls: integer(state.claimedCalls, "invalid_preserved_claimed") as 9,
    knownCalls: integer(state.knownCalls, "invalid_preserved_known") as 9,
    pendingCalls: integer(state.pendingCalls, "invalid_preserved_pending") as 0,
    uncertainCalls: integer(state.uncertainCalls, "invalid_preserved_uncertain") as 0,
    inflightCalls: integer(state.inflightCalls, "invalid_preserved_inflight") as 0,
    committedNanoUsd: integer(state.committedNanoUsd, "invalid_preserved_committed") as 562_500_000,
    knownActualNanoUsd: integer(state.knownActualNanoUsd, "invalid_preserved_actual") as 27_992_800,
    uncertainUpperNanoUsd: integer(
      state.uncertainUpperNanoUsd,
      "invalid_preserved_uncertain_upper"
    ) as 0,
    sequence: integer(state.sequence, "invalid_preserved_sequence") as 9,
    purposeCounts: {
      calibration: integer(purposeCounts.calibration, "invalid_preserved_calibration") as 9,
      baseline: integer(purposeCounts.baseline, "invalid_preserved_baseline") as 0,
      repair: integer(purposeCounts.repair, "invalid_preserved_repair") as 0,
      revised: integer(purposeCounts.revised, "invalid_preserved_revised") as 0,
      judge: integer(purposeCounts.judge, "invalid_preserved_judge") as 0
    }
  };
  if (
    parsed.claimedCalls !== fixed.claimedCalls ||
    parsed.knownCalls !== fixed.knownCalls ||
    parsed.pendingCalls !== fixed.pendingCalls ||
    parsed.uncertainCalls !== fixed.uncertainCalls ||
    parsed.inflightCalls !== fixed.inflightCalls ||
    parsed.committedNanoUsd !== fixed.committedNanoUsd ||
    parsed.uncertainUpperNanoUsd !== fixed.uncertainUpperNanoUsd ||
    parsed.sequence !== fixed.sequence ||
    parsed.knownActualNanoUsd !== fixed.knownActualNanoUsd ||
    canonicalJson(parsed.purposeCounts) !== canonicalJson(fixed.purposeCounts) ||
    parsed.knownActualNanoUsd > parsed.knownCalls * PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new ProbeV04PolicyMigrationContractError("preserved_state_mismatch");
  }
  return deepFreeze(canonicalClone(parsed));
}

async function parseKnownCalls(
  value: unknown,
  predecessor: ProbeV03PolicyMigrationReceipt,
  expectedKnownActualNanoUsd: number
): Promise<readonly ProbePolicyMigrationKnownCall[]> {
  if (!Array.isArray(value) || value.length !== 9) {
    throw new ProbeV04PolicyMigrationContractError("invalid_known_calls");
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
      ordinal: integer(call.ordinal, "invalid_known_call_ordinal"),
      jti: opaque(call.jti, "invalid_known_call_jti"),
      dispatchSequence: integer(call.dispatchSequence, "invalid_known_call_sequence"),
      actualNanoUsd: integer(call.actualNanoUsd, "invalid_known_call_cost"),
      providerResponseHash: hash(call.providerResponseHash, "invalid_known_call_response_hash"),
      settlementDigest: hash(call.settlementDigest, "invalid_known_call_settlement_digest"),
      usageHash: hash(call.usageHash, "invalid_known_call_usage_hash")
    };
    if (parsed.ordinal !== ordinal || parsed.dispatchSequence !== ordinal + 1) {
      throw new ProbeV04PolicyMigrationContractError("known_call_order_mismatch");
    }
    if (parsed.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD) {
      throw new ProbeV04PolicyMigrationContractError("known_call_cost_over_reservation");
    }
    if (seenJtis.has(parsed.jti) || seenResponses.has(parsed.providerResponseHash)) {
      throw new ProbeV04PolicyMigrationContractError("duplicate_known_call");
    }
    seenJtis.add(parsed.jti);
    seenResponses.add(parsed.providerResponseHash);
    actualTotal += parsed.actualNanoUsd;
    return parsed;
  });
  if (
    canonicalJson(calls.slice(0, 5)) !== canonicalJson(predecessor.knownCalls) ||
    actualTotal !== expectedKnownActualNanoUsd ||
    (await canonicalSha256(calls)) !== PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST
  ) {
    throw new ProbeV04PolicyMigrationContractError("known_call_lineage_mismatch");
  }
  return deepFreeze(canonicalClone(calls));
}

export async function parseProbeV04PolicyMigrationSourceReceipt(
  value: unknown,
  predecessor: ProbeV03PolicyMigrationReceipt
): Promise<ProbeV04PolicyMigrationSourceReceipt> {
  const receipt = record(value, "invalid_v04_source_receipt");
  exactKeys(
    receipt,
    [
      "version",
      "migrationId",
      "priorAppCommit",
      "priorActivationHash",
      "priorEvidenceRawSha256",
      "priorEvidenceDigest",
      "predecessorMigrationId",
      "predecessorMigrationReceiptHash",
      "guardInstanceId",
      "initializedCommit",
      "previousPolicyVersion",
      "previousPolicyHash",
      "previousScriptHash",
      "previousRunnerHash",
      "preserved",
      "knownCalls"
    ],
    "invalid_v04_source_receipt_shape"
  );
  const predecessorReceiptHash = await probeV03PolicyMigrationReceiptHash(predecessor);
  if (
    predecessor.receiptHash !== predecessorReceiptHash ||
    predecessor.receiptHash !== PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    predecessor.migrationId !== PROBE_V04_PREDECESSOR_MIGRATION_ID
  ) {
    throw new ProbeV04PolicyMigrationContractError("predecessor_receipt_invalid");
  }
  const preserved = parsePreservedState(receipt.preserved);
  const parsed = {
    version: literal(
      receipt.version,
      PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
      "v04_source_version_mismatch"
    ),
    migrationId: literal(
      receipt.migrationId,
      PROBE_V04_POLICY_MIGRATION_ID,
      "v04_migration_id_mismatch"
    ),
    priorAppCommit: literal(
      receipt.priorAppCommit,
      PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      "v04_prior_app_commit_mismatch"
    ),
    priorActivationHash: literal(
      receipt.priorActivationHash,
      PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      "v04_prior_activation_hash_mismatch"
    ),
    priorEvidenceRawSha256: literal(
      receipt.priorEvidenceRawSha256,
      PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
      "v04_prior_evidence_raw_sha_mismatch"
    ),
    priorEvidenceDigest: literal(
      receipt.priorEvidenceDigest,
      PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
      "v04_prior_evidence_digest_mismatch"
    ),
    predecessorMigrationId: literal(
      receipt.predecessorMigrationId,
      PROBE_V04_PREDECESSOR_MIGRATION_ID,
      "v04_predecessor_migration_id_mismatch"
    ),
    predecessorMigrationReceiptHash: hash(
      receipt.predecessorMigrationReceiptHash,
      "invalid_v04_predecessor_receipt_hash"
    ),
    guardInstanceId: opaque(receipt.guardInstanceId, "invalid_v04_guard_instance"),
    initializedCommit: gitCommit(receipt.initializedCommit, "invalid_v04_initialized_commit"),
    previousPolicyVersion: literal(
      receipt.previousPolicyVersion,
      PROBE_V04_PREVIOUS_POLICY_VERSION,
      "v04_previous_policy_version_mismatch"
    ),
    previousPolicyHash: literal(
      receipt.previousPolicyHash,
      PROBE_V04_PREVIOUS_POLICY_HASH,
      "v04_previous_policy_hash_mismatch"
    ),
    previousScriptHash: literal(
      receipt.previousScriptHash,
      PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      "v04_previous_script_hash_mismatch"
    ),
    previousRunnerHash: literal(
      receipt.previousRunnerHash,
      PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
      "v04_previous_runner_hash_mismatch"
    ),
    preserved,
    knownCalls: await parseKnownCalls(receipt.knownCalls, predecessor, preserved.knownActualNanoUsd)
  } satisfies ProbeV04PolicyMigrationSourceReceipt;
  if (
    parsed.predecessorMigrationReceiptHash !== predecessor.receiptHash ||
    parsed.guardInstanceId !== predecessor.guardInstanceId ||
    parsed.initializedCommit !== predecessor.initializedCommit ||
    parsed.preserved.knownActualNanoUsd < predecessor.preserved.knownActualNanoUsd
  ) {
    throw new ProbeV04PolicyMigrationContractError("v04_predecessor_lineage_mismatch");
  }
  return deepFreeze(canonicalClone(parsed));
}

export async function createProbeV04PolicyMigrationManifest(input: {
  readonly sourceReceipt: ProbeV04PolicyMigrationSourceReceipt;
  readonly predecessorReceipt: ProbeV03PolicyMigrationReceipt;
  readonly migrationCommit: string;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
  readonly nextRunnerHash: string;
  readonly migrationProgramHash: string;
}): Promise<ProbeV04PolicyMigrationManifest> {
  const source = await parseProbeV04PolicyMigrationSourceReceipt(
    input.sourceReceipt,
    input.predecessorReceipt
  );
  const expectedNextPolicyHash = await probePolicyHash();
  const expectedNextRunnerHash = await fallbackRunnerContractHash();
  if (
    PROBE_POLICY_VERSION !== PROBE_V04_MIGRATED_POLICY_VERSION ||
    expectedNextPolicyHash !== PROBE_V04_MIGRATED_POLICY_HASH ||
    canonicalJson(PROBE_PURPOSE_CALL_LIMITS) !==
      canonicalJson(PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS) ||
    canonicalJson(PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS) !==
      canonicalJson({ calibration: 13, baseline: 72, repair: 2, revised: 72, judge: 1 }) ||
    Object.values(PROBE_PURPOSE_CALL_LIMITS).reduce((sum, value) => sum + value, 0) !==
      PROBE_GLOBAL_CALL_LIMIT ||
    input.nextPolicyHash !== PROBE_V04_MIGRATED_POLICY_HASH ||
    input.nextScriptHash !== PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH ||
    expectedNextRunnerHash !== PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH ||
    input.nextRunnerHash !== PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH
  ) {
    throw new ProbeV04PolicyMigrationContractError("v04_next_policy_not_frozen");
  }
  return deepFreeze(
    canonicalClone({
      ...source,
      version: PROBE_V04_POLICY_MIGRATION_VERSION,
      migrationCommit: gitCommit(input.migrationCommit, "invalid_v04_migration_commit"),
      nextPolicyVersion: PROBE_V04_MIGRATED_POLICY_VERSION,
      nextPolicyHash: hash(input.nextPolicyHash, "invalid_v04_next_policy_hash"),
      nextScriptHash: hash(input.nextScriptHash, "invalid_v04_next_script_hash"),
      nextRunnerHash: literal(
        hash(input.nextRunnerHash, "invalid_v04_next_runner_hash"),
        PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
        "v04_next_runner_hash_mismatch"
      ),
      migrationProgramHash: hash(input.migrationProgramHash, "invalid_v04_migration_program_hash"),
      previousPurposeLimits: PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
      nextPurposeLimits: PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
    })
  );
}

export function probeV04PolicyMigrationDigest(
  manifest: ProbeV04PolicyMigrationManifest
): Promise<string> {
  return canonicalSha256(manifest);
}

export function probeV04PolicyMigrationReceiptHash(
  receipt: ProbeV04PolicyMigrationReceiptCore | ProbeV04PolicyMigrationReceipt
): Promise<string> {
  const core = { ...receipt } as ProbeV04PolicyMigrationReceiptCore & { receiptHash?: string };
  delete core.receiptHash;
  return canonicalSha256(core);
}

export async function createProbeV04PolicyMigrationReceipt(
  manifest: ProbeV04PolicyMigrationManifest,
  migrationDigest: string,
  migratedAtMs: number
): Promise<ProbeV04PolicyMigrationReceipt> {
  const expectedDigest = await probeV04PolicyMigrationDigest(manifest);
  if (migrationDigest !== expectedDigest) {
    throw new ProbeV04PolicyMigrationContractError("v04_migration_digest_mismatch");
  }
  integer(migratedAtMs, "invalid_v04_migrated_at");
  const core = deepFreeze(
    canonicalClone({ ...manifest, migrationDigest: expectedDigest, migratedAtMs })
  );
  return deepFreeze({ ...core, receiptHash: await probeV04PolicyMigrationReceiptHash(core) });
}

/** Read-only admission for a disabled successor build. The atomic transition revalidates calls. */
export function isProbeV04PolicyMigrationSourceStatus(
  status: ProbeV04PolicyMigrationSourceStatus,
  expected: {
    readonly guardInstanceId: string;
    readonly initializedCommit: string;
    readonly knownActualNanoUsd?: number;
  },
  nowMs: number = Date.now()
): boolean {
  const fixed = PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  return (
    status.status === "open" &&
    status.guardInstanceId === expected.guardInstanceId &&
    status.initializedCommit === expected.initializedCommit &&
    status.policyVersion === PROBE_V04_PREVIOUS_POLICY_VERSION &&
    status.policyHash === PROBE_V04_PREVIOUS_POLICY_HASH &&
    status.scriptHash === PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH &&
    status.model === PROBE_MODEL &&
    status.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    status.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    status.challengeClosesAtMs === Date.parse(PROBE_CHALLENGE_CLOSES_AT) &&
    nowMs < status.challengeClosesAtMs &&
    status.claimedCalls === fixed.claimedCalls &&
    status.committedNanoUsd === fixed.committedNanoUsd &&
    status.pendingCount === fixed.pendingCalls &&
    status.knownCount === fixed.knownCalls &&
    status.uncertainCount === fixed.uncertainCalls &&
    status.knownActualNanoUsd === fixed.knownActualNanoUsd &&
    (expected.knownActualNanoUsd === undefined ||
      status.knownActualNanoUsd === expected.knownActualNanoUsd) &&
    status.uncertainUpperNanoUsd === fixed.uncertainUpperNanoUsd &&
    status.inflightCount === fixed.inflightCalls &&
    status.sequence === fixed.sequence &&
    canonicalJson(status.purposeLimits) === canonicalJson(PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS) &&
    canonicalJson(status.purposeCounts) === canonicalJson(fixed.purposeCounts) &&
    !status.haltMarkerPresent &&
    !status.uncertainMarkerPresent
  );
}
