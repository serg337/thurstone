import { createCheckoutFixture, orderReview } from "@/lib/domain/checkout";
import { createOperationTrace } from "@/lib/evidence/operation-trace";
import {
  SEMANTIC_TRACE_VERIFIER_VERSION,
  verifySemanticOperationTrace
} from "@/lib/semantic/trace-verifier.server";
import { describe, expect, it } from "vitest";

async function trace() {
  const fixture = createCheckoutFixture();
  return createOperationTrace({
    eventId: "event_semantic_trace_test",
    sessionId: "session_semantic_trace_test",
    runId: "run_semantic_trace_test",
    sequence: 1,
    source: "native",
    toolName: "order_review",
    observedAt: "2026-08-28T21:00:00.000Z",
    registryHash: "a".repeat(64),
    handlerVersion: "order_review@1.0.0",
    domainVersion: "checkout-domain@1.0.0",
    toolsetVersion: "checkout-toolset-v1@1.0.0",
    appCommit: "b".repeat(40),
    runtime: {
      executionPath: "native-webmcp",
      origin: "https://toolproof-rust.vercel.app",
      userAgent: "Synthetic test",
      argumentMode: "json-string"
    },
    status: "completed",
    commitDisposition: "none",
    rawArguments: {},
    canonicalArguments: {},
    rawResult: orderReview(fixture),
    canonicalResult: orderReview(fixture),
    error: null,
    stateBefore: fixture,
    stateAfter: fixture
  });
}

describe("semantic trace verifier", () => {
  it("recomputes canonical evidence and accepts explicit canonical null error evidence", async () => {
    const verified = await verifySemanticOperationTrace(await trace());
    expect(verified.verification).toMatchObject({
      status: "verified",
      verifierVersion: SEMANTIC_TRACE_VERIFIER_VERSION
    });
    expect(verified.verification.traceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(verified.trace.error?.value).toBeNull();
  });

  it("rejects tampered evidence bytes and effect diffs", async () => {
    const valid = await trace();
    await expect(
      verifySemanticOperationTrace({
        ...valid,
        rawArguments: { ...valid.rawArguments, bytes: "tampered" }
      })
    ).rejects.toThrow(/trace_arguments_invalid/u);
    await expect(
      verifySemanticOperationTrace({
        ...valid,
        effect: { ...valid.effect, stateChanged: true }
      })
    ).rejects.toThrow(/trace_semantics_invalid/u);
  });
});
