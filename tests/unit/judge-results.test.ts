import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InvocationIntegritySummary } from "@/components/results/invocation-integrity-summary";
import currentResult from "@/evidence/thurstone-current-result.json";
import invocationIntegrity from "@/evidence/thurstone-invocation-integrity.json";

afterEach(cleanup);

describe("judge Results accounting", () => {
  it("keeps semantic and Invocation Integrity denominators separate", () => {
    expect(currentResult.summary).toMatchObject({ passed: 24, possible: 24, failed: 0 });
    expect(invocationIntegrity.evidencePackage.summary).toMatchObject({
      earned: 3,
      possible: 3,
      includedInSemanticDenominator: false,
      modelCallCount: 0
    });
    expect(currentResult.rows).toHaveLength(24);
    expect(invocationIntegrity.evidencePackage.verifierReceipt.rows).toHaveLength(3);
  });

  it("renders a compact three-row integrity matrix without a combined or superseded score", () => {
    render(InvocationIntegritySummary());
    expect(screen.getByText("3/3 separate integrity cases", { exact: true })).toBeVisible();
    const matrix = screen.getByRole("table", { name: "Invocation Integrity Matrix" });
    expect(within(matrix).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText(/27\s*\/\s*27/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/23\s*\/\s*24/u)).not.toBeInTheDocument();
    expect(screen.getByText("Inspect technical receipt and expert exports")).toBeVisible();
    expect(
      screen.getByText("Inspect technical receipt and expert exports").closest("details")
    ).not.toHaveAttribute("open");
  });
});
