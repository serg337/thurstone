import { z } from "zod";

export const OPERATION_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$";
export const CART_ITEM_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

export const emptyToolInputSchema = z.object({}).strict();

export const operationIdSchema = z
  .string()
  .regex(new RegExp(OPERATION_ID_PATTERN, "u"), "Use a 16–64 character URL-safe operation ID.");

export const cartUpdateInputSchema = z
  .object({
    operationId: operationIdSchema,
    operation: z.literal("set_quantity"),
    itemId: z.string().min(1).max(64).regex(new RegExp(CART_ITEM_ID_PATTERN, "u")),
    quantity: z.number().int().min(0).max(10)
  })
  .strict();

export const checkoutOperationInputSchema = z
  .object({
    operationId: operationIdSchema
  })
  .strict();

export type CartUpdateInput = z.infer<typeof cartUpdateInputSchema>;
export type CheckoutOperationInput = z.infer<typeof checkoutOperationInputSchema>;

export const EMPTY_TOOL_JSON_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

export const OPERATION_ID_JSON_SCHEMA = {
  type: "string",
  pattern: OPERATION_ID_PATTERN,
  description: "Unique 16–64 character URL-safe ID for retry-safe mutation execution."
} as const;

export const CART_UPDATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    operationId: OPERATION_ID_JSON_SCHEMA,
    operation: {
      type: "string",
      enum: ["set_quantity"],
      description: "Set one cart line to the declared quantity."
    },
    itemId: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: CART_ITEM_ID_PATTERN,
      description: "Syntactically valid item identifier whose current cart quantity should change."
    },
    quantity: {
      type: "integer",
      minimum: 0,
      maximum: 10,
      description: "Desired quantity from 0 through 10; 0 removes the cart line."
    }
  },
  required: ["operationId", "operation", "itemId", "quantity"],
  additionalProperties: false
} as const;

export const CHECKOUT_OPERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    operationId: OPERATION_ID_JSON_SCHEMA
  },
  required: ["operationId"],
  additionalProperties: false
} as const;
