import { z } from "zod";

import {
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_REFERENCE_TOOL_TEMPLATES
} from "@/lib/demo/reference-tool-templates";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_AGENT_PROJECTION_VERSION = "thurstone-byoa-agent-projection@1" as const;
export const BYOA_AGENT_PROJECTION_V2_VERSION = "thurstone-byoa-agent-projection@2" as const;
export const BYOA_AGENT_PROJECTION_STORAGE_KEY = "thurstone:byoa-agent-projection@1" as const;
export const BYOA_AGENT_PROJECTION_V2_STORAGE_KEY = "thurstone:byoa-agent-projection@2" as const;
export const BYOA_AGENT_PROJECTION_MAX_BYTES = 24 * 1024;

type ProjectionJson =
  | null
  | boolean
  | number
  | string
  | readonly ProjectionJson[]
  | { readonly [key: string]: ProjectionJson };

const projectionJsonSchema: z.ZodType<ProjectionJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(projectionJsonSchema),
    z.record(z.string(), projectionJsonSchema)
  ])
);

const descriptorSchema = z
  .object({
    name: z.enum(["order_review", "checkout_request"]),
    title: z.string().min(3).max(80),
    description: z.string().min(20).max(600),
    inputSchema: z.record(z.string(), projectionJsonSchema),
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        untrustedContentHint: z.boolean().optional()
      })
      .strict()
  })
  .strict();

export const agentVisibleDescriptorV2Schema = z
  .object({
    name: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(20).max(600),
    inputSchema: z.record(z.string(), projectionJsonSchema),
    annotations: z.object({ readOnlyHint: z.boolean() }).strict()
  })
  .strict()
  .superRefine((descriptor, context) => {
    const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[descriptor.name];
    if (canonicalJson(descriptor.inputSchema) !== canonicalJson(template.inputSchema)) {
      context.addIssue({
        code: "custom",
        path: ["inputSchema"],
        message: "The agent-visible schema must match the selected real tool."
      });
    }
    if (canonicalJson(descriptor.annotations) !== canonicalJson(template.annotations)) {
      context.addIssue({
        code: "custom",
        path: ["annotations"],
        message: "The agent-visible annotations must match the selected real tool."
      });
    }
  });

export const agentVisibleRunProjectionSchema = z
  .object({
    version: z.literal(BYOA_AGENT_PROJECTION_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    request: z.string().min(1).max(280),
    fixture: z
      .object({
        fixtureId: z.literal("checkout-seed-v1"),
        summary: z.string().min(1).max(240)
      })
      .strict(),
    descriptors: z.array(descriptorSchema).length(2),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    expiresAt: z.string().datetime({ offset: false })
  })
  .strict();

export type AgentVisibleRunProjection = z.infer<typeof agentVisibleRunProjectionSchema>;

export const agentVisibleRunProjectionV2Schema = z
  .object({
    version: z.literal(BYOA_AGENT_PROJECTION_V2_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    request: z.string().trim().min(1).max(280),
    fixture: z
      .object({
        fixtureId: z.literal("checkout-seed-v1"),
        summary: z.string().trim().min(1).max(240)
      })
      .strict(),
    descriptors: z.array(agentVisibleDescriptorV2Schema).min(1).max(4),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    expiresAt: z.string().datetime({ offset: false })
  })
  .strict()
  .superRefine((projection, context) => {
    const names = projection.descriptors.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["descriptors"],
        message: "Agent-visible tools must be unique."
      });
      return;
    }
    const expectedOrder = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.filter((name) =>
      names.includes(name)
    );
    if (canonicalJson(names) !== canonicalJson(expectedOrder)) {
      context.addIssue({
        code: "custom",
        path: ["descriptors"],
        message: "Agent-visible tools must retain deterministic reference-catalog order."
      });
    }
  });

export type AgentVisibleRunProjectionV2 = z.infer<typeof agentVisibleRunProjectionV2Schema>;

export function parseAgentVisibleRunProjection(value: unknown): AgentVisibleRunProjection {
  return Object.freeze(
    JSON.parse(
      canonicalJson(agentVisibleRunProjectionSchema.parse(value))
    ) as AgentVisibleRunProjection
  );
}

export function parseAgentVisibleRunProjectionV2(value: unknown): AgentVisibleRunProjectionV2 {
  return Object.freeze(
    JSON.parse(
      canonicalJson(agentVisibleRunProjectionV2Schema.parse(value))
    ) as AgentVisibleRunProjectionV2
  );
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function writeAgentVisibleRunProjection(
  storage: Storage,
  projection: AgentVisibleRunProjection
): void {
  const encoded = JSON.stringify(parseAgentVisibleRunProjection(projection));
  if (encodedBytes(encoded) > BYOA_AGENT_PROJECTION_MAX_BYTES) {
    throw new Error("Agent-visible run projection exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_AGENT_PROJECTION_STORAGE_KEY, encoded);
}

export function readAgentVisibleRunProjection(storage: Storage): AgentVisibleRunProjection | null {
  const encoded = storage.getItem(BYOA_AGENT_PROJECTION_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_AGENT_PROJECTION_MAX_BYTES) {
    throw new Error("Stored agent-visible run projection exceeds the allowed size.");
  }
  return parseAgentVisibleRunProjection(JSON.parse(encoded) as unknown);
}

export function clearAgentVisibleRunProjection(storage: Storage): void {
  storage.removeItem(BYOA_AGENT_PROJECTION_STORAGE_KEY);
}

export function writeAgentVisibleRunProjectionV2(
  storage: Storage,
  projection: AgentVisibleRunProjectionV2
): void {
  const encoded = canonicalJson(parseAgentVisibleRunProjectionV2(projection));
  if (encodedBytes(encoded) > BYOA_AGENT_PROJECTION_MAX_BYTES) {
    throw new Error("Agent-visible run projection exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_AGENT_PROJECTION_V2_STORAGE_KEY, encoded);
}

export function readAgentVisibleRunProjectionV2(
  storage: Storage
): AgentVisibleRunProjectionV2 | null {
  const encoded = storage.getItem(BYOA_AGENT_PROJECTION_V2_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_AGENT_PROJECTION_MAX_BYTES) {
    throw new Error("Stored agent-visible run projection exceeds the allowed size.");
  }
  return parseAgentVisibleRunProjectionV2(JSON.parse(encoded) as unknown);
}

export function clearAgentVisibleRunProjectionV2(storage: Storage): void {
  storage.removeItem(BYOA_AGENT_PROJECTION_V2_STORAGE_KEY);
}
