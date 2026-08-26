import { cartGet, type CheckoutState } from "@/lib/domain/checkout";

export const CART_GET_TOOL_NAME = "cart_get";
export const CART_GET_HANDLER_VERSION = "cart_get@0.1.0";

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

interface CreateCartGetToolOptions {
  readonly getState: () => CheckoutState;
  readonly onExecuted?: (result: ReturnType<typeof cartGet>) => void;
}

export function createCartGetTool({
  getState,
  onExecuted
}: CreateCartGetToolOptions): WebMCP.ModelContextTool {
  return {
    ...CART_GET_METADATA,
    execute: async (_input, { signal }) => {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Tool execution canceled.", "AbortError");
      }

      const result = cartGet(getState());
      onExecuted?.(result);
      return result;
    }
  };
}
