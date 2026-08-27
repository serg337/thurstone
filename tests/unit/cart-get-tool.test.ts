import { describe, expect, it, vi } from "vitest";

import { cartGet, createCheckoutFixture } from "@/lib/domain/checkout";
import {
  CART_GET_METADATA,
  CART_GET_TOOL_NAME,
  createCartGetTool
} from "@/lib/webmcp/cart-get-tool";

describe("cart_get WebMCP definition", () => {
  it("uses a short valid name, narrow schema, truthful annotation, and bounded description", () => {
    expect(CART_GET_TOOL_NAME).toMatch(/^[A-Za-z0-9_.-]{1,30}$/);
    expect(CART_GET_METADATA.description.length).toBeLessThanOrEqual(500);
    expect(CART_GET_METADATA.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false
    });
    expect(CART_GET_METADATA.annotations).toEqual({ readOnlyHint: true });
  });

  it("accepts both omitted and supplied execution contexts without changing the result", async () => {
    const onExecuted = vi.fn();
    const execute = vi.fn(async () => cartGet(createCheckoutFixture()));
    const tool = createCartGetTool({ execute, onExecuted });
    const controller = new AbortController();
    const withoutContext = await tool.execute({});
    const withContext = await tool.execute({}, { signal: controller.signal });

    expect(withoutContext).toEqual(withContext);
    expect(withoutContext).toEqual(onExecuted.mock.calls[0]?.[0]);
    expect(withContext).toEqual(onExecuted.mock.calls[1]?.[0]);
    expect(onExecuted).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, {}, { source: "native" });
    expect(execute).toHaveBeenNthCalledWith(2, {}, { source: "native", signal: controller.signal });
  });

  it("delegates an already-canceled signal once so the shared store records it", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Canceled", "AbortError"));
    const execute = vi.fn(async (_input: unknown, context: { readonly signal?: AbortSignal }) => {
      if (context.signal?.aborted) throw context.signal.reason;
      return cartGet(createCheckoutFixture());
    });
    const tool = createCartGetTool({ execute });

    await expect(tool.execute({}, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      {},
      { source: "native", signal: controller.signal }
    );
  });
});
