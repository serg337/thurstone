import type { CartGetResult, CheckoutErrorResult } from "@/lib/domain/checkout";
import {
  nativeToolCallContext,
  type NativeToolCallContext,
  type ToolExecutionContext
} from "@/lib/webmcp/tool-execution";

export const CART_GET_TOOL_NAME = "cart_get";
export const CART_GET_HANDLER_VERSION = "cart_get@1.0.0";

export const CART_GET_METADATA = {
  name: CART_GET_TOOL_NAME,
  title: "Read cart lines",
  description:
    "Return current cart line-item identities and quantities when the user asks what is in the cart.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  annotations: { readOnlyHint: true }
} as const;

export type CartGetToolResult = CartGetResult | CheckoutErrorResult;

interface CreateCartGetToolOptions {
  readonly execute: (input: unknown, context: NativeToolCallContext) => Promise<CartGetToolResult>;
  readonly onExecuted?: (result: CartGetToolResult) => void;
}

export type CartGetTool = Omit<WebMCP.ModelContextTool, "execute"> & {
  execute: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ) => Promise<CartGetToolResult>;
};

export function createCartGetTool({ execute, onExecuted }: CreateCartGetToolOptions): CartGetTool {
  return {
    ...CART_GET_METADATA,
    execute: async (input, { signal } = {}) => {
      const result = await execute(input, nativeToolCallContext(signal));
      onExecuted?.(result);
      return result;
    }
  };
}
