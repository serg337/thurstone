import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CART_UPDATE_JSON_SCHEMA,
  CHECKOUT_OPERATION_JSON_SCHEMA,
  EMPTY_TOOL_JSON_SCHEMA,
  cartUpdateInputSchema,
  checkoutOperationInputSchema,
  emptyToolInputSchema
} from "@/lib/domain/checkout-schemas";

const operationId = "operation_0123456";

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (typeof value !== "object" || value === null) return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema" && key !== "description")
      .map(([key, nested]) => [key, normalizeJsonSchema(nested)])
  );
  if (Object.hasOwn(normalized, "const")) {
    normalized.enum = [normalized.const];
    delete normalized.const;
  }
  return normalized;
}

describe("checkout tool schemas", () => {
  it("accepts only the exact 16–64 character URL-safe operation-ID boundary", () => {
    for (const accepted of ["A".repeat(16), `A${"_-".repeat(31)}_`]) {
      expect(checkoutOperationInputSchema.safeParse({ operationId: accepted }).success).toBe(true);
    }
    for (const rejected of [
      "A".repeat(15),
      "A".repeat(65),
      `é${"a".repeat(15)}`,
      `_start${"a".repeat(11)}`
    ]) {
      expect(checkoutOperationInputSchema.safeParse({ operationId: rejected }).success).toBe(false);
    }
  });

  it("accepts the exact cart_update boundary values", () => {
    for (const quantity of [1, 10]) {
      expect(
        cartUpdateInputSchema.safeParse({
          operationId,
          operation: "set_quantity",
          itemId: "field-notebook",
          quantity
        }).success
      ).toBe(true);
    }

    for (const itemId of ["a", "a".repeat(64), "phantom-item"]) {
      expect(
        cartUpdateInputSchema.safeParse({
          operationId,
          operation: "set_quantity",
          itemId,
          quantity: 2
        }).success
      ).toBe(true);
    }
  });

  it.each([
    [
      "short operation ID",
      { operationId: "short", operation: "set_quantity", itemId: "field-notebook", quantity: 2 }
    ],
    [
      "unknown item",
      { operationId, operation: "set_quantity", itemId: "FIELD-NOTEBOOK", quantity: 2 }
    ],
    [
      "item with an empty segment",
      { operationId, operation: "set_quantity", itemId: "field--notebook", quantity: 2 }
    ],
    [
      "item above maximum length",
      { operationId, operation: "set_quantity", itemId: "a".repeat(65), quantity: 2 }
    ],
    [
      "zero quantity",
      { operationId, operation: "set_quantity", itemId: "field-notebook", quantity: 0 }
    ],
    [
      "quantity above maximum",
      { operationId, operation: "set_quantity", itemId: "field-notebook", quantity: 11 }
    ],
    [
      "fractional quantity",
      { operationId, operation: "set_quantity", itemId: "field-notebook", quantity: 1.5 }
    ],
    [
      "string quantity",
      { operationId, operation: "set_quantity", itemId: "field-notebook", quantity: "2" }
    ],
    [
      "unsupported operation",
      { operationId, operation: "increment", itemId: "field-notebook", quantity: 2 }
    ],
    [
      "extra property",
      {
        operationId,
        operation: "set_quantity",
        itemId: "field-notebook",
        quantity: 2,
        approval: true
      }
    ]
  ])("rejects %s", (_name, input) => {
    expect(cartUpdateInputSchema.safeParse(input).success).toBe(false);
  });

  it("uses strict operation-only schemas for checkout request and cancel", () => {
    expect(checkoutOperationInputSchema.safeParse({ operationId }).success).toBe(true);
    expect(
      checkoutOperationInputSchema.safeParse({ operationId, pendingId: "caller-owned" }).success
    ).toBe(false);
    expect(emptyToolInputSchema.safeParse({}).success).toBe(true);
    expect(emptyToolInputSchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("publishes JSON schemas that match the strict Zod contracts", () => {
    expect(EMPTY_TOOL_JSON_SCHEMA).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false
    });
    expect(CART_UPDATE_JSON_SCHEMA.required).toEqual([
      "operationId",
      "operation",
      "itemId",
      "quantity"
    ]);
    expect(CART_UPDATE_JSON_SCHEMA.properties.quantity).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 10
    });
    expect(CART_UPDATE_JSON_SCHEMA.properties.itemId).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    });
    expect(CART_UPDATE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(CHECKOUT_OPERATION_JSON_SCHEMA.required).toEqual(["operationId"]);
    expect(CHECKOUT_OPERATION_JSON_SCHEMA.additionalProperties).toBe(false);

    expect(normalizeJsonSchema(z.toJSONSchema(emptyToolInputSchema))).toEqual(
      normalizeJsonSchema(EMPTY_TOOL_JSON_SCHEMA)
    );
    expect(normalizeJsonSchema(z.toJSONSchema(cartUpdateInputSchema))).toEqual(
      normalizeJsonSchema(CART_UPDATE_JSON_SCHEMA)
    );
    expect(normalizeJsonSchema(z.toJSONSchema(checkoutOperationInputSchema))).toEqual(
      normalizeJsonSchema(CHECKOUT_OPERATION_JSON_SCHEMA)
    );
  });
});
