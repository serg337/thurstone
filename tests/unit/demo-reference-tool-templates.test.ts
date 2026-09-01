import { describe, expect, it } from "vitest";

import {
  THURSTONE_DEMO_ADVANCED_TOOL_NAMES,
  THURSTONE_DEMO_DEFAULT_TOOL_NAMES,
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_REFERENCE_TOOL_TEMPLATES,
  thurstoneReferenceToolTemplate
} from "@/lib/demo/reference-tool-templates";
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

describe("Thurstone reference-tool templates", () => {
  it("exposes exactly four clean-fixture tools and the verified default pair", () => {
    expect(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);
    expect(THURSTONE_DEMO_DEFAULT_TOOL_NAMES).toEqual(["order_review", "checkout_request"]);
  });

  it("binds selectable definitions to the real metadata, schema, annotations, and handlers", () => {
    const expected = {
      cart_get: [CART_GET_METADATA, CART_GET_HANDLER_VERSION],
      cart_update: [CART_UPDATE_METADATA, CART_UPDATE_HANDLER_VERSION],
      order_review: [ORDER_REVIEW_METADATA, ORDER_REVIEW_HANDLER_VERSION],
      checkout_request: [CHECKOUT_REQUEST_METADATA, CHECKOUT_REQUEST_HANDLER_VERSION]
    } as const;

    for (const name of THURSTONE_DEMO_SELECTABLE_TOOL_NAMES) {
      const template = thurstoneReferenceToolTemplate(name);
      const [metadata, handlerVersion] = expected[name];
      expect(template).toMatchObject({
        name,
        selectableOnCleanFixture: true,
        defaultTitle: metadata.title,
        defaultDescription: metadata.description,
        inputSchema: metadata.inputSchema,
        annotations: metadata.annotations,
        handlerVersion,
        resetBehavior: "reset_exact_fixture_before_each_case"
      });
      expect(template.trustedStateAssertions.length).toBeGreaterThan(0);
      expect(template.ledgerAssertions.length).toBeGreaterThan(0);
      expect(template.cancellationBehavior).toContain("native_abort_signal_preserved");
    }
  });

  it("keeps checkout_cancel real but unavailable for a clean one-call case", () => {
    expect(THURSTONE_DEMO_ADVANCED_TOOL_NAMES).toEqual(["checkout_cancel"]);
    expect(THURSTONE_REFERENCE_TOOL_TEMPLATES.checkout_cancel).toMatchObject({
      name: CHECKOUT_CANCEL_METADATA.name,
      defaultTitle: CHECKOUT_CANCEL_METADATA.title,
      defaultDescription: CHECKOUT_CANCEL_METADATA.description,
      inputSchema: CHECKOUT_CANCEL_METADATA.inputSchema,
      annotations: CHECKOUT_CANCEL_METADATA.annotations,
      handlerVersion: CHECKOUT_CANCEL_HANDLER_VERSION,
      selectableOnCleanFixture: false,
      classification: "conditional_consequential",
      preconditions: ["pending_checkout_required"]
    });
  });

  it("deep-freezes the reference definitions", () => {
    expect(Object.isFrozen(THURSTONE_REFERENCE_TOOL_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(THURSTONE_REFERENCE_TOOL_TEMPLATES.cart_update)).toBe(true);
    expect(Object.isFrozen(THURSTONE_REFERENCE_TOOL_TEMPLATES.cart_update.inputSchema)).toBe(true);
    expect(Object.isFrozen(THURSTONE_REFERENCE_TOOL_TEMPLATES.cart_update.argumentContracts)).toBe(
      true
    );
  });
});
