import { describe, expect, it } from "vitest";

import {
  CHECKOUT_DOMAIN_VERSION,
  createCheckoutFixture,
  type CheckoutState
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION,
  verifyGate2FallbackCalibrationBundleServer
} from "@/lib/evidence/gate2-fallback-calibration-verifier.server";
import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  fallbackCalibrationEnvelopeHash,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import { fallbackNoCallJsonSchemaHash } from "@/lib/fallback/openai-tool-decision";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import {
  evaluateProbeCalibrationCase,
  getProbeCalibrationCase,
  type ProbeCalibrationEvaluation,
  type ProbeResetBoundaryObservation
} from "@/lib/probe/calibration-catalog.server";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeFixtureSynopsis,
  createProbeTransportBinding,
  probeLiveManifestSchema,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { probeContinuationScriptHash } from "@/lib/probe/continuation-store";
import { probeFunctionToolDefinitionsHash } from "@/lib/probe/decision";
import { probeLedgerScriptHash } from "@/lib/probe/ledger";
import {
  PROBE_V04_MIGRATED_POLICY_VERSION,
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PREDECESSOR_MIGRATION_ID,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V04_PREVIOUS_POLICY_HASH,
  PROBE_V04_PREVIOUS_POLICY_VERSION,
  PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST,
  createProbeV04PolicyMigrationReceipt,
  type ProbeV04PolicyMigrationManifest,
  type ProbeV04PolicyMigrationReceipt
} from "@/lib/probe/policy-v04-migration-contract";
import { PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v04-migration.server";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_PURPOSE_CALL_LIMITS,
  calculateProbeCostNanoUsd,
  probePolicyHash
} from "@/lib/probe/policy";
import {
  FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
  FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
  FALLBACK_PROBE_CALIBRATION_LANE,
  FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
  FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS
} from "@/lib/probe/service-contract";
import {
  CHECKOUT_TOOLSET_VERSION,
  INITIAL_CHECKOUT_TOOL_NAMES,
  checkoutToolContractSnapshot
} from "@/lib/webmcp/catalog";

interface BoundaryFixture extends ProbeResetBoundaryObservation {
  readonly manifestHash: string;
  readonly registrationGeneration: number;
}

interface UsageFixture {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  accountedNanoUsd: number;
  costBasis: string;
}

interface ProviderFixture {
  [key: string]: unknown;
  requestBodyBytes: string;
  requestBodyHash: string;
  rawResponseBytes: string;
  rawResponseHash: string;
  rawResponse: unknown;
  decision: unknown;
  usage: UsageFixture;
  usageHash: string;
}

interface ProviderReceiptFixture {
  [key: string]: unknown;
  receipt: ProviderFixture;
}

interface CaptureFixture {
  [key: string]: unknown;
  initialBoundary: BoundaryFixture;
  nativeDispatchCount: number;
  providerReceiptHash: string;
  rawModelResponseHash: string;
  rawDecisionEnvelopeHash: string;
}

interface TrialEvidenceFixture {
  [key: string]: unknown;
  capture: CaptureFixture;
  currentState: CheckoutState;
  currentInspection: {
    [key: string]: unknown;
    state: CheckoutState;
    currentTraceCount: number;
  };
  currentTraces: readonly unknown[];
  fallback: { [key: string]: unknown; nativeReceipt: null };
  captureDigest: string;
  postResetBoundary: BoundaryFixture;
  providerReceipt: ProviderReceiptFixture;
  nativeAdmission: null;
  envelope: FallbackCalibrationEnvelope;
  evidenceDigest: string;
}

interface SettlementFixture {
  accountedNanoUsd: number;
  providerResponseHash: string;
  usageHash: string;
  settlementDigest: string;
}

interface RowFixture {
  ordinal: number;
  jti: string;
  trialEvidence: TrialEvidenceFixture;
  evaluation: ProbeCalibrationEvaluation;
  settlement: SettlementFixture;
}

interface BundleFixture {
  [key: string]: unknown;
  cases: RowFixture[];
  calibrationCost: {
    priorCumulativeKnownAccountedNanoUsd: number;
    fallbackCalibrationAccountedNanoUsd: number;
    terminalCumulativeKnownAccountedNanoUsd: number;
  };
  terminalGuard: {
    knownAccountedNanoUsd: number;
    [key: string]: unknown;
  };
  passedCount: number;
  evidenceDigest: string;
}

const APP_COMMIT = "d".repeat(40);
const ACTIVATION_HASH = "a".repeat(64);
const RUN_ID = `run_${"r".repeat(22)}`;
const COMPLETED_AT = "2026-08-28T12:00:00.000Z";

const knownCallTuples = [
  [
    0,
    "jti_3ttNKoeU_37eePWqlaQTAd",
    1,
    2_752_200,
    "6ad2354dd698c3485acdf764436d2e006fca921dbcf816e21838726e66e08a34",
    "79d59941177121ee14813c652e4042ab73797c4952477c70301cbaf76a73f730",
    "4575531a0117bcba5679e0c8926ef35a51301ab65dd71ff8b8217ba3d0340ed3"
  ],
  [
    1,
    "jti_KbzmhiHJVFITzY_LutQLsW",
    2,
    2_745_600,
    "72ff841d0b8a0b77ea42b97a082215571bf048a13ad29cfb3015b5fc433ce4b8",
    "f006918f47aafc8b9c57321ec16c7a6360bdabeb397d5782175f94d23de30c32",
    "ac6cc9b1fedc07839fd21592c38233be6023cd152820a2e0ef297f362903a3d8"
  ],
  [
    2,
    "jti_-NVfSckdMZ9ZBaB3lR6Shd",
    3,
    2_862_200,
    "80230a2a6d04d5493b7d3116cbad1459891c0151b2306de2427b662fb54cf03e",
    "24d5c889e87d9301b7fe19b0c618e3b2252092cd4d48a3077ebe284cc93750f7",
    "be54b40921ff0e395f0a92ee21b530926ddfaf49b589a5d12ebf24730b5d2675"
  ],
  [
    3,
    "jti_fnoZqfzfBTsmlgSYJGJtjm",
    4,
    3_000_800,
    "b7c53214faf520268872b3d17eba17a4e65260e50d754e1acbc5915f80672ed6",
    "f727dc2f1f439a085ec6fce8d3c822d656b495e6ee025562bc3478868bec6938",
    "961a4ecb2a7f083f83c4afa520836716289af392c65ac722c0c433945e239d1a"
  ],
  [
    4,
    "jti_k3jaZ-FMU0962MmGl7Gtoy",
    5,
    3_216_400,
    "22eec2222d3b8cb73451df90f6af52ecc13df4080d4b44c5f26d9e48370b8e02",
    "606dea43a57488f28c43edf02d4c58fdf6910755f381c69d3a8d05d4a5d80c1c",
    "0756f7467db7984f1141aa5dd356198aa26963776d403a5fe507951fec8b27af"
  ],
  [
    5,
    "jti_9Es4dLaTwzJKmw9l1pLAje",
    6,
    3_322_000,
    "65dcc98af9f86533c4b25f5401a9272713bfbfbd0552f4b283f6dd519862b3c2",
    "415f7e8fb84d6c1c4c079a16b88dcbe039e7f037a08cea813b5d56f497782e89",
    "56044e97681209511cb0d54a62307cf59db0e5c6b87c8b52283890ba33f1ab2c"
  ],
  [
    6,
    "jti_2CK2ZdwtY_ExNqGWBzFtZH",
    7,
    3_280_200,
    "9dc549c8a52388f5fd844c3999ba1b9183acde9ec5fd46dad190bf11c1fcce34",
    "ee141035305247d16e9765d6bef48b7fbdba344646eceb777bb533c3ffa4ee59",
    "fcacfaee765db8cc7a8f72fe2bcee82ea227a0c9424ed8a1ebb1c648cb4a93ec"
  ],
  [
    7,
    "jti_9W52PDxVkWy2YlOXfiMU7d",
    8,
    3_489_200,
    "d7defedf2e8e8ec1c7d1b504ad13349ee3c9546829e6e3d761687766f2b1b604",
    "45e667f18bbd7b4ae7648f8600dcb14aa39af5fb5950745d9fcbb825d56ecab6",
    "2b364c94b58f6049131fc697e5dc0db519d960f21291a8becbebc5c80b13729c"
  ],
  [
    8,
    "jti_W_dK9y1PGv1mAbigResi3t",
    9,
    3_324_200,
    "a5524d99801cc9e750b220849d3501bee4cfcc5487fe30e9df756db9e8c1667f",
    "b47ebbeccaf8f936015781a8556769019b68a8f568c0e6c6ae6881bf07a421b4",
    "235e69b9f50ba05f6682efdcc56bc2392639c2c15a453f6fe2aac9c7b551dd52"
  ]
] as const;

const knownCalls = knownCallTuples.map(
  ([
    ordinal,
    jti,
    dispatchSequence,
    actualNanoUsd,
    providerResponseHash,
    settlementDigest,
    usageHash
  ]) => ({
    ordinal,
    jti,
    dispatchSequence,
    actualNanoUsd,
    providerResponseHash,
    settlementDigest,
    usageHash
  })
);

function clone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function projectionWithout(value: object, keys: readonly string[]): Record<string, unknown> {
  const projection: Record<string, unknown> = { ...value };
  for (const key of keys) delete projection[key];
  return projection;
}

function requiredRow(bundle: BundleFixture, index: number): RowFixture {
  const row = bundle.cases[index];
  if (!row) throw new Error(`Missing fallback fixture row ${index}.`);
  return row;
}

async function liveManifest(): Promise<ProbeLiveManifest> {
  const contract = checkoutToolContractSnapshot(createCheckoutFixture());
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: clone(inputSchema),
      annotations: {
        readOnlyHint: annotations.readOnlyHint ?? false,
        untrustedContentHint: annotations.untrustedContentHint ?? false
      }
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const readinessManifest = {
    catalogState: "initial",
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    appCommit: APP_COMMIT,
    tools: tools.map((tool) => ({ ...tool, handlerVersion: versions.get(tool.name) }))
  };
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: await canonicalSha256(readinessManifest),
    tools
  });
}

function cleanBoundary(manifestHash: string): BoundaryFixture {
  return {
    status: "verified",
    stateRevision: 0,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    registeredToolNames: [...INITIAL_CHECKOUT_TOOL_NAMES],
    manifestHash,
    registrationGeneration: 1
  };
}

async function migrationFixture(input: {
  policyHash: string;
  ledgerScriptHash: string;
  runnerContractHash: string;
}): Promise<ProbeV04PolicyMigrationReceipt> {
  expect(await canonicalSha256(knownCalls)).toBe(PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST);
  const manifest: ProbeV04PolicyMigrationManifest = {
    version: PROBE_V04_POLICY_MIGRATION_VERSION,
    migrationId: PROBE_V04_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
    priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V04_PREDECESSOR_MIGRATION_ID,
    predecessorMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    guardInstanceId: "guard_fallback_verifier_fixture",
    initializedCommit: "c".repeat(40),
    previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls,
    migrationCommit: APP_COMMIT,
    nextPolicyVersion: PROBE_V04_MIGRATED_POLICY_VERSION,
    nextPolicyHash: input.policyHash,
    nextScriptHash: input.ledgerScriptHash,
    nextRunnerHash: input.runnerContractHash,
    migrationProgramHash: PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
    previousPurposeLimits: PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: PROBE_PURPOSE_CALL_LIMITS,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
  };
  const digest = await canonicalSha256(manifest);
  return createProbeV04PolicyMigrationReceipt(manifest, digest, 1_800_000_000_000);
}

async function envelopeFixture(
  ordinal: number,
  manifest: ProbeLiveManifest
): Promise<FallbackCalibrationEnvelope> {
  const caseSuffix = String(ordinal).padStart(2, "0");
  const identity = {
    runId: RUN_ID,
    caseId: `case_${caseSuffix}${"c".repeat(20)}`,
    trialId: `trial_${caseSuffix}${"t".repeat(20)}`
  };
  const transport = await createProbeTransportBinding(identity);
  const [promptHash, settingsHash, browserRuntimeHash, toolDefinitionsHash, noCallSchemaHash] =
    await Promise.all([
      fallbackRunnerPromptHash(),
      fallbackRunnerSettingsHash(),
      fallbackBrowserRuntimeContractHash(),
      probeFunctionToolDefinitionsHash(manifest, transport),
      fallbackNoCallJsonSchemaHash()
    ]);
  return {
    version: FALLBACK_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: APP_COMMIT,
    ...identity,
    naturalLanguageRequest: getProbeCalibrationCase(ordinal).naturalLanguageRequest,
    fixture: createProbeFixtureSynopsis(createCheckoutFixture()),
    liveManifest: manifest,
    runner: {
      implementation: FALLBACK_IMPLEMENTATION,
      upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
      upstreamSubtree: FALLBACK_UPSTREAM_PIN.subtree,
      promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
      promptHash,
      settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
      settingsHash,
      browserRuntimeHash,
      toolDefinitionsHash,
      noCallSchemaHash,
      transport
    }
  };
}

async function rehashRow(row: RowFixture): Promise<void> {
  const evidence = row.trialEvidence;
  const providerReceipt = evidence.providerReceipt;
  const provider = providerReceipt.receipt;
  const capture = evidence.capture;
  provider.requestBodyHash = await sha256Hex(String(provider.requestBodyBytes));
  provider.rawResponseHash = await sha256Hex(String(provider.rawResponseBytes));
  provider.rawResponse = JSON.parse(String(provider.rawResponseBytes));
  provider.usageHash = await canonicalSha256(provider.usage);
  capture.providerReceiptHash = await canonicalSha256(providerReceipt);
  capture.rawModelResponseHash = await sha256Hex(String(provider.rawResponseBytes));
  capture.rawDecisionEnvelopeHash = await canonicalSha256({
    context: { kind: "fresh-stateless", previousResponseId: null, providerRequestCount: 1 },
    rawModelResponse: provider.rawResponseBytes,
    providerReceipt,
    decision: provider.decision
  });
  evidence.captureDigest = await canonicalSha256(capture);
  const postResetBoundary = evidence.postResetBoundary;
  const nativeAdmission = evidence.nativeAdmission;
  const envelope = evidence.envelope;
  const clientEvidence = projectionWithout(evidence, [
    "postResetBoundary",
    "providerReceipt",
    "nativeAdmission",
    "envelope",
    "evidenceDigest"
  ]);
  evidence.evidenceDigest = await canonicalSha256({
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    evidence: clientEvidence,
    postResetBoundary,
    providerReceipt,
    nativeAdmission,
    envelopeHash: await fallbackCalibrationEnvelopeHash(envelope)
  });
  row.settlement.accountedNanoUsd = provider.usage.accountedNanoUsd;
  row.settlement.providerResponseHash = provider.rawResponseHash;
  row.settlement.usageHash = provider.usageHash;
  row.settlement.settlementDigest = await canonicalSha256({
    version: 1,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    jti: row.jti,
    providerResponseHash: provider.rawResponseHash,
    usageHash: provider.usageHash,
    trialEvidenceDigest: evidence.evidenceDigest,
    evaluation: row.evaluation
  });
}

async function rehashTerminalAndBundle(bundle: BundleFixture): Promise<void> {
  const actual = bundle.cases.reduce((sum, row) => sum + row.settlement.accountedNanoUsd, 0);
  bundle.calibrationCost.fallbackCalibrationAccountedNanoUsd = actual;
  bundle.calibrationCost.terminalCumulativeKnownAccountedNanoUsd =
    bundle.calibrationCost.priorCumulativeKnownAccountedNanoUsd + actual;
  bundle.terminalGuard.knownAccountedNanoUsd =
    bundle.calibrationCost.terminalCumulativeKnownAccountedNanoUsd;
  bundle.passedCount = bundle.cases.filter((row) => row.evaluation.passed).length;
  const core = projectionWithout(bundle, ["evidenceDigest"]);
  bundle.evidenceDigest = await canonicalSha256(core);
}

async function rowFixture(ordinal: number, manifest: ProbeLiveManifest): Promise<RowFixture> {
  const envelope = await envelopeFixture(ordinal, manifest);
  const boundary = cleanBoundary(manifest.manifestHash);
  const decision = { kind: "abstain" as const, reason: "No tool call selected in this fixture." };
  const rawResponse = {
    id: `fallback_response_${ordinal}`,
    object: "response",
    status: "completed",
    decision
  };
  const rawResponseBytes = JSON.stringify(rawResponse);
  const usage = {
    inputTokens: 100 + ordinal,
    outputTokens: 20,
    totalTokens: 120 + ordinal,
    accountedNanoUsd: calculateProbeCostNanoUsd({ inputTokens: 100 + ordinal, outputTokens: 20 }),
    costBasis: "frozen-list-price-plus-10pct-uplift"
  };
  const provider = {
    version: "toolproof-fallback-provider@1.0.0",
    provider: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6-terra",
    requestId: `request_fixture_${ordinal}`,
    responseId: rawResponse.id,
    responseStatus: "completed",
    requestBodyBytes: JSON.stringify({ ordinal }),
    requestBodyHash: "",
    rawResponseBytes,
    rawResponseHash: "",
    rawResponse,
    outputText: JSON.stringify({ decision }),
    decision,
    decisionError: null,
    refusal: null,
    toolCallId: null,
    rawArgumentsBytes: null,
    toolCallCount: 0,
    usage,
    usageHash: "",
    promptHash: envelope.runner.promptHash,
    settingsHash: envelope.runner.settingsHash,
    runnerContractHash: await fallbackRunnerContractHash(),
    browserRuntimeHash: envelope.runner.browserRuntimeHash,
    toolDefinitionsHash: envelope.runner.toolDefinitionsHash,
    noCallSchemaHash: envelope.runner.noCallSchemaHash,
    transportBindingHash: envelope.runner.transport.bindingHash,
    modelInputHash: await canonicalSha256({ ordinal, input: "fixture" }),
    dispatchedAt: `2026-08-28T12:00:0${ordinal}.000Z`,
    completedAt: `2026-08-28T12:00:0${ordinal}.100Z`,
    durationMs: 100,
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  };
  const providerReceipt = { status: "known", receipt: provider };
  const capture = {
    initialBoundary: boundary,
    nativeDispatchCount: 0,
    providerReceiptHash: "",
    rawModelResponseHash: "",
    rawDecisionEnvelopeHash: ""
  };
  const fixture = createCheckoutFixture();
  const evaluation = await evaluateProbeCalibrationCase(ordinal, {
    decision,
    decisionError: null,
    nativeDispatchCount: 0,
    nativeExecution: null,
    trace: null,
    resetBefore: boundary,
    resetAfter: boundary
  });
  const row: RowFixture = {
    ordinal,
    jti: `jti_fallback_fixture_${String(ordinal).padStart(2, "0")}`,
    trialEvidence: {
      version: "toolproof-fallback-trial-evidence@1.0.0",
      appCommit: APP_COMMIT,
      capturedAt: `2026-08-28T12:00:0${ordinal}.200Z`,
      capture,
      currentState: fixture,
      currentInspection: { state: fixture, currentTraceCount: 0 },
      currentTraces: [],
      fallback: { nativeReceipt: null },
      captureDigest: "",
      postResetBoundary: boundary,
      providerReceipt,
      nativeAdmission: null,
      envelope,
      evidenceDigest: ""
    },
    evaluation,
    settlement: {
      accountedNanoUsd: usage.accountedNanoUsd,
      providerResponseHash: "",
      usageHash: "",
      settlementDigest: ""
    }
  };
  await rehashRow(row);
  return row;
}

async function bundleFixture(): Promise<BundleFixture> {
  const [manifest, policyHash, ledgerScriptHash, runnerContractHash, continuationScriptHash] =
    await Promise.all([
      liveManifest(),
      probePolicyHash(),
      probeLedgerScriptHash(),
      fallbackRunnerContractHash(),
      probeContinuationScriptHash()
    ]);
  const rows = await Promise.all(
    Array.from({ length: FALLBACK_PROBE_CALIBRATION_CASE_COUNT }, (_, ordinal) =>
      rowFixture(ordinal, manifest)
    )
  );
  const bundle: BundleFixture = {
    version: GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION,
    protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    calibrationOnly: true,
    includedInBenchmark: false,
    designation: "approved-pinned-fallback-not-fourth-preferred-attempt",
    callLineage: {
      preservedPreferredCalls: FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
      fallbackCalibrationCalls: FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
      terminalCalibrationCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
      priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
      priorMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH
    },
    policyMigration: await migrationFixture({ policyHash, ledgerScriptHash, runnerContractHash }),
    provider: "OpenAI",
    model: "gpt-5.6-terra",
    appCommit: APP_COMMIT,
    activationHash: ACTIVATION_HASH,
    policyHash,
    ledgerScriptHash,
    runnerContractHash,
    continuationScriptHash,
    runId: RUN_ID,
    completedAt: COMPLETED_AT,
    cases: rows,
    caseCount: FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
    terminalGuard: {
      phase: "idle",
      claimedCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      knownCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      pendingCalls: 0,
      uncertainCalls: 0,
      calibrationCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      committedNanoUsd:
        FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownAccountedNanoUsd: 0,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD
    },
    calibrationCost: {
      priorCumulativeKnownAccountedNanoUsd:
        PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd,
      fallbackCalibrationAccountedNanoUsd: 0,
      terminalCumulativeKnownAccountedNanoUsd: 0
    },
    passedCount: 0,
    evidenceDigest: ""
  };
  await rehashTerminalAndBundle(bundle);
  return bundle;
}

describe("Gate 2 pinned fallback calibration bundle verifier", () => {
  it("accepts an internally authentic four-row abstention bundle", async () => {
    const bundle = await bundleFixture();
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).resolves.toBeUndefined();
  });

  it("rejects a rehashed evaluation substitution", async () => {
    const bundle = await bundleFixture();
    const row = requiredRow(bundle, 0);
    row.evaluation = {
      ...row.evaluation,
      passed: true,
      score: { earned: 1, possible: 1 },
      failures: []
    };
    await rehashRow(row);
    await rehashTerminalAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_case_recomputation_mismatch/u
    );
  });

  it("rejects rehashed provider usage and cost tampering", async () => {
    const bundle = await bundleFixture();
    const row = requiredRow(bundle, 1);
    const usage = row.trialEvidence.providerReceipt.receipt.usage;
    usage.accountedNanoUsd += 1;
    await rehashRow(row);
    await rehashTerminalAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_provider_or_trial_digest_mismatch/u
    );
  });

  it("rejects a rehashed current-state substitution", async () => {
    const bundle = await bundleFixture();
    const row = requiredRow(bundle, 2);
    const wrongState = {
      ...row.trialEvidence.currentState,
      revision: 1
    };
    row.trialEvidence.currentState = wrongState;
    row.trialEvidence.currentInspection.state = wrongState;
    await rehashRow(row);
    await rehashTerminalAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_case_recomputation_mismatch/u
    );
  });

  it("rejects rehashed terminal cost totals that disagree with the rows", async () => {
    const bundle = await bundleFixture();
    bundle.calibrationCost.fallbackCalibrationAccountedNanoUsd += 1;
    bundle.calibrationCost.terminalCumulativeKnownAccountedNanoUsd += 1;
    bundle.terminalGuard.knownAccountedNanoUsd += 1;
    const core = projectionWithout(bundle, ["evidenceDigest"]);
    bundle.evidenceDigest = await canonicalSha256(core);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_cost_or_score_mismatch/u
    );
  });
});
