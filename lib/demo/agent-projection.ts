import { z } from "zod";

import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_AGENT_PROJECTION_VERSION = "thurstone-byoa-agent-projection@1" as const;
export const BYOA_AGENT_PROJECTION_STORAGE_KEY = "thurstone:byoa-agent-projection@1" as const;
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
    inputSchema: projectionJsonSchema,
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        untrustedContentHint: z.boolean().optional()
      })
      .strict()
  })
  .strict();

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

export function parseAgentVisibleRunProjection(value: unknown): AgentVisibleRunProjection {
  return Object.freeze(
    JSON.parse(
      canonicalJson(agentVisibleRunProjectionSchema.parse(value))
    ) as AgentVisibleRunProjection
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
