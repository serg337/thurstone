# Contributing

ToolProof is being built under a fixed challenge protocol. Contributions must preserve the semantic contract, evidence lineage, publication boundary, and human approval gates.

Before proposing a change:

1. Read `AGENTS.md`, `PLAN.md`, `CHALLENGE.md`, `SECURITY.md`, and the relevant public documentation.
2. Use Node `22.23.2`, npm `10.9.8`, and `npm ci`.
3. Keep UI and WebMCP behavior on the same deterministic domain functions.
4. Add tests for behavior, schema, state effects, failures, and any registration lifecycle change.
5. Do not add a private dependency, secret, local absolute path, personal data, unlicensed asset, expected-answer leak, real commerce path, or unsupported WebMCP claim.
6. Do not change a frozen case, expectation, model setting, evaluator, or evidence object after outcomes are known.

Run the repository's formatting, lint, strict type, deterministic test, integration, build, and publication checks before requesting review. Paid model evaluations are never part of ordinary pull-request CI.
