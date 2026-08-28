import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHECKOUT_DOMAIN_VERSION,
  createCheckoutFixture,
  type CheckoutState
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  GATE2_FALLBACK_CALIBRATION_BUNDLE_V1_VERSION,
  GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION,
  GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY
} from "@/lib/evidence/gate2-fallback-calibration-contract";
import {
  GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION,
  verifyGate2FallbackCalibrationBundleServer
} from "@/lib/evidence/gate2-fallback-calibration-verifier.server";
import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  fallbackCalibrationEnvelopeHash,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import { fallbackRunnerImplementationHash } from "@/lib/fallback/implementation-contract";
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
  PROBE_V05_ACK_ANCHOR_FIXED,
  PROBE_V05_MIGRATED_POLICY_VERSION,
  PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_POLICY_MIGRATION_ID,
  PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V05_POLICY_MIGRATION_VERSION,
  PROBE_V05_PREDECESSOR_MIGRATION_ID,
  PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V05_PRESERVED_KNOWN_CALLS,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
  createProbeV05PolicyMigrationReceipt,
  type ProbeV05PolicyMigrationManifest,
  type ProbeV05PolicyMigrationReceipt
} from "@/lib/probe/policy-v05-migration-contract";
import { PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v05-migration.server";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
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
}): Promise<ProbeV05PolicyMigrationReceipt> {
  const manifest: ProbeV05PolicyMigrationManifest = {
    version: PROBE_V05_POLICY_MIGRATION_VERSION,
    migrationId: PROBE_V05_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
    priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
    priorReproducerRawSha256: PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
    priorReproducerEvidenceDigest: PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V05_PREDECESSOR_MIGRATION_ID,
    predecessorMigrationReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    guardInstanceId: GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY.guardInstanceId,
    initializedCommit: GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY.initializedCommit,
    previousPolicyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls: PROBE_V05_PRESERVED_KNOWN_CALLS,
    ackAnchor: {
      ...PROBE_V05_ACK_ANCHOR_FIXED,
      recoveryHash: "1".repeat(64),
      sessionHash: "2".repeat(64),
      runHash: "3".repeat(64),
      actorHash: "4".repeat(64),
      launchHash: "5".repeat(64),
      payloadBinding: "6".repeat(64),
      encryptedDataPresent: false
    },
    migrationCommit: APP_COMMIT,
    nextPolicyVersion: PROBE_V05_MIGRATED_POLICY_VERSION,
    nextPolicyHash: input.policyHash,
    nextScriptHash: input.ledgerScriptHash,
    nextRunnerHash: input.runnerContractHash,
    migrationProgramHash: PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH,
    previousPurposeLimits: PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
  };
  const digest = await canonicalSha256(manifest);
  return createProbeV05PolicyMigrationReceipt(manifest, digest, 1_800_000_000_000);
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
      implementationHash: await fallbackRunnerImplementationHash(),
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

async function rehashMigrationAndBundle(bundle: BundleFixture): Promise<void> {
  const migration = bundle["policyMigration"] as Record<string, unknown>;
  const manifest = projectionWithout(migration, ["receiptHash", "migrationDigest", "migratedAtMs"]);
  migration.migrationDigest = await canonicalSha256(manifest);
  migration.receiptHash = await canonicalSha256(projectionWithout(migration, ["receiptHash"]));
  bundle.evidenceDigest = await canonicalSha256(projectionWithout(bundle, ["evidenceDigest"]));
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
    claim: {
      runId: envelope.runId,
      caseId: envelope.caseId,
      trialId: envelope.trialId
    },
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
      version: "toolproof-fallback-trial-evidence@1.1.0",
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
    designation: "approved-pinned-fallback-repair-attempt-2",
    callLineage: {
      preservedPreferredCalls: 9,
      preservedFallbackCalls: 4,
      preservedCalibrationCalls: FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
      fallbackCalibrationCalls: FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
      terminalCalibrationCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
      priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
      priorMigrationReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH
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
        PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd,
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
  it("continues to verify the immutable saved v1 3/4 bundle under its historical contract", async () => {
    const path = resolve(
      process.cwd(),
      ".toolproof-local/evidence/gate2/toolproof-gate2-fallback-42f65f0345ad-20260828T111429495Z.json"
    );
    const raw = await readFile(path, "utf8");
    expect(await sha256Hex(raw)).toBe(
      "cbc359472f18f8c240480562905507806ea2db45d84ba8f247714a097d05814c"
    );
    const bundle = JSON.parse(raw) as { version: string; passedCount: number };
    expect(bundle).toMatchObject({
      version: GATE2_FALLBACK_CALIBRATION_BUNDLE_V1_VERSION,
      passedCount: 3
    });
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).resolves.toBeUndefined();
  });

  it("accepts an internally authentic four-row abstention bundle", async () => {
    const bundle = await bundleFixture();
    expect(bundle.version).toBe(GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).resolves.toBeUndefined();
  });

  it("rejects a rehashed v2 lineage substitution", async () => {
    const bundle = await bundleFixture();
    const lineage = bundle["callLineage"] as Record<string, unknown>;
    lineage.priorEvidenceRawSha256 = "f".repeat(64);
    bundle.evidenceDigest = await canonicalSha256(projectionWithout(bundle, ["evidenceDigest"]));
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow();
  });

  it("rejects a fully rehashed v2 preserved-call substitution", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    const calls = clone(migration.knownCalls as readonly Record<string, unknown>[]);
    const first = calls[0];
    if (!first) throw new Error("Missing v2 migration fixture call.");
    first.actualNanoUsd = Number(first.actualNanoUsd) + 1;
    migration.knownCalls = calls;
    await rehashMigrationAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_migration_mismatch/u
    );
  });

  it("rejects a fully rehashed v2 predecessor-source substitution", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    migration.priorAppCommit = "e".repeat(40);
    migration.priorActivationHash = "e".repeat(64);
    migration.predecessorMigrationId = "migration_gate2_googlechromelabs_fallback_replaced";
    await rehashMigrationAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_migration_mismatch/u
    );
  });

  it("rejects a fully rehashed v2 guard-source substitution", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    migration.guardInstanceId = "guard_replaced_fallback_source";
    migration.initializedCommit = "e".repeat(40);
    await rehashMigrationAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_migration_mismatch/u
    );
  });

  it("rejects a fully rehashed v2 previous-policy-chain substitution", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    migration.previousPolicyVersion = "toolproof-probe-policy@0.4.1";
    migration.previousPolicyHash = "e".repeat(64);
    migration.previousScriptHash = "d".repeat(64);
    migration.previousRunnerHash = "c".repeat(64);
    migration.previousPurposeLimits = {
      ...(migration.previousPurposeLimits as Record<string, number>),
      calibration: 14
    };
    await rehashMigrationAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_migration_mismatch/u
    );
  });

  it("rejects a fully rehashed v2 prior-artifact substitution", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    migration.priorReproducerRawSha256 = "e".repeat(64);
    migration.priorReproducerEvidenceDigest = "d".repeat(64);
    const ack = migration.ackAnchor as Record<string, unknown>;
    ack.confirmation = "c".repeat(64);
    await rehashMigrationAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_migration_mismatch/u
    );
  });

  it("rejects a rehashed v2 row JTI that overlaps the 13-call predecessor", async () => {
    const bundle = clone(await bundleFixture());
    const migration = bundle["policyMigration"] as Record<string, unknown>;
    const calls = migration.knownCalls as readonly Record<string, unknown>[];
    const preserved = calls[0];
    if (!preserved) throw new Error("Missing preserved v2 JTI fixture.");
    const row = requiredRow(bundle, 0);
    row.jti = String(preserved.jti);
    await rehashRow(row);
    await rehashTerminalAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_jti_lineage_overlap/u
    );
  });

  it("rejects a rehashed v2 bundle run substitution", async () => {
    const bundle = await bundleFixture();
    bundle["runId"] = `run_${"s".repeat(22)}`;
    bundle.evidenceDigest = await canonicalSha256(projectionWithout(bundle, ["evidenceDigest"]));
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_case_mismatch/u
    );
  });

  it("rejects rehashed v2 capture claims that diverge from the envelope", async () => {
    const bundle = await bundleFixture();
    const row = requiredRow(bundle, 1);
    const claim = row.trialEvidence.capture.claim as Record<string, unknown>;
    claim.caseId = `case_${"x".repeat(22)}`;
    await rehashRow(row);
    await rehashTerminalAndBundle(bundle);
    await expect(verifyGate2FallbackCalibrationBundleServer(bundle)).rejects.toThrow(
      /fallback_bundle_case_mismatch/u
    );
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
