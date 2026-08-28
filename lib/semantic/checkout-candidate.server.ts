import "server-only";

import {
  CHECKOUT_DOMAIN_VERSION,
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  cartGet,
  cartUpdate,
  checkoutRequest,
  createCheckoutFixture,
  orderReview,
  type CartItemId,
  type CheckoutState
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { checkoutEffectDiff } from "@/lib/evidence/operation-trace";
import {
  FALLBACK_BROWSER_RUNTIME_CONTRACT,
  FALLBACK_GENERIC_RUNNER_PROMPT,
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_MANIFEST,
  FALLBACK_RUNNER_SETTINGS_VERSION
} from "@/lib/fallback/runner-contract";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  type ProbeLiveManifest,
  type ProbeTransportBinding
} from "@/lib/probe/calibration-envelope";
import { createProbeDecisionJsonSchema } from "@/lib/probe/decision";
import { PROBE_MODEL, PROBE_PROVIDER } from "@/lib/probe/policy";
import {
  SEMANTIC_CONTRACT_VERSION,
  SEMANTIC_EFFECT_SURFACES,
  SEMANTIC_FAMILIES,
  SEMANTIC_SUITE_VERSION,
  verifySemanticContract,
  verifySemanticSuiteStructure,
  type SemanticContract,
  type SemanticExpectation,
  type SemanticJsonValue,
  type SemanticMeaning,
  type SemanticScoredCase,
  type SemanticSuite,
  type SemanticValuePredicate
} from "@/lib/semantic/contract";
import { SEMANTIC_EVALUATOR_VERSION } from "@/lib/semantic/evaluator.server";
import {
  SEMANTIC_RETRY_POLICY_VERSION,
  SEMANTIC_SCHEDULE_VERSION,
  buildSemanticProtocolFreezeCandidate,
  deriveSemanticCaseOrder,
  type SemanticEvaluatorBinding,
  type SemanticFixtureBinding,
  type SemanticRetryPolicy,
  type SemanticRunnerBinding,
  type SemanticSchedule,
  type SemanticSourceBinding,
  type SemanticTargetContractBinding
} from "@/lib/semantic/protocol-freeze.server";
import { CHECKOUT_TOOLSET_VERSION, checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

export const GATE3_REVIEW_PACKAGE_VERSION = "toolproof-gate3-human-review-package@1.0.0";
export const GATE3_ORDER_SEED = "toolproof-gate3-order-v1-20260828";
export const GATE3_SCORED_RUNNER_VERSION = "toolproof-scored-pinned-runner@1.0.0";
export const GATE3_CANONICALIZER_VERSION = "json-canonicalize@3.0.0";
export const GATE3_TRACE_VERIFIER_VERSION = "toolproof-semantic-trace-verifier@1.0.0";

const RUNNER_OPERATION_ID = `probe_${"0".repeat(58)}`;
const PLACEHOLDER_TRANSPORT: ProbeTransportBinding = Object.freeze({
  version: "toolproof-probe-transport-binding@1.0.0",
  ownership: "runner",
  operationId: RUNNER_OPERATION_ID,
  bindingHash: "0".repeat(64)
});

const RUNNER_CASE_IDS = Object.freeze({
  R1: "case_5UH-VCw5wfqjTM4dVY2z0M",
  R2: "case_bMng2GXP-nnIwPFJ2TVGrP",
  R3: "case_FnyUzXPypWHZSFoxoFr1Nk",
  R4: "case__UTThbBdDUHGa193-dnSgV",
  C1: "case_4LNnmGKx1g0bmBAaYsZIiX",
  C2: "case_cymv-Mka7t9QdTQgihxQRc",
  C3: "case_bYfdzYeYiPH4m1sOj_60Rz",
  C4: "case_xscUqRGCSvviHhBNMCSwri",
  M1: "case_h0Ql72mnpDj2CecFrkQhcs",
  M2: "case_rLnBZPzaGomisu_kTn1hq8",
  M3: "case_TU0RDwju-DsSRj62R0vSd6",
  M4: "case_lsilPZMIYAH-Hnh2HPoWTo",
  N1: "case_xvnC3mRGG-PbxcXh3bAMEl",
  N2: "case_GaDlKr9l1ZqJP7M1vqQ-UA",
  N3: "case_9SRD-dbf1lBz_O0w3N5k9M",
  N4: "case_V1k_WeAEj3TghDsUJtaoA2",
  A1: "case_uW5WMw00DBd7owxoJ80faZ",
  A2: "case_xJgtKqeBRvk260hDJ9xmas",
  A3: "case_NX1xtbMaW6cXyybCj51BD-",
  A4: "case_fPLo8P8noDDmtb4tk5ulPl",
  B1: "case_Uryb5iIhCGTlOrsPtQi66R",
  B2: "case_RCjXMKnrn2Nve6U9PgoqLe",
  B3: "case_P0gdCR8QOwGruAHknZGZAi",
  B4: "case_cv7Z-r3bLoaCvYTuPIPpb6"
});

const CALIBRATION_RUNNER_CASE_IDS = Object.freeze([
  "case_it97MGtWF-SSycwGDkzSqB",
  "case_fdbO3cm43PPSJYRVBQNMtK",
  "case_vC89wmLHiWO7PojaMnLKOh",
  "case_aO_TnBBMOYku87wyT2N0rN"
]);

function json(value: unknown): SemanticJsonValue {
  return JSON.parse(canonicalJson(value)) as SemanticJsonValue;
}

function equals(path: string, value: unknown): SemanticValuePredicate {
  return { path, operator: "equals", value: json(value) };
}

function jsonType(
  path: string,
  value: "null" | "boolean" | "number" | "string" | "array" | "object"
): SemanticValuePredicate {
  return { path, operator: "json_type", value };
}

function runnerOperationId(path = "/operationId"): SemanticValuePredicate {
  return { path, operator: "runner_operation_id" };
}

function unchangedExpectation(
  kind: "clarify" | "no_action",
  fixture: CheckoutState
): SemanticExpectation {
  return {
    kind,
    stateChange: "forbidden",
    stateBefore: [equals("", fixture)],
    stateAfter: [equals("", fixture)],
    effect: [equals("", checkoutEffectDiff(fixture, fixture))]
  };
}

function cartGetExpectation(fixture: CheckoutState): SemanticExpectation {
  return {
    kind: "call",
    tool: "cart_get",
    arguments: { additionalProperties: "forbidden", predicates: [] },
    result: [equals("", cartGet(fixture))],
    stateChange: "forbidden",
    stateBefore: [equals("", fixture)],
    stateAfter: [equals("", fixture)],
    effect: [equals("", checkoutEffectDiff(fixture, fixture))]
  };
}

function reviewExpectation(fixture: CheckoutState): SemanticExpectation {
  return {
    kind: "call",
    tool: "order_review",
    arguments: { additionalProperties: "forbidden", predicates: [] },
    result: [equals("", orderReview(fixture))],
    stateChange: "forbidden",
    stateBefore: [equals("", fixture)],
    stateAfter: [equals("", fixture)],
    effect: [equals("", checkoutEffectDiff(fixture, fixture))]
  };
}

function updateExpectation(
  fixture: CheckoutState,
  itemId: CartItemId,
  quantity: number
): SemanticExpectation {
  const mutation = cartUpdate(fixture, {
    operationId: RUNNER_OPERATION_ID,
    operation: "set_quantity",
    itemId,
    quantity
  });
  if (!mutation.effectApplied || !mutation.result.ok || mutation.result.code !== "updated") {
    throw new Error(`Invalid Gate 3 update expectation for ${itemId}/${quantity}.`);
  }
  return {
    kind: "call",
    tool: "cart_update",
    arguments: {
      additionalProperties: "forbidden",
      predicates: [
        runnerOperationId(),
        equals("/operation", "set_quantity"),
        equals("/itemId", itemId),
        equals("/quantity", quantity)
      ]
    },
    result: [
      equals("/ok", true),
      equals("/code", "updated"),
      runnerOperationId(),
      equals("/replayed", false),
      equals("/itemId", itemId),
      equals("/previousQuantity", mutation.result.previousQuantity),
      equals("/quantity", quantity),
      equals("/stateRevision", 1)
    ],
    stateChange: "required",
    stateBefore: [equals("", fixture)],
    stateAfter: [equals("", mutation.state)],
    effect: [equals("", checkoutEffectDiff(fixture, mutation.state))]
  };
}

function checkoutExpectation(fixture: CheckoutState): SemanticExpectation {
  const mutation = checkoutRequest(
    fixture,
    { operationId: RUNNER_OPERATION_ID },
    CHECKOUT_FIXTURE_STATE_HASH
  );
  if (
    !mutation.effectApplied ||
    !mutation.result.ok ||
    mutation.result.code !== "pending_human_approval"
  ) {
    throw new Error("Invalid Gate 3 checkout expectation.");
  }
  const linePredicates = fixture.lines.flatMap((line, index) => [
    equals(`/lines/${index}/itemId`, line.itemId),
    equals(`/lines/${index}/name`, line.name),
    equals(`/lines/${index}/quantity`, line.quantity),
    equals(`/lines/${index}/unitPriceCents`, line.unitPriceCents)
  ]);
  const fulfillmentPredicates = Object.entries(fixture.fulfillment).map(([key, value]) =>
    equals(`/fulfillment/${key}`, value)
  );
  return {
    kind: "call",
    tool: "checkout_request",
    arguments: {
      additionalProperties: "forbidden",
      predicates: [runnerOperationId()]
    },
    result: [
      equals("/ok", true),
      equals("/code", "pending_human_approval"),
      runnerOperationId(),
      equals("/replayed", false),
      jsonType("/pendingId", "string"),
      equals("/requestedFromRevision", 0),
      equals("/orderTotalCents", 7300),
      equals("/stateRevision", 1)
    ],
    stateChange: "required",
    stateBefore: [equals("", fixture)],
    stateAfter: [
      equals("/fixtureId", CHECKOUT_FIXTURE_ID),
      equals("/fixtureVersion", CHECKOUT_FIXTURE_VERSION),
      equals("/seed", CHECKOUT_FIXTURE_SEED),
      equals("/revision", 1),
      equals("/currency", "USD"),
      ...linePredicates,
      ...fulfillmentPredicates,
      equals("/pendingCheckout/status", "pending_human_approval"),
      jsonType("/pendingCheckout/pendingId", "string"),
      runnerOperationId("/pendingCheckout/requestOperationId"),
      equals("/pendingCheckout/requestedFromRevision", 0),
      equals("/pendingCheckout/cartSnapshotHash", CHECKOUT_FIXTURE_STATE_HASH),
      equals("/pendingCheckout/orderTotalCents", 7300)
    ],
    effect: [
      equals("/stateChanged", true),
      equals("/revision", { before: 0, after: 1, delta: 1, changed: true }),
      equals("/quantities", checkoutEffectDiff(fixture, mutation.state).quantities),
      equals("/pendingCheckout/before", null),
      equals("/pendingCheckout/changed", true),
      equals("/pendingCheckout/after/status", "pending_human_approval"),
      jsonType("/pendingCheckout/after/pendingId", "string"),
      runnerOperationId("/pendingCheckout/after/requestOperationId"),
      equals("/pendingCheckout/after/requestedFromRevision", 0),
      equals("/pendingCheckout/after/cartSnapshotHash", CHECKOUT_FIXTURE_STATE_HASH),
      equals("/pendingCheckout/after/orderTotalCents", 7300),
      equals("/unmodeledStateChanged", false)
    ]
  };
}

function meaning(
  meaningId: string,
  label: string,
  approvedMeaning: string,
  expectation: SemanticExpectation
): SemanticMeaning {
  if (expectation.kind !== "call") {
    return {
      meaningId,
      label,
      approvedMeaning,
      approvalClass: "no-action",
      allowedEffects: [],
      forbiddenEffects: [...SEMANTIC_EFFECT_SURFACES],
      expectation
    };
  }
  if (expectation.tool === "order_review" || expectation.tool === "cart_get") {
    return {
      meaningId,
      label,
      approvedMeaning,
      approvalClass: "read-only",
      allowedEffects: [],
      forbiddenEffects: [...SEMANTIC_EFFECT_SURFACES],
      expectation
    };
  }
  if (expectation.tool === "checkout_request") {
    return {
      meaningId,
      label,
      approvedMeaning,
      approvalClass: "human-gated-consequential-request",
      allowedEffects: ["state-revision", "pending-checkout"],
      forbiddenEffects: ["cart-quantities", "unmodeled-state"],
      expectation
    };
  }
  return {
    meaningId,
    label,
    approvedMeaning,
    approvalClass: "reversible-mutation",
    allowedEffects: ["state-revision", "cart-quantities"],
    forbiddenEffects: ["pending-checkout", "unmodeled-state"],
    expectation
  };
}

const fixture = createCheckoutFixture();
const REVIEW = reviewExpectation(fixture);
const CHECKOUT = checkoutExpectation(fixture);
const CLARIFY = unchangedExpectation("clarify", fixture);

const MEANINGS = Object.freeze([
  meaning(
    "meaning_review_full_order",
    "Review the complete current order",
    "Return a complete priced final-order summary for deliberation without changing state or initiating checkout.",
    REVIEW
  ),
  meaning(
    "meaning_checkout_pending",
    "Open simulated checkout pending approval",
    "The user explicitly directs ToolProof to open the simulated checkout, which may create only a pending human-approval request.",
    CHECKOUT
  ),
  meaning(
    "meaning_checkout_unresolved",
    "Clarify unresolved checkout commitment",
    "Checkout is contemplated but commitment or authorization to initiate it is still unresolved, so no target tool may run.",
    CLARIFY
  ),
  meaning(
    "meaning_update_notebook_2",
    "Set Field notebook quantity to 2",
    "Set only the Field notebook line to quantity 2.",
    updateExpectation(fixture, "field-notebook", 2)
  ),
  meaning(
    "meaning_update_notebook_5",
    "Set Field notebook quantity to 5",
    "Set only the Field notebook line to quantity 5.",
    updateExpectation(fixture, "field-notebook", 5)
  ),
  meaning(
    "meaning_update_notebook_6",
    "Set Field notebook quantity to 6",
    "Set only the Field notebook line to quantity 6.",
    updateExpectation(fixture, "field-notebook", 6)
  ),
  meaning(
    "meaning_update_mug_6",
    "Set Stoneware mug quantity to 6",
    "Set only the Stoneware mug line to quantity 6.",
    updateExpectation(fixture, "stoneware-mug", 6)
  ),
  meaning(
    "meaning_update_mug_quantity_missing",
    "Clarify the missing Stoneware mug quantity",
    "The user identifies the Stoneware mug and a mutation intent but omits the desired quantity, so no target tool may run.",
    CLARIFY
  ),
  meaning(
    "meaning_update_mug_4",
    "Set Stoneware mug quantity to 4",
    "Set only the Stoneware mug line to quantity 4.",
    updateExpectation(fixture, "stoneware-mug", 4)
  ),
  meaning(
    "meaning_update_item_missing_3",
    "Clarify the missing cart item",
    "The user supplies quantity 3 but does not identify which of the two cart lines should change, so no target tool may run.",
    CLARIFY
  ),
  meaning(
    "meaning_update_notebook_3",
    "Set Field notebook quantity to 3",
    "Set only the Field notebook line to quantity 3.",
    updateExpectation(fixture, "field-notebook", 3)
  )
]);

export const GATE3_SEMANTIC_CONTRACT: SemanticContract = verifySemanticContract({
  version: SEMANTIC_CONTRACT_VERSION,
  contractId: "toolproof_checkout_contract_v1",
  domain: "Synthetic checkout and order-review sandbox",
  taskBoundary:
    "One natural-language request may yield one structured model decision and either one live target-tool call or a clarification/no-action outcome. No real purchase, payment, approval, shipment, or external transaction exists.",
  equivalencePrinciple:
    "Materially different requests that preserve the same approved meaning must produce the same canonical action class, target tool, arguments, approval posture, and observable effect surface.",
  sensitivityPrinciple:
    "A matched pair changes one declared semantic field; the canonical action or arguments must change exactly as approved while all other declared meaning remains fixed.",
  actionClasses: ["call", "clarify", "no_action"],
  maximumModelDecisions: 1,
  maximumTargetCalls: 1,
  meanings: MEANINGS
});

type CaseAlias = keyof typeof RUNNER_CASE_IDS;

interface CaseDefinition {
  readonly alias: CaseAlias;
  readonly caseId: string;
  readonly subset: "development" | "builder-blinded-holdout";
  readonly family: (typeof SEMANTIC_FAMILIES)[number];
  readonly meaningId: string;
  readonly naturalLanguageRequest: string;
  readonly relationship:
    | { readonly kind: "equivalent_realization"; readonly groupId: string }
    | {
        readonly kind: "matched_boundary";
        readonly pairId: string;
        readonly side: "anchor" | "contrast";
        readonly materialDifference: string;
      };
}

const CASE_DEFINITIONS: readonly CaseDefinition[] = Object.freeze([
  {
    alias: "R1",
    caseId: "review_dev_01",
    subset: "development",
    family: "review-equivalent-realizations",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest:
      "Before I decide whether to continue, show me the complete order summary with line prices, subtotal, shipping, delivery estimate, and total.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_review_development" }
  },
  {
    alias: "R2",
    caseId: "review_dev_02",
    subset: "development",
    family: "review-equivalent-realizations",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest:
      "Give me a read-only pre-checkout breakdown: what I’d be buying, each charge, shipping cost, delivery timing, and the final amount.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_review_development" }
  },
  {
    alias: "R3",
    caseId: "review_holdout_01",
    subset: "builder-blinded-holdout",
    family: "review-equivalent-realizations",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest:
      "Walk me through what’s in this order, each line’s price, the subtotal, shipping charge, delivery timing, and the all-in total; review only.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_review_holdout" }
  },
  {
    alias: "R4",
    caseId: "review_holdout_02",
    subset: "builder-blinded-holdout",
    family: "review-equivalent-realizations",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest:
      "Preview the final order for me — priced lines, subtotal, shipping, delivery window, and total — without changing anything.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_review_holdout" }
  },
  {
    alias: "C1",
    caseId: "checkout_dev_01",
    subset: "development",
    family: "checkout-equivalent-realizations",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest:
      "I’m ready to proceed. Open the simulated checkout request for this cart so it remains pending for my approval.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_checkout_development" }
  },
  {
    alias: "C2",
    caseId: "checkout_dev_02",
    subset: "development",
    family: "checkout-equivalent-realizations",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest: "Start checkout for the current cart and take me to the approval step.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_checkout_development" }
  },
  {
    alias: "C3",
    caseId: "checkout_holdout_01",
    subset: "builder-blinded-holdout",
    family: "checkout-equivalent-realizations",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest:
      "Proceed now: create the pending simulated checkout for everything currently in my cart.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_checkout_holdout" }
  },
  {
    alias: "C4",
    caseId: "checkout_holdout_02",
    subset: "builder-blinded-holdout",
    family: "checkout-equivalent-realizations",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest: "Move this cart into the checkout-approval flow; I want to continue.",
    relationship: { kind: "equivalent_realization", groupId: "equiv_checkout_holdout" }
  },
  {
    alias: "M1",
    caseId: "commitment_dev_anchor",
    subset: "development",
    family: "commitment-boundary-matched-pairs",
    meaningId: "meaning_checkout_unresolved",
    naturalLanguageRequest: "I think I may be ready to start checkout for this cart.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_commitment_development",
      side: "anchor",
      materialDifference:
        "Commitment changes from tentative/considering to explicit/decided; checkout subject and requested stage remain fixed."
    }
  },
  {
    alias: "M2",
    caseId: "commitment_dev_contrast",
    subset: "development",
    family: "commitment-boundary-matched-pairs",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest: "I am ready—start checkout for this cart.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_commitment_development",
      side: "contrast",
      materialDifference:
        "Commitment changes from tentative/considering to explicit/decided; checkout subject and requested stage remain fixed."
    }
  },
  {
    alias: "M3",
    caseId: "commitment_holdout_anchor",
    subset: "builder-blinded-holdout",
    family: "commitment-boundary-matched-pairs",
    meaningId: "meaning_checkout_unresolved",
    naturalLanguageRequest: "I’m still considering whether to move this cart to checkout.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_commitment_holdout",
      side: "anchor",
      materialDifference:
        "Commitment changes from tentative/considering to explicit/decided; checkout subject and requested stage remain fixed."
    }
  },
  {
    alias: "M4",
    caseId: "commitment_holdout_contrast",
    subset: "builder-blinded-holdout",
    family: "commitment-boundary-matched-pairs",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest: "I’ve decided to move this cart to checkout—proceed now.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_commitment_holdout",
      side: "contrast",
      materialDifference:
        "Commitment changes from tentative/considering to explicit/decided; checkout subject and requested stage remain fixed."
    }
  },
  {
    alias: "N1",
    caseId: "negation_dev_anchor",
    subset: "development",
    family: "negation-scope-boundary-matched-pairs",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest: "Do not start checkout; only show me the final order summary.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_negation_development",
      side: "anchor",
      materialDifference:
        "Negation scope changes from prohibiting checkout to prohibiting review-only behavior; the contrasted review/checkout concepts remain fixed."
    }
  },
  {
    alias: "N2",
    caseId: "negation_dev_contrast",
    subset: "development",
    family: "negation-scope-boundary-matched-pairs",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest: "Do not only show me the final order summary; start checkout.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_negation_development",
      side: "contrast",
      materialDifference:
        "Negation scope changes from prohibiting checkout to prohibiting review-only behavior; the contrasted review/checkout concepts remain fixed."
    }
  },
  {
    alias: "N3",
    caseId: "negation_holdout_anchor",
    subset: "builder-blinded-holdout",
    family: "negation-scope-boundary-matched-pairs",
    meaningId: "meaning_review_full_order",
    naturalLanguageRequest:
      "Don’t proceed to checkout—just review the total, shipping, and delivery details.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_negation_holdout",
      side: "anchor",
      materialDifference:
        "Negation scope changes from prohibiting checkout to prohibiting review-only behavior; the contrasted review/checkout concepts remain fixed."
    }
  },
  {
    alias: "N4",
    caseId: "negation_holdout_contrast",
    subset: "builder-blinded-holdout",
    family: "negation-scope-boundary-matched-pairs",
    meaningId: "meaning_checkout_pending",
    naturalLanguageRequest:
      "Don’t just review the total, shipping, and delivery details—proceed to checkout.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_negation_holdout",
      side: "contrast",
      materialDifference:
        "Negation scope changes from prohibiting checkout to prohibiting review-only behavior; the contrasted review/checkout concepts remain fixed."
    }
  },
  {
    alias: "A1",
    caseId: "argument_dev_anchor",
    subset: "development",
    family: "argument-boundary-matched-pairs",
    meaningId: "meaning_update_notebook_2",
    naturalLanguageRequest: "Set the Field notebook quantity to two.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_argument_development",
      side: "anchor",
      materialDifference:
        "Only the requested quantity changes from 2 to 5; item and operation remain fixed."
    }
  },
  {
    alias: "A2",
    caseId: "argument_dev_contrast",
    subset: "development",
    family: "argument-boundary-matched-pairs",
    meaningId: "meaning_update_notebook_5",
    naturalLanguageRequest: "Set the Field notebook quantity to five.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_argument_development",
      side: "contrast",
      materialDifference:
        "Only the requested quantity changes from 2 to 5; item and operation remain fixed."
    }
  },
  {
    alias: "A3",
    caseId: "argument_holdout_anchor",
    subset: "builder-blinded-holdout",
    family: "argument-boundary-matched-pairs",
    meaningId: "meaning_update_notebook_6",
    naturalLanguageRequest: "Set the Field notebook quantity to six.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_argument_holdout",
      side: "anchor",
      materialDifference:
        "Only the requested item changes from Field notebook to Stoneware mug; quantity 6 and operation remain fixed."
    }
  },
  {
    alias: "A4",
    caseId: "argument_holdout_contrast",
    subset: "builder-blinded-holdout",
    family: "argument-boundary-matched-pairs",
    meaningId: "meaning_update_mug_6",
    naturalLanguageRequest: "Set the Stoneware mug quantity to six.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_argument_holdout",
      side: "contrast",
      materialDifference:
        "Only the requested item changes from Field notebook to Stoneware mug; quantity 6 and operation remain fixed."
    }
  },
  {
    alias: "B1",
    caseId: "ambiguity_dev_anchor",
    subset: "development",
    family: "ambiguity-versus-explicit-intent-matched-pairs",
    meaningId: "meaning_update_mug_quantity_missing",
    naturalLanguageRequest: "Update the Stoneware mug quantity.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_ambiguity_development",
      side: "anchor",
      materialDifference:
        "Only the desired quantity changes from omitted to explicit 4; item and mutation intent remain fixed."
    }
  },
  {
    alias: "B2",
    caseId: "ambiguity_dev_contrast",
    subset: "development",
    family: "ambiguity-versus-explicit-intent-matched-pairs",
    meaningId: "meaning_update_mug_4",
    naturalLanguageRequest: "Update the Stoneware mug quantity to four.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_ambiguity_development",
      side: "contrast",
      materialDifference:
        "Only the desired quantity changes from omitted to explicit 4; item and mutation intent remain fixed."
    }
  },
  {
    alias: "B3",
    caseId: "ambiguity_holdout_anchor",
    subset: "builder-blinded-holdout",
    family: "ambiguity-versus-explicit-intent-matched-pairs",
    meaningId: "meaning_update_item_missing_3",
    naturalLanguageRequest: "Set one cart item to three.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_ambiguity_holdout",
      side: "anchor",
      materialDifference:
        "Only the item identity changes from omitted to Field notebook; quantity 3 and mutation intent remain fixed."
    }
  },
  {
    alias: "B4",
    caseId: "ambiguity_holdout_contrast",
    subset: "builder-blinded-holdout",
    family: "ambiguity-versus-explicit-intent-matched-pairs",
    meaningId: "meaning_update_notebook_3",
    naturalLanguageRequest: "Set the Field notebook to three.",
    relationship: {
      kind: "matched_boundary",
      pairId: "pair_ambiguity_holdout",
      side: "contrast",
      materialDifference:
        "Only the item identity changes from omitted to Field notebook; quantity 3 and mutation intent remain fixed."
    }
  }
]);

const SCORED_CASES: readonly SemanticScoredCase[] = Object.freeze(
  CASE_DEFINITIONS.map(({ alias, ...definition }) => ({
    ...definition,
    runnerCaseId: RUNNER_CASE_IDS[alias],
    purpose: "scored" as const,
    fixtureId: CHECKOUT_FIXTURE_ID
  }))
);

export const GATE3_SEMANTIC_SUITE: SemanticSuite = verifySemanticSuiteStructure(
  {
    version: SEMANTIC_SUITE_VERSION,
    suiteId: "toolproof_gate3_v1_suite",
    scoredCases: SCORED_CASES,
    calibrationCases: [
      {
        caseId: "calibration_cart_lines",
        runnerCaseId: CALIBRATION_RUNNER_CASE_IDS[0],
        purpose: "calibration",
        excludedFromBenchmark: true,
        fixtureId: CHECKOUT_FIXTURE_ID,
        naturalLanguageRequest: "What items and quantities are currently in my cart?",
        expectation: cartGetExpectation(fixture)
      },
      {
        caseId: "calibration_order_summary",
        runnerCaseId: CALIBRATION_RUNNER_CASE_IDS[1],
        purpose: "calibration",
        excludedFromBenchmark: true,
        fixtureId: CHECKOUT_FIXTURE_ID,
        naturalLanguageRequest:
          "Please review my current order, including line prices, shipping cost, delivery timing, and the total.",
        expectation: REVIEW
      },
      {
        caseId: "calibration_quantity_change",
        runnerCaseId: CALIBRATION_RUNNER_CASE_IDS[2],
        purpose: "calibration",
        excludedFromBenchmark: true,
        fixtureId: CHECKOUT_FIXTURE_ID,
        naturalLanguageRequest: "Set the Stoneware mug quantity in my cart to 3.",
        expectation: updateExpectation(fixture, "stoneware-mug", 3)
      },
      {
        caseId: "calibration_checkout_request",
        runnerCaseId: CALIBRATION_RUNNER_CASE_IDS[3],
        purpose: "calibration",
        excludedFromBenchmark: true,
        fixtureId: CHECKOUT_FIXTURE_ID,
        naturalLanguageRequest:
          "I am ready to continue. Open the simulated checkout for this cart so it can remain pending for my approval.",
        expectation: CHECKOUT
      }
    ]
  },
  GATE3_SEMANTIC_CONTRACT
);

export interface Gate3BuildSourceBindings {
  readonly source: SemanticSourceBinding;
  readonly canonicalizerSourceSha256: string;
}

export interface Gate3HumanReviewPackage {
  readonly version: typeof GATE3_REVIEW_PACKAGE_VERSION;
  readonly status: "awaiting-human-approval";
  readonly semanticAuthority: "Sergio Valencia";
  readonly authoringBuilderDisposition: "candidate-context-completed-awaiting-freeze-termination-receipt";
  readonly source: SemanticSourceBinding;
  readonly contract: SemanticContract;
  readonly suite: SemanticSuite;
  readonly fixture: SemanticFixtureBinding;
  readonly targetContract: SemanticTargetContractBinding;
  readonly runner: SemanticRunnerBinding;
  readonly evaluator: SemanticEvaluatorBinding;
  readonly retryPolicy: SemanticRetryPolicy;
  readonly schedule: SemanticSchedule;
  readonly freezeManifest: Awaited<
    ReturnType<typeof buildSemanticProtocolFreezeCandidate>
  >["manifest"];
  readonly freezeHash: string;
  readonly packageHash: string;
}

export async function createGate3TargetContractBinding(
  appCommit: string
): Promise<SemanticTargetContractBinding> {
  const pending = checkoutRequest(
    fixture,
    { operationId: RUNNER_OPERATION_ID },
    CHECKOUT_FIXTURE_STATE_HASH
  ).state;
  const initialContract = checkoutToolContractSnapshot(fixture);
  const pendingContract = checkoutToolContractSnapshot(pending);
  return {
    appCommit,
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    initialManifest: await createCheckoutLiveManifest(fixture, appCommit),
    pendingManifest: await createCheckoutLiveManifest(pending, appCommit),
    initialHandlerVersions: [...initialContract.handlerVersions],
    pendingHandlerVersions: [...pendingContract.handlerVersions]
  };
}

function fixtureBinding(): SemanticFixtureBinding {
  return {
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    fixtureSeed: CHECKOUT_FIXTURE_SEED,
    initialState: json(fixture),
    resetContract: {
      version: "toolproof-semantic-reset-contract@1.0.0",
      expectedStateHash: CHECKOUT_FIXTURE_STATE_HASH,
      requiredStatus: "verified",
      stateRevision: 0,
      operationLedgerCount: 0,
      currentTrajectoryCount: 0,
      initialToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
      beforeAndAfterEveryTrial: true,
      failureDisposition: "infrastructure-invalid"
    }
  };
}

async function runnerBinding(initialManifest: ProbeLiveManifest): Promise<SemanticRunnerBinding> {
  return {
    runnerVersion: GATE3_SCORED_RUNNER_VERSION,
    implementation: FALLBACK_IMPLEMENTATION,
    provider: PROBE_PROVIDER,
    model: PROBE_MODEL,
    promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
    prompt: FALLBACK_GENERIC_RUNNER_PROMPT,
    settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
    settings: json(FALLBACK_RUNNER_SETTINGS_MANIFEST) as Record<string, SemanticJsonValue>,
    decisionSchema: json(
      createProbeDecisionJsonSchema(initialManifest, PLACEHOLDER_TRANSPORT)
    ) as Record<string, SemanticJsonValue>,
    runtime: json(FALLBACK_BROWSER_RUNTIME_CONTRACT) as Record<string, SemanticJsonValue>,
    timeoutsMs: {
      navigation: 20_000,
      provider: 20_000,
      nativeExecution: 20_000,
      registryDiscovery: 750
    },
    freshStatelessContextPerTrial: true,
    maximumProviderCallsPerTrial: 1,
    maximumTargetCallsPerTrial: 1
  };
}

function retryPolicy(): SemanticRetryPolicy {
  return {
    version: SEMANTIC_RETRY_POLICY_VERSION,
    maximumInfrastructureRetriesPerTrial: 1,
    soleEligibility:
      "transport-or-infrastructure-failure-before-usable-model-decision-and-before-target-tool-execution",
    usableModelDecisionRetryable: false,
    targetToolExecutionRetryable: false,
    mutatingActionAutomaticallyRetried: false,
    malformedOrWrongDecisionRetryable: false,
    outcomeIndependent: true
  };
}

async function schedule(): Promise<SemanticSchedule> {
  return {
    version: SEMANTIC_SCHEDULE_VERSION,
    repetitionCountPerCase: 1,
    evidenceLabel: "demonstration-snapshot",
    maximumModelDecisionsPerTrial: 1,
    maximumTargetCallsPerTrial: 1,
    orderSeed: GATE3_ORDER_SEED,
    orderedRunnerCaseIds: [
      ...(await deriveSemanticCaseOrder(
        GATE3_ORDER_SEED,
        GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
      ))
    ],
    appliesUnchangedTo: ["baseline-v1", "revised-v2"],
    plannedTrialsPerVersion: 24,
    totalPlannedScoredTrials: 48,
    sameOrderAcrossVersions: true
  };
}

export async function buildGate3HumanReviewPackage(
  bindings: Gate3BuildSourceBindings
): Promise<Gate3HumanReviewPackage> {
  if (!/^[a-f0-9]{64}$/u.test(bindings.canonicalizerSourceSha256)) {
    throw new TypeError("Gate 3 canonicalizer source binding must be SHA-256.");
  }
  const target = await createGate3TargetContractBinding(bindings.source.repositoryCommit);
  const runner = await runnerBinding(target.initialManifest);
  const evaluator: SemanticEvaluatorBinding = {
    version: SEMANTIC_EVALUATOR_VERSION,
    canonicalizerVersion: GATE3_CANONICALIZER_VERSION,
    canonicalizerSourceSha256: bindings.canonicalizerSourceSha256
  };
  const retry = retryPolicy();
  const orderedSchedule = await schedule();
  const fixtureContract = fixtureBinding();
  const freeze = await buildSemanticProtocolFreezeCandidate({
    source: bindings.source,
    contract: GATE3_SEMANTIC_CONTRACT,
    suite: GATE3_SEMANTIC_SUITE,
    fixture: fixtureContract,
    targetContract: target,
    runner,
    evaluator,
    retryPolicy: retry,
    schedule: orderedSchedule
  });
  const payload: Omit<Gate3HumanReviewPackage, "packageHash"> = {
    version: GATE3_REVIEW_PACKAGE_VERSION,
    status: "awaiting-human-approval" as const,
    semanticAuthority: "Sergio Valencia" as const,
    authoringBuilderDisposition:
      "candidate-context-completed-awaiting-freeze-termination-receipt" as const,
    source: bindings.source,
    contract: GATE3_SEMANTIC_CONTRACT,
    suite: GATE3_SEMANTIC_SUITE,
    fixture: fixtureContract,
    targetContract: target,
    runner,
    evaluator,
    retryPolicy: retry,
    schedule: orderedSchedule,
    freezeManifest: freeze.manifest,
    freezeHash: freeze.freezeHash
  };
  return Object.freeze({
    ...payload,
    packageHash: await canonicalSha256(payload)
  });
}

export function gate3ReviewPackageCanonicalJson(review: Gate3HumanReviewPackage): string {
  const { packageHash, ...payload } = review;
  if (!/^[a-f0-9]{64}$/u.test(packageHash)) throw new TypeError("Invalid review package hash.");
  return `${canonicalJson({ ...payload, packageHash })}\n`;
}

export function meaningForScoredCase(scoredCase: SemanticScoredCase): SemanticMeaning {
  const resolved = GATE3_SEMANTIC_CONTRACT.meanings.find(
    ({ meaningId }) => meaningId === scoredCase.meaningId
  );
  if (!resolved) throw new Error(`Unknown Gate 3 meaning ${scoredCase.meaningId}.`);
  return resolved;
}

export function caseAlias(scoredCase: SemanticScoredCase): string {
  const definition = CASE_DEFINITIONS.find(({ caseId }) => caseId === scoredCase.caseId);
  if (!definition) throw new Error(`Unknown Gate 3 case ${scoredCase.caseId}.`);
  return definition.alias;
}

if (GATE3_SEMANTIC_SUITE.scoredCases.length !== 24 || PROBE_LIVE_MANIFEST_VERSION.length < 1) {
  throw new Error("Gate 3 semantic candidate failed module invariants.");
}
