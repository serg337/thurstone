import { describe, expect, it } from "vitest";

import {
  OWNER_JOURNEY_REPORT_STORAGE_KEY,
  createOwnerJourneyReport,
  ownerJourneyReportJson,
  readOwnerJourneyReport,
  writeOwnerJourneyReport,
  type OwnerJourneyReportResult
} from "@/lib/demo/owner-journey-report";

function result(
  position: number,
  verdict: "pass" | "issue" = "pass"
): Omit<OwnerJourneyReportResult, "position"> {
  const caseId = `case_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${position}`;
  return {
    caseId,
    verdict,
    resultDigest: String(position).repeat(64),
    ownerSummary: {
      caseId,
      request: position === 1 ? "What is in my cart?" : "Review the complete order.",
      expectedTool: position === 1 ? "cart_get" : "order_review",
      observedTool: position === 1 ? "cart_get" : "order_review",
      expectedArguments: { kind: "empty" },
      actualArguments: {},
      verifiedEffect: "No trusted state change",
      resultExplanation:
        "The agent selected the contract-required read-only tool. Thurstone checked the response against site-owned state and verified that the request caused no cart, checkout, or unmodeled state change.",
      primaryFindingCode: null,
      primaryFindingTitle: null,
      recommendedNextStep: null,
      trustedStateAfter: {
        revision: 0,
        lines: [
          { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
          { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
        ],
        pendingCheckoutStatus: null
      }
    }
  };
}

const input = {
  mode: "continuous" as const,
  suiteId: "suite_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  catalogDigest: "c".repeat(64),
  completedAt: "2026-09-02T14:00:00.000Z",
  total: 2,
  results: [result(1), result(2)]
};

describe("owner journey report", () => {
  it("binds ordered summaries, counts, final state, and authentic result digests", async () => {
    const report = await createOwnerJourneyReport(input);
    expect(report.counts).toEqual({
      passed: 2,
      issues: 0,
      incomplete: 0,
      unavailable: 0,
      notRun: 0
    });
    expect(
      report.results.map(({ position, resultDigest }) => ({ position, resultDigest }))
    ).toEqual([
      { position: 1, resultDigest: "1".repeat(64) },
      { position: 2, resultDigest: "2".repeat(64) }
    ]);
    expect(report.finalTrustedState.lines).toHaveLength(2);
    expect(ownerJourneyReportJson(report).endsWith("\n")).toBe(true);
  });

  it("round-trips through bounded session storage and rejects tampering", async () => {
    const stored = await writeOwnerJourneyReport(window.sessionStorage, input);
    await expect(readOwnerJourneyReport(window.sessionStorage)).resolves.toEqual(stored);
    const tampered = JSON.parse(
      window.sessionStorage.getItem(OWNER_JOURNEY_REPORT_STORAGE_KEY) ?? "{}"
    ) as Record<string, unknown>;
    tampered.completedAt = "2026-09-02T14:00:01.000Z";
    window.sessionStorage.setItem(OWNER_JOURNEY_REPORT_STORAGE_KEY, JSON.stringify(tampered));
    await expect(readOwnerJourneyReport(window.sessionStorage)).rejects.toThrow(/digest/iu);
  });

  it("allows a regression batch to preserve an issue and continue to later cases", async () => {
    const report = await createOwnerJourneyReport({
      ...input,
      mode: "regression",
      total: 3,
      results: [result(1), result(2, "issue"), result(3)]
    });
    expect(report.counts).toMatchObject({ passed: 2, issues: 1, notRun: 0 });
    expect(report.results.map(({ verdict }) => verdict)).toEqual(["pass", "issue", "pass"]);
  });

  it("preserves every planned continuous case after a failure and explains unrun cases", async () => {
    const first = result(1);
    const second = result(2, "issue");
    const third = result(3);
    const report = await createOwnerJourneyReport({
      ...input,
      total: 3,
      results: [first, second],
      plannedCases: [first, second, third].map(({ caseId, ownerSummary }) => ({
        caseId,
        request: ownerSummary.request,
        expectedTool: ownerSummary.expectedTool
      }))
    });
    expect(report.counts).toMatchObject({ passed: 1, issues: 1, notRun: 1 });
    expect(report.notRun).toEqual([
      expect.objectContaining({
        position: 3,
        caseId: third.caseId,
        request: third.ownerSummary.request,
        expectedTool: third.ownerSummary.expectedTool,
        reason: expect.stringMatching(/stopped after test 2/iu)
      })
    ]);
  });
});
