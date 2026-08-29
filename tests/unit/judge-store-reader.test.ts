import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_LANE,
  judgeDemoProjectionSchema,
  type JudgeDemoProjection
} from "@/lib/judge/contract";
import { createJudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  JUDGE_DEMO_OPENAI_ENDPOINT,
  JUDGE_DEMO_PROVIDER_RECEIPT_VERSION,
  judgeDemoProviderKnownReceiptSchema
} from "@/lib/judge/openai-provider.server";
import {
  JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION,
  JUDGE_DEMO_STORE_SCRIPTS,
  JUDGE_DEMO_STORE_VERSION,
  judgeDemoReceiptArtifactSchema,
  readJudgeDemoStore,
  type JudgeDemoReceiptArtifact,
  type JudgeDemoStoreRedis
} from "@/lib/judge/store.server";
import { PROBE_MODEL, PROBE_POLICY_VERSION, PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { sealProbeArtifact } from "@/lib/probe/server-artifact";

const appCommit = "a".repeat(40);
const hash = (character: string) => character.repeat(64);
const capturedAt = "2026-08-29T14:24:37.377Z";
const artifactSecret = Buffer.alloc(32, 17).toString("base64url");

interface StoredFixture {
  readonly artifact: JudgeDemoReceiptArtifact;
  readonly artifactDigest: string;
  readonly projection: JudgeDemoProjection;
  readonly projectionDigest: string;
  readonly sealedArtifact: string;
}

async function fixture(): Promise<StoredFixture> {
  const envelope = await createJudgeDemoEnvelope(appCommit);
  const usage = {
    inputTokens: 10,
    outputTokens: 2,
    totalTokens: 12,
    accountedNanoUsd: 1_000,
    costBasis: "frozen-list-price-plus-10pct-uplift" as const
  };
  const providerReceipt = judgeDemoProviderKnownReceiptSchema.parse({
    version: JUDGE_DEMO_PROVIDER_RECEIPT_VERSION,
    provider: "OpenAI",
    endpoint: JUDGE_DEMO_OPENAI_ENDPOINT,
    model: PROBE_MODEL,
    purpose: "judge",
    envelopeHash: envelope.envelopeHash,
    requestId: null,
    responseId: "response_unit_store_reader",
    responseStatus: "completed",
    requestBodyBytes: "{}",
    requestBodyHash: hash("1"),
    rawResponseBytes: "{}",
    rawResponseHash: hash("2"),
    rawResponse: {},
    outputText: null,
    decision: null,
    decisionError: "no_tool_call",
    refusal: null,
    toolCallId: null,
    rawArgumentsBytes: null,
    toolCallCount: 0,
    usage,
    usageHash: hash("3"),
    promptHash: hash("4"),
    settingsHash: envelope.runner.settingsHash,
    runnerHash: envelope.runnerHash,
    toolDefinitionsHash: envelope.runner.toolDefinitionsHash,
    noCallSchemaHash: envelope.runner.noCallSchemaHash,
    transportBindingHash: envelope.runner.transport.bindingHash,
    modelInputHash: hash("5"),
    dispatchedAt: capturedAt,
    completedAt: capturedAt,
    durationMs: 0,
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  });
  const projectionPayload = {
    version: "toolproof-judge-demo-public-receipt@1.0.0" as const,
    lane: JUDGE_DEMO_LANE,
    evidenceClass: "non-scored-model-selection" as const,
    sourceFixed: true as const,
    arbitraryPromptAccepted: false as const,
    globalProviderCall: 1 as const,
    nativeExecutionIncluded: false as const,
    replayPolicy: "archived-decision-may-be-executed-locally-without-model-call" as const,
    appCommit,
    evidenceAppCommit: appCommit,
    caseId: "judge_multi_quantity_lines_v1" as const,
    naturalLanguageRequest: "Which current cart lines have a quantity greater than one?" as const,
    fixtureHash: envelope.fixtureHash,
    manifestHash: envelope.liveManifest.manifestHash,
    evidenceManifestHash: envelope.liveManifest.manifestHash,
    envelopeHash: envelope.envelopeHash,
    runnerHash: envelope.runnerHash,
    provider: "OpenAI" as const,
    model: PROBE_MODEL,
    providerResponseHash: providerReceipt.rawResponseHash,
    requestBodyHash: providerReceipt.requestBodyHash,
    usageHash: providerReceipt.usageHash,
    usage,
    decision: null,
    decisionError: "no_tool_call",
    responseStatus: "completed",
    capturedAt,
    presentationBinding: null
  };
  const projection = judgeDemoProjectionSchema.parse({
    ...projectionPayload,
    receiptDigest: await canonicalSha256(projectionPayload)
  });
  const artifact = judgeDemoReceiptArtifactSchema.parse({
    version: JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION,
    activationHash: hash("6"),
    appCommit,
    envelope,
    authorization: {
      claims: {
        version: 1,
        policyVersion: PROBE_POLICY_VERSION,
        policyHash: hash("7"),
        guardInstanceId: "guard_store_reader_unit_0001",
        audience: PROBE_PRODUCTION_ORIGIN,
        origin: PROBE_PRODUCTION_ORIGIN,
        model: PROBE_MODEL,
        buildCommit: appCommit,
        activationHash: hash("6"),
        sessionHash: hash("8"),
        jti: "jti_store_reader_unit_0001",
        purpose: "judge",
        runId: envelope.runId,
        caseId: envelope.caseId,
        trialId: envelope.trialId,
        fixtureHash: envelope.fixtureHash,
        requestHash: hash("9"),
        manifestHash: envelope.liveManifest.manifestHash,
        settingsHash: envelope.runner.settingsHash,
        envelopeHash: envelope.envelopeHash,
        issuedAt: 1_788_000_000,
        expiresAt: 1_788_000_120
      },
      claimsHash: hash("a")
    },
    providerReceipt,
    settlement: {
      actualNanoUsd: usage.accountedNanoUsd,
      providerResponseHash: providerReceipt.rawResponseHash,
      usageHash: providerReceipt.usageHash,
      settlementDigest: hash("b")
    },
    capturedAt
  });
  return {
    artifact,
    artifactDigest: await canonicalSha256(artifact),
    projection,
    projectionDigest: await canonicalSha256(projection),
    sealedArtifact: sealProbeArtifact("judge_demo_receipt", artifact, artifactSecret)
  };
}

class ReaderRedis implements JudgeDemoStoreRedis {
  readonly calls = { read: 0, write: 0 };

  constructor(
    private readonly stored: StoredFixture,
    private readonly projectionValue: unknown,
    private readonly projectionDigest = stored.projectionDigest
  ) {}

  async eval(): Promise<unknown> {
    this.calls.write += 1;
    throw new Error("unexpected_write");
  }

  async evalRo(script: string): Promise<unknown> {
    this.calls.read += 1;
    expect(script).toBe(JUDGE_DEMO_STORE_SCRIPTS.read);
    return [
      1,
      JUDGE_DEMO_STORE_VERSION,
      "sealed",
      appCommit,
      this.stored.artifactDigest,
      this.stored.sealedArtifact,
      this.projectionValue,
      this.projectionDigest,
      String(Date.parse(capturedAt)),
      String(Date.parse(capturedAt) + 50)
    ];
  }
}

async function readWith(projectionValue: unknown, projectionDigest?: string) {
  const stored = await fixture();
  return readJudgeDemoStore(
    new ReaderRedis(stored, projectionValue, projectionDigest ?? stored.projectionDigest),
    { artifactSecret }
  );
}

describe("judge demo store projection reader", () => {
  it("accepts the raw JSON string returned when Redis deserialization is disabled", async () => {
    const stored = await fixture();
    await expect(
      readJudgeDemoStore(new ReaderRedis(stored, canonicalJson(stored.projection)), {
        artifactSecret
      })
    ).resolves.toMatchObject({ state: "sealed", projection: stored.projection });
  });

  it("accepts the plain object returned by Upstash automatic deserialization", async () => {
    const stored = await fixture();
    await expect(
      readJudgeDemoStore(new ReaderRedis(stored, structuredClone(stored.projection)), {
        artifactSecret
      })
    ).resolves.toMatchObject({ state: "sealed", projection: stored.projection });
  });

  it("returns canonically identical records from both transports without a store write", async () => {
    const stored = await fixture();
    const stringRedis = new ReaderRedis(stored, canonicalJson(stored.projection));
    const objectRedis = new ReaderRedis(stored, structuredClone(stored.projection));
    const [fromString, fromObject] = await Promise.all([
      readJudgeDemoStore(stringRedis, { artifactSecret }),
      readJudgeDemoStore(objectRedis, { artifactSecret })
    ]);

    expect(canonicalJson(fromObject)).toBe(canonicalJson(fromString));
    expect(stringRedis.calls).toEqual({ read: 1, write: 0 });
    expect(objectRedis.calls).toEqual({ read: 1, write: 0 });
  });

  it.each([
    ["null", null],
    ["array", []],
    ["number", 7],
    ["boolean", true],
    ["serialized null", "null"],
    ["serialized array", "[]"],
    ["serialized number", "7"],
    ["serialized string", '"scalar"'],
    ["malformed JSON", "not-json"]
  ])("rejects a %s projection transport value", async (_label, value) => {
    await expect(readWith(value)).rejects.toMatchObject({
      code: "judge_store_projection_invalid"
    });
  });

  it("rejects a non-plain object before schema validation", async () => {
    const stored = await fixture();
    const nonPlain = Object.assign(new (class StoredProjection {})(), stored.projection);
    await expect(
      readJudgeDemoStore(new ReaderRedis(stored, nonPlain), { artifactSecret })
    ).rejects.toMatchObject({
      code: "judge_store_projection_invalid"
    });
  });

  it("preserves strict projection-schema rejection for unexpected fields", async () => {
    const stored = await fixture();
    const withUnexpectedField = { ...stored.projection, unexpected: true };
    await expect(
      readJudgeDemoStore(new ReaderRedis(stored, withUnexpectedField), { artifactSecret })
    ).rejects.toThrow(/unrecognized key/iu);
  });

  it("preserves the canonical projection-digest check for object transport", async () => {
    const stored = await fixture();
    await expect(
      readJudgeDemoStore(new ReaderRedis(stored, stored.projection, hash("f")), { artifactSecret })
    ).rejects.toMatchObject({
      code: "judge_store_artifact_mismatch"
    });
  });
});
