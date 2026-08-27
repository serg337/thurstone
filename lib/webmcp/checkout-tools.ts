import type { CheckoutState } from "@/lib/domain/checkout";
import type { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { createCartGetTool } from "@/lib/webmcp/cart-get-tool";
import { createCartUpdateTool } from "@/lib/webmcp/cart-update-tool";
import {
  INITIAL_CHECKOUT_TOOL_NAMES,
  PENDING_CHECKOUT_TOOL_NAMES,
  type CheckoutToolName
} from "@/lib/webmcp/catalog";
import { createCheckoutCancelTool } from "@/lib/webmcp/checkout-cancel-tool";
import { createCheckoutRequestTool } from "@/lib/webmcp/checkout-request-tool";
import { createOrderReviewTool } from "@/lib/webmcp/order-review-tool";

export interface CheckoutToolSet {
  readonly byName: Readonly<Record<CheckoutToolName, WebMCP.ModelContextTool>>;
  readonly initial: readonly WebMCP.ModelContextTool[];
  readonly pending: readonly WebMCP.ModelContextTool[];
  readonly forState: (
    state: Pick<CheckoutState, "pendingCheckout">
  ) => readonly WebMCP.ModelContextTool[];
}

export function createCheckoutTools(store: CheckoutSessionStore): CheckoutToolSet {
  const byName: Readonly<Record<CheckoutToolName, WebMCP.ModelContextTool>> = Object.freeze({
    cart_get: createCartGetTool({ execute: store.cartGet }),
    cart_update: createCartUpdateTool({ execute: store.cartUpdate }),
    checkout_cancel: createCheckoutCancelTool({ execute: store.checkoutCancel }),
    checkout_request: createCheckoutRequestTool({ execute: store.checkoutRequest }),
    order_review: createOrderReviewTool({ execute: store.orderReview })
  });
  const initial = Object.freeze(INITIAL_CHECKOUT_TOOL_NAMES.map((name) => byName[name]));
  const pending = Object.freeze(PENDING_CHECKOUT_TOOL_NAMES.map((name) => byName[name]));

  return Object.freeze({
    byName,
    initial,
    pending,
    forState: (state: Pick<CheckoutState, "pendingCheckout">) =>
      state.pendingCheckout ? pending : initial
  });
}
