import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  GATE3_SEMANTIC_CONTRACT,
  GATE3_SEMANTIC_SUITE,
  buildGate3HumanReviewPackage,
  gate3ReviewPackageCanonicalJson,
  meaningForScoredCase
} from "@/lib/semantic/checkout-candidate.server";
import { SEMANTIC_FAMILIES } from "@/lib/semantic/contract";
import {
  GATE3_AUTHORING_TERMINATION_VERSION,
  GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
  finalizeGate3HumanFreeze
} from "@/lib/semantic/human-freeze.server";
import {
  configuredGate3ReviewPackage,
  GATE3_SOURCE_BINDING_ENV
} from "@/lib/semantic/review-package-config.server";
import { describe, expect, it } from "vitest";

const SOURCE_COMMIT = "93a602ea6d8eedb56f0f2b8e9abb6468512b2aa9";

function sourceBindings() {
  return {
    source: {
      repositoryCommit: SOURCE_COMMIT,
      contractSourceSha256: "1".repeat(64),
      casesSourceSha256: "2".repeat(64),
      fixtureSourceSha256: "3".repeat(64),
      manifestSourceSha256: "4".repeat(64),
      runnerSourceSha256: "5".repeat(64),
      evaluatorSourceSha256: "6".repeat(64)
    },
    canonicalizerSourceSha256: "7".repeat(64)
  };
}

describe("the exact Gate 3 checkout candidate", () => {
  it("contains exactly 24 scored cases, balanced six ways and disjoint from calibration", () => {
    const scored = GATE3_SEMANTIC_SUITE.scoredCases;
    expect(scored).toHaveLength(24);
    expect(GATE3_SEMANTIC_SUITE.calibrationCases).toHaveLength(4);
    expect(scored.filter(({ subset }) => subset === "development")).toHaveLength(12);
    expect(scored.filter(({ subset }) => subset === "builder-blinded-holdout")).toHaveLength(12);
    for (const family of SEMANTIC_FAMILIES) {
      const rows = scored.filter((row) => row.family === family);
      expect(rows).toHaveLength(4);
      expect(rows.filter(({ subset }) => subset === "development")).toHaveLength(2);
      expect(rows.filter(({ subset }) => subset === "builder-blinded-holdout")).toHaveLength(2);
    }
    const calibrationText = new Set(
      GATE3_SEMANTIC_SUITE.calibrationCases.map(
        ({ naturalLanguageRequest }) => naturalLanguageRequest
      )
    );
    expect(
      scored.some(({ naturalLanguageRequest }) => calibrationText.has(naturalLanguageRequest))
    ).toBe(false);
  });

  it("contains the reviewed R3 correction and a non-calibration holdout argument pair", () => {
    const r3 = GATE3_SEMANTIC_SUITE.scoredCases.find(
      ({ caseId }) => caseId === "review_holdout_01"
    );
    expect(r3?.naturalLanguageRequest).toBe(
      "Walk me through what’s in this order, each line’s price, the subtotal, shipping charge, delivery timing, and the all-in total; review only."
    );

    const argumentHoldout = GATE3_SEMANTIC_SUITE.scoredCases.filter(
      ({ family, subset }) =>
        family === "argument-boundary-matched-pairs" && subset === "builder-blinded-holdout"
    );
    expect(argumentHoldout.map(({ naturalLanguageRequest }) => naturalLanguageRequest)).toEqual([
      "Set the Field notebook quantity to six.",
      "Set the Stoneware mug quantity to six."
    ]);
    for (const row of argumentHoldout) {
      const expectation = meaningForScoredCase(row).expectation;
      expect(expectation.kind).toBe("call");
      if (expectation.kind !== "call") throw new Error("Expected a call meaning.");
      expect(expectation.arguments.predicates).toContainEqual({
        path: "/quantity",
        operator: "equals",
        value: 6
      });
    }
  });

  it("keeps every evaluator-only Gate 3 value in the exact Lab leakage manifest", async () => {
    const manifest = JSON.parse(
      await readFile(path.resolve(process.cwd(), "scripts/gate3-leakage-sentinels.json"), "utf8")
    ) as { readonly version: string; readonly sentinels: readonly string[] };
    expect(manifest.version).toBe("toolproof-gate3-leakage-sentinels@1.0.0");
    const expected = new Set([
      ...GATE3_SEMANTIC_SUITE.scoredCases.flatMap((scoredCase) => [
        scoredCase.naturalLanguageRequest,
        scoredCase.runnerCaseId,
        scoredCase.caseId,
        scoredCase.family,
        scoredCase.relationship.kind === "equivalent_realization"
          ? scoredCase.relationship.groupId
          : scoredCase.relationship.pairId,
        ...(scoredCase.relationship.kind === "matched_boundary"
          ? [scoredCase.relationship.materialDifference]
          : [])
      ]),
      ...GATE3_SEMANTIC_CONTRACT.meanings.flatMap((meaning) => [
        meaning.meaningId,
        meaning.label,
        meaning.approvedMeaning
      ]),
      "builder-blinded-holdout"
    ]);
    expect(manifest.sentinels).toHaveLength(130);
    expect(new Set(manifest.sentinels)).toEqual(expected);
  });

  it("builds an exact review package that binds the authentic manifest and all component truth", async () => {
    const review = await buildGate3HumanReviewPackage(sourceBindings());
    expect(review).toMatchObject({
      status: "awaiting-human-approval",
      semanticAuthority: "Sergio Valencia",
      source: { repositoryCommit: SOURCE_COMMIT },
      freezeManifest: {
        status: "awaiting-human-approval",
        schedule: {
          scoredCaseCount: 24,
          developmentCaseCount: 12,
          holdoutCaseCount: 12,
          repetitionCountPerCase: 1,
          plannedTrialsPerVersion: 24,
          totalPlannedScoredTrials: 48,
          evidenceLabel: "demonstration-snapshot"
        }
      }
    });
    expect(review.targetContract.initialManifest.manifestHash).toBe(
      "e78c5752c16296c2dcc273e5c8718afc8198a2eefcb1d4bdbb47087b1d6d0392"
    );
    expect(review.targetContract.initialManifest.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);
    expect(review.targetContract.pendingManifest.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_cancel",
      "checkout_request",
      "order_review"
    ]);
    expect(review.schedule.orderedRunnerCaseIds).toHaveLength(24);
    expect(new Set(review.schedule.orderedRunnerCaseIds).size).toBe(24);
    expect(review.packageHash).toMatch(/^[a-f0-9]{64}$/u);
    const { packageHash, ...payload } = review;
    expect(await canonicalSha256(payload)).toBe(packageHash);
    expect(review.freezeManifest.componentHashes.contract).toBe(
      await canonicalSha256(GATE3_SEMANTIC_CONTRACT)
    );

    const bytes = gate3ReviewPackageCanonicalJson(review);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(canonicalJson(JSON.parse(bytes))).toBe(bytes.trimEnd());
  });

  it("loads only a bounded exact-commit source binding and otherwise fails closed", async () => {
    const configured = Buffer.from(canonicalJson(sourceBindings()), "utf8").toString("base64url");
    const ready = await configuredGate3ReviewPackage({
      [GATE3_SOURCE_BINDING_ENV]: configured,
      TOOLPROOF_COMMIT_SHA: SOURCE_COMMIT
    });
    expect(ready.status).toBe("ready");
    expect(ready.reviewPackage?.source.repositoryCommit).toBe(SOURCE_COMMIT);

    await expect(
      configuredGate3ReviewPackage({
        [GATE3_SOURCE_BINDING_ENV]: configured,
        TOOLPROOF_COMMIT_SHA: "a".repeat(40)
      })
    ).resolves.toMatchObject({
      status: "invalid",
      reviewPackage: null,
      issue: "gate3_source_binding_commit_mismatch"
    });
    await expect(configuredGate3ReviewPackage({})).resolves.toEqual({
      status: "missing",
      reviewPackage: null,
      issue: null
    });
    await expect(
      configuredGate3ReviewPackage({
        [GATE3_SOURCE_BINDING_ENV]: configured,
        TOOLPROOF_COMMIT_SHA: SOURCE_COMMIT,
        VERCEL_GIT_COMMIT_SHA: "b".repeat(40)
      })
    ).resolves.toMatchObject({
      status: "invalid",
      issue: "gate3_source_binding_commit_override_mismatch"
    });
  });

  it("can freeze only a genuine exact-package human receipt plus terminated authoring context", async () => {
    const review = await buildGate3HumanReviewPackage(sourceBindings());
    const humanReviewReceipt = {
      version: GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
      receiptId: `review_${"r".repeat(22)}`,
      reviewer: "Sergio Valencia",
      authority: "human-semantic-authority",
      decision: "approved",
      channel: "sergio-explicit-user-message",
      reviewPackageHash: review.packageHash,
      freezeHash: review.freezeHash,
      reviewedAt: "2026-08-28T21:00:00.000Z",
      approvalText: "Synthetic unit-test approval receipt; not a real Gate 3 approval.",
      notes: "Unit-test fixture only."
    };
    const authoringTermination = {
      version: GATE3_AUTHORING_TERMINATION_VERSION,
      contextId: "/root/gate3_authoring_builder",
      status: "terminated",
      reviewPackageHash: review.packageHash,
      completedBeforeApproval: true,
      contextCannotResumeForRepair: true,
      holdoutSeenDuringAuthoring: true,
      terminatedAt: "2026-08-28T20:00:00.000Z",
      evidenceNote: "Synthetic unit-test termination receipt."
    };
    const frozen = await finalizeGate3HumanFreeze({
      reviewPackage: review,
      humanReviewReceipt,
      authoringTermination
    });
    expect(frozen).toMatchObject({
      status: "frozen",
      reviewPackageHash: review.packageHash,
      freezeCandidateHash: review.freezeHash,
      frozenManifest: { status: "frozen" }
    });
    expect(frozen.frozenProtocolHash).toMatch(/^[a-f0-9]{64}$/u);

    await expect(
      finalizeGate3HumanFreeze({
        reviewPackage: review,
        humanReviewReceipt: { ...humanReviewReceipt, reviewPackageHash: "f".repeat(64) },
        authoringTermination
      })
    ).rejects.toThrow(/gate3_human_receipt_binding_mismatch/u);
  });
});
