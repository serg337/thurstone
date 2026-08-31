import { describe, expect, it } from "vitest";

import {
  guidedDemoReducer,
  guidedDisplayStep,
  guidedPhases,
  guidedReference,
  initialGuidedDemoState
} from "@/lib/demo/guided";

describe("Guided Demo", () => {
  it("advances only through the declared phase order", () => {
    let state = initialGuidedDemoState;
    const observed = [state.phase];
    for (let index = 1; index < guidedPhases.length; index += 1) {
      state = guidedDemoReducer(state, { type: "next", at: `2026-08-31T00:00:0${index}.000Z` });
      observed.push(state.phase);
    }
    expect(observed).toEqual(guidedPhases);
    expect(guidedDemoReducer(state, { type: "next", at: "2026-08-31T00:01:00.000Z" })).toBe(state);
  });

  it("prevents Back from re-entering an already committed live mutation", () => {
    const committed = guidedDemoReducer(
      { ...initialGuidedDemoState, phase: "explicit_execution" },
      { type: "record_live_commit", at: "2026-08-31T00:00:00.000Z" }
    );
    expect(committed.phase).toBe("explicit_state_verification");
    expect(committed.liveMutationCommitted).toBe(true);
    expect(guidedDemoReducer(committed, { type: "back", at: "2026-08-31T00:00:01.000Z" })).toBe(
      committed
    );
  });

  it("restarts at the exact clean fixture boundary", () => {
    const restarted = guidedDemoReducer(
      { ...initialGuidedDemoState, phase: "verdict", liveMutationCommitted: true },
      { type: "restart", at: "2026-08-31T00:00:00.000Z" }
    );
    expect(restarted).toMatchObject({
      phase: "intro",
      liveMutationCommitted: false,
      startedAt: "2026-08-31T00:00:00.000Z"
    });
  });

  it("binds the tentative replay to clarification and identical trusted state", () => {
    expect(guidedReference.tentative).toMatchObject({
      expectedDecision: "clarify",
      observedDecision: "clarify",
      ledgerDelta: 0
    });
    expect(guidedReference.tentative.stateAfter).toEqual(guidedReference.tentative.stateBefore);
    expect(guidedReference.tentative.assertions.every(({ passed }) => passed)).toBe(true);
  });

  it("binds explicit authorization to one pending transition without changing quantities", () => {
    expect(guidedReference.explicit).toMatchObject({
      expectedDecision: "call:checkout_request",
      observedDecision: "call:checkout_request",
      ledgerDelta: 1,
      stateBefore: { revision: 0, pendingCheckout: null },
      stateAfter: { revision: 1, pendingCheckout: "pending_human_approval" }
    });
    expect(guidedReference.explicit.stateAfter.quantities).toEqual(
      guidedReference.explicit.stateBefore.quantities
    );
    expect(guidedReference.explicit.assertions.every(({ passed }) => passed)).toBe(true);
  });

  it("maps nine internal phases to no more than six judge-visible steps", () => {
    expect(guidedPhases.map(guidedDisplayStep)).toEqual([1, 1, 2, 3, 3, 4, 5, 5, 6]);
  });
});
