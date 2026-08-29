import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { gzipSync } from "node:zlib";
import type { Gate6PresentationProof } from "@/lib/results/presentation-proof";
import { buildGate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_AUTHORING_TERMINATION_VERSION,
  GATE3_HUMAN_REVIEW_RECEIPT_VERSION,
  finalizeGate3HumanFreeze
} from "@/lib/semantic/human-freeze.server";
import {
  GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
  GATE5_REVISION_APPROVAL_VERSION,
  buildGate5RevisionFreeze,
  verifyGate5RevisionFreezeIntegrity
} from "@/lib/semantic/revision-freeze.server";
import {
  assertGate5TerminalPresentationBinding,
  assertStoredGate5RevisionLineage,
  configuredGate5Revision,
  type Gate5RevisionDependencies
} from "@/lib/semantic/revision-config.server";
import { buildGate5SourceDiffProof } from "@/lib/semantic/gate5-source-diff-proof";
import { describe, expect, it, vi } from "vitest";

function source(description: string): string {
  return `export const CHECKOUT_REQUEST_METADATA = {\n  description:\n    ${JSON.stringify(description)},\n  inputSchema: CHECKOUT_OPERATION_JSON_SCHEMA\n} as const;\n`;
}

function patch(oldDescription: string, newDescription: string): string {
  return `diff --git a/lib/webmcp/checkout-request-tool.ts b/lib/webmcp/checkout-request-tool.ts\nindex ${"1".repeat(40)}..${"2".repeat(40)} 100644\n--- a/lib/webmcp/checkout-request-tool.ts\n+++ b/lib/webmcp/checkout-request-tool.ts\n@@ -1,5 +1,5 @@\n export const CHECKOUT_REQUEST_METADATA = {\n   description:\n-    ${JSON.stringify(oldDescription)},\n+    ${JSON.stringify(newDescription)},\n   inputSchema: CHECKOUT_OPERATION_JSON_SCHEMA\n } as const;\n`;
}

async function sourceDiffProof(oldDescription: string, newDescription: string) {
  return buildGate5SourceDiffProof({
    changedPaths: ["lib/webmcp/checkout-request-tool.ts"],
    v1AppCommit: "a".repeat(40),
    v2AppCommit: "b".repeat(40),
    oldJsonStringLiteral: JSON.stringify(oldDescription),
    newJsonStringLiteral: JSON.stringify(newDescription),
    v1RawSource: source(oldDescription),
    v2RawSource: source(newDescription),
    patch: patch(oldDescription, newDescription)
  });
}

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

async function revisionFixture() {
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
  } as const;
  const oldDescription = review.targetContract.initialManifest.tools.find(
    ({ name }) => name === "checkout_request"
  )!.description;
  const exactSourceDiffProof = await sourceDiffProof(oldDescription, proposedDescription);
  const revision = await buildGate5RevisionFreeze({
    gate3ReviewPackage: review,
    gate3FrozenProtocol: frozen,
    baselineRunId: repairBuilderReceipt.baselineRunId,
    baselineEvidenceDigest: repairBuilderReceipt.baselineEvidenceDigest,
    repairBuilderReceipt,
    revisionApproval,
    v2TargetContract,
    sourceDiffProof: exactSourceDiffProof
  });
  return {
    review,
    frozen,
    repairBuilderReceipt,
    revision,
    v2TargetContract,
    exactSourceDiffProof,
    proposedDescription
  };
}

describe("Gate 5 one-variable revision freeze", () => {
  it("allows only one exact terminal presentation commit with scored execution absent", () => {
    const input = {
      currentAppCommit: "c".repeat(40),
      allowedPresentationCommit: "c".repeat(40),
      scoredOperatorPhase: undefined,
      revisedRunId: `run_${"r".repeat(22)}`,
      revisedEvidenceDigest: "e".repeat(64)
    };
    expect(() => assertGate5TerminalPresentationBinding(input)).not.toThrow();
    for (const changed of [
      { allowedPresentationCommit: "d".repeat(40) },
      { scoredOperatorPhase: "revised" },
      { revisedRunId: undefined },
      { revisedEvidenceDigest: "invalid" }
    ]) {
      expect(() => assertGate5TerminalPresentationBinding({ ...input, ...changed })).toThrow(
        /gate5_terminal_presentation_binding_invalid/u
      );
    }
  });

  it("uses the stored terminal freeze without redundant approval/source env copies", async () => {
    const fixture = await revisionFixture();
    const presentationCommit = "c".repeat(40);
    const revisedRunId = `run_${"r".repeat(22)}`;
    const revisedEvidenceDigest = "f".repeat(64);
    const criticalFiles = Array.from({ length: 20 }, (_, index) => ({
      path: `lib/domain/terminal-critical-${String(index).padStart(2, "0")}.ts`,
      sha256: index.toString(16).padStart(64, "0")
    }));
    const gate6Payload = {
      version: "toolproof-gate6-presentation-proof@1.0.0" as const,
      measuredV2Commit: fixture.revision.v2AppCommit,
      presentationCommit,
      changedPaths: ["app/page.tsx"],
      criticalFiles,
      criticalProjectionHash: await canonicalSha256(criticalFiles),
      dependencyProjectionHash: "1".repeat(64),
      gitProofPackSha256: "2".repeat(64),
      baselineRawSha256: "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb",
      revisedRawSha256: "26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa"
    };
    const gate6Proof: Gate6PresentationProof = {
      ...gate6Payload,
      proofHash: await canonicalSha256(gate6Payload)
    };
    const environment = {
      TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 7).toString("base64url"),
      TOOLPROOF_GATE3_FROZEN_PROTOCOL_HASH: fixture.frozen.frozenProtocolHash,
      TOOLPROOF_BASELINE_RUN_ID: fixture.revision.baselineRunId,
      TOOLPROOF_BASELINE_EVIDENCE_DIGEST: fixture.revision.baselineEvidenceDigest,
      TOOLPROOF_GATE5_REVISION_FREEZE_HASH: fixture.revision.revisionFreezeHash,
      TOOLPROOF_GATE5_PRESENTATION_COMMIT: presentationCommit,
      TOOLPROOF_REVISED_RUN_ID: revisedRunId,
      TOOLPROOF_REVISED_EVIDENCE_DIGEST: revisedEvidenceDigest,
      TOOLPROOF_COMMIT_SHA: presentationCommit,
      TOOLPROOF_GATE6_PRESENTATION_PROOF_B64: gzipSync(
        Buffer.from(canonicalJson(gate6Proof))
      ).toString("base64url"),
      TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH: gate6Proof.proofHash
    };
    const baseline = {
      status: "acknowledged",
      terminalStatus: "terminal-complete",
      completedCount: 24,
      evidenceDigest: fixture.revision.baselineEvidenceDigest,
      identity: {
        runId: fixture.revision.baselineRunId,
        appCommit: fixture.review.targetContract.appCommit,
        frozenProtocolHash: fixture.frozen.frozenProtocolHash,
        reviewPackageHash: fixture.review.packageHash,
        freezeCandidateHash: fixture.review.freezeHash
      }
    };
    const revised = {
      status: "acknowledged",
      terminalStatus: "terminal-complete",
      completedCount: 24,
      evidenceDigest: revisedEvidenceDigest,
      identity: {
        appCommit: fixture.revision.v2AppCommit,
        frozenProtocolHash: fixture.revision.revisionFreezeHash,
        reviewPackageHash: fixture.revision.gate3ReviewPackageHash,
        freezeCandidateHash: fixture.review.freezeHash
      }
    };
    const createTarget = vi.fn(async () => fixture.v2TargetContract);
    const dependencies = {
      createProbeRedis: vi.fn(() => ({})),
      readRepairProviderReceipt: vi.fn(async () => ({
        repairBuilderReceipt: fixture.repairBuilderReceipt
      })),
      readPermanentScoredRunById: vi.fn(async (_redis, input) =>
        input.phase === "baseline" ? baseline : revised
      ),
      createGate3TargetContractBinding: createTarget,
      configuredGate3FrozenProtocol: vi.fn(async () => ({
        status: "frozen",
        protocol: fixture.frozen,
        reviewPackage: fixture.review,
        issue: null
      })),
      readGate3Freeze: vi.fn(async () => ({
        reviewPackage: fixture.review,
        frozenProtocol: fixture.frozen
      })),
      readGate5RevisionFreeze: vi.fn(async () => fixture.revision)
    } as unknown as Gate5RevisionDependencies;

    await expect(configuredGate5Revision(environment, dependencies)).resolves.toEqual({
      status: "ready",
      revision: fixture.revision,
      issue: null
    });
    expect(createTarget).not.toHaveBeenCalled();
    expect(environment).not.toHaveProperty("TOOLPROOF_GATE5_REVISION_APPROVAL_B64");
    expect(environment).not.toHaveProperty("TOOLPROOF_GATE5_SOURCE_DIFF_PROOF_B64");

    for (const [label, changedBaseline] of [
      ["terminal status", { ...baseline, terminalStatus: "terminal-incomplete" }],
      [
        "app commit",
        { ...baseline, identity: { ...baseline.identity, appCommit: "0".repeat(40) } }
      ],
      [
        "freeze candidate",
        { ...baseline, identity: { ...baseline.identity, freezeCandidateHash: "0".repeat(64) } }
      ]
    ] as const) {
      await expect(
        configuredGate5Revision(environment, {
          ...dependencies,
          readPermanentScoredRunById: vi.fn(async (_redis, input) =>
            input.phase === "baseline" ? changedBaseline : revised
          )
        } as unknown as Gate5RevisionDependencies),
        label
      ).resolves.toMatchObject({ status: "invalid", issue: "gate5_gate3_predecessor_missing" });
    }

    await expect(
      configuredGate5Revision(environment, {
        ...dependencies,
        readGate5RevisionFreeze: vi.fn(async () => null)
      })
    ).resolves.toMatchObject({ status: "invalid", issue: "gate5_stored_revision_mismatch" });
    await expect(
      configuredGate5Revision(environment, {
        ...dependencies,
        readGate5RevisionFreeze: vi.fn(async () => ({
          ...fixture.revision,
          baselineEvidenceDigest: "0".repeat(64)
        }))
      } as unknown as Gate5RevisionDependencies)
    ).resolves.toMatchObject({ status: "invalid", issue: "gate5_revision_digest_invalid" });
    const { receiptHash: _receiptHash, ...repairWithoutHash } = fixture.repairBuilderReceipt;
    void _receiptHash;
    const differentRepairPayload = {
      ...repairWithoutHash,
      rationale: `${repairWithoutHash.rationale} Different retained receipt.`
    };
    await expect(
      configuredGate5Revision(environment, {
        ...dependencies,
        readRepairProviderReceipt: vi.fn(async () => ({
          repairBuilderReceipt: {
            ...differentRepairPayload,
            receiptHash: await canonicalSha256(differentRepairPayload)
          }
        }))
      } as unknown as Gate5RevisionDependencies)
    ).resolves.toMatchObject({ status: "invalid", issue: "gate5_one_variable_diff_mismatch" });
    await expect(
      configuredGate5Revision(
        { ...environment, TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH: "0".repeat(64) },
        dependencies
      )
    ).resolves.toMatchObject({
      status: "invalid",
      issue: "gate6_presentation_proof_binding_invalid"
    });

    const nonTerminalEnvironment = {
      ...environment,
      TOOLPROOF_COMMIT_SHA: fixture.revision.v2AppCommit
    };
    await expect(
      configuredGate5Revision(nonTerminalEnvironment, dependencies)
    ).resolves.toMatchObject({ status: "awaiting-human", revision: null });
    const approvalOnly = {
      ...nonTerminalEnvironment,
      TOOLPROOF_GATE5_REVISION_APPROVAL_B64: Buffer.from(
        canonicalJson(fixture.revision.revisionApproval)
      ).toString("base64url")
    };
    await expect(configuredGate5Revision(approvalOnly, dependencies)).resolves.toMatchObject({
      status: "invalid",
      issue: "gate5_source_diff_proof_missing"
    });
    const completeNonTerminal = {
      ...approvalOnly,
      TOOLPROOF_GATE5_SOURCE_DIFF_PROOF_B64: Buffer.from(
        canonicalJson(fixture.revision.sourceDiffProof)
      ).toString("base64url")
    };
    await expect(configuredGate5Revision(completeNonTerminal, dependencies)).resolves.toMatchObject(
      { status: "ready", revision: fixture.revision }
    );
    expect(createTarget).toHaveBeenCalledWith(fixture.revision.v2AppCommit);
  });

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
    const oldDescription = review.targetContract.initialManifest.tools.find(
      ({ name }) => name === "checkout_request"
    )!.description;
    const exactSourceDiffProof = await sourceDiffProof(oldDescription, proposedDescription);
    const revision = await buildGate5RevisionFreeze({
      gate3ReviewPackage: review,
      gate3FrozenProtocol: frozen,
      baselineRunId: repairBuilderReceipt.baselineRunId,
      baselineEvidenceDigest: repairBuilderReceipt.baselineEvidenceDigest,
      repairBuilderReceipt,
      revisionApproval,
      v2TargetContract,
      sourceDiffProof: exactSourceDiffProof
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
    await expect(verifyGate5RevisionFreezeIntegrity(revision)).resolves.toBeUndefined();
    const tamperedSourceProof = {
      ...revision.sourceDiffProof,
      patchSha256: "0".repeat(64)
    };
    const { revisionFreezeHash: _ignored, ...revisionWithoutDigest } = revision;
    void _ignored;
    const tamperedWithoutDigest = {
      ...revisionWithoutDigest,
      sourceDiffProof: tamperedSourceProof
    };
    await expect(
      verifyGate5RevisionFreezeIntegrity({
        ...tamperedWithoutDigest,
        revisionFreezeHash: await canonicalSha256(tamperedWithoutDigest)
      } as typeof revision)
    ).rejects.toThrow(/gate5_source_diff_proof_hash_mismatch/u);
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
        sourceDiffProof: exactSourceDiffProof,
        v2TargetContract: {
          ...v2TargetContract,
          domainVersion: "changed-domain@2"
        }
      })
    ).rejects.toThrow(/gate5_one_variable_diff_mismatch/u);
  });
});
