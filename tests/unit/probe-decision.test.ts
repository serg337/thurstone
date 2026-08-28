import { describe, expect, it } from "vitest";

import {
  PROBE_DECISION_JSON_SCHEMA_NAME,
  ProbeDecisionError,
  createProbeDecisionJsonSchema,
  createProbeFunctionToolDefinitions,
  parseProbeDecision,
  parseProbeDecisionOutput,
  probeFunctionToolDefinitionsHash,
  probeDecisionJsonSchemaHash,
  probeDecisionSchema
} from "@/lib/probe/decision";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  PROBE_TRANSPORT_BINDING_VERSION,
  probeLiveManifestSchema,
  type ProbeLiveManifest,
  type ProbeTransportBinding
} from "@/lib/probe/calibration-envelope";

const transport: ProbeTransportBinding = {
  version: PROBE_TRANSPORT_BINDING_VERSION,
  ownership: "runner",
  operationId: `probe_${"a".repeat(58)}`,
  bindingHash: "b".repeat(64)
};

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
            operationId: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$"
            },
            quantity: { type: "integer", minimum: 1, maximum: 10 }
          },
          required: ["operationId", "quantity"],
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
        {
          kind: "call",
          tool: "cart_update",
          arguments: { operationId: transport.operationId, quantity: 3 }
        },
        manifest(),
        transport
      )
    ).toEqual({
      kind: "call",
      tool: "cart_update",
      arguments: { operationId: transport.operationId, quantity: 3 }
    });
    expect(
      parseProbeDecision({ kind: "clarify", text: "Which item?" }, manifest(), transport)
    ).toEqual({
      kind: "clarify",
      text: "Which item?"
    });
    expect(
      parseProbeDecision(
        { kind: "abstain", reason: "No live tool applies." },
        manifest(),
        transport
      )
    ).toEqual({
      kind: "abstain",
      reason: "No live tool applies."
    });
  });

  it("extracts the inner contract decision from the provider root object", () => {
    expect(
      parseProbeDecisionOutput(
        { decision: { kind: "call", tool: "order_review", arguments: {} } },
        manifest(),
        transport
      )
    ).toEqual({ kind: "call", tool: "order_review", arguments: {} });

    expect(() =>
      parseProbeDecisionOutput(
        {
          decision: { kind: "call", tool: "order_review", arguments: {} },
          commentary: "extra"
        },
        manifest(),
        transport
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
      parseProbeDecision(
        { kind: "call", tool: "checkout_request", arguments: {} },
        manifest(),
        transport
      )
    ).toThrowError(
      expect.objectContaining<Partial<ProbeDecisionError>>({ code: "tool_not_in_live_manifest" })
    );
  });

  it("revalidates call arguments against the selected live schema", () => {
    for (const argumentsValue of [
      { operationId: transport.operationId, quantity: 11 },
      { operationId: transport.operationId, quantity: 3, extra: true }
    ]) {
      expect(() =>
        parseProbeDecision(
          { kind: "call", tool: "cart_update", arguments: argumentsValue },
          manifest(),
          transport
        )
      ).toThrowError(
        expect.objectContaining<Partial<ProbeDecisionError>>({
          code: "arguments_do_not_match_live_schema"
        })
      );
    }
  });

  it("rejects a mutation decision whose runner-owned operation ID is not the bound value", () => {
    expect(() =>
      parseProbeDecision(
        {
          kind: "call",
          tool: "cart_update",
          arguments: { operationId: `probe_${"c".repeat(58)}`, quantity: 3 }
        },
        manifest(),
        transport
      )
    ).toThrowError(
      expect.objectContaining<Partial<ProbeDecisionError>>({
        code: "operation_id_binding_mismatch"
      })
    );
  });
});

describe("live-manifest-derived decision JSON Schema", () => {
  it("maps the live catalog to strict Responses function tools with the same transport binding", async () => {
    const definitions = createProbeFunctionToolDefinitions(manifest(), transport);
    expect(definitions.map(({ name }) => name)).toEqual(["cart_update", "order_review"]);
    expect(definitions).toEqual([
      {
        type: "function",
        name: "cart_update",
        description: "Set one current cart line to the quantity the user requests.",
        parameters: {
          ...manifest().tools[1]!.inputSchema,
          properties: {
            ...((manifest().tools[1]!.inputSchema.properties ?? {}) as Record<string, unknown>),
            operationId: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              enum: [transport.operationId]
            }
          }
        },
        strict: true
      },
      {
        type: "function",
        name: "order_review",
        description: "Return the current final read-only order summary.",
        parameters: manifest().tools[0]!.inputSchema,
        strict: true
      }
    ]);
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(Object.isFrozen(definitions[0]!.parameters)).toBe(true);
    expect(JSON.stringify(definitions)).not.toMatch(
      /expectedTool|internalTruthId|calibration_truth_/u
    );
    await expect(
      probeFunctionToolDefinitionsHash(structuredClone(manifest()), transport)
    ).resolves.toBe(await probeFunctionToolDefinitionsHash(manifest(), transport));
  });

  it("uses the required provider root object and exact inner anyOf branches", () => {
    const format = createProbeDecisionJsonSchema(manifest(), transport);
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
        arguments: {
          ...manifest().tools[1]?.inputSchema,
          properties: {
            ...((manifest().tools[1]?.inputSchema.properties ?? {}) as Record<string, unknown>),
            operationId: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              enum: [transport.operationId]
            }
          }
        }
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

  it("prebinds the same opaque operation ID in every mutation branch without changing read-only branches", () => {
    const multiple = structuredClone(manifest());
    multiple.tools.push({
      name: "checkout_request",
      title: "Request simulated checkout",
      description: "Open one pending simulated checkout.",
      inputSchema: {
        type: "object",
        properties: {
          operationId: {
            type: "string",
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$"
          }
        },
        required: ["operationId"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false }
    });
    const format = createProbeDecisionJsonSchema(multiple, transport);
    const branches = (
      format.schema.properties as { decision: { anyOf: Array<Record<string, unknown>> } }
    ).decision.anyOf.filter((branch) => {
      const properties = branch.properties as { tool?: { enum?: string[] } } | undefined;
      return properties?.tool?.enum;
    });
    const byName = new Map(
      branches.map((branch) => {
        const properties = branch.properties as {
          tool: { enum: string[] };
          arguments: { properties: Record<string, unknown> };
        };
        return [properties.tool.enum[0], properties.arguments];
      })
    );
    expect(byName.get("order_review")?.properties).toEqual({});
    for (const toolName of ["cart_update", "checkout_request"]) {
      expect(byName.get(toolName)?.properties.operationId).toMatchObject({
        enum: [transport.operationId]
      });
    }
    expect(JSON.stringify(format)).not.toMatch(/expectedTool|internalTruthId|calibration_truth_/u);
  });

  it("is canonical, deterministic, immutable, and changes with the live call contract", async () => {
    const first = createProbeDecisionJsonSchema(manifest(), transport);
    const second = createProbeDecisionJsonSchema(structuredClone(manifest()), transport);
    await expect(
      Promise.all([
        probeDecisionJsonSchemaHash(manifest(), transport),
        probeDecisionJsonSchemaHash(manifest(), transport)
      ])
    ).resolves.toSatisfy(([left, right]) => left === right);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.schema)).toBe(true);

    const changed = structuredClone(manifest());
    changed.tools[1]!.inputSchema = {
      type: "object",
      properties: {
        operationId: {
          type: "string",
          pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$"
        },
        quantity: { type: "integer", minimum: 2, maximum: 10 }
      },
      required: ["operationId", "quantity"],
      additionalProperties: false
    };
    await expect(probeDecisionJsonSchemaHash(changed, transport)).resolves.not.toBe(
      await probeDecisionJsonSchemaHash(manifest(), transport)
    );

    const changedTransport = { ...transport, operationId: `probe_${"d".repeat(58)}` };
    await expect(probeDecisionJsonSchemaHash(manifest(), changedTransport)).resolves.not.toBe(
      await probeDecisionJsonSchemaHash(manifest(), transport)
    );
  });

  it("fails closed on duplicate tools or a non-strict root argument schema", () => {
    const duplicate = structuredClone(manifest());
    duplicate.tools[1]!.name = duplicate.tools[0]!.name;
    expect(probeLiveManifestSchema.safeParse(duplicate).success).toBe(false);

    const permissive = structuredClone(manifest());
    permissive.tools[0]!.inputSchema.additionalProperties = true;
    expect(() => createProbeDecisionJsonSchema(permissive, transport)).toThrow();

    const missingTransportField = structuredClone(manifest());
    missingTransportField.tools[1]!.inputSchema = {
      type: "object",
      properties: { quantity: { type: "integer" } },
      required: ["quantity"],
      additionalProperties: false
    };
    expect(() => createProbeDecisionJsonSchema(missingTransportField, transport)).toThrowError(
      expect.objectContaining<Partial<ProbeDecisionError>>({
        code: "runner_owned_operation_id_missing"
      })
    );
  });
});
