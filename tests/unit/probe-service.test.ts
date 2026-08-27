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
  provider: vi.fn()
}));

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

import { createCheckoutFixture, CHECKOUT_DOMAIN_VERSION } from "@/lib/domain/checkout";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { CHECKOUT_FIXTURE_STATE_HASH, verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { verifyGate2CalibrationBundle } from "@/lib/evidence/gate2-calibration-bundle";
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
import {
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
const policyHash = "9289f1def645e9ccc71a3ef95320281cef937be5ec1329beaf57f22b4b2c7939";
const environment = {
  TOOLPROOF_SIGNING_SECRET: signingSecret,
  TOOLPROOF_PROBE_ACTIVATION_SECRET: activationSecret,
  OPENAI_API_KEY: "sk-test-not-real"
};

function activation(input: {
  claimed: number;
  known: number;
  pending: 0 | 1;
}): ProbeActivationContext {
  return {
    enabled: true,
    mode: "calibration",
    activationHash: "b".repeat(64),
    manifest: {
      version: "toolproof-probe-activation@1.0.0",
      mode: "calibration",
      origin: "https://toolproof-rust.vercel.app",
      activeCommit: buildCommit,
      vercelProjectId: `prj_${"c".repeat(24)}`,
      guardInstanceId: "guard_fixture_service_001",
      guardInitializedCommit: "d".repeat(40),
      policyHash,
      scriptHash: "f".repeat(64),
      runnerContractHash: "1".repeat(64),
      continuationScriptHash: "3".repeat(64)
    },
    guard: {
      phase: input.pending === 0 ? "idle" : "single-inflight",
      claimedCalls: input.claimed,
      knownCalls: input.known,
      pendingCalls: input.pending,
      calibrationCalls: input.claimed,
      committedNanoUsd: input.claimed * 62_500_000,
      knownAccountedNanoUsd: input.known * 440_000,
      uncertainCalls: 0
    },
    guardIdentity: {
      guardInstanceId: "guard_fixture_service_001",
      policyHash,
      scriptHash: "f".repeat(64),
      initializedCommit: "d".repeat(40)
    }
  };
}

function request(cookie?: string, csrf?: string): Request {
  return new Request("https://toolproof-rust.vercel.app/api/probe/test", {
    method: "POST",
    headers: {
      origin: "https://toolproof-rust.vercel.app",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "user-agent": "Fixture Browser",
      "x-vercel-forwarded-for": "203.0.113.4",
      ...(cookie ? { cookie: `toolproof_probe_session=${cookie}` } : {}),
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

const INPUTS = {
  cart_get: {},
  order_review: {},
  cart_update: {
    operationId: "calibration_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  },
  checkout_request: { operationId: "calibration_request_001" }
} as const;

async function nativeExecution(
  environment: TrialEnvironment,
  toolName: CheckoutToolName,
  manifestHash: string
) {
  const input = INPUTS[toolName as keyof typeof INPUTS];
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
  const toolInput = INPUTS[tool as keyof typeof INPUTS];
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

describe("Probe service four-case lifecycle", () => {
  beforeEach(() => {
    serviceMocks.cache.clear();
    vi.clearAllMocks();
  });

  it("automatically seals and reveals four authentic non-scored fake-provider trials", async () => {
    const manifest = await liveManifest();
    const fixture = createProbeFixtureSynopsis(createCheckoutFixture());
    const start = await startProbeCalibrationSession(request(), {
      environment,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
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
      const native = await nativeExecution(activeTrial, tool, manifest.manifestHash);
      const postResetBoundary = await boundary(activeTrial, manifest);
      const capture = {
        runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
          runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
      activation: activation({ claimed: 4, known: 4, pending: 0 }),
      now: () => nowMs + 5_000
    });
    expect(revealed).toMatchObject({
      lane: "custom-probe-calibration",
      calibrationOnly: true,
      includedInBenchmark: false,
      caseCount: 4,
      passedCount: 4
    });
    expect(revealed.cases).toHaveLength(4);
    const repeatedReveal = await revealProbeCalibrationRun(request(cookie, csrf), continuation, {
      environment,
      activation: activation({ claimed: 4, known: 4, pending: 0 }),
      now: () => nowMs + 60_000
    });
    expect(canonicalJson(repeatedReveal)).toBe(canonicalJson(revealed));
    expect(Math.max(...continuationSizes)).toBeLessThan(1_800_000);
    expect(Math.max(...completionBodySizes)).toBeLessThan(3_500_000);
    await expect(verifyGate2CalibrationBundle(revealed)).resolves.toMatchObject({
      caseCount: 4,
      passedCount: 4
    });
    const tampered = structuredClone(revealed);
    (tampered.cases[0]!.evaluation as { expectedTool: string }).expectedTool = "order_review";
    await expect(verifyGate2CalibrationBundle(tampered)).rejects.toThrow();
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
    const start = await startProbeCalibrationSession(request(), {
      environment,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
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
      runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
          runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
    const start = await startProbeCalibrationSession(request(), {
      environment,
      activation: activation({ claimed: 0, known: 0, pending: 0 }),
      now: () => nowMs
    });
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
      runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
          runnerVersion: "toolproof-probe-client-runner@1.0.0",
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
