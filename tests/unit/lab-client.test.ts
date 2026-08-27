import { describe, expect, it } from "vitest";

import { subscribeToCurrentCheckoutSnapshot } from "@/components/lab/lab-client";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";

describe("LabClient quantity snapshot admission", () => {
  it("emits the persistent current snapshot before observing future commits", async () => {
    const store = new CheckoutSessionStore();
    await store.cartUpdate({
      operationId: "remount_update_0001",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 3
    });

    const observed: Array<{ readonly revision: number; readonly mugQuantity: number | undefined }> =
      [];
    const unsubscribe = subscribeToCurrentCheckoutSnapshot(store, ({ state }) => {
      observed.push({
        revision: state.revision,
        mugQuantity: state.lines.find(({ itemId }) => itemId === "stoneware-mug")?.quantity
      });
    });

    expect(observed).toEqual([{ revision: 1, mugQuantity: 3 }]);

    await store.cartUpdate({
      operationId: "remount_update_0002",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 4
    });
    expect(observed).toEqual([
      { revision: 1, mugQuantity: 3 },
      { revision: 2, mugQuantity: 4 }
    ]);

    unsubscribe();
  });
});
