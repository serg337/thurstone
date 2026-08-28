import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH,
  PROBE_MIGRATED_POLICY_VERSION,
  PROBE_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRESERVED_STATE,
  probePolicyMigrationReceiptHash,
  type ProbePolicyMigrationKnownCall,
  type ProbePolicyMigrationReceipt
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  type ProbePurpose
} from "@/lib/probe/policy";

export const PROBE_V03_POLICY_MIGRATION_VERSION = "toolproof-probe-policy-migration-v03@1.0.0";
export const PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION =
  "toolproof-probe-policy-migration-v03-source@1.0.0";
export const PROBE_V03_POLICY_MIGRATION_ID = "migration_gate2_calibration_attempt_3";
export const PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT =
  "191f7885eeb062de4bfe4effd9468ef648aef600";
export const PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH =
  "41f8363c74f7b277c239689194069d80749d3f33342779662009f8c47e5348d6";
export const PROBE_V03_PREDECESSOR_MIGRATION_ID = PROBE_POLICY_MIGRATION_ID;
export const PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH =
  "4ee25981212e67324bda5ec21a67912eddacec622b20850035ca855574f43b84";

/** Permanent v0.3 target identity. Never derive historical receipts from the active policy. */
export const PROBE_V03_MIGRATED_POLICY_VERSION = "toolproof-probe-policy@0.3.0";
export const PROBE_V03_MIGRATED_POLICY_HASH =
  "8293eaee17e979eee1ca915a967ca3110f0d20068e4eda573554ae682dc563b0";
export const PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH =
  "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779";
export const PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS = Object.freeze({
  calibration: 9,
  baseline: 72,
  repair: 2,
  revised: 72,
  judge: 5
}) satisfies Readonly<Record<ProbePurpose, number>>;

export const PROBE_V03_PREVIOUS_POLICY_VERSION = PROBE_MIGRATED_POLICY_VERSION;
export const PROBE_V03_PREVIOUS_POLICY_HASH = PROBE_MIGRATED_POLICY_HASH;
export const PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH = PROBE_MIGRATED_LEDGER_SCRIPT_HASH;
export const PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS = PROBE_MIGRATED_PURPOSE_CALL_LIMITS;

export const PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE = Object.freeze({
  claimedCalls: 5 as const,
  knownCalls: 5 as const,
  pendingCalls: 0 as const,
  uncertainCalls: 0 as const,
  inflightCalls: 0 as const,
  committedNanoUsd: 312_500_000 as const,
  uncertainUpperNanoUsd: 0 as const,
  sequence: 5 as const,
  purposeCounts: Object.freeze({
    calibration: 5 as const,
    baseline: 0 as const,
    repair: 0 as const,
    revised: 0 as const,
    judge: 0 as const
  })
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export interface ProbeV03PolicyMigrationPreservedState {
  readonly claimedCalls: 5;
  readonly knownCalls: 5;
  readonly pendingCalls: 0;
  readonly uncertainCalls: 0;
  readonly inflightCalls: 0;
  readonly committedNanoUsd: 312_500_000;
  readonly knownActualNanoUsd: number;
  readonly uncertainUpperNanoUsd: 0;
  readonly sequence: 5;
  readonly purposeCounts: Readonly<{
    calibration: 5;
    baseline: 0;
    repair: 0;
    revised: 0;
    judge: 0;
  }>;
}

export interface ProbeV03PolicyMigrationSourceReceipt {
  readonly version: typeof PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION;
  readonly migrationId: typeof PROBE_V03_POLICY_MIGRATION_ID;
  readonly priorAppCommit: typeof PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT;
  readonly priorActivationHash: typeof PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH;
  readonly predecessorMigrationId: typeof PROBE_V03_PREDECESSOR_MIGRATION_ID;
  readonly predecessorMigrationReceiptHash: string;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly previousPolicyVersion: typeof PROBE_V03_PREVIOUS_POLICY_VERSION;
  readonly previousPolicyHash: typeof PROBE_V03_PREVIOUS_POLICY_HASH;
  readonly previousScriptHash: typeof PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH;
  readonly preserved: ProbeV03PolicyMigrationPreservedState;
  readonly knownCalls: readonly ProbePolicyMigrationKnownCall[];
}

export interface ProbeV03PolicyMigrationManifest extends Omit<
  ProbeV03PolicyMigrationSourceReceipt,
  "version"
> {
  readonly version: typeof PROBE_V03_POLICY_MIGRATION_VERSION;
  readonly migrationCommit: string;
  readonly nextPolicyVersion: typeof PROBE_V03_MIGRATED_POLICY_VERSION;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
  readonly previousPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly nextPurposeLimits: Readonly<Record<ProbePurpose, number>>;
  readonly globalCallLimit: number;
  readonly lifetimeSpendCeilingNanoUsd: number;
  readonly perCallReservationNanoUsd: number;
}

export interface ProbeV03PolicyMigrationReceiptCore extends ProbeV03PolicyMigrationManifest {
  readonly migrationDigest: string;
  readonly migratedAtMs: number;
}

export interface ProbeV03PolicyMigrationReceipt extends ProbeV03PolicyMigrationReceiptCore {
  readonly receiptHash: string;
}

export interface ProbeV03PolicyMigrationResult {
  readonly disposition: "new" | "existing";
  readonly receipt: ProbeV03PolicyMigrationReceipt;
}

export interface ProbeV03PolicyMigrationSourceStatus {
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

export class ProbeV03PolicyMigrationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeV03PolicyMigrationContractError";
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProbeV03PolicyMigrationContractError(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProbeV03PolicyMigrationContractError(code);
  }
}

function literal<T extends string>(value: unknown, expected: T, code: string): T {
  if (value !== expected) throw new ProbeV03PolicyMigrationContractError(code);
  return expected;
}

function opaque(value: unknown, code: string): string {
  if (typeof value !== "string" || !OPAQUE_PATTERN.test(value)) {
    throw new ProbeV03PolicyMigrationContractError(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ProbeV03PolicyMigrationContractError(code);
  }
  return value;
}

function gitCommit(value: unknown, code: string): string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    throw new ProbeV03PolicyMigrationContractError(code);
  }
  return value;
}

function integer(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProbeV03PolicyMigrationContractError(code);
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

function parsePreservedState(value: unknown): ProbeV03PolicyMigrationPreservedState {
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
  const fixed = PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  const purposeCounts = record(state.purposeCounts, "invalid_preserved_purpose_counts");
  exactKeys(
    purposeCounts,
    ["calibration", "baseline", "repair", "revised", "judge"],
    "invalid_preserved_purpose_counts_shape"
  );
  const parsed: ProbeV03PolicyMigrationPreservedState = {
    claimedCalls: integer(state.claimedCalls, "invalid_preserved_claimed") as 5,
    knownCalls: integer(state.knownCalls, "invalid_preserved_known") as 5,
    pendingCalls: integer(state.pendingCalls, "invalid_preserved_pending") as 0,
    uncertainCalls: integer(state.uncertainCalls, "invalid_preserved_uncertain") as 0,
    inflightCalls: integer(state.inflightCalls, "invalid_preserved_inflight") as 0,
    committedNanoUsd: integer(state.committedNanoUsd, "invalid_preserved_committed") as 312_500_000,
    knownActualNanoUsd: integer(state.knownActualNanoUsd, "invalid_preserved_actual"),
    uncertainUpperNanoUsd: integer(
      state.uncertainUpperNanoUsd,
      "invalid_preserved_uncertain_upper"
    ) as 0,
    sequence: integer(state.sequence, "invalid_preserved_sequence") as 5,
    purposeCounts: {
      calibration: integer(purposeCounts.calibration, "invalid_preserved_calibration") as 5,
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
    canonicalJson(parsed.purposeCounts) !== canonicalJson(fixed.purposeCounts) ||
    parsed.knownActualNanoUsd > parsed.knownCalls * PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new ProbeV03PolicyMigrationContractError("preserved_state_mismatch");
  }
  return deepFreeze(canonicalClone(parsed));
}

function parseKnownCalls(
  value: unknown,
  predecessor: ProbePolicyMigrationReceipt,
  expectedKnownActualNanoUsd: number
): readonly ProbePolicyMigrationKnownCall[] {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new ProbeV03PolicyMigrationContractError("invalid_known_calls");
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
      throw new ProbeV03PolicyMigrationContractError("known_call_order_mismatch");
    }
    if (parsed.actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD) {
      throw new ProbeV03PolicyMigrationContractError("known_call_cost_over_reservation");
    }
    if (seenJtis.has(parsed.jti) || seenResponses.has(parsed.providerResponseHash)) {
      throw new ProbeV03PolicyMigrationContractError("duplicate_known_call");
    }
    seenJtis.add(parsed.jti);
    seenResponses.add(parsed.providerResponseHash);
    actualTotal += parsed.actualNanoUsd;
    return parsed;
  });
  if (
    canonicalJson(calls.slice(0, 4)) !== canonicalJson(predecessor.knownCalls) ||
    actualTotal !== expectedKnownActualNanoUsd
  ) {
    throw new ProbeV03PolicyMigrationContractError("known_call_lineage_mismatch");
  }
  return deepFreeze(canonicalClone(calls));
}

export async function parseProbeV03PolicyMigrationSourceReceipt(
  value: unknown,
  predecessor: ProbePolicyMigrationReceipt
): Promise<ProbeV03PolicyMigrationSourceReceipt> {
  const receipt = record(value, "invalid_v03_source_receipt");
  exactKeys(
    receipt,
    [
      "version",
      "migrationId",
      "priorAppCommit",
      "priorActivationHash",
      "predecessorMigrationId",
      "predecessorMigrationReceiptHash",
      "guardInstanceId",
      "initializedCommit",
      "previousPolicyVersion",
      "previousPolicyHash",
      "previousScriptHash",
      "preserved",
      "knownCalls"
    ],
    "invalid_v03_source_receipt_shape"
  );
  const predecessorReceiptHash = await probePolicyMigrationReceiptHash(predecessor);
  if (
    predecessor.receiptHash !== predecessorReceiptHash ||
    predecessor.migrationId !== PROBE_V03_PREDECESSOR_MIGRATION_ID
  ) {
    throw new ProbeV03PolicyMigrationContractError("predecessor_receipt_invalid");
  }
  const preserved = parsePreservedState(receipt.preserved);
  const parsed = {
    version: literal(
      receipt.version,
      PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      "v03_source_version_mismatch"
    ),
    migrationId: literal(
      receipt.migrationId,
      PROBE_V03_POLICY_MIGRATION_ID,
      "v03_migration_id_mismatch"
    ),
    priorAppCommit: literal(
      receipt.priorAppCommit,
      PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      "v03_prior_app_commit_mismatch"
    ),
    priorActivationHash: literal(
      receipt.priorActivationHash,
      PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      "v03_prior_activation_hash_mismatch"
    ),
    predecessorMigrationId: literal(
      receipt.predecessorMigrationId,
      PROBE_V03_PREDECESSOR_MIGRATION_ID,
      "v03_predecessor_migration_id_mismatch"
    ),
    predecessorMigrationReceiptHash: hash(
      receipt.predecessorMigrationReceiptHash,
      "invalid_v03_predecessor_receipt_hash"
    ),
    guardInstanceId: opaque(receipt.guardInstanceId, "invalid_v03_guard_instance"),
    initializedCommit: gitCommit(receipt.initializedCommit, "invalid_v03_initialized_commit"),
    previousPolicyVersion: literal(
      receipt.previousPolicyVersion,
      PROBE_V03_PREVIOUS_POLICY_VERSION,
      "v03_previous_policy_version_mismatch"
    ),
    previousPolicyHash: literal(
      receipt.previousPolicyHash,
      PROBE_V03_PREVIOUS_POLICY_HASH,
      "v03_previous_policy_hash_mismatch"
    ),
    previousScriptHash: literal(
      receipt.previousScriptHash,
      PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      "v03_previous_script_hash_mismatch"
    ),
    preserved,
    knownCalls: parseKnownCalls(receipt.knownCalls, predecessor, preserved.knownActualNanoUsd)
  } satisfies ProbeV03PolicyMigrationSourceReceipt;
  if (
    parsed.predecessorMigrationReceiptHash !== predecessor.receiptHash ||
    parsed.guardInstanceId !== predecessor.guardInstanceId ||
    parsed.initializedCommit !== predecessor.initializedCommit ||
    parsed.preserved.knownActualNanoUsd < predecessor.preserved.knownActualNanoUsd
  ) {
    throw new ProbeV03PolicyMigrationContractError("v03_predecessor_lineage_mismatch");
  }
  return deepFreeze(canonicalClone(parsed));
}

export async function createProbeV03PolicyMigrationManifest(input: {
  readonly sourceReceipt: ProbeV03PolicyMigrationSourceReceipt;
  readonly predecessorReceipt: ProbePolicyMigrationReceipt;
  readonly migrationCommit: string;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
}): Promise<ProbeV03PolicyMigrationManifest> {
  const source = await parseProbeV03PolicyMigrationSourceReceipt(
    input.sourceReceipt,
    input.predecessorReceipt
  );
  if (
    canonicalJson(PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS) !==
      canonicalJson({ calibration: 9, baseline: 72, repair: 2, revised: 72, judge: 5 }) ||
    Object.values(PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS).reduce((sum, value) => sum + value, 0) !==
      PROBE_GLOBAL_CALL_LIMIT
  ) {
    throw new ProbeV03PolicyMigrationContractError("v03_next_policy_not_frozen");
  }
  return deepFreeze(
    canonicalClone({
      ...source,
      version: PROBE_V03_POLICY_MIGRATION_VERSION,
      migrationCommit: gitCommit(input.migrationCommit, "invalid_v03_migration_commit"),
      nextPolicyVersion: PROBE_V03_MIGRATED_POLICY_VERSION,
      nextPolicyHash: literal(
        hash(input.nextPolicyHash, "invalid_v03_next_policy_hash"),
        PROBE_V03_MIGRATED_POLICY_HASH,
        "v03_next_policy_hash_mismatch"
      ),
      nextScriptHash: literal(
        hash(input.nextScriptHash, "invalid_v03_next_script_hash"),
        PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
        "v03_next_script_hash_mismatch"
      ),
      previousPurposeLimits: PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS,
      nextPurposeLimits: PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
    })
  );
}

export function probeV03PolicyMigrationDigest(
  manifest: ProbeV03PolicyMigrationManifest
): Promise<string> {
  return canonicalSha256(manifest);
}

export function probeV03PolicyMigrationReceiptHash(
  receipt: ProbeV03PolicyMigrationReceiptCore | ProbeV03PolicyMigrationReceipt
): Promise<string> {
  const core = { ...receipt } as ProbeV03PolicyMigrationReceiptCore & { receiptHash?: string };
  delete core.receiptHash;
  return canonicalSha256(core);
}

export async function createProbeV03PolicyMigrationReceipt(
  manifest: ProbeV03PolicyMigrationManifest,
  migrationDigest: string,
  migratedAtMs: number
): Promise<ProbeV03PolicyMigrationReceipt> {
  const expectedDigest = await probeV03PolicyMigrationDigest(manifest);
  if (migrationDigest !== expectedDigest) {
    throw new ProbeV03PolicyMigrationContractError("v03_migration_digest_mismatch");
  }
  integer(migratedAtMs, "invalid_v03_migrated_at");
  const core = deepFreeze(
    canonicalClone({ ...manifest, migrationDigest: expectedDigest, migratedAtMs })
  );
  return deepFreeze({ ...core, receiptHash: await probeV03PolicyMigrationReceiptHash(core) });
}

/** Read-only admission for a disabled successor build. The atomic transition revalidates calls. */
export function isProbeV03PolicyMigrationSourceStatus(
  status: ProbeV03PolicyMigrationSourceStatus,
  expected: {
    readonly guardInstanceId: string;
    readonly initializedCommit: string;
    readonly knownActualNanoUsd?: number;
  },
  nowMs: number = Date.now()
): boolean {
  const fixed = PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  return (
    status.status === "open" &&
    status.guardInstanceId === expected.guardInstanceId &&
    status.initializedCommit === expected.initializedCommit &&
    status.policyVersion === PROBE_V03_PREVIOUS_POLICY_VERSION &&
    status.policyHash === PROBE_V03_PREVIOUS_POLICY_HASH &&
    status.scriptHash === PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH &&
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
    status.knownActualNanoUsd >= PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownActualNanoUsd &&
    status.knownActualNanoUsd <= fixed.knownCalls * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    (expected.knownActualNanoUsd === undefined ||
      status.knownActualNanoUsd === expected.knownActualNanoUsd) &&
    status.uncertainUpperNanoUsd === fixed.uncertainUpperNanoUsd &&
    status.inflightCount === fixed.inflightCalls &&
    status.sequence === fixed.sequence &&
    canonicalJson(status.purposeLimits) === canonicalJson(PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS) &&
    canonicalJson(status.purposeCounts) === canonicalJson(fixed.purposeCounts) &&
    !status.haltMarkerPresent &&
    !status.uncertainMarkerPresent
  );
}
