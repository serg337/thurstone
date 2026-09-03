# Methodology

Thurstone evaluates whether observed WebMCP behavior matches a human-approved contract.

For each case:

1. Restore the deterministic checkout fixture.
2. Verify the exact live WebMCP catalog.
3. Give one natural-language request to a fresh stateless model context.
4. Permit at most one native tool call.
5. Capture the decision, canonical arguments, handler trace, and trusted state before and after.
6. Reset the fixture again.
7. Score the observation outside the model.

A case passes only when its complete approved behavior passes. Call-required cases verify tool,
arguments, result, state, and effect. Clarification cases require an explicit structured
clarification and prohibit target execution.

The current successor contract contains 24 cases covering equivalent phrasing and meaning-changing
boundaries. Its separately frozen one-trial-per-case snapshot passed all 24. This is bounded
reference regression coverage, not an independent benchmark or stability estimate.

A historical paired experiment remains a different record: one description changed, the complete
24-case suite reran, and the result remained `23/24 → 23/24`, so the measured conclusion was no
improvement. It is not presented as the predecessor of the current successor snapshot.

Invocation Integrity is a separate `3/3` deterministic direct-call matrix with zero model calls.
Its denominator is never combined with semantic behavior.

## Scope

The current result uses one provider model, one synthetic checkout domain, and one trial per case.
It is a product demonstration, not a stability estimate, safety certification, proof of model
understanding, or general result for arbitrary websites.
