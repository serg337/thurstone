import type { CheckoutErrorResult, OrderReviewResult } from "@/lib/domain/checkout";
import { EMPTY_TOOL_JSON_SCHEMA } from "@/lib/domain/checkout-schemas";
import {
  nativeToolCallContext,
  type NativeToolCallContext,
  type ToolExecutionContext
} from "@/lib/webmcp/tool-execution";

export const ORDER_REVIEW_TOOL_NAME = "order_review";
export const ORDER_REVIEW_HANDLER_VERSION = "order_review@1.0.0";

export const ORDER_REVIEW_METADATA = {
  name: ORDER_REVIEW_TOOL_NAME,
  title: "Review order summary",
  description:
    "Return the current final read-only order summary with line prices, subtotal, shipping cost, delivery estimate, and total when the user asks to review the order.",
  inputSchema: EMPTY_TOOL_JSON_SCHEMA,
  annotations: { readOnlyHint: true }
} as const;

export type OrderReviewToolResult = OrderReviewResult | CheckoutErrorResult;

export interface CreateOrderReviewToolOptions {
  readonly execute: (
    input: unknown,
    context: NativeToolCallContext
  ) => Promise<OrderReviewToolResult>;
}

export type OrderReviewTool = Omit<WebMCP.ModelContextTool, "execute"> & {
  execute: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ) => Promise<OrderReviewToolResult>;
};

export function createOrderReviewTool({ execute }: CreateOrderReviewToolOptions): OrderReviewTool {
  return {
    ...ORDER_REVIEW_METADATA,
    execute: async (input, { signal } = {}) => {
      return execute(input, nativeToolCallContext(signal));
    }
  };
}
