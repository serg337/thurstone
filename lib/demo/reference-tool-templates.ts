import { CART_GET_HANDLER_VERSION, CART_GET_METADATA } from "@/lib/webmcp/cart-get-tool";
import { CART_UPDATE_HANDLER_VERSION, CART_UPDATE_METADATA } from "@/lib/webmcp/cart-update-tool";
import {
  CHECKOUT_CANCEL_HANDLER_VERSION,
  CHECKOUT_CANCEL_METADATA
} from "@/lib/webmcp/checkout-cancel-tool";
import {
  CHECKOUT_REQUEST_HANDLER_VERSION,
  CHECKOUT_REQUEST_METADATA
} from "@/lib/webmcp/checkout-request-tool";
import {
  ORDER_REVIEW_HANDLER_VERSION,
  ORDER_REVIEW_METADATA
} from "@/lib/webmcp/order-review-tool";

export const THURSTONE_DEMO_TOOLSET_VERSION = "thurstone-demo-reference-toolset@2" as const;
export const THURSTONE_DEMO_FIXTURE_ID = "checkout-seed-v1" as const;
export const THURSTONE_DEMO_TRUSTED_STATE_SOURCE = "thurstone-reference-checkout-ledger" as const;

export const THURSTONE_DEMO_SELECTABLE_TOOL_NAMES = [
  "cart_get",
  "cart_update",
  "order_review",
  "checkout_request"
] as const;

export type ThurstoneDemoSelectableToolName = (typeof THURSTONE_DEMO_SELECTABLE_TOOL_NAMES)[number];

export const THURSTONE_DEMO_DEFAULT_TOOL_NAMES = ["order_review", "checkout_request"] as const;

export const THURSTONE_DEMO_ADVANCED_TOOL_NAMES = ["checkout_cancel"] as const;

export type ThurstoneDemoAdvancedToolName = (typeof THURSTONE_DEMO_ADVANCED_TOOL_NAMES)[number];

export type ThurstoneDemoReferenceToolName =
  ThurstoneDemoSelectableToolName | ThurstoneDemoAdvancedToolName;

export type ReferenceArgumentContract =
  | { readonly kind: "empty" }
  | {
      readonly kind: "cart_update";
      readonly operationId: "valid_unique";
      readonly operation: "set_quantity";
      readonly itemIds: readonly ["field-notebook", "stoneware-mug"];
      readonly quantity: { readonly minimum: 0; readonly maximum: 10 };
    }
  | { readonly kind: "checkout_request"; readonly operationId: "valid_unique" }
  | { readonly kind: "checkout_cancel"; readonly operationId: "valid_unique" };

export type ReferenceEffectTemplate =
  | { readonly kind: "cart_quantity"; readonly binds: "itemId_and_quantity_arguments" }
  | { readonly kind: "pending_checkout"; readonly transition: "create" | "clear" };

export type ReferenceForbiddenEffect =
  "cart_mutation" | "pending_checkout" | "duplicate_transition" | "unmodeled_state";

export interface ThurstoneReferenceToolTemplate {
  readonly name: ThurstoneDemoReferenceToolName;
  readonly selectableOnCleanFixture: boolean;
  readonly classification: "read_only" | "consequential" | "conditional_consequential";
  readonly defaultTitle: string;
  readonly defaultDescription: string;
  readonly inputSchema: object;
  readonly annotations: Readonly<WebMCP.ToolAnnotations>;
  readonly handlerVersion: string;
  readonly argumentContracts: readonly ReferenceArgumentContract[];
  readonly allowedEffectTemplates: readonly ReferenceEffectTemplate[];
  readonly forbiddenEffectTemplates: readonly ReferenceForbiddenEffect[];
  readonly preconditions: readonly string[];
  readonly trustedStateAssertions: readonly string[];
  readonly ledgerAssertions: readonly string[];
  readonly cancellationBehavior: readonly string[];
  readonly resetBehavior: "reset_exact_fixture_before_each_case";
  readonly handlerEffectSummary: string;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const commonCancellation = Object.freeze([
  "native_abort_signal_preserved",
  "abort_before_commit_prevents_effect",
  "post_commit_outcome_remains_evident"
] as const);

const cartGet = {
  name: CART_GET_METADATA.name,
  selectableOnCleanFixture: true,
  classification: "read_only",
  defaultTitle: CART_GET_METADATA.title,
  defaultDescription: CART_GET_METADATA.description,
  inputSchema: CART_GET_METADATA.inputSchema,
  annotations: CART_GET_METADATA.annotations,
  handlerVersion: CART_GET_HANDLER_VERSION,
  argumentContracts: [{ kind: "empty" }],
  allowedEffectTemplates: [],
  forbiddenEffectTemplates: ["cart_mutation", "pending_checkout", "unmodeled_state"],
  preconditions: ["exact_reference_fixture"],
  trustedStateAssertions: ["cart_lines_match_result", "state_unchanged"],
  ledgerAssertions: ["one_completed_native_trace", "zero_state_transitions"],
  cancellationBehavior: commonCancellation,
  resetBehavior: "reset_exact_fixture_before_each_case",
  handlerEffectSummary: "Reads current cart line identities and quantities without changing state."
} as const satisfies ThurstoneReferenceToolTemplate;

const cartUpdate = {
  name: CART_UPDATE_METADATA.name,
  selectableOnCleanFixture: true,
  classification: "consequential",
  defaultTitle: CART_UPDATE_METADATA.title,
  defaultDescription: CART_UPDATE_METADATA.description,
  inputSchema: CART_UPDATE_METADATA.inputSchema,
  annotations: CART_UPDATE_METADATA.annotations,
  handlerVersion: CART_UPDATE_HANDLER_VERSION,
  argumentContracts: [
    {
      kind: "cart_update",
      operationId: "valid_unique",
      operation: "set_quantity",
      itemIds: ["field-notebook", "stoneware-mug"],
      quantity: { minimum: 0, maximum: 10 }
    }
  ],
  allowedEffectTemplates: [{ kind: "cart_quantity", binds: "itemId_and_quantity_arguments" }],
  forbiddenEffectTemplates: ["pending_checkout", "duplicate_transition", "unmodeled_state"],
  preconditions: ["exact_reference_fixture", "item_exists_in_fixture"],
  trustedStateAssertions: ["exactly_one_cart_quantity_changed", "state_revision_incremented_once"],
  ledgerAssertions: ["one_committed_transition", "replay_has_no_second_transition"],
  cancellationBehavior: commonCancellation,
  resetBehavior: "reset_exact_fixture_before_each_case",
  handlerEffectSummary:
    "Sets one existing reference-cart quantity, removes it at zero, and records exactly one replay-safe transition."
} as const satisfies ThurstoneReferenceToolTemplate;

const orderReview = {
  name: ORDER_REVIEW_METADATA.name,
  selectableOnCleanFixture: true,
  classification: "read_only",
  defaultTitle: ORDER_REVIEW_METADATA.title,
  defaultDescription: ORDER_REVIEW_METADATA.description,
  inputSchema: ORDER_REVIEW_METADATA.inputSchema,
  annotations: ORDER_REVIEW_METADATA.annotations,
  handlerVersion: ORDER_REVIEW_HANDLER_VERSION,
  argumentContracts: [{ kind: "empty" }],
  allowedEffectTemplates: [],
  forbiddenEffectTemplates: ["cart_mutation", "pending_checkout", "unmodeled_state"],
  preconditions: ["exact_reference_fixture"],
  trustedStateAssertions: ["order_totals_match_state", "state_unchanged"],
  ledgerAssertions: ["one_completed_native_trace", "zero_state_transitions"],
  cancellationBehavior: commonCancellation,
  resetBehavior: "reset_exact_fixture_before_each_case",
  handlerEffectSummary:
    "Reads line prices, subtotal, shipping, delivery estimate, and total without changing state."
} as const satisfies ThurstoneReferenceToolTemplate;

const checkoutRequest = {
  name: CHECKOUT_REQUEST_METADATA.name,
  selectableOnCleanFixture: true,
  classification: "consequential",
  defaultTitle: CHECKOUT_REQUEST_METADATA.title,
  defaultDescription: CHECKOUT_REQUEST_METADATA.description,
  inputSchema: CHECKOUT_REQUEST_METADATA.inputSchema,
  annotations: CHECKOUT_REQUEST_METADATA.annotations,
  handlerVersion: CHECKOUT_REQUEST_HANDLER_VERSION,
  argumentContracts: [{ kind: "checkout_request", operationId: "valid_unique" }],
  allowedEffectTemplates: [{ kind: "pending_checkout", transition: "create" }],
  forbiddenEffectTemplates: ["cart_mutation", "duplicate_transition", "unmodeled_state"],
  preconditions: ["exact_reference_fixture", "no_pending_checkout"],
  trustedStateAssertions: [
    "one_pending_human_approval_created",
    "state_revision_incremented_once",
    "no_purchase_payment_shipment_or_external_transaction"
  ],
  ledgerAssertions: ["one_committed_transition", "replay_has_no_second_transition"],
  cancellationBehavior: commonCancellation,
  resetBehavior: "reset_exact_fixture_before_each_case",
  handlerEffectSummary:
    "Creates one pending human-approval request; no purchase, payment, shipment, or external transaction occurs."
} as const satisfies ThurstoneReferenceToolTemplate;

const checkoutCancel = {
  name: CHECKOUT_CANCEL_METADATA.name,
  selectableOnCleanFixture: false,
  classification: "conditional_consequential",
  defaultTitle: CHECKOUT_CANCEL_METADATA.title,
  defaultDescription: CHECKOUT_CANCEL_METADATA.description,
  inputSchema: CHECKOUT_CANCEL_METADATA.inputSchema,
  annotations: CHECKOUT_CANCEL_METADATA.annotations,
  handlerVersion: CHECKOUT_CANCEL_HANDLER_VERSION,
  argumentContracts: [{ kind: "checkout_cancel", operationId: "valid_unique" }],
  allowedEffectTemplates: [{ kind: "pending_checkout", transition: "clear" }],
  forbiddenEffectTemplates: ["cart_mutation", "duplicate_transition", "unmodeled_state"],
  preconditions: ["pending_checkout_required"],
  trustedStateAssertions: ["pending_checkout_cleared_once", "state_revision_incremented_once"],
  ledgerAssertions: ["one_committed_transition", "replay_has_no_second_transition"],
  cancellationBehavior: commonCancellation,
  resetBehavior: "reset_exact_fixture_before_each_case",
  handlerEffectSummary:
    "Clears an existing pending checkout and therefore remains an advanced Lab-only tool for a clean one-call case."
} as const satisfies ThurstoneReferenceToolTemplate;

export const THURSTONE_REFERENCE_TOOL_TEMPLATES = deepFreeze({
  cart_get: cartGet,
  cart_update: cartUpdate,
  order_review: orderReview,
  checkout_request: checkoutRequest,
  checkout_cancel: checkoutCancel
}) as Readonly<Record<ThurstoneDemoReferenceToolName, ThurstoneReferenceToolTemplate>>;

export const THURSTONE_DEMO_SELECTABLE_TOOL_TEMPLATES = Object.freeze(
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.map((name) => THURSTONE_REFERENCE_TOOL_TEMPLATES[name])
);

export function thurstoneReferenceToolTemplate(
  name: ThurstoneDemoReferenceToolName
): ThurstoneReferenceToolTemplate {
  return THURSTONE_REFERENCE_TOOL_TEMPLATES[name];
}
