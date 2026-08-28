import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  GATE3_SUCCESSOR_REVIEW_PACKAGE_VERSION,
  buildGate3HumanReviewPackage
} from "@/lib/semantic/checkout-candidate.server";
import { verifyStoredGate3FreezePayload } from "@/lib/semantic/freeze-store.server";
import {
  GATE3_AUTHORING_CONTINUITY_VERSION,
  GATE3_AUTHORING_TERMINATION_VERSION,
  GATE3_SUCCESSOR_LINEAGE_ENV,
  GATE3_SUCCESSOR_LINEAGE_VERSION,
  assertGate3SuccessorSemanticContinuity,
  gate3V1TargetContractSemanticProjectionHash,
  decodeGate3SuccessorLineageBase64Url
} from "@/lib/semantic/gate3-successor-lineage.server";
import {
  GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
  GATE3_SUCCESSOR_FROZEN_PROTOCOL_VERSION,
  finalizeGate3HumanFreeze
} from "@/lib/semantic/human-freeze.server";
import {
  GATE3_SOURCE_BINDING_ENV,
  configuredGate3ReviewPackage
} from "@/lib/semantic/review-package-config.server";
import { GATE5_REPAIR_BUILDER_RECEIPT_VERSION } from "@/lib/semantic/revision-freeze.server";
import { describe, expect, it } from "vitest";

const SOURCE_COMMIT = "b".repeat(40);

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

async function successorLineage() {
  const semanticReference = await buildGate3HumanReviewPackage(sourceBindings());
  const predecessorReviewPackageHash = "8".repeat(64);
  const originalAuthoringTermination = {
    version: GATE3_AUTHORING_TERMINATION_VERSION,
    contextId: "/root/gate3_authoring_builder",
    status: "terminated",
    reviewPackageHash: predecessorReviewPackageHash,
    completedBeforeApproval: true,
    contextCannotResumeForRepair: true,
    holdoutSeenDuringAuthoring: true,
    terminatedAt: "2026-08-28T20:00:00.000Z",
    evidenceNote: "Synthetic original termination; no successor reauthorization occurred."
  } as const;
  const predecessorRunId = `run_${"p".repeat(22)}`;
  const predecessorEvidenceDigest = "9".repeat(64);
  const repairPayload = {
    version: GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
    contextId: `repair_${"r".repeat(22)}`,
    contextClass: "fresh-stateless-application-api",
    provider: "OpenAI",
    model: "gpt-5.6-terra",
    store: false,
    baselineRunId: predecessorRunId,
    baselineEvidenceDigest: predecessorEvidenceDigest,
    developmentPackageHash: "a".repeat(64),
    developmentCaseCount: 12,
    holdoutPromptCountReceived: 0,
    holdoutResultCountReceived: 0,
    filesystemAccess: false,
    browserAccess: false,
    sourceBriefAccess: false,
    fullContractAccess: false,
    proposedField: "checkout_request.description",
    proposedDescription:
      "Open a simulated checkout request only when the user explicitly directs checkout.",
    rationale:
      "Synthetic development evidence supports a more explicit commitment boundary for checkout.",
    createdAt: "2026-08-29T08:00:00.000Z"
  } as const;
  const repairBuilderReceipt = {
    ...repairPayload,
    receiptHash: await canonicalSha256(repairPayload)
  };
  const components = semanticReference.freezeManifest.componentHashes;
  const authoringContinuity = {
    version: GATE3_AUTHORING_CONTINUITY_VERSION,
    disposition: "original-authoring-context-permanently-terminated",
    originalReviewPackageHash: predecessorReviewPackageHash,
    originalAuthoringTermination,
    originalAuthoringTerminationHash: await canonicalSha256(originalAuthoringTermination),
    originalAuthoringContextReauthorized: false,
    successorReauthoringPerformed: false,
    successorAuthoringTerminationMinted: false
  } as const;
  const payload = {
    version: GATE3_SUCCESSOR_LINEAGE_VERSION,
    disposition: "superseded-protocol",
    predecessor: {
      reviewPackageHash: predecessorReviewPackageHash,
      frozenProtocolHash: "c".repeat(64),
      freezeCandidateHash: "d".repeat(64),
      runId: predecessorRunId,
      evidenceDigest: predecessorEvidenceDigest,
      acknowledgementStatus: "acknowledged",
      terminalStatus: "terminal-complete",
      completedCaseCount: 24,
      providerCallCount: 24
    },
    semanticContinuity: {
      contractHash: components.contract,
      casesHash: components.cases,
      scoredCasesHash: components.scoredCases,
      calibrationCasesHash: components.calibrationCases,
      fixtureHash: components.fixture,
      runnerHash: components.runner,
      evaluatorHash: components.evaluator,
      retryPolicyHash: components.retryPolicy,
      scheduleHash: components.schedule,
      targetContractSemanticProjectionHash: await gate3V1TargetContractSemanticProjectionHash(
        semanticReference.targetContract,
        semanticReference.fixture
      )
    },
    priorRepair: {
      repairBuilderReceipt,
      repairBuilderReceiptHash: repairBuilderReceipt.receiptHash,
      providerCallCount: 1
    },
    phaseCallOffsets: { baseline: 24, repair: 1, revised: 0 },
    authoringContinuity
  } as const;
  return { ...payload, lineageHash: await canonicalSha256(payload) };
}

function encode(value: unknown): string {
  return Buffer.from(canonicalJson(value), "utf8").toString("base64url");
}

describe("provider-free successor Gate 3 lineage", () => {
  it("binds the predecessor, prior Repair call, offsets, and unchanged semantic components", async () => {
    const lineage = await successorLineage();
    const decoded = await decodeGate3SuccessorLineageBase64Url(encode(lineage));
    const review = await buildGate3HumanReviewPackage({
      ...sourceBindings(),
      successorLineage: decoded
    });
    expect(review).toMatchObject({
      version: GATE3_SUCCESSOR_REVIEW_PACKAGE_VERSION,
      authoringBuilderDisposition: "original-authoring-context-terminated-successor-review-only",
      successorLineage: {
        disposition: "superseded-protocol",
        predecessor: {
          acknowledgementStatus: "acknowledged",
          terminalStatus: "terminal-complete",
          completedCaseCount: 24,
          providerCallCount: 24
        },
        priorRepair: { providerCallCount: 1 },
        phaseCallOffsets: { baseline: 24, repair: 1, revised: 0 },
        authoringContinuity: {
          originalAuthoringContextReauthorized: false,
          successorReauthoringPerformed: false,
          successorAuthoringTerminationMinted: false
        }
      }
    });
    expect(review.successorLineage?.semanticContinuity.contractHash).toBe(
      review.freezeManifest.componentHashes.contract
    );

    const driftPayload = {
      ...lineage,
      semanticContinuity: { ...lineage.semanticContinuity, contractHash: "f".repeat(64) }
    };
    const { lineageHash: _ignored, ...driftWithoutHash } = driftPayload;
    void _ignored;
    await expect(
      buildGate3HumanReviewPackage({
        ...sourceBindings(),
        successorLineage: {
          ...driftWithoutHash,
          lineageHash: await canonicalSha256(driftWithoutHash)
        }
      })
    ).rejects.toThrow(/gate3_successor_semantic_continuity_mismatch/u);
  });

  it("loads one bounded Base64URL lineage for prepare/rebuild and rejects duplicate authority", async () => {
    const lineage = await successorLineage();
    const source = encode(sourceBindings());
    const successor = encode(lineage);
    await expect(
      configuredGate3ReviewPackage({
        [GATE3_SOURCE_BINDING_ENV]: source,
        [GATE3_SUCCESSOR_LINEAGE_ENV]: successor,
        TOOLPROOF_COMMIT_SHA: SOURCE_COMMIT
      })
    ).resolves.toMatchObject({
      status: "ready",
      reviewPackage: { version: GATE3_SUCCESSOR_REVIEW_PACKAGE_VERSION }
    });
    await expect(
      configuredGate3ReviewPackage({
        [GATE3_SOURCE_BINDING_ENV]: encode({ ...sourceBindings(), successorLineage: lineage }),
        [GATE3_SUCCESSOR_LINEAGE_ENV]: successor,
        TOOLPROOF_COMMIT_SHA: SOURCE_COMMIT
      })
    ).resolves.toMatchObject({ status: "invalid", issue: "gate3_successor_lineage_duplicate" });
    await expect(decodeGate3SuccessorLineageBase64Url(`${successor}=`)).rejects.toThrow(
      /gate3_successor_lineage_encoding_invalid/u
    );
  });

  it("rejects v1 target, runner, and evaluator semantic drift while ignoring commit digests only", async () => {
    const lineage = await successorLineage();
    const review = await buildGate3HumanReviewPackage({
      ...sourceBindings(),
      successorLineage: lineage
    });
    const components = review.freezeManifest.componentHashes;
    const originalHash = await gate3V1TargetContractSemanticProjectionHash(
      review.targetContract,
      review.fixture
    );
    const commitOnly = {
      ...review.targetContract,
      appCommit: "e".repeat(40),
      initialManifest: {
        ...review.targetContract.initialManifest,
        manifestHash: "e".repeat(64)
      },
      pendingManifest: {
        ...review.targetContract.pendingManifest,
        manifestHash: "f".repeat(64)
      }
    };
    await expect(
      gate3V1TargetContractSemanticProjectionHash(commitOnly, review.fixture)
    ).resolves.toBe(originalHash);

    const descriptionDrift = {
      ...review.targetContract,
      initialManifest: {
        ...review.targetContract.initialManifest,
        tools: review.targetContract.initialManifest.tools.map((tool) =>
          tool.name === "checkout_request"
            ? { ...tool, description: `${tool.description} drift` }
            : tool
        )
      }
    };
    const schemaDrift = {
      ...review.targetContract,
      initialManifest: {
        ...review.targetContract.initialManifest,
        tools: review.targetContract.initialManifest.tools.map((tool) =>
          tool.name === "cart_get"
            ? { ...tool, inputSchema: { ...tool.inputSchema, maxProperties: 1 } }
            : tool
        )
      }
    };
    const handlerDrift = {
      ...review.targetContract,
      initialHandlerVersions: review.targetContract.initialHandlerVersions.map((handler) =>
        handler.name === "cart_get" ? { ...handler, version: `${handler.version}-drift` } : handler
      )
    };
    for (const target of [descriptionDrift, schemaDrift, handlerDrift]) {
      const driftHash = await gate3V1TargetContractSemanticProjectionHash(target, review.fixture);
      expect(() => assertGate3SuccessorSemanticContinuity(lineage, components, driftHash)).toThrow(
        /gate3_successor_semantic_continuity_mismatch/u
      );
    }
    expect(() =>
      assertGate3SuccessorSemanticContinuity(
        lineage,
        { ...components, runner: "0".repeat(64) },
        originalHash
      )
    ).toThrow(/gate3_successor_semantic_continuity_mismatch/u);
    expect(() =>
      assertGate3SuccessorSemanticContinuity(
        lineage,
        { ...components, evaluator: "0".repeat(64) },
        originalHash
      )
    ).toThrow(/gate3_successor_semantic_continuity_mismatch/u);
  });

  it("freezes with original authoring continuity and survives strict stored verification", async () => {
    const lineage = await successorLineage();
    const review = await buildGate3HumanReviewPackage({
      ...sourceBindings(),
      successorLineage: lineage
    });
    const humanReviewReceipt = {
      version: GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
      receiptId: `review_${"h".repeat(22)}`,
      reviewer: "Sergio Valencia",
      authority: "human-semantic-authority",
      decision: "approved",
      channel: "sergio-explicit-user-message",
      reviewPackageHash: review.packageHash,
      freezeHash: review.freezeHash,
      reviewedAt: "2026-08-29T10:00:00.000Z",
      approvalText: "Synthetic successor approval for a unit test only.",
      notes: "No real approval is represented by this fixture."
    } as const;
    const frozen = await finalizeGate3HumanFreeze({ reviewPackage: review, humanReviewReceipt });
    expect(frozen).toMatchObject({
      version: GATE3_SUCCESSOR_FROZEN_PROTOCOL_VERSION,
      successorLineageHash: lineage.lineageHash,
      authoringContinuity: lineage.authoringContinuity
    });
    expect(frozen).not.toHaveProperty("authoringTermination");
    await expect(
      verifyStoredGate3FreezePayload({ reviewPackage: review, frozenProtocol: frozen })
    ).resolves.toMatchObject({
      reviewPackage: { packageHash: review.packageHash },
      frozenProtocol: { frozenProtocolHash: frozen.frozenProtocolHash }
    });

    const tamperedPayload = {
      ...frozen,
      authoringContinuity: {
        ...frozen.authoringContinuity,
        successorReauthoringPerformed: true
      }
    };
    const { frozenProtocolHash: _ignored, ...tamperedWithoutHash } = tamperedPayload;
    void _ignored;
    await expect(
      verifyStoredGate3FreezePayload({
        reviewPackage: review,
        frozenProtocol: {
          ...tamperedWithoutHash,
          frozenProtocolHash: await canonicalSha256(tamperedWithoutHash)
        }
      })
    ).rejects.toThrow(/GATE3_STORED_FREEZE_MISMATCH/u);

    await expect(
      finalizeGate3HumanFreeze({
        reviewPackage: review,
        humanReviewReceipt,
        authoringTermination: {
          ...lineage.authoringContinuity.originalAuthoringTermination,
          reviewPackageHash: review.packageHash
        }
      })
    ).rejects.toThrow(/gate3_successor_authoring_termination_mismatch/u);
  });
});
