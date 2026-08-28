import { describe, expect, it, vi } from "vitest";
import { studioAuthoringIsLocked } from "@/components/studio/studio-client";

import {
  createStudioMetaTools,
  parseStudioDraftInput,
  TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME,
  TOOLPROOF_INSPECT_TOOL_NAME,
  TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME,
  type LastVerifiedTargetSnapshot,
  type StudioDraftInput
} from "@/lib/studio/meta-tools";

type OptionalExecute = (
  input: Record<string, unknown>,
  context?: { readonly signal?: AbortSignal }
) => Promise<unknown>;

const target: LastVerifiedTargetSnapshot = Object.freeze({
  receiptVersion: "toolproof-last-verified-target@1.0.0",
  status: "last-verified",
  claimBoundary: "not-live-lab-registry",
  sourceLane: "authentic-gate2-fallback",
  sourceCommit: "93a602ea6d8eedb56f0f2b8e9abb6468512b2aa9",
  sourceEvidenceDigest: "8a4f674ff68ea02a8f2b9792ceb88eea7bb9657b995ee80778d6e8ac56df355b",
  verifiedAt: "2026-08-28T18:05:26.760Z",
  manifestHash: "e78c5752c16296c2dcc273e5c8718afc8198a2eefcb1d4bdbb47087b1d6d0392",
  registrationGeneration: 1,
  catalogState: "initial",
  toolsetVersion: "checkout-toolset-v1@1.0.0",
  domainVersion: "checkout-domain@1.0.0",
  registeredToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
  manifest: []
});

function toolHarness() {
  const inspect = vi.fn(() => target);
  const draft = vi.fn((input: StudioDraftInput) => ({
    ok: true as const,
    status: "candidate-note-saved" as const,
    sessionLocal: true as const,
    phase: "review" as const,
    humanApproval: "required" as const,
    noteLength: input.reviewNote?.length ?? 0,
    requestedFocus: input.requestedFocus ?? null,
    contractFieldsUpdated: Object.keys(input.contractPatch ?? {}),
    caseIdsUpdated: (input.caseUpdates ?? []).map(({ caseId }) => caseId)
  }));
  const submitReview = vi.fn(() => ({
    ok: true as const,
    status: "presented-to-human" as const,
    sessionLocal: true as const,
    phase: "review" as const,
    humanApproval: "required" as const,
    canApprove: false as const,
    canFreeze: false as const
  }));
  return {
    inspect,
    draft,
    submitReview,
    tools: createStudioMetaTools({ inspect, draft, submitReview })
  };
}

describe("Studio phase-specific meta-tools", () => {
  it("permanently disables authoring for successor and frozen review packages", () => {
    expect(studioAuthoringIsLocked({ status: "awaiting-human", successorLineage: null })).toBe(
      false
    );
    expect(
      studioAuthoringIsLocked({
        status: "awaiting-human",
        successorLineage: {} as never
      })
    ).toBe(true);
    expect(studioAuthoringIsLocked({ status: "frozen", successorLineage: null })).toBe(true);
  });

  it("exposes only the cumulative authoring tools required by each phase", () => {
    const { tools } = toolHarness();

    expect(tools.forPhase("inspect").map(({ name }) => name)).toEqual([
      TOOLPROOF_INSPECT_TOOL_NAME
    ]);
    expect(tools.forPhase("draft").map(({ name }) => name)).toEqual([
      TOOLPROOF_INSPECT_TOOL_NAME,
      TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME
    ]);
    expect(tools.forPhase("review").map(({ name }) => name)).toEqual([
      TOOLPROOF_INSPECT_TOOL_NAME,
      TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME,
      TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME
    ]);
  });

  it("inspects historical verified evidence with or without the optional execution context", async () => {
    const { inspect, tools } = toolHarness();
    const execute = tools.byName.toolproof_inspect.execute as OptionalExecute;
    const signal = new AbortController().signal;

    await expect(execute({})).resolves.toEqual(target);
    await expect(execute({}, { signal })).resolves.toEqual(target);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(target.claimBoundary).toBe("not-live-lab-registry");
    expect(target.manifestHash).toBe(
      "e78c5752c16296c2dcc273e5c8718afc8198a2eefcb1d4bdbb47087b1d6d0392"
    );
  });

  it("applies strictly parsed structured contract and case patches without approval authority", async () => {
    const { draft, tools } = toolHarness();
    const execute = tools.byName.toolproof_draft_contract.execute as OptionalExecute;
    const input = {
      reviewNote: "Check the matched pair.",
      requestedFocus: "boundaries",
      contractPatch: {
        clarificationPolicy: "Ambiguous consequential intent must yield clarification or no action."
      },
      caseUpdates: [
        {
          caseId: "case-dev-01",
          meaningSpec: "The request asks for read-only review and does not commit to checkout.",
          expectedTool: "order_review",
          allowedEffects: [],
          forbiddenEffects: ["pendingCheckout"]
        }
      ]
    };

    await expect(execute(input)).resolves.toMatchObject({
      status: "candidate-note-saved",
      humanApproval: "required",
      caseIdsUpdated: ["case-dev-01"]
    });
    await expect(execute(input, { signal: new AbortController().signal })).resolves.toMatchObject({
      status: "candidate-note-saved"
    });
    expect(draft).toHaveBeenCalledTimes(2);
    expect(draft.mock.calls[0]?.[0]).toEqual(input);
  });

  it("rejects note-only, undeclared, duplicate, and malformed draft patches", () => {
    expect(() => parseStudioDraftInput({ reviewNote: "A note alone." })).toThrow(
      /cannot be the only draft effect/iu
    );
    expect(() =>
      parseStudioDraftInput({ contractPatch: { title: "Candidate", surprise: true } })
    ).toThrow(/declared/iu);
    expect(() =>
      parseStudioDraftInput({
        caseUpdates: [
          { caseId: "case-1", prompt: "First" },
          { caseId: "case-1", prompt: "Second" }
        ]
      })
    ).toThrow(/must not patch one case twice/iu);
    expect(() =>
      parseStudioDraftInput({ caseUpdates: [{ caseId: "../bad", prompt: "No" }] })
    ).toThrow(/caseId is invalid/iu);
  });

  it("presents for human review but never approves or freezes", async () => {
    const { submitReview, tools } = toolHarness();
    const execute = tools.byName.toolproof_submit_review.execute as OptionalExecute;

    await expect(execute({})).resolves.toEqual({
      ok: true,
      status: "presented-to-human",
      sessionLocal: true,
      phase: "review",
      humanApproval: "required",
      canApprove: false,
      canFreeze: false
    });
    await expect(execute({}, { signal: new AbortController().signal })).resolves.toMatchObject({
      canApprove: false,
      canFreeze: false
    });
    expect(submitReview).toHaveBeenCalledTimes(2);
  });

  it("preserves cancellation for every handler when a signal is supplied", async () => {
    const { tools } = toolHarness();
    const controller = new AbortController();
    controller.abort(new DOMException("Stop", "AbortError"));

    for (const tool of Object.values(tools.byName)) {
      const execute = tool.execute as OptionalExecute;
      const input =
        tool.name === TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME
          ? { contractPatch: { title: "Candidate" } }
          : {};
      await expect(execute(input, { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError"
      });
    }
  });
});
