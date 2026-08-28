import {
  TOOLPROOF_GET_RESULTS_TOOL_NAME,
  TOOLPROOF_PROPOSE_REVISION_TOOL_NAME,
  createPairedResultsMetaTool,
  createResultsMetaTools,
  type ToolProofDevelopmentResultsProjection,
  type ToolProofPairedResultsProjection
} from "@/lib/results/meta-tools";
import { describe, expect, it, vi } from "vitest";

const results: ToolProofDevelopmentResultsProjection = {
  version: "toolproof-development-results-projection@1.0.0",
  evidenceLabel: "one-trial demonstration snapshot",
  baselineEvidenceDigest: "a".repeat(64),
  development: {
    earned: 7,
    possible: 12,
    rows: [
      {
        caseId: "development_case",
        family: "review-equivalent-realizations",
        request: "Synthetic development request.",
        expectedAction: "call:order_review",
        observedAction: "clarify",
        passed: false,
        failureCodes: ["decision_action_class"]
      }
    ]
  },
  holdout: { status: "sealed", caseCount: 12, commitmentDigest: "b".repeat(64) }
};

describe("Results phase meta-tools", () => {
  it("returns development evidence plus only a sealed holdout commitment", async () => {
    const tools = createResultsMetaTools({ results, onProposal: vi.fn() });
    expect(tools.map(({ name }) => name)).toEqual([
      TOOLPROOF_GET_RESULTS_TOOL_NAME,
      TOOLPROOF_PROPOSE_REVISION_TOOL_NAME
    ]);
    const inspect = tools[0]!.execute as (
      value: Record<string, unknown>,
      context?: { signal?: AbortSignal }
    ) => Promise<unknown>;
    await expect(inspect({})).resolves.toEqual(results);
    expect(JSON.stringify(await inspect({}))).not.toContain("builder-blinded-holdout");
  });

  it("presents one bounded proposal but cannot approve or freeze it", async () => {
    const onProposal = vi.fn();
    const tools = createResultsMetaTools({ results, onProposal });
    const propose = tools[1]!.execute as (
      value: Record<string, unknown>,
      context?: { signal?: AbortSignal }
    ) => Promise<unknown>;
    const input = {
      proposedDescription:
        "Open a simulated pending checkout only when the user explicitly directs checkout; do not use this tool for review-only requests.",
      rationale:
        "Development evidence shows tentative or review wording needs a sharper commitment boundary."
    };
    await expect(propose(input)).resolves.toEqual({
      ok: true,
      status: "proposal-presented-for-human-review",
      humanApproval: "required",
      canFreeze: false
    });
    expect(onProposal).toHaveBeenCalledWith(input);
  });

  it("exposes only the read-only paired projection after the revised run", async () => {
    const paired: ToolProofPairedResultsProjection = {
      version: "toolproof-paired-results-projection@1.0.0",
      evidenceLabel: "one-trial demonstration snapshot",
      baselineEvidenceDigest: "c".repeat(64),
      revisedEvidenceDigest: "d".repeat(64),
      development: { baselineEarned: 8, revisedEarned: 10, possible: 12 },
      holdout: { baselineEarned: 7, revisedEarned: 9, possible: 12 },
      rows: [{ caseId: "paired_case", baselinePassed: false, revisedPassed: true }]
    };
    const tool = createPairedResultsMetaTool(paired);
    expect(tool.name).toBe(TOOLPROOF_GET_RESULTS_TOOL_NAME);
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    const execute = tool.execute as (
      value: Record<string, unknown>,
      context?: { signal?: AbortSignal }
    ) => Promise<unknown>;
    await expect(execute({})).resolves.toEqual(paired);
  });
});
