import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { probeLiveManifestSchema, type ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import { z } from "zod";

export const PROBE_DECISION_VERSION = "toolproof-probe-decision@1.0.0";
export const PROBE_DECISION_JSON_SCHEMA_NAME = "toolproof_probe_decision";
export const PROBE_DECISION_TEXT_MAX_CHARACTERS = 800;

const jsonObjectSchema = z.record(z.string(), z.json());
const nonBlankDecisionText = z
  .string()
  .min(1)
  .max(PROBE_DECISION_TEXT_MAX_CHARACTERS)
  .refine((value) => value.trim().length > 0, "Decision text must not be blank.");

export const probeCallDecisionSchema = z
  .object({
    kind: z.literal("call"),
    tool: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u),
    arguments: jsonObjectSchema
  })
  .strict();

export const probeClarifyDecisionSchema = z
  .object({
    kind: z.literal("clarify"),
    text: nonBlankDecisionText
  })
  .strict();

export const probeAbstainDecisionSchema = z
  .object({
    kind: z.literal("abstain"),
    reason: nonBlankDecisionText
  })
  .strict();

export const probeDecisionSchema = z.discriminatedUnion("kind", [
  probeCallDecisionSchema,
  probeClarifyDecisionSchema,
  probeAbstainDecisionSchema
]);

export const probeDecisionOutputSchema = z
  .object({
    decision: probeDecisionSchema
  })
  .strict();

export type ProbeCallDecision = z.infer<typeof probeCallDecisionSchema>;
export type ProbeClarifyDecision = z.infer<typeof probeClarifyDecisionSchema>;
export type ProbeAbstainDecision = z.infer<typeof probeAbstainDecisionSchema>;
export type ProbeDecision = z.infer<typeof probeDecisionSchema>;
export type ProbeDecisionOutput = z.infer<typeof probeDecisionOutputSchema>;

export class ProbeDecisionError extends Error {
  constructor(
    readonly code:
      | "tool_not_in_live_manifest"
      | "invalid_live_argument_schema"
      | "arguments_do_not_match_live_schema"
  ) {
    super(code);
    this.name = "ProbeDecisionError";
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function parseProbeDecision(value: unknown, manifest: ProbeLiveManifest): ProbeDecision {
  const parsedManifest = probeLiveManifestSchema.parse(manifest);
  const decision = probeDecisionSchema.parse(value);
  if (decision.kind === "call") {
    const selected = parsedManifest.tools.find(({ name }) => name === decision.tool);
    if (!selected) throw new ProbeDecisionError("tool_not_in_live_manifest");

    let argumentSchema: z.ZodType;
    try {
      argumentSchema = z.fromJSONSchema(
        selected.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
      );
    } catch {
      throw new ProbeDecisionError("invalid_live_argument_schema");
    }
    if (!argumentSchema.safeParse(decision.arguments).success) {
      throw new ProbeDecisionError("arguments_do_not_match_live_schema");
    }
  }
  return deepFreeze(canonicalClone(decision));
}

export function parseProbeDecisionOutput(
  value: unknown,
  manifest: ProbeLiveManifest
): ProbeDecision {
  const output = probeDecisionOutputSchema.parse(value);
  return parseProbeDecision(output.decision, manifest);
}

export interface ProbeDecisionJsonSchemaFormat {
  readonly name: typeof PROBE_DECISION_JSON_SCHEMA_NAME;
  readonly strict: true;
  readonly schema: Readonly<Record<string, unknown>>;
}

function textBranch(kind: "clarify" | "abstain", field: "text" | "reason") {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: [kind] },
      [field]: {
        type: "string"
      }
    },
    required: ["kind", field],
    additionalProperties: false
  };
}

export function createProbeDecisionJsonSchema(
  manifest: ProbeLiveManifest
): ProbeDecisionJsonSchemaFormat {
  const parsed = probeLiveManifestSchema.parse(manifest);
  const callBranches = [...parsed.tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => ({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["call"] },
        tool: { type: "string", enum: [tool.name] },
        arguments: canonicalClone(tool.inputSchema)
      },
      required: ["kind", "tool", "arguments"],
      additionalProperties: false
    }));

  return deepFreeze(
    canonicalClone({
      name: PROBE_DECISION_JSON_SCHEMA_NAME,
      strict: true,
      schema: {
        type: "object",
        properties: {
          decision: {
            anyOf: [...callBranches, textBranch("clarify", "text"), textBranch("abstain", "reason")]
          }
        },
        required: ["decision"],
        additionalProperties: false
      }
    })
  );
}

export function probeDecisionJsonSchemaHash(manifest: ProbeLiveManifest): Promise<string> {
  return canonicalSha256(createProbeDecisionJsonSchema(manifest));
}
