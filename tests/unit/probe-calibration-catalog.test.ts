import { describe, expect, it } from "vitest";

import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalSha256 } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import {
  PROBE_CALIBRATION_CASE_COUNT,
  evaluateProbeCalibrationCase,
  getProbeCalibrationCase,
  type ProbeCalibrationObservation
} from "@/lib/probe/calibration-catalog.server";
import { INITIAL_CHECKOUT_TOOL_NAMES, type CheckoutToolName } from "@/lib/webmcp/catalog";

const INPUTS = {
  cart_get: {},
  order_review: {},
  cart_update: {
    operationId: "calibration_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  },
  checkout_request: { operationId: "calibration_request_001" }
} as const;

function resetBoundary() {
  return {
    status: "verified",
    stateRevision: 0,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
  };
}

async function authenticObservation(
  toolName: CheckoutToolName
): Promise<ProbeCalibrationObservation> {
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => "a".repeat(64),
    getArgumentMode: () => "json-string",
    appCommit: "b".repeat(40),
    origin: "https://toolproof-rust.vercel.app",
    userAgent: "Fixture Browser"
  });
  const store = new CheckoutSessionStore({ traceSink: ledger });
  const input = INPUTS[toolName as keyof typeof INPUTS];
  if (toolName === "cart_get") await store.cartGet(input, { source: "native" });
  else if (toolName === "order_review") await store.orderReview(input, { source: "native" });
  else if (toolName === "cart_update") await store.cartUpdate(input, { source: "native" });
  else if (toolName === "checkout_request")
    await store.checkoutRequest(input, { source: "native" });
  else throw new Error("Unsupported calibration tool fixture.");
  const trace = ledger.snapshot().current[0];
  if (!trace) throw new Error("Missing authentic test trace.");
  return {
    decision: { kind: "call", tool: toolName, arguments: input },
    decisionError: null,
    nativeDispatchCount: 1,
    nativeExecution: {
      toolName,
      nativeCallCount: 1,
      handlerTraceId: trace.eventId,
      resultDigest: trace.canonicalResult?.sha256 ?? null,
      effectDigest: await canonicalSha256(trace.effect),
      stateBeforeDigest: trace.stateBefore.sha256,
      stateAfterDigest: trace.stateAfter.sha256
    },
    trace,
    resetBefore: resetBoundary(),
    resetAfter: resetBoundary()
  };
}

describe("server-only Probe calibration catalog", () => {
  it("contains exactly four explicitly non-scored natural-language cases", () => {
    expect(PROBE_CALIBRATION_CASE_COUNT).toBe(4);
    const cases = Array.from({ length: PROBE_CALIBRATION_CASE_COUNT }, (_, ordinal) =>
      getProbeCalibrationCase(ordinal)
    );
    expect(cases.map(({ ordinal }) => ordinal)).toEqual([0, 1, 2, 3]);
    expect(new Set(cases.map(({ naturalLanguageRequest }) => naturalLanguageRequest)).size).toBe(4);
    expect(cases.map(({ expectedTool }) => expectedTool)).toEqual([
      "cart_get",
      "order_review",
      "cart_update",
      "checkout_request"
    ]);
    expect(() => getProbeCalibrationCase(4)).toThrowError(/invalid_calibration_ordinal/u);
  });

  it("deterministically accepts authentic exact traces for all four cases", async () => {
    for (let ordinal = 0; ordinal < PROBE_CALIBRATION_CASE_COUNT; ordinal += 1) {
      const definition = getProbeCalibrationCase(ordinal);
      const evaluation = await evaluateProbeCalibrationCase(
        ordinal,
        await authenticObservation(definition.expectedTool)
      );
      expect(evaluation).toMatchObject({
        ordinal,
        expectedTool: definition.expectedTool,
        passed: true,
        calibrationOnly: true,
        includedInBenchmark: false,
        score: { earned: 1, possible: 1 },
        failures: []
      });
    }
  });

  it("preserves wrong choices, effects, and reset failures as deterministic failures", async () => {
    const wrongTool = await authenticObservation("cart_get");
    const wrongEvaluation = await evaluateProbeCalibrationCase(1, wrongTool);
    expect(wrongEvaluation.passed).toBe(false);
    expect(wrongEvaluation.failures).toContain("wrong_tool");

    const authenticEffect = await authenticObservation("cart_update");
    const wrongEffect: ProbeCalibrationObservation = {
      ...authenticEffect,
      trace: authenticEffect.trace
        ? {
            ...authenticEffect.trace,
            effect: { ...authenticEffect.trace.effect, stateChanged: false }
          }
        : null
    };
    const effectEvaluation = await evaluateProbeCalibrationCase(2, wrongEffect);
    expect(effectEvaluation.failures).toContain("effect_mismatch");

    const authenticReset = await authenticObservation("checkout_request");
    const unverified: ProbeCalibrationObservation = {
      ...authenticReset,
      resetAfter: { ...authenticReset.resetAfter, status: "invalid" }
    };
    const resetEvaluation = await evaluateProbeCalibrationCase(3, unverified);
    expect(resetEvaluation.failures).toContain("after_reset_unverified");
  });

  it("binds the declared fixture hash used by both reset boundaries", () => {
    expect(resetBoundary().stateHash).toBe(CHECKOUT_FIXTURE_STATE_HASH);
  });
});
