import "server-only";

import { createHash } from "node:crypto";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  beginProbeCall,
  issueProbeAuthorization,
  settleProbeCallKnown,
  settleProbeCallUncertain
} from "@/lib/probe/ledger";
import { readScoredGuardContext } from "@/lib/scored/guard.server";
import {
  ScoredProviderError,
  decideScoredWithOpenAi,
  verifyScoredProviderKnownReceipt,
  type ScoredProviderKnownReceipt
} from "@/lib/scored/openai-provider.server";
import { verifyExpectationFreeScoredEnvelope } from "@/lib/scored/envelope";
import {
  SUCCESSOR_EVAL_TARGET_CASE_ID,
  SUCCESSOR_EVAL_VERSION,
  assertSuccessorEnvelopeCase,
  successorEvalDecisionRequestSchema,
  successorProtocolHash
} from "@/lib/successor-eval/contract";
import {
  putSuccessorProviderReceipt,
  readSuccessorProviderReceipt
} from "@/lib/successor-eval/store.server";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export class SuccessorEvalServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly inferencePerformed = false
  ) {
    super(code);
    this.name = "SuccessorEvalServiceError";
  }
}

function required(environment: EnvironmentLike, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new SuccessorEvalServiceError("successor_eval_configuration_missing", 503);
  return value;
}

function appCommit(environment: EnvironmentLike): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  const configured = environment.TOOLPROOF_COMMIT_SHA?.trim() ?? "";
  const value = vercel || configured;
  if (!/^[a-f0-9]{40}$/u.test(value) || (vercel && configured && vercel !== configured)) {
    throw new SuccessorEvalServiceError("successor_eval_commit_invalid", 503);
  }
  return value;
}

function rawSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function settleKnown(input: {
  readonly receipt: ScoredProviderKnownReceipt;
  readonly jti: string;
  readonly guard: Awaited<ReturnType<typeof readScoredGuardContext>>;
}) {
  const settlementDigest = await canonicalSha256({
    version: "thurstone-successor-eval-settlement@1.0.0",
    jti: input.jti,
    providerResponseHash: input.receipt.rawResponseHash,
    usageHash: input.receipt.usageHash,
    actualNanoUsd: input.receipt.usage.accountedNanoUsd
  });
  await settleProbeCallKnown(input.guard.redis, {
    ...input.guard.identity,
    jti: input.jti,
    actualNanoUsd: input.receipt.usage.accountedNanoUsd,
    providerResponseHash: input.receipt.rawResponseHash,
    settlementDigest,
    usageHash: input.receipt.usageHash
  });
}

function response(receipt: ScoredProviderKnownReceipt, recovered: boolean) {
  return Object.freeze({
    ok: true as const,
    context: Object.freeze({
      kind: "fresh-stateless" as const,
      previousResponseId: null,
      providerRequestCount: 1 as const
    }),
    rawModelResponse: receipt.rawResponseBytes,
    providerReceipt: receipt,
    decision: receipt.decision,
    recovered
  });
}

export async function decideSuccessorEvaluation(
  rawInput: unknown,
  environment: EnvironmentLike = process.env
) {
  if (environment.THURSTONE_SUCCESSOR_EVAL_MODE !== "enabled") {
    throw new SuccessorEvalServiceError("successor_eval_disabled", 404);
  }
  const input = successorEvalDecisionRequestSchema.parse(rawInput);
  const capabilityHash = required(environment, "THURSTONE_SUCCESSOR_EVAL_CAPABILITY_HASH");
  if (!/^[a-f0-9]{64}$/u.test(capabilityHash) || rawSha256(input.capability) !== capabilityHash) {
    throw new SuccessorEvalServiceError("successor_eval_capability_invalid", 403);
  }
  const commit = appCommit(environment);
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelope);
  assertSuccessorEnvelopeCase(envelope);
  if (input.mode === "targeted" && envelope.caseId !== SUCCESSOR_EVAL_TARGET_CASE_ID) {
    throw new SuccessorEvalServiceError("successor_eval_target_case_invalid", 400);
  }
  const expectedManifest = await createCheckoutLiveManifest(createCheckoutFixture(), commit);
  const protocolHash = await successorProtocolHash({
    appCommit: commit,
    liveManifest: expectedManifest
  });
  if (
    envelope.buildCommit !== commit ||
    envelope.liveManifest.manifestHash !== expectedManifest.manifestHash ||
    envelope.runBinding.freezeHash !== protocolHash
  ) {
    throw new SuccessorEvalServiceError("successor_eval_envelope_mismatch", 409);
  }
  const artifactSecret = required(environment, "TOOLPROOF_SIGNING_SECRET");
  const guard = await readScoredGuardContext(environment);
  if (guard.status.purposeCounts.revised + 1 > 70) {
    throw new SuccessorEvalServiceError("successor_eval_revised_cap_exhausted", 409);
  }
  const receiptKey = await canonicalSha256({
    version: SUCCESSOR_EVAL_VERSION,
    mode: input.mode,
    envelopeHash: envelope.envelopeHash
  });
  const claimsHash = await canonicalSha256({
    version: SUCCESSOR_EVAL_VERSION,
    capabilityHash,
    receiptKey
  });
  const jti = `jti_scored_${receiptKey.slice(0, 22)}`;
  const stored = await readSuccessorProviderReceipt(guard.redis, {
    receiptKey,
    artifactSecret
  });
  if (stored) {
    const receipt = await verifyScoredProviderKnownReceipt({ receipt: stored, envelope });
    await settleKnown({ receipt, jti, guard });
    return response(receipt, true);
  }
  await issueProbeAuthorization(guard.redis, {
    ...guard.identity,
    jti,
    claimsHash,
    purpose: "revised",
    subjectHash: await canonicalSha256({ version: SUCCESSOR_EVAL_VERSION, receiptKey }),
    actorHash: await canonicalSha256({ version: SUCCESSOR_EVAL_VERSION, capabilityHash })
  });
  let receipt: ScoredProviderKnownReceipt;
  try {
    receipt = await decideScoredWithOpenAi({
      envelope,
      apiKey: required(environment, "OPENAI_API_KEY"),
      safetyIdentifier: await canonicalSha256({
        version: SUCCESSOR_EVAL_VERSION,
        capabilityHash
      }),
      beforeDispatch: async () => {
        await beginProbeCall(guard.redis, {
          ...guard.identity,
          jti,
          claimsHash,
          purpose: "revised"
        });
      }
    });
    await putSuccessorProviderReceipt(guard.redis, { receiptKey, receipt, artifactSecret });
    await settleKnown({ receipt, jti, guard });
  } catch (error) {
    if (error instanceof ScoredProviderError && error.dispatch === "after_dispatch_uncertain") {
      await settleProbeCallUncertain(guard.redis, {
        ...guard.identity,
        jti,
        settlementDigest: await canonicalSha256({
          version: "thurstone-successor-eval-uncertain@1.0.0",
          jti,
          code: error.code
        }),
        reason: "successor_provider_uncertain"
      });
    }
    throw error;
  }
  return response(receipt, false);
}

export function successorEvalErrorResponse(error: unknown): {
  readonly status: number;
  readonly body: { readonly error: string; readonly inferencePerformed: boolean };
} {
  if (error instanceof SuccessorEvalServiceError) {
    return {
      status: error.status,
      body: { error: error.code, inferencePerformed: error.inferencePerformed }
    };
  }
  if (error instanceof ScoredProviderError) {
    return {
      status: error.httpStatus && error.httpStatus >= 400 ? error.httpStatus : 502,
      body: { error: error.code, inferencePerformed: error.dispatch !== "before_dispatch" }
    };
  }
  return { status: 500, body: { error: "successor_eval_failed", inferencePerformed: false } };
}
