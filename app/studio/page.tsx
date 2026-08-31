import type { Metadata } from "next";

import {
  StudioClient,
  type StudioCaseReviewProjection,
  type StudioFamilySummary,
  type StudioReviewPackageView
} from "@/components/studio/studio-client";
import { canonicalJson } from "@/lib/evidence/digest";
import { PRODUCT_NAME } from "@/lib/brand";
import {
  gate3ReviewPackageCanonicalJson,
  type Gate3HumanReviewPackage
} from "@/lib/semantic/checkout-candidate.server";
import { semanticMeaningForCase } from "@/lib/semantic/contract";
import { configuredGate3FrozenProtocol } from "@/lib/semantic/frozen-config.server";
import type { Gate3FrozenProtocol } from "@/lib/semantic/human-freeze.server";
import { configuredGate3ReviewPackage } from "@/lib/semantic/review-package-config.server";
import type { LastVerifiedTargetSnapshot } from "@/lib/studio/meta-tools";

export const metadata: Metadata = { title: "Studio" };

const LAST_VERIFIED_TARGET: LastVerifiedTargetSnapshot = Object.freeze({
  receiptVersion: "toolproof-last-verified-target@1.0.0",
  status: "last-verified",
  claimBoundary: "not-live-lab-registry",
  sourceLane: "authentic-gate2-fallback",
  sourceCommit: "93a602ea6d8eedb56f0f2b8e9abb6468512b2aa9",
  sourceEvidenceDigest: "8a4f674ff68ea02a8f2b9792ceb88eea7bb9657b995ee80778d6e8ac56df355b",
  verifiedAt: "2026-08-28T18:05:26.760Z",
  manifestHash: "e78c5752c16296c2dcc273e5c8718afc8198a2eefcb1d4bdbb47087b1d6d0392",
  registrationGeneration: 1,
  catalogState: "initial",
  toolsetVersion: "checkout-toolset-v1@1.0.0",
  domainVersion: "checkout-domain@1.0.0",
  registeredToolNames: Object.freeze([
    "cart_get",
    "cart_update",
    "checkout_request",
    "order_review"
  ]),
  manifest: Object.freeze([
    Object.freeze({
      name: "cart_get",
      title: "Read cart lines",
      description:
        "Return current cart line-item identities and quantities when the user asks what is in the cart.",
      inputSchema: Object.freeze({
        type: "object",
        properties: Object.freeze({}),
        additionalProperties: false
      }),
      annotations: Object.freeze({ readOnlyHint: true })
    }),
    Object.freeze({
      name: "cart_update",
      title: "Set cart quantity",
      description:
        "Set one current cart line to the quantity the user requests and return the resulting cart revision.",
      inputSchema: Object.freeze({
        type: "object",
        properties: Object.freeze({
          operationId: Object.freeze({
            type: "string",
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
            description: "Unique 16–64 character URL-safe ID for retry-safe mutation execution."
          }),
          operation: Object.freeze({
            type: "string",
            enum: Object.freeze(["set_quantity"]),
            description: "Set one cart line to the declared quantity."
          }),
          itemId: Object.freeze({
            type: "string",
            enum: Object.freeze(["field-notebook", "stoneware-mug"]),
            description: "Fixture item whose quantity should change."
          }),
          quantity: Object.freeze({
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Desired quantity from 1 through 10."
          })
        }),
        required: Object.freeze(["operationId", "operation", "itemId", "quantity"]),
        additionalProperties: false
      }),
      annotations: Object.freeze({ readOnlyHint: false })
    }),
    Object.freeze({
      name: "checkout_request",
      title: "Request simulated checkout",
      description:
        "Finalize the current cart by opening a simulated checkout request that remains pending for human approval when the user is ready to proceed.",
      inputSchema: Object.freeze({
        type: "object",
        properties: Object.freeze({
          operationId: Object.freeze({
            type: "string",
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
            description: "Unique 16–64 character URL-safe ID for retry-safe mutation execution."
          })
        }),
        required: Object.freeze(["operationId"]),
        additionalProperties: false
      }),
      annotations: Object.freeze({ readOnlyHint: false })
    }),
    Object.freeze({
      name: "order_review",
      title: "Review order summary",
      description:
        "Return the current final read-only order summary with line prices, subtotal, shipping cost, delivery estimate, and total when the user asks to review the order.",
      inputSchema: Object.freeze({
        type: "object",
        properties: Object.freeze({}),
        additionalProperties: false
      }),
      annotations: Object.freeze({ readOnlyHint: true })
    })
  ])
});

const FAMILIES: readonly StudioFamilySummary[] = Object.freeze([
  Object.freeze({
    id: "review-equivalent",
    label: "Review-equivalent realizations",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "Materially different wording; same read-only review meaning"
  }),
  Object.freeze({
    id: "checkout-equivalent",
    label: "Checkout-equivalent realizations",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "Materially different wording; same explicit commitment"
  }),
  Object.freeze({
    id: "commitment-boundary",
    label: "Commitment-boundary matched pairs",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "One declared commitment field changes per pair"
  }),
  Object.freeze({
    id: "negation-scope-boundary",
    label: "Negation/scope-boundary matched pairs",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "One declared negation or contrast-scope field changes per pair"
  }),
  Object.freeze({
    id: "argument-boundary",
    label: "Argument-boundary matched pairs",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "One declared item, quantity, or operation field changes per pair"
  }),
  Object.freeze({
    id: "ambiguity-explicit",
    label: "Ambiguity versus explicit intent",
    total: 4,
    development: 2,
    holdout: 2,
    relationship: "One declared sufficiency-of-intent field changes per pair"
  })
]);

const PREPARING_REVIEW_PACKAGE: StudioReviewPackageView = Object.freeze({
  version: "toolproof-gate3-human-review-package@1.0.0-candidate",
  status: "preparing",
  packageHash: null,
  frozenProtocolHash: null,
  humanReviewReceiptId: null,
  reviewedAt: null,
  exactPackageReady: false,
  totalCases: 24,
  developmentCases: 12,
  holdoutCases: 12,
  repetitionCount: 1,
  families: FAMILIES,
  cases: Object.freeze([]),
  canonicalJson: null,
  successorLineage: null,
  readinessIssues: Object.freeze([
    "Exact 24-case texts and human-review fields are not loaded.",
    "Component hashes and canonical frozen-run manifest are not loaded.",
    "No genuine Sergio review receipt exists."
  ]),
  contractDraft: Object.freeze({
    title: `${PRODUCT_NAME} checkout/review semantic contract`,
    meaningPrinciple:
      "Human-approved meaning-equivalent requests must produce the same canonical single-step action signature; one declared semantic boundary may change that signature.",
    clarificationPolicy:
      "Ambiguous or insufficient consequential intent requires clarification or no action; it must not create a pending checkout.",
    effectPolicy:
      "Observed state changes must match the approved action and effect predicates. Read-only decisions may not mutate checkout state."
  })
});

function expectedDecision(
  contract: Gate3HumanReviewPackage["contract"],
  reviewCase: Gate3HumanReviewPackage["suite"]["scoredCases"][number]
): string {
  const expectation = semanticMeaningForCase(contract, reviewCase).expectation;
  if (expectation.kind === "call") return `Call ${expectation.tool}`;
  if (expectation.kind === "clarify") return "Clarify; make no target call";
  return "No action; make no target call";
}

function relationshipId(
  reviewCase: Gate3HumanReviewPackage["suite"]["scoredCases"][number]
): string {
  return reviewCase.relationship.kind === "equivalent_realization"
    ? reviewCase.relationship.groupId
    : reviewCase.relationship.pairId;
}

function exactReviewPackage(
  review: Gate3HumanReviewPackage,
  frozen: Gate3FrozenProtocol | null
): StudioReviewPackageView {
  const caseByRunnerId = new Map(
    review.suite.scoredCases.map((reviewCase) => [reviewCase.runnerCaseId, reviewCase])
  );
  const cases: StudioCaseReviewProjection[] = review.schedule.orderedRunnerCaseIds.map(
    (runnerCaseId, index) => {
      const reviewCase = caseByRunnerId.get(runnerCaseId);
      if (!reviewCase) throw new Error(`Gate 3 schedule references unknown ${runnerCaseId}.`);
      const approved = semanticMeaningForCase(review.contract, reviewCase);
      const expectation = approved.expectation;
      return {
        opaqueId: reviewCase.runnerCaseId,
        ordinal: index + 1,
        subset: reviewCase.subset,
        family: reviewCase.family,
        relationshipId: relationshipId(reviewCase),
        prompt: reviewCase.naturalLanguageRequest,
        meaningIdentity: approved.meaningId,
        meaningSpec: approved.approvedMeaning,
        expectedDecision: expectedDecision(review.contract, reviewCase),
        argumentPredicate:
          expectation.kind === "call"
            ? canonicalJson(expectation.arguments)
            : "No target arguments; zero target calls.",
        allowedEffects: approved.allowedEffects,
        forbiddenEffects: approved.forbiddenEffects,
        approvalClass: approved.approvalClass,
        fixtureId: reviewCase.fixtureId
      };
    }
  );
  return Object.freeze({
    version: review.version,
    status: frozen ? "frozen" : "awaiting-human",
    packageHash: review.packageHash,
    frozenProtocolHash: frozen?.frozenProtocolHash ?? null,
    humanReviewReceiptId: frozen?.humanReviewReceipt.receiptId ?? null,
    reviewedAt: frozen?.humanReviewReceipt.reviewedAt ?? null,
    exactPackageReady: true,
    totalCases: 24,
    developmentCases: 12,
    holdoutCases: 12,
    repetitionCount: 1,
    families: FAMILIES,
    cases: Object.freeze(cases),
    canonicalJson: gate3ReviewPackageCanonicalJson(review),
    successorLineage: review.successorLineage
      ? Object.freeze({
          disposition: review.successorLineage.disposition,
          predecessorRunId: review.successorLineage.predecessor.runId,
          predecessorEvidenceDigest: review.successorLineage.predecessor.evidenceDigest,
          priorRepairReceiptHash: review.successorLineage.priorRepair.repairBuilderReceiptHash,
          baselinePhaseCallOffset: review.successorLineage.phaseCallOffsets.baseline,
          repairPhaseCallOffset: review.successorLineage.phaseCallOffsets.repair,
          revisedPhaseCallOffset: review.successorLineage.phaseCallOffsets.revised,
          originalAuthoringContextRemainsTerminated: true as const,
          lineageHash: review.successorLineage.lineageHash
        })
      : null,
    readinessIssues: frozen
      ? Object.freeze([])
      : Object.freeze([
          "No genuine Sergio semantic-review receipt exists yet; this exact package is not frozen.",
          "No scored request is admitted before approval, freeze, Authoring Builder termination, and fresh-run readiness."
        ]),
    contractDraft: Object.freeze({
      title: `${PRODUCT_NAME} checkout/review semantic contract`,
      meaningPrinciple: review.contract.equivalencePrinciple,
      clarificationPolicy:
        "Missing user-controlled intent or arguments require the exact approved clarification outcome and zero target calls.",
      effectPolicy:
        "Only explicitly allowed state/effect surfaces may change; all other modeled and unmodeled surfaces are forbidden."
    })
  });
}

export default async function StudioPage() {
  const [configured, frozenConfiguration] = await Promise.all([
    configuredGate3ReviewPackage(),
    configuredGate3FrozenProtocol()
  ]);
  const exactPackage =
    configured.status === "missing" ? frozenConfiguration.reviewPackage : configured.reviewPackage;
  const frozen =
    frozenConfiguration.status === "frozen" &&
    frozenConfiguration.protocol?.reviewPackageHash === exactPackage?.packageHash
      ? frozenConfiguration.protocol
      : null;
  const reviewPackage = exactPackage
    ? exactReviewPackage(exactPackage, frozen)
    : configured.status === "invalid"
      ? Object.freeze({
          ...PREPARING_REVIEW_PACKAGE,
          status: "preparing" as const,
          readinessIssues: Object.freeze([
            "Configured Gate 3 source binding failed closed.",
            configured.issue ?? "gate3_source_binding_invalid",
            "No genuine Sergio review receipt exists."
          ])
        })
      : PREPARING_REVIEW_PACKAGE;
  // thurstone-impact-execution:studio-presentation-only
  return (
    <div className="page-shell route-page">
      <section className="panel impact-execution-entry" aria-labelledby="studio-contract-first">
        <p className="eyebrow">
          {frozen ? "Human-approved contract" : "Contract awaiting human review"}
        </p>
        <h1 id="studio-contract-first">
          {frozen
            ? "The contract defines what each request is allowed to mean."
            : "This contract still requires human approval."}
        </h1>
        <p>
          Tentative checkout intent must stay tentative. Explicit authorization may create one
          pending approval—and nothing beyond it.
        </p>
      </section>
      <StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />
    </div>
  );
}
