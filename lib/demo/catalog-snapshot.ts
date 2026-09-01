import { z } from "zod";

import { jsonValueSchema } from "@/lib/demo/diagnostic-contract";
import {
  THURSTONE_DEMO_DEFAULT_TOOL_NAMES,
  THURSTONE_DEMO_FIXTURE_ID,
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_DEMO_TOOLSET_VERSION,
  THURSTONE_DEMO_TRUSTED_STATE_SOURCE,
  THURSTONE_REFERENCE_TOOL_TEMPLATES,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export {
  THURSTONE_DEMO_DEFAULT_TOOL_NAMES,
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_DEMO_TOOLSET_VERSION,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";

export const THURSTONE_DEMO_CATALOG_VERSION = "thurstone-demo-catalog@1" as const;

const unsafeTextPattern =
  /(?:https?:\/\/|www\.|<[^>]*>|`{1,3}|\[[^\]]*\]\([^)]*\)|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)|-----BEGIN)/u;

function boundedPlainText(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
      `${label} must not contain control characters.`
    )
    .refine(
      (value) => !unsafeTextPattern.test(value),
      `${label} must be plain synthetic text without URLs, markup, or secret-shaped values.`
    );
}

const catalogJsonObjectSchema = jsonValueSchema.refine(
  (
    value
  ): value is { readonly [key: string]: import("@/lib/demo/diagnostic-contract").JsonValue } =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  "Tool inputSchema must be a JSON object."
);

const catalogAnnotationsSchema = z.object({ readOnlyHint: z.boolean() }).strict();

export const thurstoneDemoCatalogToolSchema = z
  .object({
    name: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
    title: boundedPlainText(3, 80, "Tool title"),
    description: boundedPlainText(20, 600, "Tool description"),
    inputSchema: catalogJsonObjectSchema,
    annotations: catalogAnnotationsSchema,
    handlerVersion: z.string().min(1).max(80)
  })
  .strict()
  .superRefine((tool, context) => {
    const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[tool.name];
    for (const [path, actual, expected, message] of [
      ["inputSchema", tool.inputSchema, template.inputSchema, "Tool input schema is fixed."],
      ["annotations", tool.annotations, template.annotations, "Tool annotations are fixed."],
      [
        "handlerVersion",
        tool.handlerVersion,
        template.handlerVersion,
        "Tool handler version is fixed."
      ]
    ] as const) {
      if (canonicalJson(actual) !== canonicalJson(expected)) {
        context.addIssue({ code: "custom", path: [path], message });
      }
    }
  });

export type ThurstoneDemoCatalogToolV1 = z.infer<typeof thurstoneDemoCatalogToolSchema>;

export const thurstoneDemoCatalogSnapshotSchema = z
  .object({
    version: z.literal(THURSTONE_DEMO_CATALOG_VERSION),
    toolsetVersion: z.literal(THURSTONE_DEMO_TOOLSET_VERSION),
    fixtureId: z.literal(THURSTONE_DEMO_FIXTURE_ID),
    trustedStateSource: z.literal(THURSTONE_DEMO_TRUSTED_STATE_SOURCE),
    tools: z.array(thurstoneDemoCatalogToolSchema).min(2).max(4)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const names = snapshot.tools.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Catalog tools must be unique."
      });
      return;
    }
    const expectedOrder = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.filter((name) =>
      names.includes(name)
    );
    if (canonicalJson(names) !== canonicalJson(expectedOrder)) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Catalog tools must use deterministic reference-library order."
      });
    }
  });

export type ThurstoneDemoCatalogSnapshotV1 = z.infer<typeof thurstoneDemoCatalogSnapshotSchema>;

export interface ThurstoneDemoDescriptorOverride {
  readonly title?: string;
  readonly description?: string;
}

export interface CreateThurstoneDemoCatalogSnapshotInput {
  readonly selectedToolNames?: readonly ThurstoneDemoSelectableToolName[];
  readonly descriptorOverrides?: Readonly<
    Partial<Record<ThurstoneDemoSelectableToolName, ThurstoneDemoDescriptorOverride>>
  >;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function parseThurstoneDemoCatalogSnapshot(value: unknown): ThurstoneDemoCatalogSnapshotV1 {
  const parsed = thurstoneDemoCatalogSnapshotSchema.parse(value);
  return deepFreeze(JSON.parse(canonicalJson(parsed)) as ThurstoneDemoCatalogSnapshotV1);
}

export function createThurstoneDemoCatalogSnapshot(
  input: CreateThurstoneDemoCatalogSnapshotInput = {}
): ThurstoneDemoCatalogSnapshotV1 {
  const requestedNames = input.selectedToolNames ?? THURSTONE_DEMO_DEFAULT_TOOL_NAMES;
  const selectedNames = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.filter((name) =>
    requestedNames.includes(name)
  );

  if (
    selectedNames.length !== requestedNames.length ||
    new Set(requestedNames).size !== requestedNames.length
  ) {
    throw new Error("Catalog selection must contain unique selectable reference-tool names.");
  }

  const tools = selectedNames.map((name) => {
    const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[name];
    const override = input.descriptorOverrides?.[name];
    return {
      name,
      title: override?.title?.trim() || template.defaultTitle,
      description: override?.description?.trim() || template.defaultDescription,
      inputSchema: template.inputSchema,
      annotations: template.annotations,
      handlerVersion: template.handlerVersion
    };
  });

  return parseThurstoneDemoCatalogSnapshot({
    version: THURSTONE_DEMO_CATALOG_VERSION,
    toolsetVersion: THURSTONE_DEMO_TOOLSET_VERSION,
    fixtureId: THURSTONE_DEMO_FIXTURE_ID,
    trustedStateSource: THURSTONE_DEMO_TRUSTED_STATE_SOURCE,
    tools
  });
}

export function resetThurstoneDemoCatalogSnapshot(): ThurstoneDemoCatalogSnapshotV1 {
  return createThurstoneDemoCatalogSnapshot();
}

export async function thurstoneDemoCatalogDigest(
  snapshot: ThurstoneDemoCatalogSnapshotV1
): Promise<string> {
  return canonicalSha256(parseThurstoneDemoCatalogSnapshot(snapshot));
}
