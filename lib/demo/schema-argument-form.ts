import { z } from "zod";

import {
  THURSTONE_REFERENCE_TOOL_TEMPLATES,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";

export type SchemaArgumentValue = string | number | boolean;
export type SchemaArgumentValues = Readonly<Record<string, SchemaArgumentValue>>;

type BaseField = Readonly<{
  name: string;
  label: string;
  description: string | null;
  required: boolean;
}>;

export type SchemaArgumentField =
  | (BaseField & { readonly kind: "runtime"; readonly summary: string })
  | (BaseField & { readonly kind: "fixed"; readonly value: SchemaArgumentValue })
  | (BaseField & { readonly kind: "select"; readonly options: readonly string[] })
  | (BaseField & {
      readonly kind: "integer";
      readonly minimum: number | null;
      readonly maximum: number | null;
    })
  | (BaseField & {
      readonly kind: "string";
      readonly minLength: number | null;
      readonly maxLength: number | null;
      readonly pattern: string | null;
    })
  | (BaseField & { readonly kind: "boolean" });

const propertySchema = z
  .object({
    type: z.enum(["string", "integer", "boolean"]),
    description: z.string().optional(),
    enum: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .min(1)
      .optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    pattern: z.string().optional()
  })
  .passthrough();

const objectSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), propertySchema),
    required: z.array(z.string()).optional(),
    additionalProperties: z.literal(false)
  })
  .passthrough();

function labelFor(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./u, (value) => value.toUpperCase())
    .replace(/\bId\b/gu, "ID");
}

function runtimeFields(toolName: ThurstoneDemoSelectableToolName): ReadonlySet<string> {
  const contract = THURSTONE_REFERENCE_TOOL_TEMPLATES[toolName].argumentContracts[0];
  return new Set(contract && "operationId" in contract ? ["operationId"] : []);
}

function fixtureOptions(
  toolName: ThurstoneDemoSelectableToolName,
  fieldName: string
): readonly string[] | null {
  const contract = THURSTONE_REFERENCE_TOOL_TEMPLATES[toolName].argumentContracts[0];
  if (fieldName === "itemId" && contract?.kind === "cart_update") return contract.itemIds;
  return null;
}

export function schemaArgumentFields(
  toolName: ThurstoneDemoSelectableToolName
): readonly SchemaArgumentField[] {
  const schema = objectSchema.parse(THURSTONE_REFERENCE_TOOL_TEMPLATES[toolName].inputSchema);
  const required = new Set(schema.required ?? []);
  const runtime = runtimeFields(toolName);
  return Object.entries(schema.properties).map(([name, property]): SchemaArgumentField => {
    const base = {
      name,
      label: labelFor(name),
      description: property.description ?? null,
      required: required.has(name)
    } as const;
    if (runtime.has(name)) {
      return { ...base, kind: "runtime", summary: "Generated uniquely for each live invocation" };
    }
    const options = fixtureOptions(toolName, name);
    if (options !== null) return { ...base, kind: "select", options };
    if (property.enum !== undefined) {
      if (property.enum.length === 1) return { ...base, kind: "fixed", value: property.enum[0]! };
      if (property.enum.every((value): value is string => typeof value === "string")) {
        return { ...base, kind: "select", options: property.enum };
      }
      throw new Error(`Unsupported mixed enum for ${toolName}.${name}.`);
    }
    if (property.type === "integer") {
      return {
        ...base,
        kind: "integer",
        minimum: property.minimum ?? null,
        maximum: property.maximum ?? null
      };
    }
    if (property.type === "boolean") return { ...base, kind: "boolean" };
    return {
      ...base,
      kind: "string",
      minLength: property.minLength ?? null,
      maxLength: property.maxLength ?? null,
      pattern: property.pattern ?? null
    };
  });
}

export function defaultSchemaArgumentValues(
  toolName: ThurstoneDemoSelectableToolName
): SchemaArgumentValues {
  return Object.fromEntries(
    schemaArgumentFields(toolName).map((field) => {
      if (field.kind === "runtime") return [field.name, "runtime-generated"];
      if (field.kind === "fixed") return [field.name, field.value];
      if (field.kind === "select") return [field.name, field.options[0] ?? ""];
      if (field.kind === "integer") return [field.name, field.minimum ?? 0];
      if (field.kind === "boolean") return [field.name, false];
      return [field.name, ""];
    })
  );
}
