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

The current contract contains 24 cases covering equivalent phrasing and meaning-changing
boundaries. The current run passed all 24.

## Scope

The current result uses one provider model, one synthetic checkout domain, and one trial per case.
It is a product demonstration, not a stability estimate, safety certification, or general result for
arbitrary websites.
