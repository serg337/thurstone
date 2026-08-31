import { canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import type { ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import type { ScoredTrialEnvelope } from "@/lib/scored/envelope";
import {
  GATE3_SEMANTIC_CONTRACT,
  GATE3_SEMANTIC_SUITE
} from "@/lib/semantic/checkout-candidate.server";
import { z } from "zod";

export const SUCCESSOR_EVAL_VERSION = "thurstone-successor-eval@1.0.0";
export const SUCCESSOR_EVAL_MODES = ["targeted", "full"] as const;
export const SUCCESSOR_EVAL_TARGET_CASE_ID = "case_TU0RDwju-DsSRj62R0vSd6";
export type SuccessorEvalMode = (typeof SUCCESSOR_EVAL_MODES)[number];

export const successorEvalDecisionRequestSchema = z
  .object({
    capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    mode: z.enum(SUCCESSOR_EVAL_MODES),
    envelope: z.unknown()
  })
  .strict();

export const successorEvalDecisionResponseSchema = z
  .object({
    ok: z.literal(true),
    context: z
      .object({
        kind: z.literal("fresh-stateless"),
        previousResponseId: z.null(),
        providerRequestCount: z.literal(1)
      })
      .strict(),
    rawModelResponse: z.string().min(1),
    providerReceipt: z.unknown(),
    decision: z.unknown(),
    recovered: z.boolean()
  })
  .strict();

export function successorScoredCase(runnerCaseId: string) {
  return (
    GATE3_SEMANTIC_SUITE.scoredCases.find((value) => value.runnerCaseId === runnerCaseId) ?? null
  );
}

export async function successorProtocolHash(input: {
  readonly appCommit: string;
  readonly liveManifest: ProbeLiveManifest;
}): Promise<string> {
  return canonicalSha256({
    version: SUCCESSOR_EVAL_VERSION,
    appCommit: input.appCommit,
    manifestHash: input.liveManifest.manifestHash,
    runnerContractHash: await fallbackRunnerContractHash(),
    contract: GATE3_SEMANTIC_CONTRACT,
    suite: GATE3_SEMANTIC_SUITE
  });
}

export function assertSuccessorEnvelopeCase(envelope: ScoredTrialEnvelope): void {
  const scoredCase = successorScoredCase(envelope.caseId);
  if (
    !scoredCase ||
    envelope.purpose !== "revised" ||
    scoredCase.naturalLanguageRequest !== envelope.naturalLanguageRequest
  ) {
    throw new Error("successor_eval_case_mismatch");
  }
}
