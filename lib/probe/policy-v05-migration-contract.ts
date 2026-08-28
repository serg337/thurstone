import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import {
  PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V04_MIGRATED_POLICY_HASH,
  PROBE_V04_MIGRATED_POLICY_VERSION,
  PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V04_POLICY_MIGRATION_ID,
  probeV04PolicyMigrationReceiptHash,
  type ProbeV04PolicyMigrationReceipt
} from "@/lib/probe/policy-v04-migration-contract";
import { type ProbePolicyMigrationKnownCall } from "@/lib/probe/policy-migration-contract";
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

export const PROBE_V05_POLICY_MIGRATION_VERSION = "toolproof-probe-policy-migration-v05@1.0.0";
export const PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION =
  "toolproof-probe-policy-migration-v05-source@1.0.0";
export const PROBE_V05_POLICY_MIGRATION_ID = "migration_gate2_googlechromelabs_fallback_attempt_2";
export const PROBE_V05_PREDECESSOR_MIGRATION_ID = PROBE_V04_POLICY_MIGRATION_ID;
export const PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH =
  "bb60398c7f803c19845c5f05d9e70d88784f9a11ca8cd33e7f7d1dfd0b91b9c1";
export const PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT =
  "42f65f0345adca88b83b2e8c612c7914f8fbbaba";
export const PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH =
  "842c355e6b783b838727376e35c63fc7d0bab9eda112a49c8136e6ef752e4950";
export const PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256 =
  "cbc359472f18f8c240480562905507806ea2db45d84ba8f247714a097d05814c";
export const PROBE_V05_PRIOR_EVIDENCE_DIGEST =
  "43bf61e6bceccdf80e561da3a596ce758016ec6a4b2ed53502136a6a6303c3fb";
export const PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256 =
  "3725dbe46727bf05ffe0db30c96b4c2e57e292f72c41dfdd0a67af76963032d8";
export const PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST =
  "b3db37326d81cee044ac258d60b0b35809fcbc2111ae17c42c6c4784c0f36a17";
export const PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST =
  "03c4632b3fc75914f107528965c11959c9e39bed8354f7c9a46d599cc34a3e2b";
export const PROBE_V05_AUTHORIZATION_INVENTORY_VERSION =
  "toolproof-probe-authorization-inventory@1.0.0";
export const PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_COUNT = 1;
export const PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_DIGEST =
  "d1314f7253800ede4a804f264638b24ea9947d6a2709b07d44c9129a220f1e99";
export const PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_FOOTPRINT_DIGEST =
  "b46063f356d9f6bcbfa858c4623c387452757cd52531f54b0baecd110b1ae8b0";
export const PROBE_V05_AUTHORIZATION_INVENTORY = Object.freeze({
  version: PROBE_V05_AUTHORIZATION_INVENTORY_VERSION,
  total: 14,
  known: 13,
  providerResponses: 13,
  ungrantedExpired: PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_COUNT,
  tombstone: Object.freeze({
    recordDigest: PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_DIGEST,
    footprintDigest: PROBE_V05_PRESERVED_ISSUED_AUTHORIZATION_FOOTPRINT_DIGEST,
    storedState: "ISSUED",
    temporalDisposition: "expired",
    purpose: "calibration",
    fieldCount: 11,
    permanent: true,
    countedAsCall: false,
    providerRecordPresent: false,
    dispatchFieldsPresent: false,
    subjectReplayBindingPresent: true,
    issuanceRateBindingPresent: true
  })
});

export const PROBE_V05_PREVIOUS_POLICY_VERSION = PROBE_V04_MIGRATED_POLICY_VERSION;
export const PROBE_V05_PREVIOUS_POLICY_HASH = PROBE_V04_MIGRATED_POLICY_HASH;
export const PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH = PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH;
export const PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH = PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH;
export const PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS = PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS;

export const PROBE_V05_MIGRATED_POLICY_VERSION = "toolproof-probe-policy@0.5.0";
export const PROBE_V05_MIGRATED_POLICY_HASH =
  "61765daf8a620613e4b94946ac897211a3c977de7922970228788aec5d893281";
export const PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH = PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH;
export const PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS = Object.freeze({
  calibration: 17,
  baseline: 70,
  repair: 2,
  revised: 70,
  judge: 1
}) satisfies Readonly<Record<ProbePurpose, number>>;

export const PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH =
  "6c44eb19479e460cdef51bca52b577526170eb455d26066b97ec81fe1d7b5230";

export const PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE = Object.freeze({
  claimedCalls: 13,
  knownCalls: 13,
  pendingCalls: 0,
  uncertainCalls: 0,
  inflightCalls: 0,
  committedNanoUsd: 812_500_000,
  knownActualNanoUsd: 42_165_200,
  uncertainUpperNanoUsd: 0,
  sequence: 13,
  purposeCounts: Object.freeze({ calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 })
});

export const PROBE_V05_ACK_ANCHOR_FIXED = Object.freeze({
  activationHash: PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  buildCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  ackStatus: "acknowledged",
  ackRevision: 4,
  ackMode: "operator_recovery",
  evidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  rawEvidenceSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  repairCommit: "367854cfd9cda45ea8a247fa030fc8630d72df6d",
  programHash: "cc8a5ca21b0ad6105fb528a343e8c3fce3f00aa0d4e7867517b9754ff9760b3f",
  acknowledgedAtMs: 1_787_921_605_562,
  confirmation: "4d721722e3ed941f7c3d391590c37436ba88bc9f3c7bdc0720c917e5186229a0",
  runIdentityDigest: "12ff6d4d29930955e7f5568768a42d9533d6f5e991de5441f8a38f4da3500621",
  guardSnapshotDigest: "1e6c7c06fdf003775df48c98d7d25fa30406729242a8ef751a5036503ce22d0e"
});

const KNOWN_CALLS = [
  [
    "jti_3ttNKoeU_37eePWqlaQTAd",
    2_752_200,
    "6ad2354dd698c3485acdf764436d2e006fca921dbcf816e21838726e66e08a34",
    "79d59941177121ee14813c652e4042ab73797c4952477c70301cbaf76a73f730",
    "4575531a0117bcba5679e0c8926ef35a51301ab65dd71ff8b8217ba3d0340ed3"
  ],
  [
    "jti_KbzmhiHJVFITzY_LutQLsW",
    2_745_600,
    "72ff841d0b8a0b77ea42b97a082215571bf048a13ad29cfb3015b5fc433ce4b8",
    "f006918f47aafc8b9c57321ec16c7a6360bdabeb397d5782175f94d23de30c32",
    "ac6cc9b1fedc07839fd21592c38233be6023cd152820a2e0ef297f362903a3d8"
  ],
  [
    "jti_-NVfSckdMZ9ZBaB3lR6Shd",
    2_862_200,
    "80230a2a6d04d5493b7d3116cbad1459891c0151b2306de2427b662fb54cf03e",
    "24d5c889e87d9301b7fe19b0c618e3b2252092cd4d48a3077ebe284cc93750f7",
    "be54b40921ff0e395f0a92ee21b530926ddfaf49b589a5d12ebf24730b5d2675"
  ],
  [
    "jti_fnoZqfzfBTsmlgSYJGJtjm",
    3_000_800,
    "b7c53214faf520268872b3d17eba17a4e65260e50d754e1acbc5915f80672ed6",
    "f727dc2f1f439a085ec6fce8d3c822d656b495e6ee025562bc3478868bec6938",
    "961a4ecb2a7f083f83c4afa520836716289af392c65ac722c0c433945e239d1a"
  ],
  [
    "jti_k3jaZ-FMU0962MmGl7Gtoy",
    3_216_400,
    "22eec2222d3b8cb73451df90f6af52ecc13df4080d4b44c5f26d9e48370b8e02",
    "606dea43a57488f28c43edf02d4c58fdf6910755f381c69d3a8d05d4a5d80c1c",
    "0756f7467db7984f1141aa5dd356198aa26963776d403a5fe507951fec8b27af"
  ],
  [
    "jti_9Es4dLaTwzJKmw9l1pLAje",
    3_322_000,
    "65dcc98af9f86533c4b25f5401a9272713bfbfbd0552f4b283f6dd519862b3c2",
    "415f7e8fb84d6c1c4c079a16b88dcbe039e7f037a08cea813b5d56f497782e89",
    "56044e97681209511cb0d54a62307cf59db0e5c6b87c8b52283890ba33f1ab2c"
  ],
  [
    "jti_2CK2ZdwtY_ExNqGWBzFtZH",
    3_280_200,
    "9dc549c8a52388f5fd844c3999ba1b9183acde9ec5fd46dad190bf11c1fcce34",
    "ee141035305247d16e9765d6bef48b7fbdba344646eceb777bb533c3ffa4ee59",
    "fcacfaee765db8cc7a8f72fe2bcee82ea227a0c9424ed8a1ebb1c648cb4a93ec"
  ],
  [
    "jti_9W52PDxVkWy2YlOXfiMU7d",
    3_489_200,
    "d7defedf2e8e8ec1c7d1b504ad13349ee3c9546829e6e3d761687766f2b1b604",
    "45e667f18bbd7b4ae7648f8600dcb14aa39af5fb5950745d9fcbb825d56ecab6",
    "2b364c94b58f6049131fc697e5dc0db519d960f21291a8becbebc5c80b13729c"
  ],
  [
    "jti_W_dK9y1PGv1mAbigResi3t",
    3_324_200,
    "a5524d99801cc9e750b220849d3501bee4cfcc5487fe30e9df756db9e8c1667f",
    "b47ebbeccaf8f936015781a8556769019b68a8f568c0e6c6ae6881bf07a421b4",
    "235e69b9f50ba05f6682efdcc56bc2392639c2c15a453f6fe2aac9c7b551dd52"
  ],
  [
    "jti_vcEhnlGG874uS1phCwDgo6",
    3_192_200,
    "e6016c8aeeda63f1f95687fcb52316357730a924075ef616e57770281325677d",
    "b28d34b3cfd0a3d82dddcfcabc65017d19dbd0bad313bd8bbdedf6c4b1426a01",
    "373d83a1d5690c7cc95abd75f2f2471b165bed2c0f0897ceee731570ee7e1aac"
  ],
  [
    "jti_2hu_wGf-PUIYTK2nowQBmO",
    3_207_600,
    "93f8ff002a73b5584815e31399a4e7cf06028d0502a6f2da5ae8afca94e122ee",
    "dd97fa57badfb45985c53541731a05b95e5ae4e2c4fb88c36a5b4989c83ff41b",
    "2838c2a29569ddbfa80e93747e31d995e5760727c3defebdff2c74e128672c59"
  ],
  [
    "jti_2MyQhEtCty5XiyWFUg8Ct6",
    3_971_000,
    "563d2e22d1cf46f32371b0bd54c8215096610da60bf65d5f0fa39037fef9684d",
    "808f7476a18254391e4eecdbe7746f7c8ec2c8dd215151e2017367d0894b1dca",
    "03cb42787a29ac06d4a4c01f91911400b8363283f2066611909ea2f072e9bd18"
  ],
  [
    "jti_QW_wboZRDardfXsmG5ePUr",
    3_801_600,
    "26ba91e2ea9a6ef738f9a8538ff52d78bbf918341e8141aa7aa8991e206b90b2",
    "8c5278cd462fda0a9f9aad3dd04664fe3fd46ec70ec2ddc5fbc77285cc41872f",
    "c703ca30d06dfe0f6ee8b8c07ce790f5533b5799958d09cc05323b08a3b4e6f2"
  ]
] as const;

export const PROBE_V05_PRESERVED_KNOWN_CALLS: readonly ProbePolicyMigrationKnownCall[] =
  Object.freeze(
    KNOWN_CALLS.map(
      ([jti, actualNanoUsd, providerResponseHash, settlementDigest, usageHash], ordinal) =>
        Object.freeze({
          ordinal,
          jti,
          dispatchSequence: ordinal + 1,
          actualNanoUsd,
          providerResponseHash,
          settlementDigest,
          usageHash
        })
    )
  );

export interface ProbeV05AckAnchor {
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly recoveryHash: string;
  readonly sessionHash: string;
  readonly runHash: string;
  readonly actorHash: string;
  readonly launchHash: string;
  readonly ackStatus: string;
  readonly ackRevision: number;
  readonly ackMode: string;
  readonly evidenceDigest: string;
  readonly rawEvidenceSha256: string;
  readonly repairCommit: string;
  readonly programHash: string;
  readonly payloadBinding: string;
  readonly acknowledgedAtMs: number;
  readonly confirmation: string;
  readonly runIdentityDigest: string;
  readonly guardSnapshotDigest: string;
  readonly encryptedDataPresent: false;
}

export interface ProbeV05PolicyMigrationSourceReceipt {
  readonly version: typeof PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION;
  readonly migrationId: typeof PROBE_V05_POLICY_MIGRATION_ID;
  readonly priorAppCommit: typeof PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT;
  readonly priorActivationHash: typeof PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH;
  readonly priorEvidenceRawSha256: typeof PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256;
  readonly priorEvidenceDigest: typeof PROBE_V05_PRIOR_EVIDENCE_DIGEST;
  readonly priorReproducerRawSha256: typeof PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256;
  readonly priorReproducerEvidenceDigest: typeof PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST;
  readonly predecessorMigrationId: typeof PROBE_V05_PREDECESSOR_MIGRATION_ID;
  readonly predecessorMigrationReceiptHash: string;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
  readonly previousPolicyVersion: typeof PROBE_V05_PREVIOUS_POLICY_VERSION;
  readonly previousPolicyHash: typeof PROBE_V05_PREVIOUS_POLICY_HASH;
  readonly previousScriptHash: typeof PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH;
  readonly previousRunnerHash: typeof PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH;
  readonly preserved: typeof PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  readonly knownCalls: readonly ProbePolicyMigrationKnownCall[];
  readonly authorizationInventory: typeof PROBE_V05_AUTHORIZATION_INVENTORY;
  readonly ackAnchor: ProbeV05AckAnchor;
}

export interface ProbeV05PolicyMigrationManifest extends Omit<
  ProbeV05PolicyMigrationSourceReceipt,
  "version"
> {
  readonly version: typeof PROBE_V05_POLICY_MIGRATION_VERSION;
  readonly migrationCommit: string;
  readonly nextPolicyVersion: typeof PROBE_V05_MIGRATED_POLICY_VERSION;
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

export interface ProbeV05PolicyMigrationReceipt extends ProbeV05PolicyMigrationManifest {
  readonly migrationDigest: string;
  readonly migratedAtMs: number;
  readonly receiptHash: string;
}

export interface ProbeV05PolicyMigrationSourceStatus {
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

export class ProbeV05PolicyMigrationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeV05PolicyMigrationContractError";
  }
}

function fail(code: string): never {
  throw new ProbeV05PolicyMigrationContractError(code);
}
function hash(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
  return value;
}
function commit(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) fail(code);
  return value;
}
function integer(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}
function clone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}
function exact(value: unknown, expected: unknown, code: string): void {
  if (canonicalJson(value) !== canonicalJson(expected)) fail(code);
}
function exactKeys(value: object, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    fail(code);
}

export async function parseProbeV05PolicyMigrationSourceReceipt(
  value: ProbeV05PolicyMigrationSourceReceipt,
  predecessor: ProbeV04PolicyMigrationReceipt
): Promise<ProbeV05PolicyMigrationSourceReceipt> {
  if (!value || typeof value !== "object") fail("invalid_v05_source_receipt");
  exactKeys(
    value,
    [
      "version",
      "migrationId",
      "priorAppCommit",
      "priorActivationHash",
      "priorEvidenceRawSha256",
      "priorEvidenceDigest",
      "priorReproducerRawSha256",
      "priorReproducerEvidenceDigest",
      "predecessorMigrationId",
      "predecessorMigrationReceiptHash",
      "guardInstanceId",
      "initializedCommit",
      "previousPolicyVersion",
      "previousPolicyHash",
      "previousScriptHash",
      "previousRunnerHash",
      "preserved",
      "knownCalls",
      "authorizationInventory",
      "ackAnchor"
    ],
    "invalid_v05_source_receipt_shape"
  );
  if (
    predecessor.receiptHash !== (await probeV04PolicyMigrationReceiptHash(predecessor)) ||
    predecessor.receiptHash !== PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    predecessor.migrationId !== PROBE_V05_PREDECESSOR_MIGRATION_ID
  )
    fail("v05_predecessor_receipt_invalid");
  if (
    value.version !== PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION ||
    value.migrationId !== PROBE_V05_POLICY_MIGRATION_ID ||
    value.priorAppCommit !== PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT ||
    value.priorActivationHash !== PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH ||
    value.priorEvidenceRawSha256 !== PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256 ||
    value.priorEvidenceDigest !== PROBE_V05_PRIOR_EVIDENCE_DIGEST ||
    value.priorReproducerRawSha256 !== PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256 ||
    value.priorReproducerEvidenceDigest !== PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST ||
    value.predecessorMigrationId !== PROBE_V05_PREDECESSOR_MIGRATION_ID ||
    value.predecessorMigrationReceiptHash !== PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    value.previousPolicyVersion !== PROBE_V05_PREVIOUS_POLICY_VERSION ||
    value.previousPolicyHash !== PROBE_V05_PREVIOUS_POLICY_HASH ||
    value.previousScriptHash !== PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH ||
    value.previousRunnerHash !== PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH
  )
    fail("v05_source_identity_mismatch");
  commit(value.initializedCommit, "invalid_v05_initialized_commit");
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(value.guardInstanceId)) fail("invalid_v05_guard_instance");
  exact(
    value.preserved,
    PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    "v05_preserved_state_mismatch"
  );
  exact(value.knownCalls, PROBE_V05_PRESERVED_KNOWN_CALLS, "v05_known_call_lineage_mismatch");
  exact(
    value.authorizationInventory,
    PROBE_V05_AUTHORIZATION_INVENTORY,
    "v05_authorization_inventory_mismatch"
  );
  if ((await canonicalSha256(value.knownCalls)) !== PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST)
    fail("v05_known_call_digest_mismatch");
  exact(
    value.knownCalls.slice(0, 9),
    predecessor.knownCalls,
    "v05_predecessor_call_lineage_mismatch"
  );
  const ack = value.ackAnchor;
  if (!ack || typeof ack !== "object" || ack.encryptedDataPresent !== false)
    fail("v05_ack_anchor_invalid");
  exactKeys(
    ack,
    [
      "activationHash",
      "buildCommit",
      "recoveryHash",
      "sessionHash",
      "runHash",
      "actorHash",
      "launchHash",
      "ackStatus",
      "ackRevision",
      "ackMode",
      "evidenceDigest",
      "rawEvidenceSha256",
      "repairCommit",
      "programHash",
      "payloadBinding",
      "acknowledgedAtMs",
      "confirmation",
      "runIdentityDigest",
      "guardSnapshotDigest",
      "encryptedDataPresent"
    ],
    "invalid_v05_ack_anchor_shape"
  );
  const fixed = PROBE_V05_ACK_ANCHOR_FIXED;
  for (const [key, expected] of Object.entries(fixed)) {
    if ((ack as unknown as Record<string, unknown>)[key] !== expected)
      fail("v05_ack_anchor_mismatch");
  }
  for (const key of [
    "recoveryHash",
    "sessionHash",
    "runHash",
    "actorHash",
    "launchHash",
    "payloadBinding"
  ] as const)
    hash(ack[key], `invalid_v05_ack_${key}`);
  return freeze(clone(value));
}

export async function createProbeV05PolicyMigrationManifest(input: {
  readonly sourceReceipt: ProbeV05PolicyMigrationSourceReceipt;
  readonly predecessorReceipt: ProbeV04PolicyMigrationReceipt;
  readonly migrationCommit: string;
  readonly nextPolicyHash: string;
  readonly nextScriptHash: string;
  readonly nextRunnerHash: string;
  readonly migrationProgramHash: string;
}): Promise<ProbeV05PolicyMigrationManifest> {
  const source = await parseProbeV05PolicyMigrationSourceReceipt(
    input.sourceReceipt,
    input.predecessorReceipt
  );
  if (
    PROBE_POLICY_VERSION !== PROBE_V05_MIGRATED_POLICY_VERSION ||
    (await probePolicyHash()) !== PROBE_V05_MIGRATED_POLICY_HASH ||
    canonicalJson(PROBE_PURPOSE_CALL_LIMITS) !==
      canonicalJson(PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS) ||
    input.nextPolicyHash !== PROBE_V05_MIGRATED_POLICY_HASH ||
    input.nextScriptHash !== PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH ||
    (await fallbackRunnerContractHash()) !== PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH ||
    input.nextRunnerHash !== PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH
  )
    fail("v05_next_policy_not_frozen");
  return freeze(
    clone({
      ...source,
      version: PROBE_V05_POLICY_MIGRATION_VERSION,
      migrationCommit: commit(input.migrationCommit, "invalid_v05_migration_commit"),
      nextPolicyVersion: PROBE_V05_MIGRATED_POLICY_VERSION,
      nextPolicyHash: hash(input.nextPolicyHash, "invalid_v05_next_policy_hash"),
      nextScriptHash: hash(input.nextScriptHash, "invalid_v05_next_script_hash"),
      nextRunnerHash: hash(input.nextRunnerHash, "invalid_v05_next_runner_hash"),
      migrationProgramHash: hash(input.migrationProgramHash, "invalid_v05_migration_program_hash"),
      previousPurposeLimits: PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
      nextPurposeLimits: PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
    })
  );
}

export function probeV05PolicyMigrationDigest(manifest: ProbeV05PolicyMigrationManifest) {
  return canonicalSha256(manifest);
}
export function probeV05PolicyMigrationReceiptHash(
  receipt: ProbeV05PolicyMigrationReceipt | Omit<ProbeV05PolicyMigrationReceipt, "receiptHash">
) {
  const core = { ...receipt } as Omit<ProbeV05PolicyMigrationReceipt, "receiptHash"> & {
    receiptHash?: string;
  };
  delete core.receiptHash;
  return canonicalSha256(core);
}
export async function createProbeV05PolicyMigrationReceipt(
  manifest: ProbeV05PolicyMigrationManifest,
  migrationDigest: string,
  migratedAtMs: number
): Promise<ProbeV05PolicyMigrationReceipt> {
  if (migrationDigest !== (await probeV05PolicyMigrationDigest(manifest)))
    fail("v05_migration_digest_mismatch");
  integer(migratedAtMs, "invalid_v05_migrated_at");
  const core = freeze(clone({ ...manifest, migrationDigest, migratedAtMs }));
  return freeze({ ...core, receiptHash: await probeV05PolicyMigrationReceiptHash(core) });
}

export function isProbeV05PolicyMigrationSourceStatus(
  status: ProbeV05PolicyMigrationSourceStatus,
  expected: { readonly guardInstanceId: string; readonly initializedCommit: string },
  nowMs = Date.now()
): boolean {
  const fixed = PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  return (
    status.status === "open" &&
    status.guardInstanceId === expected.guardInstanceId &&
    status.initializedCommit === expected.initializedCommit &&
    status.policyVersion === PROBE_V05_PREVIOUS_POLICY_VERSION &&
    status.policyHash === PROBE_V05_PREVIOUS_POLICY_HASH &&
    status.scriptHash === PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH &&
    status.model === PROBE_MODEL &&
    status.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    status.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    status.challengeClosesAtMs === Date.parse(PROBE_CHALLENGE_CLOSES_AT) &&
    nowMs < status.challengeClosesAtMs &&
    status.claimedCalls === fixed.claimedCalls &&
    status.committedNanoUsd === fixed.committedNanoUsd &&
    status.pendingCount === 0 &&
    status.knownCount === fixed.knownCalls &&
    status.uncertainCount === 0 &&
    status.knownActualNanoUsd === fixed.knownActualNanoUsd &&
    status.uncertainUpperNanoUsd === 0 &&
    status.inflightCount === 0 &&
    status.sequence === fixed.sequence &&
    canonicalJson(status.purposeLimits) === canonicalJson(PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS) &&
    canonicalJson(status.purposeCounts) === canonicalJson(fixed.purposeCounts) &&
    !status.haltMarkerPresent &&
    !status.uncertainMarkerPresent
  );
}
