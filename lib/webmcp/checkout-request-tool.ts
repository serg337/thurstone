import type { MutationResult } from "@/lib/domain/checkout";
import { CHECKOUT_OPERATION_JSON_SCHEMA } from "@/lib/domain/checkout-schemas";
import {
  nativeToolCallContext,
  type NativeToolCallContext,
  type ToolExecutionContext
} from "@/lib/webmcp/tool-execution";

export const CHECKOUT_REQUEST_TOOL_NAME = "checkout_request";
export const CHECKOUT_REQUEST_HANDLER_VERSION = "checkout_request@1.0.0";

export const CHECKOUT_REQUEST_METADATA = {
  name: CHECKOUT_REQUEST_TOOL_NAME,
  title: "Request simulated checkout",
  description:
    "Open a simulated checkout request for the current cart only when the user explicitly directs checkout to begin; it creates a pending request for human approval and does not complete a purchase. If the user is considering or uncertain about checkout without authorizing it, ask whether they want to proceed instead of abstaining or calling this tool.",
  inputSchema: CHECKOUT_OPERATION_JSON_SCHEMA,
  annotations: { readOnlyHint: false }
} as const;

export interface CreateCheckoutRequestToolOptions {
  readonly execute: (input: unknown, context: NativeToolCallContext) => Promise<MutationResult>;
}

export type CheckoutRequestTool = Omit<WebMCP.ModelContextTool, "execute"> & {
  execute: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ) => Promise<MutationResult>;
};

export function createCheckoutRequestTool({
  execute
}: CreateCheckoutRequestToolOptions): CheckoutRequestTool {
  return {
    ...CHECKOUT_REQUEST_METADATA,
    execute: async (input, { signal } = {}) => {
      return execute(input, nativeToolCallContext(signal));
    }
  };
}
