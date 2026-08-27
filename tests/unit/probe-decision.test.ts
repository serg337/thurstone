import { describe, expect, it } from "vitest";

import {
  PROBE_DECISION_JSON_SCHEMA_NAME,
  ProbeDecisionError,
  createProbeDecisionJsonSchema,
  parseProbeDecision,
  parseProbeDecisionOutput,
  probeDecisionJsonSchemaHash,
  probeDecisionSchema
} from "@/lib/probe/decision";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  probeLiveManifestSchema,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";

function manifest(): ProbeLiveManifest {
  return {
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: "a".repeat(64),
    tools: [
      {
        name: "order_review",
        title: "Review order summary",
        description: "Return the current final read-only order summary.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      },
      {
        name: "cart_update",
        title: "Set cart quantity",
        description: "Set one current cart line to the quantity the user requests.",
        inputSchema: {
          type: "object",
          properties: {
            quantity: { type: "integer", minimum: 1, maximum: 10 }
          },
          required: ["quantity"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false }
      }
    ]
  };
}

describe("Probe strict decision union", () => {
  it("accepts exactly one call, clarification, or abstention decision", () => {
    expect(
      parseProbeDecision(
        { kind: "call", tool: "cart_update", arguments: { quantity: 3 } },
        manifest()
      )
    ).toEqual({ kind: "call", tool: "cart_update", arguments: { quantity: 3 } });
    expect(parseProbeDecision({ kind: "clarify", text: "Which item?" }, manifest())).toEqual({
      kind: "clarify",
      text: "Which item?"
    });
    expect(
      parseProbeDecision({ kind: "abstain", reason: "No live tool applies." }, manifest())
    ).toEqual({
      kind: "abstain",
      reason: "No live tool applies."
    });
  });

  it("extracts the inner contract decision from the provider root object", () => {
    expect(
      parseProbeDecisionOutput(
        { decision: { kind: "call", tool: "order_review", arguments: {} } },
        manifest()
      )
    ).toEqual({ kind: "call", tool: "order_review", arguments: {} });

    expect(() =>
      parseProbeDecisionOutput(
        {
          decision: { kind: "call", tool: "order_review", arguments: {} },
          commentary: "extra"
        },
        manifest()
      )
    ).toThrow();
  });

  it("rejects cross-variant fields, extras, blank text, and non-JSON arguments", () => {
    for (const candidate of [
      { kind: "call", tool: "cart_update", arguments: {}, text: "extra" },
      { kind: "clarify", text: " ".repeat(3) },
      { kind: "abstain", reason: "", tool: "order_review" },
      { kind: "call", tool: "cart_update" },
      { kind: "call", tool: "cart_update", arguments: { quantity: Number.NaN } },
      { kind: "call", tool: "cart_update", arguments: { quantity: undefined } },
      { kind: "other", reason: "unsupported" }
    ]) {
      expect(probeDecisionSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects a syntactically valid call to a tool outside the live catalog", () => {
    expect(() =>
      parseProbeDecision({ kind: "call", tool: "checkout_request", arguments: {} }, manifest())
    ).toThrowError(
      expect.objectContaining<Partial<ProbeDecisionError>>({ code: "tool_not_in_live_manifest" })
    );
  });

  it("revalidates call arguments against the selected live schema", () => {
    for (const argumentsValue of [{ quantity: 11 }, { quantity: 3, extra: true }]) {
      expect(() =>
        parseProbeDecision(
          { kind: "call", tool: "cart_update", arguments: argumentsValue },
          manifest()
        )
      ).toThrowError(
        expect.objectContaining<Partial<ProbeDecisionError>>({
          code: "arguments_do_not_match_live_schema"
        })
      );
    }
  });
});

describe("live-manifest-derived decision JSON Schema", () => {
  it("uses the required provider root object and exact inner anyOf branches", () => {
    const format = createProbeDecisionJsonSchema(manifest());
    expect(format.name).toBe(PROBE_DECISION_JSON_SCHEMA_NAME);
    expect(format.strict).toBe(true);
    expect(format.schema).toMatchObject({
      type: "object",
      required: ["decision"],
      additionalProperties: false
    });
    expect(format.schema).not.toHaveProperty("oneOf");

    const properties = format.schema.properties as Record<string, unknown>;
    const decision = properties.decision as { anyOf: Array<Record<string, unknown>> };
    expect(decision.anyOf).toHaveLength(4);
    expect(
      decision.anyOf.slice(0, 2).map((branch) => {
        const branchProperties = branch.properties as Record<string, { enum?: string[] }>;
        return branchProperties.tool?.enum?.[0];
      })
    ).toEqual(["cart_update", "order_review"]);
    expect(decision.anyOf[0]).toMatchObject({
      required: ["kind", "tool", "arguments"],
      additionalProperties: false,
      properties: {
        kind: { enum: ["call"] },
        tool: { enum: ["cart_update"] },
        arguments: manifest().tools[1]?.inputSchema
      }
    });
    expect(decision.anyOf[2]).toMatchObject({
      properties: { kind: { enum: ["clarify"] } },
      required: ["kind", "text"],
      additionalProperties: false
    });
    expect(decision.anyOf[3]).toMatchObject({
      properties: { kind: { enum: ["abstain"] } },
      required: ["kind", "reason"],
      additionalProperties: false
    });
  });

  it("is canonical, deterministic, immutable, and changes with the live call contract", async () => {
    const first = createProbeDecisionJsonSchema(manifest());
    const second = createProbeDecisionJsonSchema(structuredClone(manifest()));
    await expect(
      Promise.all([
        probeDecisionJsonSchemaHash(manifest()),
        probeDecisionJsonSchemaHash(manifest())
      ])
    ).resolves.toSatisfy(([left, right]) => left === right);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.schema)).toBe(true);

    const changed = structuredClone(manifest());
    changed.tools[1]!.inputSchema = {
      type: "object",
      properties: { quantity: { type: "integer", minimum: 2, maximum: 10 } },
      required: ["quantity"],
      additionalProperties: false
    };
    await expect(probeDecisionJsonSchemaHash(changed)).resolves.not.toBe(
      await probeDecisionJsonSchemaHash(manifest())
    );
  });

  it("fails closed on duplicate tools or a non-strict root argument schema", () => {
    const duplicate = structuredClone(manifest());
    duplicate.tools[1]!.name = duplicate.tools[0]!.name;
    expect(probeLiveManifestSchema.safeParse(duplicate).success).toBe(false);

    const permissive = structuredClone(manifest());
    permissive.tools[0]!.inputSchema.additionalProperties = true;
    expect(() => createProbeDecisionJsonSchema(permissive)).toThrow();
  });
});
