import { describe, expect, it } from "vitest";

import {
  CheckoutSessionStore,
  type CheckoutSessionTraceEvent
} from "@/lib/domain/checkout-session";
import { createCheckoutTools } from "@/lib/webmcp/checkout-tools";

describe("assembled checkout WebMCP tools", () => {
  it("reuses stable handler objects and adds only checkout_cancel for pending state", async () => {
    const store = new CheckoutSessionStore();
    const tools = createCheckoutTools(store);

    expect(tools.initial.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);
    expect(tools.pending.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_cancel",
      "checkout_request",
      "order_review"
    ]);
    for (const initialTool of tools.initial) {
      expect(tools.pending.find(({ name }) => name === initialTool.name)).toBe(initialTool);
    }
    expect(tools.forState(store.getSnapshot().state)).toBe(tools.initial);

    await store.checkoutRequest({ operationId: "request_012345678" });
    expect(tools.forState(store.getSnapshot().state)).toBe(tools.pending);
  });

  it("routes omitted and supplied native contexts through the same traced store", async () => {
    const events: CheckoutSessionTraceEvent[] = [];
    const store = new CheckoutSessionStore({
      traceSink: {
        append: (event) => {
          events.push(event);
        }
      }
    });
    const tools = createCheckoutTools(store);
    const cartGet = tools.byName.cart_get;
    const update = tools.byName.cart_update;
    const signal = new AbortController().signal;

    await expect(cartGet.execute({}, { signal })).resolves.toMatchObject({
      ok: true,
      stateRevision: 0
    });
    await expect(
      update.execute(
        {
          operationId: "update_0123456789",
          operation: "set_quantity",
          itemId: "field-notebook",
          quantity: 2
        },
        { signal }
      )
    ).resolves.toMatchObject({ ok: true, code: "updated", stateRevision: 1 });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ source: "native", toolName: "cart_get" });
    expect(events[1]).toMatchObject({
      source: "native",
      toolName: "cart_update",
      commitDisposition: "committed"
    });
  });
});
