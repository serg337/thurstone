import { describe, expect, it, vi } from "vitest";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_AUTHORIZATION_SCRIPTS,
  createJudgeDemoAuthorizationKeyspace
} from "@/lib/judge/authorization-anchor.server";
import { judgeDemoDecisionResponseSchema, judgeDemoStatusSchema } from "@/lib/judge/contract";
import {
  JUDGE_DEMO_COLLATERAL_PROOF_VERSION,
  JUDGE_DEMO_CRITICAL_PATHS,
  JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256,
  JUDGE_DEMO_RECOVERY_PATHS,
  judgeDemoImmutableProjectionHash
} from "@/lib/judge/collateral-proof";
import { JUDGE_DEMO_DISPATCH_RECOVERY_SCRIPTS } from "@/lib/judge/dispatch-recovery.server";
import { createJudgeDemoEnvelope } from "@/lib/judge/envelope";
import { JUDGE_DEMO_STORE_SCRIPTS, createJudgeDemoStoreKeyspace } from "@/lib/judge/store.server";
import {
  JudgeDemoProviderError,
  decideJudgeDemoWithOpenAi
} from "@/lib/judge/openai-provider.server";
import {
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_VERSION
} from "@/lib/judge/presentation-binding.server";
import {
  JudgeDemoServiceError,
  decideJudgeDemo,
  readJudgeDemoStatus
} from "@/lib/judge/service.server";
import { PROBE_LEDGER_SCRIPTS, probeLedgerScriptHash } from "@/lib/probe/ledger";
import { gzipSync } from "node:zlib";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";

const commit = "a".repeat(40);
const initializedCommit = "f".repeat(40);
const guardInstanceId = "guard_judge_demo_0123456789";
const storeKeyspace = createJudgeDemoStoreKeyspace("tp:{webmcp26}:judge-demo:test");
const authorizationKeyspace = createJudgeDemoAuthorizationKeyspace("tp:{webmcp26}:judge-demo:test");
const nowMs = 1_788_000_000_000;

function environment(activeCommit = commit): Record<string, string> {
  return {
    TOOLPROOF_JUDGE_LANE_MODE: "enabled",
    TOOLPROOF_JUDGE_PRESENTATION_MODE: "predecessor",
    TOOLPROOF_JUDGE_ACTIVE_COMMIT: activeCommit,
    TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID: "prj_judge_demo",
    TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 7).toString("base64url"),
    TOOLPROOF_GUARD_INSTANCE_ID: guardInstanceId,
    TOOLPROOF_GUARD_INITIALIZED_COMMIT: initializedCommit,
    TOOLPROOF_COMMIT_SHA: activeCommit,
    OPENAI_API_KEY: "test-only-key",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_judge_demo",
    VERCEL_GIT_COMMIT_SHA: activeCommit,
    NODE_ENV: "production"
  };
}

function providerResponse() {
  return {
    id: "resp_judge_service",
    object: "response",
    model: PROBE_MODEL,
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: "call_judge_service",
        name: "cart_get",
        arguments: "{}"
      }
    ],
    usage: { input_tokens: 800, output_tokens: 40, total_tokens: 840 }
  };
}

class JudgeRedisFake {
  readonly policyHash: string;
  readonly scriptHash: string;
  readonly store: Record<string, string> = {};
  readonly authorizationStore: Record<string, string> = {};
  readonly issueFootprints: string[][] = [];
  guardStatus: "open" | "quarantined" = "open";
  claimed = 91;
  pending = 0;
  known = 91;
  uncertain = 0;
  knownActual = 20_000_000;
  uncertainUpper = 0;
  judge = 0;
  inflight = 0;
  sequence = 91;
  authorizationState: "none" | "issued" | "in-flight" | "known" | "uncertain" = "none";
  authorizationClaimsHash = "";
  authorizationSubjectHash = "";
  authorizationActorHash = "";
  actualNanoUsd = 0;
  failSealOnce = false;
  authorizationJti = "jti_judge_demo_recovery_0001";
  leaseExpiresAt = Math.floor(nowMs / 1_000) + 45;
  uncertainSettlementDigest = "";
  uncertainReason = "";
  writeEvalCount = 0;

  constructor(policyHash: string, scriptHash: string) {
    this.policyHash = policyHash;
    this.scriptHash = scriptHash;
  }

  private statusReply(): unknown[] {
    return [
      1,
      this.guardStatus,
      guardInstanceId,
      this.policyHash,
      this.scriptHash,
      this.claimed,
      this.claimed * PROBE_PER_CALL_RESERVATION_NANO_USD,
      this.pending,
      this.known,
      this.uncertain,
      this.knownActual,
      this.uncertainUpper,
      PROBE_POLICY_VERSION,
      PROBE_MODEL,
      PROBE_GLOBAL_CALL_LIMIT,
      PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      PROBE_PER_CALL_RESERVATION_NANO_USD,
      PROBE_MAX_CONCURRENCY,
      Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      initializedCommit,
      PROBE_PURPOSE_CALL_LIMITS.calibration,
      PROBE_PURPOSE_CALL_LIMITS.baseline,
      PROBE_PURPOSE_CALL_LIMITS.repair,
      PROBE_PURPOSE_CALL_LIMITS.revised,
      PROBE_PURPOSE_CALL_LIMITS.judge,
      17,
      48,
      2,
      24,
      this.judge,
      this.inflight,
      this.sequence,
      0,
      this.uncertain === 1 ? 1 : 0
    ];
  }

  async evalRo<TArgs extends unknown[], TResult = unknown>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TResult> {
    void keys;
    void args;
    if (script === PROBE_LEDGER_SCRIPTS.status) return this.statusReply() as TResult;
    if (script === JUDGE_DEMO_STORE_SCRIPTS.read) {
      if (!this.store.state) return [0, "EMPTY"] as TResult;
      return [
        1,
        this.store.version,
        this.store.state,
        this.store.app_commit,
        this.store.artifact_digest,
        this.store.sealed_artifact,
        this.store.projection_json ?? "",
        this.store.projection_digest ?? "",
        this.store.captured_at_ms,
        this.store.sealed_at_ms ?? ""
      ] as TResult;
    }
    if (script === JUDGE_DEMO_AUTHORIZATION_SCRIPTS.read) {
      if (!this.authorizationStore.version) return [0, "EMPTY"] as TResult;
      return [
        1,
        this.authorizationStore.version,
        this.authorizationStore.activation_hash,
        this.authorizationStore.app_commit,
        this.authorizationStore.envelope_hash,
        this.authorizationStore.artifact_digest,
        this.authorizationStore.sealed_artifact
      ] as TResult;
    }
    if (script === JUDGE_DEMO_DISPATCH_RECOVERY_SCRIPTS.read) {
      if (this.authorizationState === "in-flight") {
        return [
          1,
          "inflight",
          this.authorizationJti,
          this.leaseExpiresAt,
          Math.floor(nowMs / 1_000)
        ] as TResult;
      }
      if (this.authorizationState === "uncertain") {
        return [
          1,
          "uncertain",
          this.authorizationJti,
          this.uncertainSettlementDigest,
          this.uncertainReason,
          nowMs
        ] as TResult;
      }
      return [1, "empty"] as TResult;
    }
    throw new Error("unexpected_eval_ro_script");
  }

  async eval<TArgs extends unknown[], TResult = unknown>(
    script: string,
    _keys: string[],
    rawArgs: TArgs
  ): Promise<TResult> {
    this.writeEvalCount += 1;
    const args = rawArgs.map(String);
    if (script === PROBE_LEDGER_SCRIPTS.issue) {
      this.issueFootprints.push([...args]);
      if (this.authorizationState !== "none") {
        if (
          this.authorizationState === "issued" &&
          this.authorizationJti === args[3] &&
          this.authorizationClaimsHash === args[4] &&
          this.authorizationSubjectHash === args[6] &&
          this.authorizationActorHash === args[7]
        ) {
          return [
            2,
            "ISSUED_EXISTING",
            args[3],
            Math.floor(nowMs / 1_000),
            Math.floor(nowMs / 1_000) + 120
          ] as TResult;
        }
        return [0, "SUBJECT_ALREADY_CLAIMED"] as TResult;
      }
      this.authorizationState = "issued";
      this.authorizationJti = args[3]!;
      this.authorizationClaimsHash = args[4]!;
      this.authorizationSubjectHash = args[6]!;
      this.authorizationActorHash = args[7]!;
      return [
        1,
        "ISSUED_NEW",
        args[3],
        Math.floor(nowMs / 1_000),
        Math.floor(nowMs / 1_000) + 120
      ] as TResult;
    }
    if (script === JUDGE_DEMO_AUTHORIZATION_SCRIPTS.capture) {
      if (this.authorizationStore.version) return [2, "ANCHOR_EXISTING"] as TResult;
      Object.assign(this.authorizationStore, {
        version: args[0],
        activation_hash: args[1],
        app_commit: args[2],
        envelope_hash: args[3],
        artifact_digest: args[4],
        sealed_artifact: args[5]
      });
      return [1, "ANCHOR_CAPTURED"] as TResult;
    }
    if (script === PROBE_LEDGER_SCRIPTS.begin) {
      if (this.judge !== 0) return [0, "PURPOSE_CALL_LIMIT"] as TResult;
      this.judge = 1;
      this.claimed += 1;
      this.pending = 1;
      this.inflight = 1;
      this.sequence += 1;
      this.authorizationState = "in-flight";
      this.authorizationJti = args[6]!;
      this.leaseExpiresAt = Math.floor(nowMs / 1_000) + 45;
      return [
        1,
        "GRANTED_NEW",
        this.sequence,
        this.claimed,
        this.claimed * PROBE_PER_CALL_RESERVATION_NANO_USD,
        Math.floor(nowMs / 1_000) + 45
      ] as TResult;
    }
    if (script === PROBE_LEDGER_SCRIPTS.settleKnown) {
      if (this.authorizationState === "known") {
        return [2, "KNOWN_EXISTING", this.actualNanoUsd] as TResult;
      }
      this.pending = 0;
      this.inflight = 0;
      this.known += 1;
      this.actualNanoUsd = Number(args[3]);
      this.knownActual += this.actualNanoUsd;
      if (this.uncertain === 1) {
        this.uncertain = 0;
        this.uncertainUpper = 0;
        this.guardStatus = "open";
      }
      this.authorizationState = "known";
      return [
        1,
        "KNOWN_NEW",
        this.actualNanoUsd,
        this.claimed,
        this.claimed * PROBE_PER_CALL_RESERVATION_NANO_USD
      ] as TResult;
    }
    if (script === PROBE_LEDGER_SCRIPTS.settleUncertain) {
      if (this.authorizationState !== "in-flight") {
        return [0, "TOKEN_NOT_IN_FLIGHT", this.authorizationState] as TResult;
      }
      this.pending = 0;
      this.inflight = 0;
      this.uncertain = 1;
      this.uncertainUpper = PROBE_PER_CALL_RESERVATION_NANO_USD;
      this.guardStatus = "quarantined";
      this.authorizationState = "uncertain";
      this.uncertainSettlementDigest = args[4]!;
      this.uncertainReason = args[5]!;
      return [1, "UNCERTAIN_NEW", PROBE_PER_CALL_RESERVATION_NANO_USD] as TResult;
    }
    if (script === PROBE_LEDGER_SCRIPTS.reap) {
      if (this.authorizationState === "uncertain") return [2, "UNCERTAIN_EXISTING"] as TResult;
      if (this.authorizationState !== "in-flight") {
        return [0, "TOKEN_NOT_IN_FLIGHT", this.authorizationState] as TResult;
      }
      if (this.leaseExpiresAt > Math.floor(nowMs / 1_000)) {
        return [0, "LEASE_NOT_EXPIRED"] as TResult;
      }
      this.pending = 0;
      this.inflight = 0;
      this.uncertain = 1;
      this.uncertainUpper = PROBE_PER_CALL_RESERVATION_NANO_USD;
      this.guardStatus = "quarantined";
      this.authorizationState = "uncertain";
      this.uncertainSettlementDigest = args[4]!;
      this.uncertainReason = "lease_expired";
      return [1, "UNCERTAIN_NEW", PROBE_PER_CALL_RESERVATION_NANO_USD] as TResult;
    }
    if (script === JUDGE_DEMO_STORE_SCRIPTS.capture) {
      if (this.store.state) return [0, "CAPTURE_CONFLICT"] as TResult;
      Object.assign(this.store, {
        version: args[0],
        state: "captured",
        app_commit: args[1],
        artifact_digest: args[2],
        sealed_artifact: args[3],
        projection_json: args[4],
        projection_digest: args[5],
        captured_at_ms: args[6]
      });
      return [1, "CAPTURED"] as TResult;
    }
    if (script === JUDGE_DEMO_STORE_SCRIPTS.seal) {
      if (this.failSealOnce) {
        this.failSealOnce = false;
        throw new Error("transient_seal_failure");
      }
      this.store.state = "sealed";
      this.store.sealed_at_ms = args[3]!;
      return [1, "SEALED"] as TResult;
    }
    if (script === JUDGE_DEMO_STORE_SCRIPTS.recordUncertain) {
      if (this.store.state) return [0, "UNCERTAIN_CONFLICT"] as TResult;
      Object.assign(this.store, {
        version: args[0],
        state: "uncertain",
        app_commit: args[1],
        artifact_digest: args[2],
        sealed_artifact: args[3],
        captured_at_ms: args[4]
      });
      return [1, "UNCERTAIN_RECORDED"] as TResult;
    }
    throw new Error("unexpected_eval_script");
  }
}

async function fixture() {
  const redis = new JudgeRedisFake(await probePolicyHash(), await probeLedgerScriptHash());
  const fetchImplementation = vi.fn(
    async () =>
      new Response(JSON.stringify(providerResponse()), {
        status: 200,
        headers: { "x-request-id": "request_judge_service" }
      })
  );
  const decide = (input: Parameters<typeof decideJudgeDemoWithOpenAi>[0]) =>
    decideJudgeDemoWithOpenAi({ ...input, fetchImplementation });
  const dependencies = {
    environment: environment(),
    redis,
    storeKeyspace,
    authorizationKeyspace,
    decide,
    nowMs: () => nowMs
  } as const;
  const request = new Request("https://toolproof-rust.vercel.app/api/judge-demo", {
    method: "POST",
    headers: {
      "user-agent": "judge-service-test",
      "x-vercel-forwarded-for": "203.0.113.10"
    }
  });
  return { redis, fetchImplementation, dependencies, request };
}

async function successorEnvironment(input: {
  readonly predecessorCommit: string;
  readonly successorCommit: string;
  readonly predecessorReceiptDigest: string;
  readonly predecessorArtifactDigest: string;
  readonly predecessorStoredProjectionDigest: string;
  readonly predecessorCapturedAt: string;
}): Promise<Record<string, string>> {
  const predecessorEnvelope = await createJudgeDemoEnvelope(input.predecessorCommit);
  const successorEnvelope = await createJudgeDemoEnvelope(input.successorCommit);
  const gitTreeChanges = JUDGE_DEMO_RECOVERY_PATHS.map((path, index) => ({
    path,
    status: "M" as const,
    predecessorMode: "100644",
    successorMode: "100644",
    predecessorBlobOid: (index + 1).toString(16).padStart(40, "0"),
    successorBlobOid: (index + 101).toString(16).padStart(40, "0")
  }));
  const criticalFiles = JUDGE_DEMO_CRITICAL_PATHS.map((path, index) => {
    const predecessorBlobOid = (index + 301).toString(16).padStart(40, "0");
    return {
      path,
      predecessorBlobOid,
      successorBlobOid: JUDGE_DEMO_RECOVERY_PATHS.includes(path)
        ? (index + 601).toString(16).padStart(40, "0")
        : predecessorBlobOid,
      successorSha256: (index + 901).toString(16).padStart(64, "0")
    };
  });
  const immutableProjectionHash = await judgeDemoImmutableProjectionHash(predecessorEnvelope);
  const transitionPayload = {
    version: JUDGE_DEMO_COLLATERAL_PROOF_VERSION,
    kind: "sealed-reader-compatibility-recovery" as const,
    ordinal: 0,
    predecessorCommit: input.predecessorCommit,
    successorCommit: input.successorCommit,
    predecessorEnvelopeHash: predecessorEnvelope.envelopeHash,
    successorEnvelopeHash: successorEnvelope.envelopeHash,
    rootEvidenceCommit: input.predecessorCommit,
    rootEnvelopeHash: predecessorEnvelope.envelopeHash,
    rootReceiptDigest: input.predecessorReceiptDigest,
    rootArtifactDigest: input.predecessorArtifactDigest,
    rootStoredProjectionDigest: input.predecessorStoredProjectionDigest,
    rootCapturedAt: input.predecessorCapturedAt,
    immutableProjectionHash,
    firstParentChainHash: await canonicalSha256([input.predecessorCommit, input.successorCommit]),
    gitTreeProjectionHash: await canonicalSha256(gitTreeChanges),
    criticalProjectionHash: await canonicalSha256(criticalFiles),
    dependencyProjectionHash: "d".repeat(64),
    recoveryContract: {
      failureMode: "redis-json-auto-deserialization" as const,
      acceptedProjectionRepresentations: ["json-string" as const, "preparsed-json-value" as const],
      strictSchemaValidationPreserved: true as const,
      projectionDigestValidationPreserved: true as const,
      permanentReceiptMutation: "none" as const
    },
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  };
  const transition = {
    ...transitionPayload,
    proofHash: await canonicalSha256(transitionPayload)
  };
  const bindingPayload = {
    version: JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
    rootEvidenceCommit: input.predecessorCommit,
    activeCommit: input.successorCommit,
    rootEnvelopeHash: predecessorEnvelope.envelopeHash,
    activeEnvelopeHash: successorEnvelope.envelopeHash,
    rootReceiptDigest: input.predecessorReceiptDigest,
    rootArtifactDigest: input.predecessorArtifactDigest,
    rootStoredProjectionDigest: input.predecessorStoredProjectionDigest,
    rootCapturedAt: input.predecessorCapturedAt,
    immutableProjectionHash,
    transitions: [transition],
    gitProofPackSha256: "e".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  };
  const lineageHash = await canonicalSha256(bindingPayload);
  const binding = { ...bindingPayload, lineageHash, bindingHash: lineageHash };
  return {
    ...environment(input.successorCommit),
    TOOLPROOF_JUDGE_PRESENTATION_MODE: "successor",
    [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: gzipSync(Buffer.from(canonicalJson(binding))).toString(
      "base64url"
    ),
    [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: binding.bindingHash
  };
}

describe("single-use signed-out judge demo service", () => {
  it("spends judge once, preserves an encrypted permanent receipt, and serves archive thereafter", async () => {
    const { redis, fetchImplementation, dependencies, request } = await fixture();
    await expect(readJudgeDemoStatus(dependencies)).resolves.toMatchObject({
      status: "available",
      remainingModelCalls: 1,
      projection: null
    });

    const fresh = await decideJudgeDemo(request, dependencies);
    expect(fresh).toMatchObject({
      status: "fresh",
      inferencePerformed: true,
      projection: {
        evidenceClass: "non-scored-model-selection",
        naturalLanguageRequest: "Which current cart lines have a quantity greater than one?",
        decision: { kind: "call", tool: "cart_get", arguments: {} },
        nativeExecutionIncluded: false
      }
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(redis).toMatchObject({
      judge: 1,
      claimed: 92,
      known: 92,
      pending: 0,
      uncertain: 0
    });
    expect(redis.store.state).toBe("sealed");
    expect(redis.store.sealed_artifact).toMatch(/^tpse1\./u);
    expect(redis.store.sealed_artifact).not.toContain("resp_judge_service");
    expect(redis.store.projection_json).not.toContain("authorizationJti");
    expect(redis.store.projection_json).not.toContain("rawResponseBytes");

    const archived = await decideJudgeDemo(request, dependencies);
    expect(archived.status).toBe("archived");
    expect(archived.inferencePerformed).toBe(false);
    expect(canonicalJson(archived.projection)).toBe(canonicalJson(fresh.projection));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await expect(readJudgeDemoStatus(dependencies)).resolves.toMatchObject({
      status: "sealed",
      remainingModelCalls: 0,
      projection: fresh.projection
    });
  });

  it("quarantines an admitted uncertain dispatch and never retries it", async () => {
    const { redis, dependencies, request } = await fixture();
    const uncertainProvider = vi.fn(
      async (input: Parameters<typeof decideJudgeDemoWithOpenAi>[0]) => {
        await input.beforeDispatch();
        throw new JudgeDemoProviderError("provider_dispatch_uncertain", "after_dispatch_uncertain");
      }
    );
    const uncertainDependencies = { ...dependencies, decide: uncertainProvider };
    await expect(decideJudgeDemo(request, uncertainDependencies)).rejects.toEqual(
      expect.objectContaining<Partial<JudgeDemoServiceError>>({
        code: "provider_dispatch_uncertain",
        inferencePerformed: true
      })
    );
    expect(redis).toMatchObject({
      judge: 1,
      pending: 0,
      uncertain: 1,
      guardStatus: "quarantined"
    });
    expect(redis.store.state).toBe("uncertain");
    await expect(decideJudgeDemo(request, uncertainDependencies)).rejects.toMatchObject({
      code: "judge_demo_dispatch_uncertain_no_retry",
      inferencePerformed: true
    });
    expect(uncertainProvider).toHaveBeenCalledTimes(1);
    await expect(readJudgeDemoStatus(uncertainDependencies)).resolves.toMatchObject({
      status: "uncertain",
      remainingModelCalls: 0,
      projection: null
    });
  });

  it("recovers a captured known receipt after response-finalization loss without another call", async () => {
    const { redis, fetchImplementation, dependencies, request } = await fixture();
    redis.failSealOnce = true;
    await expect(decideJudgeDemo(request, dependencies)).rejects.toMatchObject({
      inferencePerformed: true
    });
    expect(redis.store.state).toBe("captured");
    expect(redis.authorizationState).toBe("known");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await expect(readJudgeDemoStatus(dependencies)).resolves.toMatchObject({
      status: "recoverable",
      remainingModelCalls: 0,
      projection: { receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) }
    });

    const recovered = await decideJudgeDemo(request, dependencies);
    expect(recovered).toMatchObject({ status: "archived", inferencePerformed: false });
    expect(redis.store.state).toBe("sealed");
    expect(redis.authorizationState).toBe("known");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("redacts unexpected failures on both sides of the dispatch boundary", async () => {
    const secretBearingMessage = "redis://user:password@example.invalid/internal";
    const before = await fixture();
    await expect(
      decideJudgeDemo(before.request, {
        ...before.dependencies,
        decide: async () => {
          throw new Error(secretBearingMessage);
        }
      })
    ).rejects.toMatchObject({
      code: "judge_demo_before_dispatch_failed",
      inferencePerformed: false
    });
    expect(before.redis).toMatchObject({ judge: 0, claimed: 91, pending: 0, uncertain: 0 });

    const after = await fixture();
    await expect(
      decideJudgeDemo(after.request, {
        ...after.dependencies,
        decide: async (input) => {
          await input.beforeDispatch();
          throw new Error(secretBearingMessage);
        }
      })
    ).rejects.toMatchObject({
      code: "judge_demo_after_dispatch_failed",
      inferencePerformed: true
    });
    expect(after.redis).toMatchObject({
      judge: 1,
      claimed: 92,
      pending: 0,
      uncertain: 1,
      guardStatus: "quarantined"
    });
    await expect(readJudgeDemoStatus(after.dependencies)).resolves.toMatchObject({
      status: "uncertain",
      reason: expect.not.stringContaining(secretBearingMessage)
    });
  });

  it("never redispatches an empty-store orphan and reaps it only after its lease expires", async () => {
    const { redis, fetchImplementation, dependencies, request } = await fixture();
    Object.assign(redis, {
      judge: 1,
      claimed: 92,
      pending: 1,
      known: 91,
      inflight: 1,
      sequence: 92,
      authorizationState: "in-flight" as const,
      leaseExpiresAt: Math.floor(nowMs / 1_000) + 10
    });
    await expect(readJudgeDemoStatus(dependencies)).resolves.toMatchObject({
      status: "running",
      remainingModelCalls: 0,
      projection: null
    });
    await expect(decideJudgeDemo(request, dependencies)).rejects.toMatchObject({
      code: "judge_demo_running",
      inferencePerformed: true
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(redis.store.state).toBeUndefined();

    redis.leaseExpiresAt = Math.floor(nowMs / 1_000) - 1;
    await expect(readJudgeDemoStatus(dependencies)).resolves.toMatchObject({
      status: "uncertain",
      remainingModelCalls: 0,
      projection: null
    });
    expect(redis).toMatchObject({
      pending: 0,
      inflight: 0,
      uncertain: 1,
      authorizationState: "uncertain",
      guardStatus: "quarantined"
    });
    expect(redis.store.state).toBe("uncertain");
    expect(redis.store.sealed_artifact).toMatch(/^tpse1\./u);
    await expect(decideJudgeDemo(request, dependencies)).rejects.toMatchObject({
      code: "judge_demo_dispatch_uncertain_no_retry",
      inferencePerformed: true
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("replays a sealed predecessor only through an exact provider-free recovery lineage", async () => {
    const { redis, fetchImplementation, dependencies, request } = await fixture();
    const fresh = await decideJudgeDemo(request, dependencies);
    const successorCommit = "9".repeat(40);
    const unbound = {
      ...dependencies,
      environment: environment(successorCommit)
    };
    await expect(readJudgeDemoStatus(unbound)).resolves.toMatchObject({
      status: "unavailable",
      projection: null
    });

    const bound = {
      ...dependencies,
      environment: await successorEnvironment({
        predecessorCommit: commit,
        successorCommit,
        predecessorReceiptDigest: fresh.projection.receiptDigest,
        predecessorArtifactDigest: redis.store.artifact_digest!,
        predecessorStoredProjectionDigest: await canonicalSha256(fresh.projection),
        predecessorCapturedAt: fresh.projection.capturedAt
      })
    };
    const wrongSuccessor = {
      ...bound,
      environment: {
        ...bound.environment,
        TOOLPROOF_JUDGE_ACTIVE_COMMIT: "8".repeat(40),
        TOOLPROOF_COMMIT_SHA: "8".repeat(40),
        VERCEL_GIT_COMMIT_SHA: "8".repeat(40)
      }
    };
    await expect(readJudgeDemoStatus(wrongSuccessor)).resolves.toMatchObject({
      status: "unavailable",
      projection: null
    });
    const redisBytesBeforeReplay = canonicalJson(redis);
    const writeEvalCountBeforeReplay = redis.writeEvalCount;
    const redisStateBeforeReplay = JSON.parse(redisBytesBeforeReplay) as unknown;
    const status = await readJudgeDemoStatus(bound);
    expect(status).toMatchObject({
      status: "sealed",
      remainingModelCalls: 0,
      projection: {
        appCommit: successorCommit,
        evidenceAppCommit: commit,
        evidenceManifestHash: fresh.projection.manifestHash,
        presentationBinding: {
          rootEvidenceCommit: commit,
          activeCommit: successorCommit,
          rootReceiptDigest: fresh.projection.receiptDigest,
          rootArtifactDigest: redis.store.artifact_digest,
          rootStoredProjectionDigest: await canonicalSha256(fresh.projection),
          transitions: [{ kind: "sealed-reader-compatibility-recovery", ordinal: 0 }],
          providerCallsPerformed: 0,
          storeWritesPerformed: 0,
          replayOnly: true
        }
      }
    });
    if (status.status !== "sealed") throw new Error("expected_sealed_successor");
    const publicBinding = status.projection.presentationBinding!;
    const rebrandCommit = "7".repeat(40);
    const rebrandEnvelopeHash = "6".repeat(64);
    const publicRebrandTransition = {
      kind: "presentation-rebrand" as const,
      ordinal: 1,
      predecessorCommit: publicBinding.activeCommit,
      successorCommit: rebrandCommit,
      predecessorEnvelopeHash: publicBinding.activeEnvelopeHash,
      successorEnvelopeHash: rebrandEnvelopeHash,
      firstParentChainHash: "1".repeat(64),
      gitTreeProjectionHash: "2".repeat(64),
      criticalProjectionHash: "3".repeat(64),
      dependencyProjectionHash: "4".repeat(64),
      proofHash: "5".repeat(64),
      ciTimeoutValidation: null,
      rebrandVerification: {
        productNameBefore: "ToolProof" as const,
        productNameAfter: "Thurstone" as const,
        adoptedAt: "2026-08-29" as const,
        legacyProtocolNamespace: "toolproof" as const,
        predecessorBindingHash: publicBinding.bindingHash,
        predecessorBindingArtifactSha256: JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256,
        protocolExtensionCommit: "8".repeat(40),
        protocolProjectionHash: "6".repeat(64),
        brandingProjectionHash: "7".repeat(64),
        preservedArtifactsHash: "8".repeat(64),
        gate6PresentationProofHash: "9".repeat(64),
        gate6CriticalProjectionHash: "a".repeat(64),
        scoredCallsPerformed: 0 as const
      },
      providerCallsPerformed: 0 as const,
      storeWritesPerformed: 0 as const,
      replayOnly: true as const
    };
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...status,
        projection: {
          ...status.projection,
          appCommit: rebrandCommit,
          presentationBinding: {
            ...publicBinding,
            version: "toolproof-judge-demo-public-presentation-lineage@3.0.0",
            activeCommit: rebrandCommit,
            activeEnvelopeHash: rebrandEnvelopeHash,
            transitions: [publicBinding.transitions[0]!, publicRebrandTransition]
          }
        }
      })
    ).not.toThrow();
    const integrityCommit = "5".repeat(40);
    const integrityEnvelopeHash = "4".repeat(64);
    const publicIntegrityTransition = {
      kind: "invocation-integrity" as const,
      ordinal: 2,
      predecessorCommit: rebrandCommit,
      successorCommit: integrityCommit,
      predecessorEnvelopeHash: rebrandEnvelopeHash,
      successorEnvelopeHash: integrityEnvelopeHash,
      firstParentChainHash: "1".repeat(64),
      gitTreeProjectionHash: "2".repeat(64),
      criticalProjectionHash: "3".repeat(64),
      dependencyProjectionHash: "4".repeat(64),
      proofHash: "5".repeat(64),
      ciTimeoutValidation: null,
      invocationIntegrityVerification: {
        predecessorBindingHash: "6".repeat(64),
        predecessorBindingArtifactSha256: "7".repeat(64),
        predecessorEnvelopeHash: rebrandEnvelopeHash,
        amendmentCommit: "8".repeat(40),
        amendmentSha256: "9".repeat(64),
        protocolExtensionCommit: "a".repeat(40),
        protocolProjectionHash: "b".repeat(64),
        implementationProjectionHash: "c".repeat(64),
        contractSourceSha256: "d".repeat(64),
        semanticEvidenceBuildCommit: "e".repeat(40),
        semanticPackageDigest: "f".repeat(64),
        semanticBaselinePassed: 23 as const,
        semanticRevisedPassed: 23 as const,
        semanticPossible: 24 as const,
        semanticNoMeasuredImprovement: true as const,
        modelCallsPerformed: 0 as const,
        scoredCallsPerformed: 0 as const
      },
      providerCallsPerformed: 0 as const,
      storeWritesPerformed: 0 as const,
      replayOnly: true as const
    };
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...status,
        projection: {
          ...status.projection,
          appCommit: integrityCommit,
          presentationBinding: {
            ...publicBinding,
            version: "toolproof-judge-demo-public-presentation-lineage@4.0.0",
            activeCommit: integrityCommit,
            activeEnvelopeHash: integrityEnvelopeHash,
            activeImmutableProjectionHash: "f".repeat(64),
            transitions: [
              publicBinding.transitions[0]!,
              publicRebrandTransition,
              publicIntegrityTransition
            ]
          }
        }
      })
    ).not.toThrow();
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...status,
        projection: {
          ...status.projection,
          presentationBinding: { ...publicBinding, rootCapturedAt: "2026-01-01T00:00:00.000Z" }
        }
      })
    ).toThrow();
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...status,
        projection: {
          ...status.projection,
          presentationBinding: {
            ...publicBinding,
            transitions: [
              { ...publicBinding.transitions[0]!, predecessorEnvelopeHash: "0".repeat(64) }
            ]
          }
        }
      })
    ).toThrow();
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...status,
        projection: {
          ...status.projection,
          presentationBinding: {
            ...publicBinding,
            transitions: [
              { ...publicBinding.transitions[0]!, successorEnvelopeHash: "0".repeat(64) }
            ]
          }
        }
      })
    ).toThrow();
    expect(status.projection.manifestHash).not.toBe(status.projection.evidenceManifestHash);
    const archived = await decideJudgeDemo(request, bound);
    expect(archived).toMatchObject({
      status: "archived",
      inferencePerformed: false,
      projection: { appCommit: successorCommit, evidenceAppCommit: commit }
    });
    expect(canonicalJson(redis)).toBe(redisBytesBeforeReplay);
    expect(redis.writeEvalCount).toBe(writeEvalCountBeforeReplay);
    expect(JSON.parse(canonicalJson(redis))).toEqual(redisStateBeforeReplay);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects contradictory public status and decision combinations", async () => {
    const { dependencies, request } = await fixture();
    const fresh = await decideJudgeDemo(request, dependencies);
    const common = {
      version: "toolproof-judge-demo-api@1.0.0",
      lane: "signed-out-fixed-read-only-judge-demo",
      sourceFixed: true,
      arbitraryPromptAccepted: false,
      inferencePerformed: false,
      reason: "test"
    };
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...common,
        status: "available",
        remainingModelCalls: 0,
        projection: null
      })
    ).toThrow();
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...common,
        status: "recoverable",
        remainingModelCalls: 0,
        projection: null
      })
    ).toThrow();
    expect(() =>
      judgeDemoStatusSchema.parse({
        ...common,
        status: "sealed",
        remainingModelCalls: 0,
        projection: null
      })
    ).toThrow();
    expect(() =>
      judgeDemoDecisionResponseSchema.parse({ ...fresh, inferencePerformed: false })
    ).toThrow();
    expect(() =>
      judgeDemoDecisionResponseSchema.parse({
        ...fresh,
        status: "archived",
        inferencePerformed: true
      })
    ).toThrow();
  });

  it("never turns replay-only successor configuration into a fresh provider allocation", async () => {
    const { redis, fetchImplementation, dependencies, request } = await fixture();
    const replayOnly = {
      ...dependencies,
      environment: {
        ...dependencies.environment,
        TOOLPROOF_JUDGE_PRESENTATION_MODE: "successor",
        [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: "invalid_but_configured",
        [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: "f".repeat(64)
      }
    };
    await expect(readJudgeDemoStatus(replayOnly)).resolves.toMatchObject({
      status: "unavailable",
      remainingModelCalls: 0,
      projection: null
    });
    await expect(decideJudgeDemo(request, replayOnly)).rejects.toMatchObject({
      code: "judge_demo_replay_predecessor_missing",
      inferencePerformed: false
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(redis).toMatchObject({ judge: 0, claimed: 91, pending: 0, uncertain: 0 });
  });

  it("anchors one global authorization footprint across a concurrent public burst", async () => {
    const { redis, dependencies, request } = await fixture();
    let releaseFetch!: () => void;
    let markFetchStarted!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const delayedFetch = vi.fn(async () => {
      markFetchStarted();
      await fetchGate;
      return new Response(JSON.stringify(providerResponse()), { status: 200 });
    });
    const burstDependencies = {
      ...dependencies,
      decide: (input: Parameters<typeof decideJudgeDemoWithOpenAi>[0]) =>
        decideJudgeDemoWithOpenAi({ ...input, fetchImplementation: delayedFetch })
    };
    const winner = decideJudgeDemo(request, burstDependencies);
    await fetchStarted;
    const otherActor = new Request(request.url, {
      method: "POST",
      headers: {
        "user-agent": "different-public-judge",
        "x-vercel-forwarded-for": "203.0.113.99"
      }
    });
    await expect(decideJudgeDemo(otherActor, burstDependencies)).rejects.toMatchObject({
      code: "judge_demo_running",
      inferencePerformed: true
    });
    releaseFetch();
    await expect(winner).resolves.toMatchObject({ status: "fresh", inferencePerformed: true });

    expect(delayedFetch).toHaveBeenCalledTimes(1);
    expect(redis.authorizationStore.sealed_artifact).toMatch(/^tpse1\./u);
    expect(redis.issueFootprints.length).toBe(1);
    expect(new Set(redis.issueFootprints.map((args) => args[3])).size).toBe(1);
    expect(new Set(redis.issueFootprints.map((args) => args[6])).size).toBe(1);
    expect(new Set(redis.issueFootprints.map((args) => args[7])).size).toBe(1);
  });

  it("recovers the same pre-begin anchor and lets an expired anchor fail terminally", async () => {
    const first = await fixture();
    const beforeDispatchFailure = {
      ...first.dependencies,
      decide: async () => {
        throw new Error("pre-begin test failure");
      }
    };
    await expect(decideJudgeDemo(first.request, beforeDispatchFailure)).rejects.toMatchObject({
      code: "judge_demo_before_dispatch_failed",
      inferencePerformed: false
    });
    const anchoredDigest = first.redis.authorizationStore.artifact_digest;
    const recovered = await decideJudgeDemo(first.request, first.dependencies);
    expect(recovered).toMatchObject({ status: "fresh", inferencePerformed: true });
    expect(first.redis.authorizationStore.artifact_digest).toBe(anchoredDigest);
    expect(first.redis.issueFootprints.length).toBe(2);
    expect(first.redis.issueFootprints[1]!.slice(3, 8)).toEqual(
      first.redis.issueFootprints[0]!.slice(3, 8)
    );

    const expired = await fixture();
    let clock = nowMs;
    const expiringDependencies = { ...expired.dependencies, nowMs: () => clock };
    await expect(
      decideJudgeDemo(expired.request, {
        ...expiringDependencies,
        decide: async () => {
          throw new Error("pre-begin test failure");
        }
      })
    ).rejects.toMatchObject({ code: "judge_demo_before_dispatch_failed" });
    const expiredDigest = expired.redis.authorizationStore.artifact_digest;
    clock += 121_000;
    await expect(decideJudgeDemo(expired.request, expiringDependencies)).rejects.toMatchObject({
      code: "judge_demo_authorization_anchor_expired",
      inferencePerformed: false
    });
    expect(expired.redis.authorizationStore.artifact_digest).toBe(expiredDigest);
    expect(expired.redis.issueFootprints).toHaveLength(1);
    await expect(readJudgeDemoStatus(expiringDependencies)).resolves.toMatchObject({
      status: "unavailable",
      remainingModelCalls: 0
    });
  });
});
