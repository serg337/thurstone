import { describe, expect, it } from "vitest";

import { createDiagnosticEnvelope, diagnosticPrecedence } from "@/lib/demo/diagnose-result";
import {
  diagnosticFindingCodeSchema,
  type DiagnosticFindingCode,
  type DiagnosticSignal
} from "@/lib/demo/diagnostic-contract";
import { canonicalJson } from "@/lib/evidence/digest";

const base = {
  sourceResultDigest: "a".repeat(64),
  contractDigest: "b".repeat(64),
  buildCommit: "c".repeat(40),
  completedAt: "2026-09-01T00:00:01.000Z"
};

function signal(code: DiagnosticFindingCode): DiagnosticSignal {
  return {
    code,
    expected: code === "wrong_tool_selected" ? "checkout_request" : true,
    actual: code === "wrong_tool_selected" ? "order_review" : false,
    failedAssertionIds: [`assertion_${code}`],
    evidenceRefs: [{ source: "native-trace", jsonPointer: "/toolName", sha256: "d".repeat(64) }]
  };
}

describe("deterministic BYOA diagnosis", () => {
  it("covers every frozen taxonomy code", async () => {
    const codes = diagnosticFindingCodeSchema.options;
    expect(codes).toHaveLength(19);
    for (const code of codes) {
      const diagnostic = await createDiagnosticEnvelope({ ...base, signals: [signal(code)] });
      expect(diagnostic.findings[0]?.code).toBe(code);
      expect(diagnostic.findings[0]?.facts[0]?.evidenceRefs).toHaveLength(1);
      expect(diagnostic.releaseGuidance).not.toBe("case-passed");
    }
  });

  it("returns not-needed and case-passed when no assertion failed", async () => {
    const diagnostic = await createDiagnosticEnvelope({ ...base, signals: [] });
    expect(diagnostic).toMatchObject({
      status: "not-needed",
      primaryFindingId: null,
      findings: [],
      releaseGuidance: "case-passed"
    });
  });

  it("keeps no-call and cancellation inconclusive rather than semantically failing", async () => {
    for (const code of [
      "native_invocation_missing",
      "agent_decision_unobservable",
      "execution_canceled_or_partial"
    ] as const) {
      const diagnostic = await createDiagnosticEnvelope({ ...base, signals: [signal(code)] });
      expect(diagnostic.status).toBe("inconclusive");
      expect(diagnostic.releaseGuidance).toBe("rerun-required");
      expect(diagnostic.findings[0]?.hypothesis).toBeNull();
    }
  });

  it("prevents semantic diagnosis when fixture or native evidence is invalid", async () => {
    const diagnostic = await createDiagnosticEnvelope({
      ...base,
      signals: [signal("wrong_tool_selected"), signal("native_trace_unverified")]
    });
    expect(diagnostic.status).toBe("invalid-evidence");
    expect(diagnostic.primaryFindingId).toContain("native_trace_unverified");
    expect(diagnostic.findings.map(({ code }) => code)).toEqual(["native_trace_unverified"]);
    expect(diagnostic.releaseGuidance).toBe("rerun-required");
  });

  it("makes wrong tool primary and missing effect a consequence", async () => {
    const diagnostic = await createDiagnosticEnvelope({
      ...base,
      signals: [signal("required_effect_missing"), signal("wrong_tool_selected")]
    });
    expect(diagnostic.primaryFindingId).toContain("wrong_tool_selected");
    expect(diagnostic.findings[0]?.consequenceFindingIds[0]).toContain("required_effect_missing");
    expect(diagnostic.findings[0]?.hypothesis?.message).toContain("cannot establish why");
    expect(diagnostic.findings[0]?.nextStep.rerun).toBe("same-case-then-required-suite");
  });

  it("uses immutable precedence independent of signal order", () => {
    expect(diagnosticPrecedence("forbidden_effect_observed")).toBeLessThan(
      diagnosticPrecedence("wrong_tool_selected")
    );
    expect(diagnosticPrecedence("wrong_tool_selected")).toBeLessThan(
      diagnosticPrecedence("argument_value_mismatch")
    );
  });

  it("produces byte-identical diagnosis for identical evidence", async () => {
    const input = {
      ...base,
      signals: [signal("wrong_tool_selected"), signal("required_effect_missing")]
    };
    const first = await createDiagnosticEnvelope(input);
    const second = await createDiagnosticEnvelope(input);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.diagnosticId).toBe(second.diagnosticId);
  });

  it("rejects duplicate finding codes", async () => {
    await expect(
      createDiagnosticEnvelope({
        ...base,
        signals: [signal("wrong_tool_selected"), signal("wrong_tool_selected")]
      })
    ).rejects.toThrow(/at most one/iu);
  });
});
