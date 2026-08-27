import type { MutationResult } from "@/lib/domain/checkout";
import { CHECKOUT_OPERATION_JSON_SCHEMA } from "@/lib/domain/checkout-schemas";
import {
  nativeToolCallContext,
  type NativeToolCallContext,
  type ToolExecutionContext
} from "@/lib/webmcp/tool-execution";

export const CHECKOUT_CANCEL_TOOL_NAME = "checkout_cancel";
export const CHECKOUT_CANCEL_HANDLER_VERSION = "checkout_cancel@1.0.0";

export const CHECKOUT_CANCEL_METADATA = {
  name: CHECKOUT_CANCEL_TOOL_NAME,
  title: "Cancel simulated checkout",
  description:
    "Cancel the currently pending simulated checkout request when the user asks to stop that checkout flow.",
  inputSchema: CHECKOUT_OPERATION_JSON_SCHEMA,
  annotations: { readOnlyHint: false }
} as const;

export interface CreateCheckoutCancelToolOptions {
  readonly execute: (input: unknown, context: NativeToolCallContext) => Promise<MutationResult>;
}

export type CheckoutCancelTool = Omit<WebMCP.ModelContextTool, "execute"> & {
  execute: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ) => Promise<MutationResult>;
};

export function createCheckoutCancelTool({
  execute
}: CreateCheckoutCancelToolOptions): CheckoutCancelTool {
  return {
    ...CHECKOUT_CANCEL_METADATA,
    execute: async (input, { signal } = {}) => {
      return execute(input, nativeToolCallContext(signal));
    }
  };
}
