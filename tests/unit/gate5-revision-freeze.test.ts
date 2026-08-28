import { canonicalSha256 } from "@/lib/evidence/digest";
import { buildGate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_AUTHORING_TERMINATION_VERSION,
  GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
  finalizeGate3HumanFreeze
} from "@/lib/semantic/human-freeze.server";
import {
  GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
  GATE5_REVISION_APPROVAL_VERSION,
  buildGate5RevisionFreeze
} from "@/lib/semantic/revision-freeze.server";
import { assertStoredGate5RevisionLineage } from "@/lib/semantic/revision-config.server";
import { describe, expect, it } from "vitest";

async function gate3() {
  const review = await buildGate3HumanReviewPackage({
    source: {
      repositoryCommit: "a".repeat(40),
      contractSourceSha256: "1".repeat(64),
      casesSourceSha256: "2".repeat(64),
      fixtureSourceSha256: "3".repeat(64),
      manifestSourceSha256: "4".repeat(64),
      runnerSourceSha256: "5".repeat(64),
      evaluatorSourceSha256: "6".repeat(64)
    },
    canonicalizerSourceSha256: "7".repeat(64)
  });
  const humanReviewReceipt = {
    version: GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
    receiptId: `review_${"r".repeat(22)}`,
    reviewer: "Sergio Valencia",
    authority: "human-semantic-authority",
    decision: "approved",
    channel: "sergio-explicit-user-message",
    reviewPackageHash: review.packageHash,
    freezeHash: review.freezeHash,
    reviewedAt: "2026-08-28T22:00:00.000Z",
    approvalText: "Synthetic unit test only.",
    notes: "Not real."
  };
  return {
    review,
    frozen: await finalizeGate3HumanFreeze({
      reviewPackage: review,
      humanReviewReceipt,
      authoringTermination: {
        version: GATE3_AUTHORING_TERMINATION_VERSION,
        contextId: "/root/gate3_authoring_builder",
        status: "terminated",
        reviewPackageHash: review.packageHash,
        completedBeforeApproval: true,
        contextCannotResumeForRepair: true,
        holdoutSeenDuringAuthoring: true,
        terminatedAt: "2026-08-28T21:00:00.000Z",
        evidenceNote: "Synthetic unit test only."
      }
    })
  };
}

describe("Gate 5 one-variable revision freeze", () => {
  it("accepts only an approved checkout_request description diff with unchanged protocol", async () => {
    const { review, frozen } = await gate3();
    const proposedDescription =
      "Open a simulated pending checkout only when the user explicitly directs checkout; never use this tool for review-only or tentative requests.";
    const repairPayload = {
      version: GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
      contextId: `repair_${"x".repeat(22)}`,
      contextClass: "fresh-stateless-application-api",
      provider: "OpenAI",
      model: "gpt-5.6-terra",
      store: false,
      baselineRunId: `run_${"b".repeat(22)}`,
      baselineEvidenceDigest: "8".repeat(64),
      developmentPackageHash: "9".repeat(64),
      developmentCaseCount: 12,
      holdoutPromptCountReceived: 0,
      holdoutResultCountReceived: 0,
      filesystemAccess: false,
      browserAccess: false,
      sourceBriefAccess: false,
      fullContractAccess: false,
      proposedField: "checkout_request.description",
      proposedDescription,
      rationale:
        "Development-only failures indicate a sharper explicit-commitment boundary is warranted.",
      createdAt: "2026-08-29T10:00:00.000Z"
    } as const;
    const repairBuilderReceipt = {
      ...repairPayload,
      receiptHash: await canonicalSha256(repairPayload)
    };
    const v2TargetContract = {
      ...review.targetContract,
      appCommit: "b".repeat(40),
      initialManifest: {
        ...review.targetContract.initialManifest,
        manifestHash: "c".repeat(64),
        tools: review.targetContract.initialManifest.tools.map((tool) =>
          tool.name === "checkout_request" ? { ...tool, description: proposedDescription } : tool
        )
      },
      pendingManifest: {
        ...review.targetContract.pendingManifest,
        manifestHash: "d".repeat(64),
        tools: review.targetContract.pendingManifest.tools.map((tool) =>
          tool.name === "checkout_request" ? { ...tool, description: proposedDescription } : tool
        )
      }
    };
    const revisionApproval = {
      version: GATE5_REVISION_APPROVAL_VERSION,
      receiptId: `revision_${"v".repeat(22)}`,
      reviewer: "Sergio Valencia",
      authority: "human-semantic-authority",
      decision: "approved",
      repairBuilderReceiptHash: repairBuilderReceipt.receiptHash,
      proposedField: "checkout_request.description",
      approvedDescription: proposedDescription,
      reviewedAt: "2026-08-29T11:00:00.000Z",
      approvalText: "Synthetic unit-test approval only."
    };
    const revision = await buildGate5RevisionFreeze({
      gate3ReviewPackage: review,
      gate3FrozenProtocol: frozen,
      baselineRunId: repairBuilderReceipt.baselineRunId,
      baselineEvidenceDigest: repairBuilderReceipt.baselineEvidenceDigest,
      repairBuilderReceipt,
      revisionApproval,
      v2TargetContract
    });
    expect(revision).toMatchObject({
      status: "frozen",
      changedField: "checkout_request.description",
      oldDescription: review.targetContract.initialManifest.tools.find(
        ({ name }) => name === "checkout_request"
      )?.description,
      newDescription: proposedDescription,
      v1AppCommit: "a".repeat(40),
      v2AppCommit: "b".repeat(40)
    });
    expect(revision.revisionFreezeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      assertStoredGate5RevisionLineage({
        stored: revision,
        rebuilt: revision,
        activeCommit: revision.v2AppCommit,
        gate3FrozenProtocolHash: revision.gate3FrozenProtocolHash,
        baselineRunId: revision.baselineRunId,
        baselineEvidenceDigest: revision.baselineEvidenceDigest
      })
    ).not.toThrow();
    expect(() =>
      assertStoredGate5RevisionLineage({
        stored: { ...revision, baselineEvidenceDigest: "0".repeat(64) },
        rebuilt: revision,
        activeCommit: revision.v2AppCommit,
        gate3FrozenProtocolHash: revision.gate3FrozenProtocolHash,
        baselineRunId: revision.baselineRunId,
        baselineEvidenceDigest: revision.baselineEvidenceDigest
      })
    ).toThrow(/gate5_stored_revision_mismatch/u);

    await expect(
      buildGate5RevisionFreeze({
        gate3ReviewPackage: review,
        gate3FrozenProtocol: frozen,
        baselineRunId: repairBuilderReceipt.baselineRunId,
        baselineEvidenceDigest: repairBuilderReceipt.baselineEvidenceDigest,
        repairBuilderReceipt,
        revisionApproval,
        v2TargetContract: {
          ...v2TargetContract,
          domainVersion: "changed-domain@2"
        }
      })
    ).rejects.toThrow(/gate5_one_variable_diff_mismatch/u);
  });
});
