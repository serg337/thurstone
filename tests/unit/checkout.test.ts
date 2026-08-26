import { describe, expect, it } from "vitest";

import { cartGet, cartSubtotalCents, createCheckoutFixture } from "@/lib/domain/checkout";

describe("checkout fixture", () => {
  it("is deterministic and exposes a stable read-only cart projection", () => {
    const first = createCheckoutFixture();
    const second = createCheckoutFixture();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.lines).not.toBe(second.lines);
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
});
