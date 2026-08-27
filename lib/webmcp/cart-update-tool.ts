import type { MutationResult } from "@/lib/domain/checkout";
import { CART_UPDATE_JSON_SCHEMA } from "@/lib/domain/checkout-schemas";
import {
  nativeToolCallContext,
  type NativeToolCallContext,
  type ToolExecutionContext
} from "@/lib/webmcp/tool-execution";

export const CART_UPDATE_TOOL_NAME = "cart_update";
export const CART_UPDATE_HANDLER_VERSION = "cart_update@1.0.0";

export const CART_UPDATE_METADATA = {
  name: CART_UPDATE_TOOL_NAME,
  title: "Set cart quantity",
  description:
    "Set one current cart line to the quantity the user requests and return the resulting cart revision.",
  inputSchema: CART_UPDATE_JSON_SCHEMA,
  annotations: { readOnlyHint: false }
} as const;

export interface CreateCartUpdateToolOptions {
  readonly execute: (input: unknown, context: NativeToolCallContext) => Promise<MutationResult>;
}

export type CartUpdateTool = Omit<WebMCP.ModelContextTool, "execute"> & {
  execute: (
    input: Record<string, unknown>,
    context?: ToolExecutionContext
  ) => Promise<MutationResult>;
};

export function createCartUpdateTool({ execute }: CreateCartUpdateToolOptions): CartUpdateTool {
  return {
    ...CART_UPDATE_METADATA,
    execute: async (input, { signal } = {}) => {
      return execute(input, nativeToolCallContext(signal));
    }
  };
}
