import { describe, expect, it, vi } from "vitest";

import {
  CART_UPDATE_JSON_SCHEMA,
  CHECKOUT_OPERATION_JSON_SCHEMA,
  EMPTY_TOOL_JSON_SCHEMA
} from "@/lib/domain/checkout-schemas";
import {
  cartGet,
  cartUpdate,
  checkoutCancel,
  checkoutRequest,
  createCheckoutFixture,
  orderReview,
  type MutationResult
} from "@/lib/domain/checkout";
import { CART_GET_METADATA, createCartGetTool } from "@/lib/webmcp/cart-get-tool";
import { CART_UPDATE_METADATA, createCartUpdateTool } from "@/lib/webmcp/cart-update-tool";
import {
  CHECKOUT_TOOLSET_VERSION,
  INITIAL_CHECKOUT_TOOL_MANIFEST,
  PENDING_CHECKOUT_TOOL_MANIFEST,
  checkoutToolContractSnapshot,
  checkoutToolManifestForState,
  type SerializableToolMetadata
} from "@/lib/webmcp/catalog";
import {
  CHECKOUT_CANCEL_METADATA,
  createCheckoutCancelTool
} from "@/lib/webmcp/checkout-cancel-tool";
import {
  CHECKOUT_REQUEST_METADATA,
  createCheckoutRequestTool
} from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_METADATA, createOrderReviewTool } from "@/lib/webmcp/order-review-tool";

const updateOperationId = "update_0123456789";
const requestOperationId = "request_012345678";
const cancelOperationId = "cancel_0123456789";

const metadataCases = [
  CART_GET_METADATA,
  CART_UPDATE_METADATA,
  CHECKOUT_CANCEL_METADATA,
  CHECKOUT_REQUEST_METADATA,
  ORDER_REVIEW_METADATA
] as const;

function propertyDescriptions(metadata: SerializableToolMetadata): readonly string[] {
  const schema = metadata.inputSchema as {
    readonly properties?: Readonly<Record<string, { readonly description?: string }>>;
  };

  return Object.values(schema.properties ?? {}).flatMap(({ description }) =>
    description ? [description] : []
  );
}

function expectCompactJson(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized.length).toBeLessThanOrEqual(1_500);
  expect(JSON.parse(serialized)).toEqual(value);
}

describe("checkout WebMCP metadata", () => {
  it("uses bounded, valid, non-overlapping names and descriptions", () => {
    for (const metadata of metadataCases) {
      expect(metadata.name).toMatch(/^[A-Za-z0-9_.-]{1,30}$/u);
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeLessThanOrEqual(500);
      for (const description of propertyDescriptions(metadata)) {
        expect(description.length).toBeLessThanOrEqual(150);
      }
    }

    expect(new Set(metadataCases.map(({ name }) => name)).size).toBe(metadataCases.length);
    expect(CART_GET_METADATA.description).not.toMatch(/price|subtotal|shipping|delivery|total/iu);
    expect(ORDER_REVIEW_METADATA.description).toMatch(/price|subtotal|shipping|delivery|total/iu);
  });

  it("reuses the exact strict application schemas", () => {
    expect(CART_GET_METADATA.inputSchema).toEqual(EMPTY_TOOL_JSON_SCHEMA);
    expect(ORDER_REVIEW_METADATA.inputSchema).toEqual(EMPTY_TOOL_JSON_SCHEMA);
    expect(CART_UPDATE_METADATA.inputSchema).toEqual(CART_UPDATE_JSON_SCHEMA);
    expect(CHECKOUT_REQUEST_METADATA.inputSchema).toEqual(CHECKOUT_OPERATION_JSON_SCHEMA);
    expect(CHECKOUT_CANCEL_METADATA.inputSchema).toEqual(CHECKOUT_OPERATION_JSON_SCHEMA);

    for (const metadata of metadataCases) {
      expect(metadata.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false
      });
    }
  });

  it("marks only the two read tools read-only", () => {
    expect(CART_GET_METADATA.annotations).toEqual({ readOnlyHint: true });
    expect(ORDER_REVIEW_METADATA.annotations).toEqual({ readOnlyHint: true });
    expect(CART_UPDATE_METADATA.annotations).toEqual({ readOnlyHint: false });
    expect(CHECKOUT_REQUEST_METADATA.annotations).toEqual({ readOnlyHint: false });
    expect(CHECKOUT_CANCEL_METADATA.annotations).toEqual({ readOnlyHint: false });
  });

  it("frames checkout_request only as a simulated pending human-approval request", () => {
    const executionClaims = [
      CHECKOUT_REQUEST_METADATA.name,
      CHECKOUT_REQUEST_METADATA.title,
      CHECKOUT_REQUEST_METADATA.description
    ].join(" ");

    expect(executionClaims).toContain("simulated checkout request");
    expect(executionClaims).toMatch(/\bpending(?:\s+\w+){0,3}\s+for human approval\b/iu);
    expect(executionClaims.replace(/\bdoes not complete a purchase\b/giu, "")).not.toMatch(
      /\b(?:purchase|payment|charge|buy|approve|complete)\w*\b/iu
    );
    for (const { name } of metadataCases) {
      expect(name).not.toMatch(/(?:approve|complete|payment|purchase)/iu);
    }
  });
});

describe("checkout WebMCP handler factories", () => {
  it("passes raw inputs and supplied cancellation signals to each store operation exactly once", async () => {
    const controller = new AbortController();
    const context = { signal: controller.signal };
    const updateInput = {
      operationId: updateOperationId,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 2
    };
    const requestInput = { operationId: requestOperationId };
    const cancelInput = { operationId: cancelOperationId };
    const mutationResult: MutationResult = {
      ok: false,
      code: "session_halted",
      message: "Test sentinel.",
      retryable: false,
      replayed: false,
      stateRevision: 0
    };
    const reviewResult = orderReview(createCheckoutFixture());
    const reviewExecute = vi.fn(async () => reviewResult);
    const updateExecute = vi.fn(async () => mutationResult);
    const requestExecute = vi.fn(async () => mutationResult);
    const cancelExecute = vi.fn(async () => mutationResult);

    await createOrderReviewTool({ execute: reviewExecute }).execute({}, context);
    await createCartUpdateTool({ execute: updateExecute }).execute(updateInput, context);
    await createCheckoutRequestTool({ execute: requestExecute }).execute(requestInput, context);
    await createCheckoutCancelTool({ execute: cancelExecute }).execute(cancelInput, context);

    expect(reviewExecute).toHaveBeenCalledExactlyOnceWith(
      {},
      { source: "native", signal: context.signal }
    );
    expect(updateExecute).toHaveBeenCalledExactlyOnceWith(updateInput, {
      source: "native",
      signal: context.signal
    });
    expect(requestExecute).toHaveBeenCalledExactlyOnceWith(requestInput, {
      source: "native",
      signal: context.signal
    });
    expect(cancelExecute).toHaveBeenCalledExactlyOnceWith(cancelInput, {
      source: "native",
      signal: context.signal
    });
  });

  it("accepts omitted execution contexts and preserves JSON-serializable domain outputs", async () => {
    const initial = createCheckoutFixture();
    const updated = cartUpdate(initial, {
      operationId: updateOperationId,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 2
    });
    const requested = checkoutRequest(initial, { operationId: requestOperationId }, "a".repeat(64));
    const canceled = checkoutCancel(requested.state, { operationId: cancelOperationId });

    const outputs = [
      await createCartGetTool({ execute: async () => cartGet(initial) }).execute({}),
      await createOrderReviewTool({ execute: async () => orderReview(initial) }).execute({}),
      await createCartUpdateTool({ execute: async () => updated.result }).execute({
        operationId: updateOperationId,
        operation: "set_quantity",
        itemId: "field-notebook",
        quantity: 2
      }),
      await createCheckoutRequestTool({ execute: async () => requested.result }).execute({
        operationId: requestOperationId
      }),
      await createCheckoutCancelTool({ execute: async () => canceled.result }).execute({
        operationId: cancelOperationId
      })
    ];

    outputs.forEach(expectCompactJson);
    expect(outputs[3]).toMatchObject({
      ok: true,
      code: "pending_human_approval",
      stateRevision: 1
    });
    expect(outputs[3]).not.toHaveProperty("approved");
    expect(outputs[3]).not.toHaveProperty("purchase");
    expect(outputs[3]).not.toHaveProperty("payment");
  });

  it("delegates an already-aborted call so the store can trace cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Canceled", "AbortError"));
    const execute = vi.fn(async (_input: unknown, context: { readonly signal?: AbortSignal }) => {
      if (context.signal?.aborted) throw context.signal.reason;
      return orderReview(createCheckoutFixture());
    });

    await expect(
      createOrderReviewTool({ execute }).execute({}, { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      {},
      { source: "native", signal: controller.signal }
    );
  });
});

describe("checkout WebMCP catalog", () => {
  it("exposes four initial tools and adds only checkout_cancel while pending", () => {
    const initial = createCheckoutFixture();
    const pending = checkoutRequest(initial, { operationId: requestOperationId }, "b".repeat(64));
    const restored = checkoutCancel(pending.state, { operationId: cancelOperationId });

    expect(INITIAL_CHECKOUT_TOOL_MANIFEST.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);
    expect(PENDING_CHECKOUT_TOOL_MANIFEST.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_cancel",
      "checkout_request",
      "order_review"
    ]);
    expect(checkoutToolManifestForState(initial)).toBe(INITIAL_CHECKOUT_TOOL_MANIFEST);
    expect(checkoutToolManifestForState(pending.state)).toBe(PENDING_CHECKOUT_TOOL_MANIFEST);
    expect(checkoutToolManifestForState(restored.state)).toBe(INITIAL_CHECKOUT_TOOL_MANIFEST);
  });

  it("produces a deterministic, sorted, serializable version snapshot without handlers", () => {
    const snapshot = checkoutToolContractSnapshot(createCheckoutFixture());
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.toolsetVersion).toBe(CHECKOUT_TOOLSET_VERSION);
    expect(snapshot.domainVersion).toMatch(/^checkout-domain@/u);
    expect(snapshot.handlerVersions.map(({ name }) => name)).toEqual(
      [...snapshot.handlerVersions.map(({ name }) => name)].sort()
    );
    expect(snapshot.manifest.map(({ name }) => name)).toEqual(
      [...snapshot.manifest.map(({ name }) => name)].sort()
    );
    expect(snapshot.manifest.every((metadata) => !("execute" in metadata))).toBe(true);
    expect(JSON.stringify(checkoutToolContractSnapshot(createCheckoutFixture()))).toBe(serialized);
    expect(JSON.parse(serialized)).toEqual(snapshot);
  });
});
