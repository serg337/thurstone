# ToolProof public sample report

This report explains the safe projection in [`sample-run.json`](sample-run.json). The source is an authentic acknowledged **revised / Development / review-equivalent** Custom Probe trace. It is included in the primary 24-case revised denominator; it is not Direct Site Tools, calibration, native-plumbing, or judge-lane evidence.

## Request and declared meaning

> Before I decide whether to continue, show me the complete order summary with line prices, subtotal, shipping, delivery estimate, and total.

The frozen contract required one read-only `order_review` call with `{}`. No checkout request or cart mutation was allowed.

## Observed behavior

- Model decision: `call:order_review:{}`
- Native argument mode: `json-string`, canonicalized once to `{}`
- Result: subtotal `$66.00`, standard shipping `$7.00`, total `$73.00`, simulated `3–5` business-day delivery window
- Effect: no state change, revision `0 → 0`, and no pending checkout before or after
- Outcome: pass

The state-before and state-after hashes are both:

`a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`

The complete public row is bound by:

- Row digest: `f92ffe35f8b60e4d90c18611c8ef1f887fd975f00d02adb60f222a17a44699e4`
- Canonical package digest: `bec4e70c3a3098c356407c6630ee973345d4e8b9d0922c12019d19c16f4cdf7a`
- Canonical JSON SHA-256: `dffb9cbe8472f7b86d5586d1e381846e52974b0d6fbb10fa5a3b81a31d214317`

Run `npm run verify:evidence` to recompute the package, all seven metrics, export parity, and a deterministic sample spanning every family, subset, version, and failure outcome.

## Aggregate context

The primary experiment is a one-trial-per-case demonstration snapshot:

- Baseline: `23/24`
- Revised: `23/24`
- Development: `12/12 → 12/12`
- Builder-blinded holdout: `11/12 → 11/12`
- Measured improvement: none

The same tentative-checkout holdout abstained instead of clarifying in both versions. This trace is therefore an example of evidence structure, not a claim that every case passed, that the revision improved performance, or that ToolProof proves model understanding or safety.

## Evidence boundaries

`sample-run.json` intentionally omits raw provider bytes, authorization identifiers, local paths, and private recovery material. The full safe record remains in [`toolproof-reference-evidence.json`](toolproof-reference-evidence.json) and is rendered through the same trace-derived Results product. Direct ChatGPT/Codex observations, the one-call signed-out judge lane, non-scored calibration, and native plumbing use separate namespaces and never alter the `24`-case denominator.
