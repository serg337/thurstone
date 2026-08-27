import { CHECKOUT_DOMAIN_VERSION, type CheckoutState } from "@/lib/domain/checkout";
import {
  CART_GET_HANDLER_VERSION,
  CART_GET_METADATA,
  CART_GET_TOOL_NAME
} from "@/lib/webmcp/cart-get-tool";
import {
  CART_UPDATE_HANDLER_VERSION,
  CART_UPDATE_METADATA,
  CART_UPDATE_TOOL_NAME
} from "@/lib/webmcp/cart-update-tool";
import {
  CHECKOUT_CANCEL_HANDLER_VERSION,
  CHECKOUT_CANCEL_METADATA,
  CHECKOUT_CANCEL_TOOL_NAME
} from "@/lib/webmcp/checkout-cancel-tool";
import {
  CHECKOUT_REQUEST_HANDLER_VERSION,
  CHECKOUT_REQUEST_METADATA,
  CHECKOUT_REQUEST_TOOL_NAME
} from "@/lib/webmcp/checkout-request-tool";
import {
  ORDER_REVIEW_HANDLER_VERSION,
  ORDER_REVIEW_METADATA,
  ORDER_REVIEW_TOOL_NAME
} from "@/lib/webmcp/order-review-tool";

export const CHECKOUT_TOOLSET_VERSION = "checkout-toolset-v1@1.0.0";

export const CHECKOUT_TOOL_NAMES = [
  CART_GET_TOOL_NAME,
  CART_UPDATE_TOOL_NAME,
  CHECKOUT_CANCEL_TOOL_NAME,
  CHECKOUT_REQUEST_TOOL_NAME,
  ORDER_REVIEW_TOOL_NAME
] as const;

export type CheckoutToolName = (typeof CHECKOUT_TOOL_NAMES)[number];
export type CheckoutCatalogState = "initial" | "pending";

export interface SerializableToolMetadata {
  readonly name: CheckoutToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: Readonly<WebMCP.ToolAnnotations>;
}

export interface ToolHandlerVersion {
  readonly name: CheckoutToolName;
  readonly version: string;
}

export interface CheckoutToolContractSnapshot {
  readonly catalogState: CheckoutCatalogState;
  readonly toolsetVersion: typeof CHECKOUT_TOOLSET_VERSION;
  readonly domainVersion: typeof CHECKOUT_DOMAIN_VERSION;
  readonly handlerVersions: readonly ToolHandlerVersion[];
  readonly manifest: readonly SerializableToolMetadata[];
}

const METADATA_BY_NAME: Readonly<Record<CheckoutToolName, SerializableToolMetadata>> = {
  [CART_GET_TOOL_NAME]: CART_GET_METADATA,
  [CART_UPDATE_TOOL_NAME]: CART_UPDATE_METADATA,
  [CHECKOUT_CANCEL_TOOL_NAME]: CHECKOUT_CANCEL_METADATA,
  [CHECKOUT_REQUEST_TOOL_NAME]: CHECKOUT_REQUEST_METADATA,
  [ORDER_REVIEW_TOOL_NAME]: ORDER_REVIEW_METADATA
};

const HANDLER_VERSION_BY_NAME: Readonly<Record<CheckoutToolName, string>> = {
  [CART_GET_TOOL_NAME]: CART_GET_HANDLER_VERSION,
  [CART_UPDATE_TOOL_NAME]: CART_UPDATE_HANDLER_VERSION,
  [CHECKOUT_CANCEL_TOOL_NAME]: CHECKOUT_CANCEL_HANDLER_VERSION,
  [CHECKOUT_REQUEST_TOOL_NAME]: CHECKOUT_REQUEST_HANDLER_VERSION,
  [ORDER_REVIEW_TOOL_NAME]: ORDER_REVIEW_HANDLER_VERSION
};

export const INITIAL_CHECKOUT_TOOL_NAMES = [
  CART_GET_TOOL_NAME,
  CART_UPDATE_TOOL_NAME,
  CHECKOUT_REQUEST_TOOL_NAME,
  ORDER_REVIEW_TOOL_NAME
] as const satisfies readonly CheckoutToolName[];

export const PENDING_CHECKOUT_TOOL_NAMES = CHECKOUT_TOOL_NAMES;

function metadataFor(names: readonly CheckoutToolName[]): readonly SerializableToolMetadata[] {
  return Object.freeze(names.map((name) => METADATA_BY_NAME[name]));
}

function handlerVersionsFor(names: readonly CheckoutToolName[]): readonly ToolHandlerVersion[] {
  return Object.freeze(
    names.map((name) => Object.freeze({ name, version: HANDLER_VERSION_BY_NAME[name] }))
  );
}

export const INITIAL_CHECKOUT_TOOL_MANIFEST = metadataFor(INITIAL_CHECKOUT_TOOL_NAMES);
export const PENDING_CHECKOUT_TOOL_MANIFEST = metadataFor(PENDING_CHECKOUT_TOOL_NAMES);

export const INITIAL_CHECKOUT_HANDLER_VERSIONS = handlerVersionsFor(INITIAL_CHECKOUT_TOOL_NAMES);
export const PENDING_CHECKOUT_HANDLER_VERSIONS = handlerVersionsFor(PENDING_CHECKOUT_TOOL_NAMES);

export function checkoutCatalogState(
  state: Pick<CheckoutState, "pendingCheckout">
): CheckoutCatalogState {
  return state.pendingCheckout ? "pending" : "initial";
}

export function checkoutToolManifestForState(
  state: Pick<CheckoutState, "pendingCheckout">
): readonly SerializableToolMetadata[] {
  return state.pendingCheckout ? PENDING_CHECKOUT_TOOL_MANIFEST : INITIAL_CHECKOUT_TOOL_MANIFEST;
}

export function checkoutToolContractSnapshot(
  state: Pick<CheckoutState, "pendingCheckout">
): CheckoutToolContractSnapshot {
  const catalogState = checkoutCatalogState(state);

  return Object.freeze({
    catalogState,
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    handlerVersions:
      catalogState === "pending"
        ? PENDING_CHECKOUT_HANDLER_VERSIONS
        : INITIAL_CHECKOUT_HANDLER_VERSIONS,
    manifest:
      catalogState === "pending" ? PENDING_CHECKOUT_TOOL_MANIFEST : INITIAL_CHECKOUT_TOOL_MANIFEST
  });
}
