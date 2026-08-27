import { describe, expect, it } from "vitest";

import { checkoutRequest, createCheckoutFixture } from "@/lib/domain/checkout";
import {
  PROBE_CALIBRATION_ENVELOPE_VERSION,
  PROBE_FIXTURE_SYNOPSIS_VERSION,
  PROBE_LIVE_MANIFEST_VERSION,
  PROBE_MODEL_INPUT_VERSION,
  PROBE_TRANSPORT_BINDING_VERSION,
  ProbeExpectationLeakageError,
  ProbeTransportBindingError,
  assertNoProbeExpectationLeakage,
  createProbeFixtureSynopsis,
  createProbeModelInput,
  createProbeTransportBinding,
  parseExpectationFreeCalibrationEnvelope,
  probeCalibrationEnvelopeHash,
  probeCalibrationEnvelopeSchema,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema,
  verifyProbeTransportBinding,
  type ProbeCalibrationEnvelope,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { probeDecisionJsonSchemaHash } from "@/lib/probe/decision";
import {
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_VERSION,
  probeRunnerPromptHash,
  probeRunnerSettingsHash
} from "@/lib/probe/runner-contract";

function liveManifest(): ProbeLiveManifest {
  return {
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: "a".repeat(64),
    tools: [
      {
        name: "cart_get",
        title: "Read cart lines",
        description: "Return current cart line-item identities and quantities.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      },
      {
        name: "order_review",
        title: "Review order summary",
        description: "Return the current final read-only order summary.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      }
    ]
  };
}

async function envelope(
  naturalLanguageRequest = "Show the cart contents."
): Promise<ProbeCalibrationEnvelope> {
  const manifest = liveManifest();
  const identity = {
    runId: `run_${"R".repeat(22)}`,
    caseId: `case_${"C".repeat(22)}`,
    trialId: `trial_${"T".repeat(22)}`
  };
  const transport = await createProbeTransportBinding(identity);
  return {
    version: PROBE_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: "b".repeat(40),
    ...identity,
    naturalLanguageRequest,
    fixture: createProbeFixtureSynopsis(createCheckoutFixture()),
    liveManifest: manifest,
    runner: {
      promptVersion: PROBE_RUNNER_PROMPT_VERSION,
      promptHash: await probeRunnerPromptHash(),
      settingsVersion: PROBE_RUNNER_SETTINGS_VERSION,
      settingsHash: await probeRunnerSettingsHash(),
      decisionSchemaHash: await probeDecisionJsonSchemaHash(manifest, transport),
      transport
    }
  };
}

describe("minimum expectation-free calibration envelope", () => {
  it("projects only synthetic fixture and item identity facts needed for selection", () => {
    const synopsis = createProbeFixtureSynopsis(createCheckoutFixture());
    expect(synopsis).toEqual({
      version: PROBE_FIXTURE_SYNOPSIS_VERSION,
      simulated: true,
      fixtureId: "checkout-seed-v1",
      fixtureVersion: "checkout-fixture@1.0.0",
      stateRevision: 0,
      items: [
        { itemId: "field-notebook", name: "Field notebook" },
        { itemId: "stoneware-mug", name: "Stoneware mug" }
      ],
      pendingCheckout: false
    });
    expect(synopsis).not.toHaveProperty("seed");
    expect(synopsis).not.toHaveProperty("shipping");
    expect(synopsis).not.toHaveProperty("delivery");
    expect(synopsis).not.toHaveProperty("pendingId");
    expect(synopsis).not.toHaveProperty("operationId");
    expect(synopsis).not.toHaveProperty("currency");
    expect(synopsis).not.toHaveProperty("lines");
    for (const item of synopsis.items) {
      expect(item).not.toHaveProperty("quantity");
      expect(item).not.toHaveProperty("unitPriceCents");
    }
    expect(Object.isFrozen(synopsis)).toBe(true);
  });

  it("rejects pending state, duplicate/mismatched lines, and undeclared fixture fields", () => {
    const pending = checkoutRequest(
      createCheckoutFixture(),
      { operationId: "request_0123456789" },
      "c".repeat(64)
    ).state;
    expect(() => createProbeFixtureSynopsis(pending)).toThrow();

    const base = createProbeFixtureSynopsis(createCheckoutFixture());
    expect(
      probeFixtureSynopsisSchema.safeParse({
        ...base,
        items: [base.items[0], base.items[0]]
      }).success
    ).toBe(false);
    expect(
      probeFixtureSynopsisSchema.safeParse({
        ...base,
        items: [{ ...base.items[0], name: "Stoneware mug" }, base.items[1]]
      }).success
    ).toBe(false);
    expect(
      probeFixtureSynopsisSchema.safeParse({
        ...base,
        items: [{ ...base.items[0], quantity: 1 }, base.items[1]]
      }).success
    ).toBe(false);
    expect(probeFixtureSynopsisSchema.safeParse({ ...base, seed: "private" }).success).toBe(false);
  });

  it("accepts and deeply freezes the exact strict envelope", async () => {
    const parsed = parseExpectationFreeCalibrationEnvelope(await envelope());
    expect(parsed).toEqual(await envelope());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.fixture)).toBe(true);
    expect(Object.isFrozen(parsed.liveManifest.tools[0])).toBe(true);
    expect(Object.isFrozen(parsed.liveManifest.tools[0]?.inputSchema)).toBe(true);
  });

  it("projects exactly the model-permitted request, fixture, and five-field tools", async () => {
    const source = await envelope();
    const modelInput = createProbeModelInput(source);
    expect(modelInput).toEqual({
      version: PROBE_MODEL_INPUT_VERSION,
      request: source.naturalLanguageRequest,
      fixture: source.fixture,
      tools: source.liveManifest.tools
    });
    const bytes = JSON.stringify(modelInput);
    expect(bytes).not.toMatch(
      /buildCommit|runId|caseId|trialId|manifestHash|promptHash|settingsHash|decisionSchemaHash|operationId|bindingHash/iu
    );
    expect(bytes).not.toMatch(/origin|window|execute|handlerVersion/iu);
  });

  it("rejects expectation-bearing keys before schema parsing without scanning legitimate prose", async () => {
    const legitimate = await envelope(
      "What is the expected delivery estimate if I review this simulated order?"
    );
    expect(() => parseExpectationFreeCalibrationEnvelope(legitimate)).not.toThrow();

    for (const [key, path] of [
      ["expectedTool", "$root.expectedTool"],
      ["semantic_family", "$root.liveManifest.tools[0].semantic_family"],
      ["score", "$root.fixture.score"],
      ["repairHint", "$root.runner.repairHint"]
    ] as const) {
      const contaminated = structuredClone(await envelope()) as Record<string, unknown>;
      if (path.includes("liveManifest")) {
        const manifest = contaminated.liveManifest as { tools: Array<Record<string, unknown>> };
        manifest.tools[0]![key] = "hidden";
      } else if (path.includes("fixture")) {
        (contaminated.fixture as Record<string, unknown>)[key] = "hidden";
      } else if (path.includes("runner")) {
        (contaminated.runner as Record<string, unknown>)[key] = "hidden";
      } else {
        contaminated[key] = "hidden";
      }
      expect(() => parseExpectationFreeCalibrationEnvelope(contaminated)).toThrowError(
        expect.objectContaining<Partial<ProbeExpectationLeakageError>>({
          code: "forbidden_key",
          path
        })
      );
    }
  });

  it("rejects semantic metadata and executable/runtime fields from the live manifest", () => {
    const base = liveManifest();
    expect(
      probeLiveManifestSchema.safeParse({
        ...base,
        tools: [{ ...base.tools[0], handlerVersion: "hidden" }, base.tools[1]]
      }).success
    ).toBe(false);
    expect(
      probeLiveManifestSchema.safeParse({
        ...base,
        tools: [{ ...base.tools[0], origin: "https://example.test" }, base.tools[1]]
      }).success
    ).toBe(false);
    expect(
      probeLiveManifestSchema.safeParse({
        ...base,
        tools: [
          { ...base.tools[0], inputSchema: { type: "object", properties: {} } },
          base.tools[1]
        ]
      }).success
    ).toBe(false);
  });

  it("rejects invalid identities, extra envelope fields, and duplicate live tools", async () => {
    const base = await envelope();
    expect(
      probeCalibrationEnvelopeSchema.safeParse({ ...base, caseId: "review_case" }).success
    ).toBe(false);
    expect(probeCalibrationEnvelopeSchema.safeParse({ ...base, evaluator: "hidden" }).success).toBe(
      false
    );
    expect(
      probeCalibrationEnvelopeSchema.safeParse({
        ...base,
        liveManifest: {
          ...base.liveManifest,
          tools: [base.liveManifest.tools[0], base.liveManifest.tools[0]]
        }
      }).success
    ).toBe(false);
  });

  it("hashes only a validated canonical envelope and changes with the request", async () => {
    const first = await envelope();
    const second = structuredClone(first);
    await expect(
      Promise.all([probeCalibrationEnvelopeHash(first), probeCalibrationEnvelopeHash(second)])
    ).resolves.toSatisfy(([left, right]) => left === right);

    second.naturalLanguageRequest = "Review the order.";
    await expect(probeCalibrationEnvelopeHash(second)).resolves.not.toBe(
      await probeCalibrationEnvelopeHash(first)
    );
  });

  it("derives one deterministic opaque runner transport binding and rejects tampering", async () => {
    const source = await envelope();
    const first = await createProbeTransportBinding(source);
    const second = await createProbeTransportBinding(structuredClone(source));
    expect(first).toEqual(second);
    expect(first).toEqual(source.runner.transport);
    expect(first).toMatchObject({
      version: PROBE_TRANSPORT_BINDING_VERSION,
      ownership: "runner",
      operationId: expect.stringMatching(/^probe_[a-f0-9]{58}$/u),
      bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(verifyProbeTransportBinding(source)).resolves.toEqual(first);

    for (const field of ["operationId", "bindingHash"] as const) {
      const tampered = structuredClone(source);
      tampered.runner.transport[field] =
        field === "operationId" ? `probe_${"0".repeat(58)}` : "0".repeat(64);
      await expect(verifyProbeTransportBinding(tampered)).rejects.toThrowError(
        expect.objectContaining<Partial<ProbeTransportBindingError>>({
          code: "transport_binding_mismatch"
        })
      );
      await expect(probeCalibrationEnvelopeHash(tampered)).rejects.toThrow(
        "transport_binding_mismatch"
      );
    }
  });

  it("supports standalone recursive leakage checks on arrays and normalized key forms", () => {
    expect(() => assertNoProbeExpectationLeakage([{ harmless: true }])).not.toThrow();
    expect(() => assertNoProbeExpectationLeakage([{ expected_action: "hidden" }])).toThrowError(
      expect.objectContaining<Partial<ProbeExpectationLeakageError>>({
        code: "forbidden_key",
        path: "$root[0].expected_action"
      })
    );
  });
});
