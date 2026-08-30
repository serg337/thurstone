import { describe, expect, it } from "vitest";

import {
  cartGet,
  cartSubtotalCents,
  cartUpdate,
  checkoutCancel,
  checkoutRequest,
  createCheckoutFixture,
  orderReview
} from "@/lib/domain/checkout";
import { canonicalSha256 } from "@/lib/evidence/digest";

const updateOperationId = "update_0123456789";
const requestOperationId = "request_012345678";
const cancelOperationId = "cancel_0123456789";

describe("checkout fixture", () => {
  it("is deterministic, deeply immutable, and matches the golden canonical hash", async () => {
    const first = createCheckoutFixture();
    const second = createCheckoutFixture();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.lines).not.toBe(second.lines);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.lines)).toBe(true);
    expect(first.lines.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(first.fulfillment)).toBe(true);
    await expect(canonicalSha256(first)).resolves.toBe(
      "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
    );
    expect(cartGet(first)).toEqual({
      ok: true,
      fixtureId: "checkout-seed-v1",
      stateRevision: 0,
      lines: [
        { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
        { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
      ]
    });
  });

  it("keeps totals out of cart_get while the normal UI can derive them", () => {
    const state = createCheckoutFixture();
    const result = cartGet(state);

    expect(cartSubtotalCents(state)).toBe(6600);
    expect(result).not.toHaveProperty("subtotal");
    expect(result).not.toHaveProperty("shipping");
    expect(result).not.toHaveProperty("delivery");
    expect(result).not.toHaveProperty("pendingCheckout");
  });

  it("returns fresh result objects without mutating fixture state", () => {
    const state = createCheckoutFixture();
    const before = structuredClone(state);

    const first = cartGet(state);
    const second = cartGet(state);

    expect(state).toEqual(before);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.lines).not.toBe(second.lines);
  });

  it("keeps order_review read-only and semantically separate from cart_get", () => {
    const state = createCheckoutFixture();
    const before = structuredClone(state);
    const first = orderReview(state);
    const second = orderReview(state);

    expect(first).toEqual({
      ok: true,
      fixtureId: "checkout-seed-v1",
      stateRevision: 0,
      currency: "USD",
      lines: [
        {
          itemId: "field-notebook",
          name: "Field notebook",
          quantity: 1,
          unitPriceCents: 1800,
          lineTotalCents: 1800
        },
        {
          itemId: "stoneware-mug",
          name: "Stoneware mug",
          quantity: 2,
          unitPriceCents: 2400,
          lineTotalCents: 4800
        }
      ],
      subtotalCents: 6600,
      shipping: {
        shippingMethod: "standard",
        shippingLabel: "Standard shipping",
        shippingCents: 700,
        deliveryWindow: "3-5-business-days",
        deliveryNotice: "Simulated estimate; no shipment occurs."
      },
      totalCents: 7300,
      checkoutStatus: "ready_for_review"
    });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.lines).not.toBe(first.lines);
    expect(state).toEqual(before);
    expect(cartGet(state)).not.toHaveProperty("totalCents");
  });

  it("updates exactly one quantity and increments revision once", () => {
    const state = createCheckoutFixture();
    const transition = cartUpdate(state, {
      operationId: updateOperationId,
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 3
    });

    expect(transition.effectApplied).toBe(true);
    expect(transition.result).toMatchObject({
      ok: true,
      code: "updated",
      previousQuantity: 2,
      quantity: 3,
      stateRevision: 1
    });
    expect(transition.state.lines).toEqual([
      expect.objectContaining({ itemId: "field-notebook", quantity: 1 }),
      expect.objectContaining({ itemId: "stoneware-mug", quantity: 3 })
    ]);
    expect(state.revision).toBe(0);
    expect(state.lines[1]?.quantity).toBe(2);
    expect(Object.isFrozen(transition.state)).toBe(true);
    expect(Object.isFrozen(transition.state.lines)).toBe(true);
  });

  it.each([
    ["field-notebook", 10, "stoneware-mug", 2],
    ["stoneware-mug", 1, "field-notebook", 1]
  ] as const)(
    "accepts the declared quantity boundary for %s without changing the other line",
    (itemId, quantity, unchangedItemId, unchangedQuantity) => {
      const transition = cartUpdate(createCheckoutFixture(), {
        operationId: `${itemId.replace("-", "_")}_boundary_01`,
        operation: "set_quantity",
        itemId,
        quantity
      });

      expect(transition).toMatchObject({
        effectApplied: true,
        state: { revision: 1 },
        result: { ok: true, code: "updated", itemId, quantity, stateRevision: 1 }
      });
      expect(transition.state.lines.find((line) => line.itemId === unchangedItemId)?.quantity).toBe(
        unchangedQuantity
      );
    }
  );

  it("treats an identical quantity as a successful no-op", () => {
    const state = createCheckoutFixture();
    const transition = cartUpdate(state, {
      operationId: updateOperationId,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 1
    });

    expect(transition.effectApplied).toBe(false);
    expect(transition.state).toBe(state);
    expect(transition.result).toMatchObject({ ok: true, code: "no_change", stateRevision: 0 });
  });

  it("rejects a syntactically valid nonexistent item without mutating trusted state", () => {
    const state = createCheckoutFixture();
    const transition = cartUpdate(state, {
      operationId: "ii02_update_00000001",
      operation: "set_quantity",
      itemId: "phantom-item",
      quantity: 3
    });

    expect(transition.effectApplied).toBe(false);
    expect(transition.state).toBe(state);
    expect(transition.result).toEqual({
      ok: false,
      code: "invalid_item",
      message: "The requested cart item is not available in this fixture.",
      retryable: true,
      operationId: "ii02_update_00000001",
      replayed: false,
      stateRevision: 0
    });
  });

  it("creates only a simulated pending approval and blocks cart mutation", () => {
    const initial = createCheckoutFixture();
    const requested = checkoutRequest(initial, { operationId: requestOperationId }, "a".repeat(64));

    expect(requested.effectApplied).toBe(true);
    expect(requested.state.revision).toBe(1);
    expect(requested.state.lines).toEqual(initial.lines);
    expect(requested.state.pendingCheckout).toEqual({
      status: "pending_human_approval",
      pendingId: "pending_aaaaaaaaaaaa_12345678",
      requestOperationId,
      requestedFromRevision: 0,
      cartSnapshotHash: "a".repeat(64),
      orderTotalCents: 7300
    });
    expect(requested.result).not.toHaveProperty("approved");
    expect(requested.result).not.toHaveProperty("purchased");
    expect(requested.result).not.toHaveProperty("payment");

    const blocked = cartUpdate(requested.state, {
      operationId: "blocked_012345678",
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 2
    });
    expect(blocked.effectApplied).toBe(false);
    expect(blocked.state).toBe(requested.state);
    expect(blocked.result).toMatchObject({ ok: false, code: "checkout_pending" });
  });

  it("returns already_pending for another request and cancels without changing cart lines", () => {
    const initial = createCheckoutFixture();
    const requested = checkoutRequest(initial, { operationId: requestOperationId }, "b".repeat(64));
    const duplicate = checkoutRequest(
      requested.state,
      { operationId: "request_987654321" },
      "b".repeat(64)
    );

    expect(duplicate.effectApplied).toBe(false);
    expect(duplicate.result).toMatchObject({ ok: false, code: "already_pending" });
    expect(duplicate.state).toBe(requested.state);

    const canceled = checkoutCancel(requested.state, { operationId: cancelOperationId });
    expect(canceled.effectApplied).toBe(true);
    expect(canceled.state.revision).toBe(2);
    expect(canceled.state.pendingCheckout).toBeNull();
    expect(canceled.state.lines).toEqual(initial.lines);
    expect(canceled.result).toMatchObject({ ok: true, code: "checkout_canceled" });
  });

  it("returns no_pending_checkout without changing revision", () => {
    const state = createCheckoutFixture();
    const transition = checkoutCancel(state, { operationId: cancelOperationId });

    expect(transition.effectApplied).toBe(false);
    expect(transition.state).toBe(state);
    expect(transition.result).toMatchObject({
      ok: false,
      code: "no_pending_checkout",
      stateRevision: 0
    });
  });
});
