import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  issue: vi.fn(async () => ({ disposition: "new", issuedAt: 1, expiresAt: 2 })),
  begin: vi.fn(async () => ({
    sequence: 1,
    claimedCalls: 1,
    committedNanoUsd: 62_500_000,
    leaseExpiresAt: 1
  })),
  settleKnown: vi.fn(async () => ({ disposition: "new", actualNanoUsd: 1 })),
  settleUncertain: vi.fn(async () => ({ disposition: "new", upperBoundNanoUsd: 62_500_000 })),
  provider: vi.fn(),
  fallbackProvider: vi.fn(),
  index: undefined as unknown
}));

vi.mock("@/lib/probe/run-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/run-index")>();
  return {
    ...actual,
    assertProbeOperatorArmed: vi.fn(async () => undefined),
    assertProbeRunDocumentOwner: vi.fn(async () => 0),
    claimProbeRunDocument: vi.fn(async () => ({ disposition: "new", revision: 0 })),
    getProbeRunIndexByLaunch: vi.fn(async () => null),
    putProbeRunIndex: vi.fn(
      async (_redis, input: { recovery: Record<string, unknown>; continuation: string }) => {
        const payload = {
          version: 1,
          ...input.recovery,
          continuation: input.continuation,
          nextOrdinal: 0,
          terminal: false
        };
        const receipt = {
          disposition: "new",
          payload,
          payloadBinding: "8".repeat(64),
          revision: 0,
          nextOrdinal: 0,
          createdAtMs: nowMs,
          expiresAtMs: nowMs + 4 * 60 * 60_000,
          ttlRemainingMs: 4 * 60 * 60_000
        };
        serviceMocks.index = receipt;
        return receipt;
      }
    ),
    getProbeRunIndex: vi.fn(async () => serviceMocks.index),
    advanceProbeRunIndex: vi.fn(
      async (
        _redis,
        input: {
          current: {
            nextOrdinal: number;
            payload: Record<string, unknown>;
            [key: string]: unknown;
          };
          continuation: string;
        }
      ) => {
        const nextOrdinal = input.current.nextOrdinal + 1;
        const receipt = {
          ...input.current,
          revision: nextOrdinal,
          nextOrdinal,
          payload: {
            ...input.current.payload,
            continuation: input.continuation,
            nextOrdinal,
            terminal: nextOrdinal === 4
          }
        };
        serviceMocks.index = receipt;
        return receipt;
      }
    )
  };
});

vi.mock("@/lib/probe/continuation-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/continuation-store")>();
  return {
    ...actual,
    getProbeContinuation: vi.fn(async (_redis, input: { jti: string; stage: string }) => {
      const payload = serviceMocks.cache.get(`${input.jti}:${input.stage}`);
      return payload ? { payload, payloadBinding: "9".repeat(64) } : null;
    }),
    putProbeContinuation: vi.fn(
      async (_redis, input: { jti: string; stage: string; payload: unknown }) => {
        const key = `${input.jti}:${input.stage}`;
        const prior = serviceMocks.cache.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(input.payload)) {
          throw new Error("CONTINUATION_CONFLICT");
        }
        serviceMocks.cache.set(key, input.payload);
        return {
          payload: prior ?? input.payload,
          payloadBinding: "9".repeat(64),
          disposition: prior ? "existing" : "new"
        };
      }
    )
  };
});

vi.mock("@/lib/probe/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/ledger")>();
  return {
    ...actual,
    issueProbeAuthorization: serviceMocks.issue,
    beginProbeCall: serviceMocks.begin,
    settleProbeCallKnown: serviceMocks.settleKnown,
    settleProbeCallUncertain: serviceMocks.settleUncertain
  };
});

vi.mock("@/lib/probe/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/openai")>();
  return { ...actual, decideWithOpenAi: serviceMocks.provider };
});

vi.mock("@/lib/fallback/openai-tool-provider.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/fallback/openai-tool-provider.server")>();
  return { ...actual, decideWithFallbackOpenAi: serviceMocks.fallbackProvider };
});

vi.mock("@/lib/evidence/gate2-calibration-verifier.server", () => ({
  verifyGate2CalibrationBundleServer: vi.fn(async (value: unknown) => value)
}));

import { createCheckoutFixture, CHECKOUT_DOMAIN_VERSION } from "@/lib/domain/checkout";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { CHECKOUT_FIXTURE_STATE_HASH, verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type { FallbackCalibrationEnvelope } from "@/lib/fallback/calibration-envelope";
import type { FallbackProviderKnownReceipt } from "@/lib/fallback/openai-tool-provider.server";
import { FALLBACK_UPSTREAM_PIN } from "@/lib/fallback/runner-contract";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeFixtureSynopsis,
  probeLiveManifestSchema,
  type ProbeCalibrationEnvelope,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { getProbeCalibrationCase } from "@/lib/probe/calibration-catalog.server";
import type { ProbeActivationContext } from "@/lib/probe/activation";
import type { ProbeProviderKnownReceipt } from "@/lib/probe/openai";
import { probeLedgerScriptHash } from "@/lib/probe/ledger";
import {
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_VERSION,
  createProbePolicyMigrationManifest,
  createProbePolicyMigrationReceipt,
  probePolicyMigrationDigest,
  type ProbePolicyMigrationPriorReceipt
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH,
  PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V03_PREDECESSOR_MIGRATION_ID,
  PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V03_PREVIOUS_POLICY_HASH,
  PROBE_V03_PREVIOUS_POLICY_VERSION,
  createProbeV03PolicyMigrationManifest,
  createProbeV03PolicyMigrationReceipt,
  parseProbeV03PolicyMigrationSourceReceipt,
  probeV03PolicyMigrationDigest
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_MIGRATED_POLICY_VERSION,
  PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
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
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256
} from "@/lib/probe/policy-v04-migration-contract";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";
import {
  FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
  FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
  FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS
} from "@/lib/probe/service-contract";
import { deriveProbeActorHash, issueProbeOperatorCredential } from "@/lib/probe/session";
import {
  admitFallbackProbeNativeDispatch,
  completeFallbackProbeCalibrationTrial,
  decideFallbackProbeCalibrationTrial,
  issueFallbackProbeCalibrationTrial,
  revealFallbackProbeCalibrationRun,
  startFallbackProbeCalibrationSession,
  completeProbeCalibrationTrial,
  admitProbeNativeDispatch,
  decideProbeCalibrationTrial,
  issueProbeCalibrationTrial,
  revealProbeCalibrationRun,
  startProbeCalibrationSession
} from "@/lib/probe/service";
import {
  CHECKOUT_TOOLSET_VERSION,
  INITIAL_CHECKOUT_TOOL_NAMES,
  checkoutToolContractSnapshot,
  type CheckoutToolName
} from "@/lib/webmcp/catalog";

const buildCommit = "a".repeat(40);
const signingSecret = Buffer.alloc(32, 11).toString("base64url");
const activationSecret = Buffer.alloc(32, 12).toString("base64url");
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
let policyHash = "";
let scriptHash = "";
let policyMigration: ProbeActivationContext["migration"];
let predecessorMigration: ProbeActivationContext["predecessorMigration"];
const environment = {
  TOOLPROOF_SIGNING_SECRET: signingSecret,
  TOOLPROOF_PROBE_ACTIVATION_SECRET: activationSecret,
  OPENAI_API_KEY: "sk-test-not-real",
  TOOLPROOF_PROBE_ACTIVATION_HASH: "b".repeat(64),
  TOOLPROOF_PROBE_ACTIVE_COMMIT: buildCommit,
  TOOLPROOF_PROBE_OPERATOR_CAPABILITY_HASH: "4".repeat(64)
};
let activeRecoveryCookie = "";

function operatorCookie(): string {
  const actorRequest = new Request("https://toolproof-rust.vercel.app/api/probe/test", {
    headers: {
      "user-agent": "Fixture Browser",
      "x-vercel-forwarded-for": "203.0.113.4"
    }
  });
  return issueProbeOperatorCredential({
    activationHash: "b".repeat(64),
    buildCommit,
    actorHash: deriveProbeActorHash(actorRequest, signingSecret),
    signingSecret,
    nowMs
  }).cookieValue;
}

function activation(input: {
  claimed: number;
  known: number;
  pending: 0 | 1;
}): ProbeActivationContext {
  const cumulativeClaimed = 5 + input.claimed;
  const cumulativeKnown = 5 + input.known;
  return {
    enabled: true,
    mode: "calibration",
    activationHash: "b".repeat(64),
    manifest: {
      version: "toolproof-probe-activation@4.0.0",
      mode: "calibration",
      origin: "https://toolproof-rust.vercel.app",
      activeCommit: buildCommit,
      vercelProjectId: `prj_${"c".repeat(24)}`,
      guardInstanceId: "guard_fixture_service_001",
      guardInitializedCommit: "d".repeat(40),
      policyHash,
      scriptHash,
      runnerContractHash: policyMigration.nextRunnerHash,
      continuationScriptHash: "3".repeat(64),
      predecessorPolicyMigrationReceiptHash: predecessorMigration.receiptHash,
      operatorCapabilityHash: "4".repeat(64),
      policyMigrationReceiptHash: policyMigration.receiptHash
    },
    guard: {
      phase: input.pending === 0 ? "idle" : "single-inflight",
      claimedCalls: cumulativeClaimed,
      knownCalls: cumulativeKnown,
      pendingCalls: input.pending,
      calibrationCalls: cumulativeClaimed,
      committedNanoUsd: cumulativeClaimed * 62_500_000,
      knownAccountedNanoUsd: 11_800_800 + input.known * 440_000,
      uncertainCalls: 0
    },
    guardIdentity: {
      guardInstanceId: "guard_fixture_service_001",
      policyHash,
      scriptHash,
      initializedCommit: "d".repeat(40)
    },
    predecessorMigration,
    migration: policyMigration
  };
}

function fallbackActivation(input: {
  claimed: number;
  known: number;
  pending: 0 | 1;
}): ProbeActivationContext {
  const value = activation(input);
  const cumulativeClaimed = 9 + input.claimed;
  const cumulativeKnown = 9 + input.known;
  return {
    ...value,
    manifest: {
      ...value.manifest,
      predecessorPolicyMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
      policyMigrationReceiptHash: policyMigration.receiptHash,
      runnerContractHash: policyMigration.nextRunnerHash
    },
    guard: {
      ...value.guard,
      claimedCalls: cumulativeClaimed,
      knownCalls: cumulativeKnown,
      calibrationCalls: cumulativeClaimed,
      committedNanoUsd: cumulativeClaimed * 62_500_000,
      knownAccountedNanoUsd: 27_992_800 + input.known * 440_000
    }
  };
}

function request(cookie?: string, csrf?: string): Request {
  const cookies = [
    `toolproof_probe_operator=${operatorCookie()}`,
    ...(cookie ? [`toolproof_probe_session=${cookie}`] : []),
    ...(activeRecoveryCookie ? [`toolproof_probe_recovery=${activeRecoveryCookie}`] : [])
  ].join("; ");
  return new Request("https://toolproof-rust.vercel.app/api/probe/test", {
    method: "POST",
    headers: {
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "user-agent": "Fixture Browser",
      "x-vercel-forwarded-for": "203.0.113.4",
      cookie: cookies,
      "x-toolproof-document": `document_${"d".repeat(32)}`,
      ...(csrf ? { "x-toolproof-csrf": csrf } : {})
    },
    body: "{}"
  });
}

async function liveManifest(): Promise<ProbeLiveManifest> {
  const contract = checkoutToolContractSnapshot(createCheckoutFixture());
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: JSON.parse(canonicalJson(inputSchema)),
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
    appCommit: buildCommit,
    tools: tools.map((tool) => ({ ...tool, handlerVersion: versions.get(tool.name) }))
  };
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: await canonicalSha256(readinessManifest),
    tools
  });
}

interface TrialEnvironment {
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
}

function trialEnvironment(manifestHash: string, ordinal: number): TrialEnvironment {
  let sequence = 0;
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => manifestHash,
    getArgumentMode: () => "json-string",
    appCommit: buildCommit,
    origin: "https://toolproof-rust.vercel.app",
    userAgent: "Fixture Browser"
  });
  const store = new CheckoutSessionStore({
    traceSink: ledger,
    clock: () => new Date(nowMs + sequence * 10).toISOString(),
    idFactory: (kind) => {
      sequence += 1;
      return `${kind}_fixture_${ordinal}_${String(sequence).padStart(6, "0")}`;
    }
  });
  return { store, ledger };
}

async function boundary(environment: TrialEnvironment, manifest: ProbeLiveManifest) {
  const domainReceipt = await environment.store.hardReset({
    source: "ui",
    holdForVerification: true
  });
  const verification = await verifyCheckoutReset({
    domainReceipt,
    inspection: environment.store.inspect(),
    archives: environment.store.archivedTrajectories(),
    traceLedger: environment.ledger.snapshot(),
    registry: {
      verified: true,
      registryHash: manifest.manifestHash,
      registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
    },
    checkedAt: new Date(nowMs).toISOString()
  });
  if (verification.status !== "verified") throw new Error("Fixture reset failed.");
  const traceSnapshot = environment.ledger.snapshot();
  const serializedInspection = JSON.parse(canonicalJson(environment.store.inspect()));
  const serializedArchives = JSON.parse(canonicalJson(environment.store.archivedTrajectories()));
  const serializedTraceLedger = JSON.parse(canonicalJson(traceSnapshot));
  const recomputed = await verifyCheckoutReset({
    domainReceipt: JSON.parse(canonicalJson(domainReceipt)),
    inspection: serializedInspection,
    archives: serializedArchives,
    traceLedger: serializedTraceLedger,
    registry: {
      verified: true,
      registryHash: manifest.manifestHash,
      registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
    },
    checkedAt: String(verification.checkedAt)
  });
  expect(recomputed).toEqual(verification);
  if (!environment.store.releaseResetAdmission(verification.resetId)) {
    throw new Error("Fixture reset admission failed.");
  }
  return {
    status: "verified" as const,
    catalogState: "initial" as const,
    fixtureId: "checkout-seed-v1" as const,
    fixtureSeed: "toolproof-checkout-seed-001" as const,
    stateRevision: 0 as const,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    manifestHash: manifest.manifestHash,
    registrationGeneration: 1,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    resetId: verification.resetId,
    resetReceipt: {
      verification: JSON.parse(canonicalJson(verification)),
      domainReceipt: JSON.parse(canonicalJson(domainReceipt)),
      inspection: serializedInspection,
      domainArchives: serializedArchives,
      traceLedger: serializedTraceLedger
    },
    registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
  };
}

function inputForTool(toolName: CheckoutToolName, operationId: string) {
  if (toolName === "cart_update") {
    return {
      operationId,
      operation: "set_quantity" as const,
      itemId: "stoneware-mug" as const,
      quantity: 3
    };
  }
  if (toolName === "checkout_request") return { operationId };
  return {};
}

async function nativeExecution(
  environment: TrialEnvironment,
  toolName: CheckoutToolName,
  manifestHash: string,
  input: ReturnType<typeof inputForTool>
) {
  if (toolName === "cart_get") await environment.store.cartGet(input, { source: "native" });
  else if (toolName === "order_review")
    await environment.store.orderReview(input, { source: "native" });
  else if (toolName === "cart_update")
    await environment.store.cartUpdate(input, { source: "native" });
  else if (toolName === "checkout_request")
    await environment.store.checkoutRequest(input, { source: "native" });
  else throw new Error("Unsupported service fixture tool.");
  const trace = environment.ledger.snapshot().current[0]!;
  return {
    input,
    result: {
      receipt: {
        executionId: `execution_fixture_${toolName}`,
        toolName,
        argumentMode: "json-string",
        rawResult: JSON.stringify(trace.canonicalResult?.value),
        canonicalResult: trace.canonicalResult?.value,
        nativeCallCount: 1,
        handlerTraceId: trace.eventId,
        handlerTraceStatus: trace.status,
        resultDigest: trace.canonicalResult?.sha256 ?? null,
        effectDigest: await canonicalSha256(trace.effect),
        stateBeforeDigest: trace.stateBefore.sha256,
        stateAfterDigest: trace.stateAfter.sha256,
        manifestHash
      },
      trace
    }
  };
}

async function providerReceipt(
  envelope: ProbeCalibrationEnvelope,
  ordinal: number
): Promise<ProbeProviderKnownReceipt> {
  const tool = getProbeCalibrationCase(ordinal).expectedTool;
  const toolInput = inputForTool(tool, envelope.runner.transport.operationId);
  const rawResponseBytes = JSON.stringify({ id: `resp_fixture_${ordinal}`, decision: tool });
  return {
    version: "toolproof-probe-provider@1.0.0",
    provider: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6-terra",
    requestId: `req_fixture_${ordinal}`,
    responseId: `resp_fixture_${ordinal}`,
    responseStatus: "completed",
    requestBodyBytes: "{}",
    requestBodyHash: await sha256Hex("{}"),
    rawResponseBytes,
    rawResponseHash: await sha256Hex(rawResponseBytes),
    rawResponse: { id: `resp_fixture_${ordinal}`, decision: tool },
    outputText: JSON.stringify({ decision: { kind: "call", tool, arguments: toolInput } }),
    decision: { kind: "call", tool, arguments: toolInput },
    decisionError: null,
    refusal: null,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      accountedNanoUsd: 440_000,
      costBasis: "frozen-list-price-plus-10pct-uplift"
    },
    usageHash: await canonicalSha256({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      accountedNanoUsd: 440_000,
      costBasis: "frozen-list-price-plus-10pct-uplift"
    }),
    promptHash: envelope.runner.promptHash,
    settingsHash: envelope.runner.settingsHash,
    decisionSchemaHash: envelope.runner.decisionSchemaHash,
    transportBindingHash: envelope.runner.transport.bindingHash,
    modelInputHash: "2".repeat(64),
    dispatchedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:00.100Z",
    durationMs: 100,
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  };
}

async function fallbackProviderReceipt(
  envelope: FallbackCalibrationEnvelope,
  ordinal: number
): Promise<FallbackProviderKnownReceipt> {
  const tool = getProbeCalibrationCase(ordinal).expectedTool;
  const toolInput = inputForTool(tool, envelope.runner.transport.operationId);
  const rawResponseBytes = JSON.stringify({ id: `fallback_resp_fixture_${ordinal}`, tool });
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    accountedNanoUsd: 440_000,
    costBasis: "frozen-list-price-plus-10pct-uplift" as const
  };
  return {
    version: "toolproof-fallback-provider@1.0.0",
    provider: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6-terra",
    requestId: `fallback_req_fixture_${ordinal}`,
    responseId: `fallback_resp_fixture_${ordinal}`,
    responseStatus: "completed",
    requestBodyBytes: "{}",
    requestBodyHash: await sha256Hex("{}"),
    rawResponseBytes,
    rawResponseHash: await sha256Hex(rawResponseBytes),
    rawResponse: { id: `fallback_resp_fixture_${ordinal}`, tool },
    outputText: null,
    decision: { kind: "call", tool, arguments: toolInput },
    decisionError: null,
    refusal: null,
    toolCallId: `fallback_call_fixture_${ordinal}`,
    rawArgumentsBytes: canonicalJson(toolInput),
    toolCallCount: 1,
    usage,
    usageHash: await canonicalSha256(usage),
    promptHash: envelope.runner.promptHash,
    settingsHash: envelope.runner.settingsHash,
    runnerContractHash: policyMigration.nextRunnerHash,
    browserRuntimeHash: envelope.runner.browserRuntimeHash,
    toolDefinitionsHash: envelope.runner.toolDefinitionsHash,
    noCallSchemaHash: envelope.runner.noCallSchemaHash,
    transportBindingHash: envelope.runner.transport.bindingHash,
    modelInputHash: "2".repeat(64),
    dispatchedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:00.100Z",
    durationMs: 100,
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  };
}

async function migrationFixture(): Promise<ProbeActivationContext["migration"]> {
  const actualCosts = [2_840_200, 2_840_200, 2_840_200, 2_840_200] as const;
  const priorReceipt: ProbePolicyMigrationPriorReceipt = {
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: PROBE_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
    guardInstanceId: "guard_fixture_service_001",
    initializedCommit: "d".repeat(40),
    previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
    knownCalls: actualCosts.map((actualNanoUsd, ordinal) => ({
      ordinal,
      jti: `prior_jti_fixture_${String(ordinal).padStart(2, "0")}`,
      dispatchSequence: ordinal + 1,
      actualNanoUsd,
      providerResponseHash: String(ordinal + 1).repeat(64),
      settlementDigest: String(ordinal + 5).repeat(64),
      usageHash: String(ordinal + 1)
        .repeat(64)
        .split("")
        .reverse()
        .join("")
    }))
  };
  const manifest = createProbePolicyMigrationManifest({
    priorReceipt,
    nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
    migrationCommit: buildCommit
  });
  const initialMigration = await createProbePolicyMigrationReceipt(
    manifest,
    await probePolicyMigrationDigest(manifest),
    nowMs - 2_000
  );
  const fifthCall = {
    ordinal: 4,
    jti: "attempt2_lost_fixture_04",
    dispatchSequence: 5,
    actualNanoUsd: 440_000,
    providerResponseHash: "9".repeat(64),
    settlementDigest: "a".repeat(64),
    usageHash: "b".repeat(64)
  };
  const source = await parseProbeV03PolicyMigrationSourceReceipt(
    {
      version: PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V03_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      predecessorMigrationId: PROBE_V03_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: initialMigration.receiptHash,
      guardInstanceId: priorReceipt.guardInstanceId,
      initializedCommit: priorReceipt.initializedCommit,
      previousPolicyVersion: PROBE_V03_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V03_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      preserved: {
        ...PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownActualNanoUsd: 11_800_800
      },
      knownCalls: [...initialMigration.knownCalls, fifthCall]
    },
    initialMigration
  );
  const v03Manifest = await createProbeV03PolicyMigrationManifest({
    sourceReceipt: source,
    predecessorReceipt: initialMigration,
    migrationCommit: buildCommit,
    nextPolicyHash: PROBE_V03_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH
  });
  predecessorMigration = await createProbeV03PolicyMigrationReceipt(
    v03Manifest,
    await probeV03PolicyMigrationDigest(v03Manifest),
    nowMs - 1_000
  );
  const appendedCalls = [0, 1, 2, 3].map((index) => ({
    ordinal: index + 5,
    jti: `attempt3_fixture_jti_${index}`,
    dispatchSequence: index + 6,
    actualNanoUsd: 4_048_000,
    providerResponseHash: String(index + 1)
      .repeat(32)
      .padEnd(64, String(index + 5)),
    settlementDigest: String(index + 2)
      .repeat(32)
      .padEnd(64, String(index + 6)),
    usageHash: String(index + 3)
      .repeat(32)
      .padEnd(64, String(index + 7))
  }));
  return {
    version: PROBE_V04_POLICY_MIGRATION_VERSION,
    migrationId: PROBE_V04_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
    priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V04_PREDECESSOR_MIGRATION_ID,
    predecessorMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    guardInstanceId: "guard_fixture_service_001",
    initializedCommit: "d".repeat(40),
    previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls: [...predecessorMigration.knownCalls, ...appendedCalls],
    migrationCommit: buildCommit,
    nextPolicyVersion: PROBE_V04_MIGRATED_POLICY_VERSION,
    nextPolicyHash: policyHash,
    nextScriptHash: scriptHash,
    nextRunnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
    migrationProgramHash: "e".repeat(64),
    previousPurposeLimits: PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: { calibration: 13, baseline: 72, repair: 2, revised: 72, judge: 1 },
    globalCallLimit: 160,
    lifetimeSpendCeilingNanoUsd: 10_000_000_000,
    perCallReservationNanoUsd: 62_500_000,
    migrationDigest: "f".repeat(64),
    migratedAtMs: nowMs,
    receiptHash: "6".repeat(64)
  };
}

describe("Probe service four-case lifecycle", () => {
  beforeEach(async () => {
    serviceMocks.cache.clear();
    serviceMocks.index = undefined;
    activeRecoveryCookie = "";
    vi.clearAllMocks();
    [policyHash, scriptHash] = await Promise.all([probePolicyHash(), probeLedgerScriptHash()]);
    policyMigration = await migrationFixture();
  });

  it("starts only from the exact migrated four-known-call base and never from adjacent counts", async () => {
    await expect(
      startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs
      })
    ).resolves.toMatchObject({ buildCommit });
    for (const state of [
      { claimed: -1, known: -1, pending: 0 as const },
      { claimed: 0, known: -1, pending: 0 as const },
      { claimed: 1, known: 1, pending: 0 as const },
      { claimed: 1, known: 0, pending: 1 as const }
    ]) {
      await expect(
        startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
          environment,
          redis: {} as never,
          activation: activation(state),
          now: () => nowMs
        })
      ).rejects.toThrowError(/calibration_session_unavailable/u);
    }
  });

  it("automatically seals and reveals four authentic non-scored fake-provider trials", async () => {
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const start = await startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
      environment,
      redis: {} as never,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
    activeRecoveryCookie = start.recoveryCookieValue;
    const cookie = start.cookieValue;
    const csrf = start.csrfToken;
    let continuation = start.continuation;
    const continuationSizes: number[] = [];
    const completionBodySizes: number[] = [];

    serviceMocks.provider.mockImplementation(
      async ({
        envelope,
        beforeDispatch
      }: {
        envelope: ProbeCalibrationEnvelope;
        beforeDispatch?: () => Promise<void>;
      }) => {
        await beforeDispatch?.();
        const ordinal = Array.from({ length: 4 }, (_, index) => index).find(
          (index) =>
            getProbeCalibrationCase(index).naturalLanguageRequest ===
            envelope.naturalLanguageRequest
        );
        if (ordinal === undefined) throw new Error("Unknown fixture envelope.");
        return providerReceipt(envelope, ordinal);
      }
    );

    for (let ordinal = 0; ordinal < 4; ordinal += 1) {
      const trial = trialEnvironment(manifest.manifestHash, ordinal);
      await trial.store.cartGet({}, { source: "native" });
      const initialBoundary = await boundary(trial, manifest);
      const issued = await issueProbeCalibrationTrial(
        request(cookie, csrf),
        { continuation, initialBoundary, fixture, liveManifest: manifest },
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal, known: ordinal, pending: 0 }),
          now: () => nowMs + ordinal * 1_000
        }
      );
      if (issued.status !== "issued") throw new Error("Unexpected recovered fixture issue.");
      let activeIssued = issued;
      let activeTrial = trial;
      let activeBoundary = initialBoundary;
      let decision = await decideProbeCalibrationTrial(
        request(cookie, csrf),
        {
          probeToken: issued.authorization.probeToken,
          envelope: issued.authorization.envelope
        },
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal, known: ordinal, pending: 0 }),
          now: () => nowMs + ordinal * 1_000 + 100
        }
      );
      if (ordinal === 0) {
        const recoveredTrial = trialEnvironment(manifest.manifestHash, 10);
        await recoveredTrial.store.cartGet({}, { source: "native" });
        const recoveredBoundary = await boundary(recoveredTrial, manifest);
        const recoveredIssue = await issueProbeCalibrationTrial(
          request(cookie, csrf),
          {
            continuation,
            initialBoundary: recoveredBoundary,
            fixture,
            liveManifest: manifest
          },
          {
            environment,
            redis: {} as never,
            activation: activation({ claimed: 1, known: 0, pending: 1 }),
            now: () => nowMs + 200
          }
        );
        if (recoveredIssue.status !== "issued") throw new Error("Issue recovery failed.");
        expect(recoveredIssue.authorization.probeToken).toBe(issued.authorization.probeToken);
        const recoveredDecision = await decideProbeCalibrationTrial(
          request(cookie, csrf),
          {
            probeToken: recoveredIssue.authorization.probeToken,
            envelope: recoveredIssue.authorization.envelope
          },
          {
            environment,
            redis: {} as never,
            activation: activation({ claimed: 1, known: 0, pending: 1 }),
            now: () => nowMs + 210
          }
        );
        expect(canonicalJson(recoveredDecision)).toBe(canonicalJson(decision));
        activeIssued = recoveredIssue;
        activeTrial = recoveredTrial;
        activeBoundary = recoveredBoundary;
        decision = recoveredDecision;
      }
      const tool = getProbeCalibrationCase(ordinal).expectedTool;
      const nativeAdmission = await admitProbeNativeDispatch(
        request(cookie, csrf),
        {
          probeToken: activeIssued.authorization.probeToken,
          envelope: activeIssued.authorization.envelope,
          initialBoundary: activeBoundary
        },
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal + 1, known: ordinal, pending: 1 }),
          now: () => nowMs + ordinal * 1_000 + 150
        }
      );
      expect(nativeAdmission.status).toBe("admitted");
      const repeatedAdmission = await admitProbeNativeDispatch(
        request(cookie, csrf),
        {
          probeToken: activeIssued.authorization.probeToken,
          envelope: activeIssued.authorization.envelope,
          initialBoundary: activeBoundary
        },
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal + 1, known: ordinal, pending: 1 }),
          now: () => nowMs + ordinal * 1_000 + 151
        }
      );
      expect(repeatedAdmission.status).toBe("already-admitted");
      const native = await nativeExecution(
        activeTrial,
        tool,
        manifest.manifestHash,
        inputForTool(tool, activeIssued.authorization.envelope.runner.transport.operationId)
      );
      const postResetBoundary = await boundary(activeTrial, manifest);
      const capture = {
        runnerVersion: "toolproof-probe-client-runner@2.0.0",
        claim: {
          runId: activeIssued.runId,
          caseId: activeIssued.caseId,
          trialId: activeIssued.trialId
        },
        initialBoundary: activeBoundary,
        liveBoundary: {
          ...activeBoundary,
          registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
        },
        decisionRequestCount: 1,
        rawDecisionEnvelopeHash: await canonicalSha256(decision),
        rawModelResponseHash: await sha256Hex(decision.rawModelResponse),
        providerReceiptHash: await canonicalSha256(decision.providerReceipt),
        decision: decision.decision,
        selectedToolName: tool,
        rawArguments: native.input,
        nativeAllowanceConsumed: true,
        nativeDispatchCount: 1,
        executionResult: native.result,
        terminalStatus: "call_completed",
        errors: { provider: null, decision: null, liveBoundary: null, execution: null },
        timings: {
          startedAtMs: nowMs,
          initialBoundaryVerifiedAtMs: nowMs + 10,
          claimIssuedAtMs: nowMs + 20,
          decisionCompletedAtMs: nowMs + 30,
          liveReverifiedAtMs: nowMs + 40,
          nativeCompletedAtMs: nowMs + 50,
          captureStartedAtMs: nowMs + 60
        }
      };
      const capturedEvidence = {
        version: "toolproof-probe-trial-evidence@1.0.0",
        appCommit: buildCommit,
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Fixture Browser",
        capturedAt: "2026-08-27T12:00:00.000Z",
        capture,
        currentTraces: [native.result.trace],
        captureDigest: await canonicalSha256(capture)
      };
      const completionBody = {
        probeToken: activeIssued.authorization.probeToken,
        envelope: activeIssued.authorization.envelope,
        providerReceipt: decision.providerReceipt,
        continuation,
        completion: {
          runnerVersion: "toolproof-probe-client-runner@2.0.0",
          claim: capture.claim,
          terminalStatus: "call_completed",
          nativeDispatchCount: 1,
          evidence: capturedEvidence,
          postResetBoundary
        }
      };
      completionBodySizes.push(Buffer.byteLength(JSON.stringify(completionBody), "utf8"));
      if (ordinal === 0) {
        const rawTamper = structuredClone(completionBody);
        const tamperedRaw = { tampered: true };
        const tamperedBytes = canonicalJson(tamperedRaw);
        const mutableRawTrace = rawTamper.completion.evidence.currentTraces[0] as unknown as {
          rawResult: unknown;
        };
        mutableRawTrace.rawResult = {
          value: tamperedRaw,
          bytes: tamperedBytes,
          sha256: await sha256Hex(tamperedBytes)
        };
        (
          rawTamper.completion.evidence.capture.executionResult.trace as unknown as {
            rawResult: unknown;
          }
        ).rawResult = mutableRawTrace.rawResult;
        rawTamper.completion.evidence.captureDigest = await canonicalSha256(
          rawTamper.completion.evidence.capture
        );
        await expect(
          completeProbeCalibrationTrial(request(cookie, csrf), rawTamper, {
            environment,
            redis: {} as never,
            activation: activation({ claimed: 1, known: 0, pending: 1 }),
            now: () => nowMs + 190
          })
        ).rejects.toThrowError(/native_provenance_mismatch/u);

        const provenanceTamper = structuredClone(completionBody);
        (
          provenanceTamper.completion.evidence.currentTraces[0] as unknown as {
            handlerVersion: string;
          }
        ).handlerVersion = "tampered-handler@999";
        (
          provenanceTamper.completion.evidence.capture.executionResult.trace as unknown as {
            handlerVersion: string;
          }
        ).handlerVersion = "tampered-handler@999";
        provenanceTamper.completion.evidence.captureDigest = await canonicalSha256(
          provenanceTamper.completion.evidence.capture
        );
        await expect(
          completeProbeCalibrationTrial(request(cookie, csrf), provenanceTamper, {
            environment,
            redis: {} as never,
            activation: activation({ claimed: 1, known: 0, pending: 1 }),
            now: () => nowMs + 191
          })
        ).rejects.toThrowError(/native_provenance_mismatch/u);
      }
      const completion = await completeProbeCalibrationTrial(
        request(cookie, csrf),
        completionBody,
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal + 1, known: ordinal, pending: 1 }),
          now: () => nowMs + ordinal * 1_000 + 200
        }
      );
      expect(completion).toMatchObject({
        status: "sealed",
        completedCount: ordinal + 1,
        terminal: ordinal === 3
      });
      expect(completion.continuation).not.toContain("expectedTool");
      const recoveryTrial = trialEnvironment(manifest.manifestHash, ordinal + 20);
      await recoveryTrial.store.cartGet({}, { source: "native" });
      const recoveryBoundary = await boundary(recoveryTrial, manifest);
      const recoveredCompletion = await issueProbeCalibrationTrial(
        request(cookie, csrf),
        {
          continuation,
          initialBoundary: recoveryBoundary,
          fixture,
          liveManifest: manifest
        },
        {
          environment,
          redis: {} as never,
          activation: activation({ claimed: ordinal + 1, known: ordinal + 1, pending: 0 }),
          now: () => nowMs + ordinal * 1_000 + 250
        }
      );
      expect(recoveredCompletion).toMatchObject({
        status: "already-sealed",
        continuation: completion.continuation,
        completedCount: ordinal + 1,
        terminal: ordinal === 3
      });
      continuation = completion.continuation;
      continuationSizes.push(Buffer.byteLength(continuation, "utf8"));
    }

    const revealed = await revealProbeCalibrationRun(request(cookie, csrf), continuation, {
      environment,
      redis: {} as never,
      activation: activation({ claimed: 4, known: 4, pending: 0 }),
      now: () => nowMs + 5_000
    });
    expect(revealed).toMatchObject({
      protocolVersion: "toolproof-probe-calibration-attempt-3@1.0.0",
      attempt: 3,
      lane: "custom-probe-calibration-attempt-3",
      calibrationOnly: true,
      includedInBenchmark: false,
      priorAttempts: {
        mergedIntoCurrentAttempt: false,
        attempt1: { passedCount: 0, caseCount: 4 },
        attempt2: { disposition: "terminal-invalid-infrastructure" }
      },
      policyMigration: { receiptHash: predecessorMigration.receiptHash },
      terminalGuard: { claimedCalls: 9, knownCalls: 9, calibrationCalls: 9 },
      attemptCost: {
        priorCumulativeKnownAccountedNanoUsd: 11_800_800,
        attemptAccountedNanoUsd: 1_760_000,
        terminalCumulativeKnownAccountedNanoUsd: 13_560_800
      },
      caseCount: 4,
      passedCount: 4
    });
    expect(revealed.cases).toHaveLength(4);
    const repeatedReveal = await revealProbeCalibrationRun(request(cookie, csrf), continuation, {
      environment,
      redis: {} as never,
      activation: activation({ claimed: 4, known: 4, pending: 0 }),
      now: () => nowMs + 60_000
    });
    expect(canonicalJson(repeatedReveal)).toBe(canonicalJson(revealed));
    expect(Math.max(...continuationSizes)).toBeLessThan(1_800_000);
    expect(Math.max(...completionBodySizes)).toBeLessThan(3_500_000);
    expect(revealed).toMatchObject({ caseCount: 4, passedCount: 4 });
    await expect(
      startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 4, known: 4, pending: 0 }),
        now: () => nowMs + 61_000
      })
    ).rejects.toThrowError(/calibration_session_unavailable/u);
    expect(serviceMocks.provider).toHaveBeenCalledTimes(4);
    expect(serviceMocks.issue).toHaveBeenCalledTimes(4);
    expect(serviceMocks.begin).toHaveBeenCalledTimes(4);
    expect(serviceMocks.settleKnown).toHaveBeenCalledTimes(8);
    expect(serviceMocks.settleUncertain).not.toHaveBeenCalled();
  });

  it.each([
    { name: "known refusal", terminalStatus: "malformed_decision", boundaryDrift: false },
    { name: "post-decision boundary drift", terminalStatus: "boundary_drift", boundaryDrift: true }
  ])("settles and seals a $name without a native dispatch", async (scenario) => {
    serviceMocks.cache.clear();
    vi.clearAllMocks();
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const start = await startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
      environment,
      redis: {} as never,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
    activeRecoveryCookie = start.recoveryCookieValue;
    const trial = trialEnvironment(manifest.manifestHash, scenario.boundaryDrift ? 41 : 40);
    await trial.store.cartGet({}, { source: "native" });
    const initialBoundary = await boundary(trial, manifest);
    const issued = await issueProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      { continuation: start.continuation, initialBoundary, fixture, liveManifest: manifest },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs
      }
    );
    if (issued.status !== "issued") throw new Error("Unexpected recovered issue.");
    serviceMocks.provider.mockImplementation(
      async ({
        envelope,
        beforeDispatch
      }: {
        envelope: ProbeCalibrationEnvelope;
        beforeDispatch?: () => Promise<void>;
      }) => {
        await beforeDispatch?.();
        const receipt = await providerReceipt(envelope, 0);
        return scenario.boundaryDrift
          ? receipt
          : {
              ...receipt,
              outputText: null,
              decision: null,
              decisionError: "provider_refusal",
              refusal: "Fixture refusal"
            };
      }
    );
    const decision = await decideProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 100
      }
    );
    const postResetBoundary = await boundary(trial, manifest);
    const capture = {
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim: { runId: issued.runId, caseId: issued.caseId, trialId: issued.trialId },
      initialBoundary,
      liveBoundary: scenario.boundaryDrift
        ? null
        : {
            status: "verified",
            catalogState: "initial",
            fixtureId: initialBoundary.fixtureId,
            fixtureSeed: initialBoundary.fixtureSeed,
            stateRevision: 0,
            stateHash: initialBoundary.stateHash,
            manifestHash: initialBoundary.manifestHash,
            registrationGeneration: 1,
            operationLedgerCount: 0,
            currentTrajectoryCount: 0,
            registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
          },
      decisionRequestCount: 1,
      rawDecisionEnvelopeHash: await canonicalSha256(decision),
      rawModelResponseHash: await sha256Hex(decision.rawModelResponse),
      providerReceiptHash: await canonicalSha256(decision.providerReceipt),
      decision: decision.decision,
      selectedToolName: null,
      rawArguments: null,
      nativeAllowanceConsumed: false,
      nativeDispatchCount: 0,
      executionResult: null,
      terminalStatus: scenario.terminalStatus,
      errors: {
        provider: null,
        decision: scenario.boundaryDrift
          ? null
          : { name: "DecisionError", message: "Known provider decision was not callable." },
        liveBoundary: scenario.boundaryDrift
          ? { name: "BoundaryError", message: "Live catalog drifted." }
          : null,
        execution: null
      },
      timings: {
        startedAtMs: nowMs,
        initialBoundaryVerifiedAtMs: nowMs + 10,
        claimIssuedAtMs: nowMs + 20,
        decisionCompletedAtMs: nowMs + 30,
        liveReverifiedAtMs: nowMs + 40,
        nativeCompletedAtMs: null,
        captureStartedAtMs: nowMs + 50
      }
    };
    const completion = await completeProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        providerReceipt: decision.providerReceipt,
        continuation: start.continuation,
        completion: {
          runnerVersion: "toolproof-probe-client-runner@2.0.0",
          claim: capture.claim,
          terminalStatus: scenario.terminalStatus,
          nativeDispatchCount: 0,
          evidence: {
            version: "toolproof-probe-trial-evidence@1.0.0",
            appCommit: buildCommit,
            origin: "https://toolproof-rust.vercel.app",
            userAgent: "Fixture Browser",
            capturedAt: new Date(nowMs).toISOString(),
            capture,
            currentTraces: [],
            captureDigest: await canonicalSha256(capture)
          },
          postResetBoundary
        }
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 200
      }
    );
    expect(completion).toMatchObject({ status: "sealed", completedCount: 1, terminal: false });
    expect(serviceMocks.provider).toHaveBeenCalledTimes(1);
    expect(serviceMocks.begin).toHaveBeenCalledTimes(1);
    expect(serviceMocks.settleKnown).toHaveBeenCalledTimes(1);
    expect(serviceMocks.settleUncertain).not.toHaveBeenCalled();
    expect([...serviceMocks.cache.keys()].some((key) => key.endsWith(":native"))).toBe(false);
  });

  it("seals an indeterminate failed row without redispatch after native admission recovery", async () => {
    serviceMocks.cache.clear();
    vi.clearAllMocks();
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const start = await startProbeCalibrationSession(request(), `launch_${"l".repeat(32)}`, {
      environment,
      redis: {} as never,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
    activeRecoveryCookie = start.recoveryCookieValue;
    const firstDocument = trialEnvironment(manifest.manifestHash, 50);
    await firstDocument.store.cartGet({}, { source: "native" });
    const firstBoundary = await boundary(firstDocument, manifest);
    const issued = await issueProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      {
        continuation: start.continuation,
        initialBoundary: firstBoundary,
        fixture,
        liveManifest: manifest
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs
      }
    );
    if (issued.status !== "issued") throw new Error("Unexpected recovered issue.");
    serviceMocks.provider.mockImplementation(
      async ({
        envelope,
        beforeDispatch
      }: {
        envelope: ProbeCalibrationEnvelope;
        beforeDispatch?: () => Promise<void>;
      }) => {
        await beforeDispatch?.();
        return providerReceipt(envelope, 0);
      }
    );
    const decision = await decideProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 100
      }
    );
    const firstAdmission = await admitProbeNativeDispatch(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        initialBoundary: firstBoundary
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 110
      }
    );
    expect(firstAdmission.status).toBe("admitted");

    const recoveredDocument = trialEnvironment(manifest.manifestHash, 51);
    await recoveredDocument.store.cartGet({}, { source: "native" });
    const recoveredBoundary = await boundary(recoveredDocument, manifest);
    const repeatedAdmission = await admitProbeNativeDispatch(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        initialBoundary: recoveredBoundary
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 120
      }
    );
    expect(repeatedAdmission.status).toBe("already-admitted");
    const postResetBoundary = await boundary(recoveredDocument, manifest);
    const capture = {
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim: { runId: issued.runId, caseId: issued.caseId, trialId: issued.trialId },
      initialBoundary: recoveredBoundary,
      liveBoundary: {
        status: "verified",
        catalogState: "initial",
        fixtureId: recoveredBoundary.fixtureId,
        fixtureSeed: recoveredBoundary.fixtureSeed,
        stateRevision: 0,
        stateHash: recoveredBoundary.stateHash,
        manifestHash: recoveredBoundary.manifestHash,
        registrationGeneration: 1,
        operationLedgerCount: 0,
        currentTrajectoryCount: 0,
        registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
      },
      decisionRequestCount: 1,
      rawDecisionEnvelopeHash: await canonicalSha256(decision),
      rawModelResponseHash: await sha256Hex(decision.rawModelResponse),
      providerReceiptHash: await canonicalSha256(decision.providerReceipt),
      decision: decision.decision,
      selectedToolName: "cart_get",
      rawArguments: {},
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      executionResult: null,
      terminalStatus: "call_failed",
      errors: {
        provider: null,
        decision: null,
        liveBoundary: null,
        execution: {
          name: "NativeRecoveryError",
          message: "Native allowance was consumed in an earlier document.",
          code: "native_allowance_already_consumed"
        }
      },
      timings: {
        startedAtMs: nowMs,
        initialBoundaryVerifiedAtMs: nowMs + 10,
        claimIssuedAtMs: nowMs + 20,
        decisionCompletedAtMs: nowMs + 30,
        liveReverifiedAtMs: nowMs + 40,
        nativeCompletedAtMs: nowMs + 50,
        captureStartedAtMs: nowMs + 60
      }
    };
    const completion = await completeProbeCalibrationTrial(
      request(start.cookieValue, start.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        providerReceipt: decision.providerReceipt,
        continuation: start.continuation,
        completion: {
          runnerVersion: "toolproof-probe-client-runner@2.0.0",
          claim: capture.claim,
          terminalStatus: "call_failed",
          nativeDispatchCount: 1,
          evidence: {
            version: "toolproof-probe-trial-evidence@1.0.0",
            appCommit: buildCommit,
            origin: "https://toolproof-rust.vercel.app",
            userAgent: "Fixture Browser",
            capturedAt: new Date(nowMs).toISOString(),
            capture,
            currentTraces: [],
            captureDigest: await canonicalSha256(capture)
          },
          postResetBoundary
        }
      },
      {
        environment,
        redis: {} as never,
        activation: activation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 200
      }
    );
    expect(completion).toMatchObject({ status: "sealed", completedCount: 1 });
    expect(serviceMocks.provider).toHaveBeenCalledTimes(1);
    expect(serviceMocks.settleKnown).toHaveBeenCalledTimes(1);
  });
});

describe("Dormant pinned fallback service lane", () => {
  beforeEach(async () => {
    serviceMocks.cache.clear();
    serviceMocks.index = undefined;
    activeRecoveryCookie = "";
    vi.clearAllMocks();
    [policyHash, scriptHash] = await Promise.all([probePolicyHash(), probeLedgerScriptHash()]);
    policyMigration = await migrationFixture();
  });

  it("freezes the reviewed 9 + 4 = 13 allocation under the unchanged lifetime caps", () => {
    expect(FALLBACK_PROBE_CALIBRATION_BASE_CALLS).toBe(9);
    expect(FALLBACK_PROBE_CALIBRATION_CASE_COUNT).toBe(4);
    expect(FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS).toBe(13);
    expect(PROBE_PURPOSE_CALL_LIMITS).toEqual({
      calibration: 13,
      baseline: 72,
      repair: 2,
      revised: 72,
      judge: 1
    });
    expect(PROBE_GLOBAL_CALL_LIMIT).toBe(160);
    expect(PROBE_LIFETIME_SPEND_CEILING_NANO_USD).toBe(10_000_000_000);
  });

  it("starts only at preserved call 9 and seals one exact native fallback trial", async () => {
    for (const state of [
      { claimed: -1, known: -1, pending: 0 as const },
      { claimed: 1, known: 1, pending: 0 as const },
      { claimed: 1, known: 0, pending: 1 as const }
    ]) {
      await expect(
        startFallbackProbeCalibrationSession(request(), `launch_${"x".repeat(31)}y`, {
          environment,
          redis: {} as never,
          activation: fallbackActivation(state),
          now: () => nowMs
        })
      ).rejects.toThrowError(/fallback_calibration_session_unavailable/u);
    }

    const started = await startFallbackProbeCalibrationSession(
      request(),
      `launch_${"f".repeat(32)}`,
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs
      }
    );
    activeRecoveryCookie = started.recoveryCookieValue;
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const trial = trialEnvironment(manifest.manifestHash, 20);
    await trial.store.cartGet({}, { source: "native" });
    const initialBoundary = await boundary(trial, manifest);
    const issued = await issueFallbackProbeCalibrationTrial(
      request(started.cookieValue, started.csrfToken),
      {
        continuation: started.continuation,
        initialBoundary,
        fixture,
        liveManifest: manifest
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 10
      }
    );
    if (issued.status !== "issued") throw new Error("Fallback issue fixture failed.");
    serviceMocks.fallbackProvider.mockImplementation(
      async ({
        envelope,
        beforeDispatch
      }: {
        envelope: FallbackCalibrationEnvelope;
        beforeDispatch?: () => Promise<void>;
      }) => {
        await beforeDispatch?.();
        return fallbackProviderReceipt(envelope, 0);
      }
    );
    const decision = await decideFallbackProbeCalibrationTrial(
      request(started.cookieValue, started.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 20
      }
    );
    expect(serviceMocks.begin).toHaveBeenCalledTimes(1);
    expect(decision.decision).toMatchObject({ kind: "call", tool: "cart_get" });
    await expect(
      admitFallbackProbeNativeDispatch(
        request(started.cookieValue, started.csrfToken),
        {
          probeToken: issued.authorization.probeToken,
          envelope: issued.authorization.envelope,
          initialBoundary
        },
        {
          environment,
          redis: {} as never,
          activation: fallbackActivation({ claimed: 1, known: 0, pending: 1 }),
          now: () => nowMs + 30
        }
      )
    ).resolves.toMatchObject({ status: "admitted", inferencePerformed: false });

    const native = await nativeExecution(trial, "cart_get", manifest.manifestHash, {});
    const capturedState = trial.store.getSnapshot().state;
    const capturedInspection = trial.store.inspect();
    const postResetBoundary = await boundary(trial, manifest);
    const nativeId = "fallback_native_result_fixture_0001";
    const nativeCall = { id: nativeId, toolName: "cart_get", input: {} };
    const fallbackRawResult = {
      id: nativeId,
      status: "Completed",
      call: nativeCall,
      outputPresent: true,
      output: native.result.trace.canonicalResult?.value,
      errorText: null,
      exception: null
    };
    const fallbackNativeReceipt = {
      version: "toolproof-fallback-native-bridge@1.0.0",
      toolName: "cart_get",
      manifestHash: manifest.manifestHash,
      registrationGeneration: 1,
      allowanceConsumed: true,
      nativeCallCount: 1,
      arguments: {
        value: {},
        bytes: "{}",
        sha256: await sha256Hex("{}")
      },
      outcome: "Completed",
      rawResult: fallbackRawResult,
      invokedEvents: [nativeCall],
      respondedEvents: [fallbackRawResult],
      error: null,
      startedAt: "2026-08-27T12:00:00.040Z",
      completedAt: "2026-08-27T12:00:00.050Z",
      durationMs: 10
    };
    const capture = {
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim: { runId: issued.runId, caseId: issued.caseId, trialId: issued.trialId },
      initialBoundary,
      liveBoundary: { ...initialBoundary, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
      decisionRequestCount: 1,
      rawDecisionEnvelopeHash: await canonicalSha256(decision),
      rawModelResponseHash: await sha256Hex(decision.rawModelResponse),
      providerReceiptHash: await canonicalSha256(decision.providerReceipt),
      decision: decision.decision,
      selectedToolName: "cart_get",
      rawArguments: {},
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      executionResult: fallbackNativeReceipt,
      terminalStatus: "call_completed",
      errors: { provider: null, decision: null, liveBoundary: null, execution: null },
      timings: {
        startedAtMs: nowMs,
        initialBoundaryVerifiedAtMs: nowMs + 10,
        claimIssuedAtMs: nowMs + 20,
        decisionCompletedAtMs: nowMs + 30,
        liveReverifiedAtMs: nowMs + 40,
        nativeCompletedAtMs: nowMs + 50,
        captureStartedAtMs: nowMs + 60
      }
    };
    const evidence = {
      version: "toolproof-fallback-trial-evidence@1.0.0",
      adapterVersion: "toolproof-fallback-lab-page-adapter@1.0.0",
      appCommit: buildCommit,
      origin: "https://toolproof-rust.vercel.app",
      userAgent: "Fixture Browser",
      capturedAt: new Date(nowMs + 60).toISOString(),
      capture,
      captureDigest: await canonicalSha256(capture),
      currentState: capturedState,
      currentInspection: capturedInspection,
      currentTraces: [native.result.trace],
      fallback: {
        catalog: {
          version: "toolproof-fallback-native-bridge@1.0.0",
          targetOrigin: "https://toolproof-rust.vercel.app",
          pageUrl: "https://toolproof-rust.vercel.app/lab",
          manifestHash: manifest.manifestHash,
          registrationGeneration: 1,
          toolNames: INITIAL_CHECKOUT_TOOL_NAMES,
          catalogDigest: await canonicalSha256({
            manifest,
            targetOrigin: "https://toolproof-rust.vercel.app",
            pageUrl: "https://toolproof-rust.vercel.app/lab",
            registrationGeneration: 1
          }),
          upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
          puppeteerCore: FALLBACK_UPSTREAM_PIN.puppeteerCore
        },
        runtime: {
          version: "toolproof-fallback-browser-runtime@1.0.0",
          planHash: "8".repeat(64),
          runtimeContractHash: issued.authorization.envelope.runner.browserRuntimeHash,
          executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
          browserVersion: `Chrome/${FALLBACK_UPSTREAM_PIN.chromeForTesting}`,
          puppeteerCore: FALLBACK_UPSTREAM_PIN.puppeteerCore,
          chromeForTesting: FALLBACK_UPSTREAM_PIN.chromeForTesting,
          protocol: FALLBACK_UPSTREAM_PIN.protocol,
          targetOrigin: "https://toolproof-rust.vercel.app",
          targetUrl: "https://toolproof-rust.vercel.app/lab",
          isolatedProcess: true,
          foreignRequestObserved: false,
          unexpectedTargetObserved: false,
          additionalTargetCount: 0
        },
        nativeReceipt: fallbackNativeReceipt
      }
    };
    const completeWithEvidence = (candidateEvidence: unknown) =>
      completeFallbackProbeCalibrationTrial(
        request(started.cookieValue, started.csrfToken),
        {
          probeToken: issued.authorization.probeToken,
          envelope: issued.authorization.envelope,
          providerReceipt: decision.providerReceipt,
          continuation: started.continuation,
          completion: {
            runnerVersion: "toolproof-probe-client-runner@2.0.0",
            claim: capture.claim,
            terminalStatus: "call_completed",
            nativeDispatchCount: 1,
            evidence: candidateEvidence,
            postResetBoundary
          }
        },
        {
          environment,
          redis: {} as never,
          activation: fallbackActivation({ claimed: 1, known: 0, pending: 1 }),
          now: () => nowMs + 100
        }
      );
    await expect(
      completeWithEvidence({
        ...evidence,
        currentState: { ...capturedState, revision: 99 }
      })
    ).rejects.toThrowError(/fallback_current_state_or_inspection_mismatch/u);
    await expect(
      completeWithEvidence({
        ...evidence,
        currentInspection: { ...capturedInspection, currentTraceCount: 0 }
      })
    ).rejects.toThrowError(/fallback_current_state_or_inspection_mismatch/u);
    const completion = await completeWithEvidence(evidence);
    expect(completion).toMatchObject({
      lane: "pinned-googlechromelabs-webmcp-fallback-calibration",
      status: "sealed",
      completedCount: 1,
      terminal: false
    });
    expect(serviceMocks.settleKnown).toHaveBeenCalledTimes(1);
    await expect(
      revealFallbackProbeCalibrationRun(
        request(started.cookieValue, started.csrfToken),
        completion.continuation,
        {
          environment,
          redis: {} as never,
          activation: fallbackActivation({ claimed: 1, known: 1, pending: 0 }),
          now: () => nowMs + 110
        }
      )
    ).rejects.toThrowError(/fallback_calibration_not_complete/u);
  });

  it("seals a failed fallback row without redispatch after a recovered native admission", async () => {
    const started = await startFallbackProbeCalibrationSession(
      request(),
      `launch_${"g".repeat(32)}`,
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs
      }
    );
    activeRecoveryCookie = started.recoveryCookieValue;
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const firstDocument = trialEnvironment(manifest.manifestHash, 60);
    const firstBoundary = await boundary(firstDocument, manifest);
    const issued = await issueFallbackProbeCalibrationTrial(
      request(started.cookieValue, started.csrfToken),
      {
        continuation: started.continuation,
        initialBoundary: firstBoundary,
        fixture,
        liveManifest: manifest
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 10
      }
    );
    if (issued.status !== "issued") throw new Error("Fallback issue fixture failed.");
    serviceMocks.fallbackProvider.mockImplementation(
      async ({
        envelope,
        beforeDispatch
      }: {
        envelope: FallbackCalibrationEnvelope;
        beforeDispatch?: () => Promise<void>;
      }) => {
        await beforeDispatch?.();
        return fallbackProviderReceipt(envelope, 0);
      }
    );
    const decision = await decideFallbackProbeCalibrationTrial(
      request(started.cookieValue, started.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 0, known: 0, pending: 0 }),
        now: () => nowMs + 20
      }
    );
    await admitFallbackProbeNativeDispatch(
      request(started.cookieValue, started.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        initialBoundary: firstBoundary
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 30
      }
    );

    const recoveredDocument = trialEnvironment(manifest.manifestHash, 61);
    const recoveredBoundary = await boundary(recoveredDocument, manifest);
    await expect(
      admitFallbackProbeNativeDispatch(
        request(started.cookieValue, started.csrfToken),
        {
          probeToken: issued.authorization.probeToken,
          envelope: issued.authorization.envelope,
          initialBoundary: recoveredBoundary
        },
        {
          environment,
          redis: {} as never,
          activation: fallbackActivation({ claimed: 1, known: 0, pending: 1 }),
          now: () => nowMs + 40
        }
      )
    ).rejects.toThrowError(/fallback_native_allowance_already_consumed/u);
    const recoveredState = recoveredDocument.store.getSnapshot().state;
    const recoveredInspection = recoveredDocument.store.inspect();
    const postResetBoundary = await boundary(recoveredDocument, manifest);
    const capture = {
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim: { runId: issued.runId, caseId: issued.caseId, trialId: issued.trialId },
      initialBoundary: recoveredBoundary,
      liveBoundary: { ...recoveredBoundary, registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES },
      decisionRequestCount: 1,
      rawDecisionEnvelopeHash: await canonicalSha256(decision),
      rawModelResponseHash: await sha256Hex(decision.rawModelResponse),
      providerReceiptHash: await canonicalSha256(decision.providerReceipt),
      decision: decision.decision,
      selectedToolName: "cart_get",
      rawArguments: {},
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      executionResult: null,
      terminalStatus: "call_failed",
      errors: {
        provider: null,
        decision: null,
        liveBoundary: null,
        execution: {
          name: "FallbackNativeRecoveryError",
          message: "Native allowance was consumed in an earlier isolated browser.",
          code: "fallback_native_allowance_already_consumed"
        }
      },
      timings: {
        startedAtMs: nowMs,
        initialBoundaryVerifiedAtMs: nowMs + 10,
        claimIssuedAtMs: nowMs + 20,
        decisionCompletedAtMs: nowMs + 30,
        liveReverifiedAtMs: nowMs + 40,
        nativeCompletedAtMs: nowMs + 50,
        captureStartedAtMs: nowMs + 60
      }
    };
    const catalogDigest = await canonicalSha256({
      manifest,
      targetOrigin: "https://toolproof-rust.vercel.app",
      pageUrl: "https://toolproof-rust.vercel.app/lab",
      registrationGeneration: 1
    });
    const completion = await completeFallbackProbeCalibrationTrial(
      request(started.cookieValue, started.csrfToken),
      {
        probeToken: issued.authorization.probeToken,
        envelope: issued.authorization.envelope,
        providerReceipt: decision.providerReceipt,
        continuation: started.continuation,
        completion: {
          runnerVersion: "toolproof-probe-client-runner@2.0.0",
          claim: capture.claim,
          terminalStatus: "call_failed",
          nativeDispatchCount: 1,
          evidence: {
            version: "toolproof-fallback-trial-evidence@1.0.0",
            adapterVersion: "toolproof-fallback-lab-page-adapter@1.0.0",
            appCommit: buildCommit,
            origin: "https://toolproof-rust.vercel.app",
            userAgent: "Fixture Browser",
            capturedAt: new Date(nowMs + 60).toISOString(),
            capture,
            captureDigest: await canonicalSha256(capture),
            currentState: recoveredState,
            currentInspection: recoveredInspection,
            currentTraces: [],
            fallback: {
              catalog: {
                version: "toolproof-fallback-native-bridge@1.0.0",
                targetOrigin: "https://toolproof-rust.vercel.app",
                pageUrl: "https://toolproof-rust.vercel.app/lab",
                manifestHash: manifest.manifestHash,
                registrationGeneration: 1,
                toolNames: INITIAL_CHECKOUT_TOOL_NAMES,
                catalogDigest,
                upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
                puppeteerCore: FALLBACK_UPSTREAM_PIN.puppeteerCore
              },
              runtime: {
                version: "toolproof-fallback-browser-runtime@1.0.0",
                planHash: "8".repeat(64),
                runtimeContractHash: issued.authorization.envelope.runner.browserRuntimeHash,
                executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
                browserVersion: `Chrome/${FALLBACK_UPSTREAM_PIN.chromeForTesting}`,
                puppeteerCore: FALLBACK_UPSTREAM_PIN.puppeteerCore,
                chromeForTesting: FALLBACK_UPSTREAM_PIN.chromeForTesting,
                protocol: FALLBACK_UPSTREAM_PIN.protocol,
                targetOrigin: "https://toolproof-rust.vercel.app",
                targetUrl: "https://toolproof-rust.vercel.app/lab",
                isolatedProcess: true,
                foreignRequestObserved: false,
                unexpectedTargetObserved: false,
                additionalTargetCount: 0
              },
              nativeReceipt: null
            }
          },
          postResetBoundary
        }
      },
      {
        environment,
        redis: {} as never,
        activation: fallbackActivation({ claimed: 1, known: 0, pending: 1 }),
        now: () => nowMs + 100
      }
    );
    expect(completion).toMatchObject({ status: "sealed", completedCount: 1, terminal: false });
    expect(serviceMocks.fallbackProvider).toHaveBeenCalledTimes(1);
    expect(serviceMocks.settleKnown).toHaveBeenCalledTimes(1);
  });
});
