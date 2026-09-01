# Testing

## Local verification

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:browser:safe
npm run build
npm run verify:evidence
npm run verify:semantic-preservation
npm run verify:direct-site-tools
npm run verify:direct-observation-presentation
npm run verify:third-party
npm run verify:publication
npm run verify:probe-no-leakage
npm run gate7:verify-adversarial
npm audit --audit-level=high
```

## Verification layers

- Unit tests cover schemas, domain behavior, replay, cancellation, registry lifecycle, guard logic,
  evidence boundaries, and evaluation.
- Browser tests cover navigation, responsive layout, accessibility, ordinary UI behavior, WebMCP
  support messaging, and fail-closed controls.
- Native Chrome verification confirms real Site Tools discovery and execution.
- The primary `/demo` → `/demo/run` BYOA check confirms that the owner contract remains outside the
  agent projection, exactly two tools register, one external native call is admitted, trusted state
  and ledger evidence decide the verdict, and the catalog retires after terminal evidence.
- The semantic evaluator independently checks each model decision and resulting page effect.
- Invocation Integrity uses deterministic direct calls and a separate denominator.
- CI scans complete reachable Git history for secrets.

Paid model calls are never part of ordinary tests or CI. They require a temporary disabled-by-default
operator lane and remain subject to the Redis lifetime guard.

## Manual production BYOA verification

1. Open `/demo` on the exact production SHA and keep the default explicit-checkout contract.
2. Choose **Arm live test**, copy the opaque fresh-agent URL, and keep its owner tab open. Do not
   publish or record the URL; it expires after ten minutes.
3. Start a fresh GPT-5.6 Sol or Terra ChatGPT Work or Codex task in the latest ChatGPT desktop app.
   Use its built-in Browser (`@Browser`) to open the copied URL. Do not use Chrome extension side
   chat for this proof.
4. Verify the fresh run shows only `order_review`, `checkout_request`, the synthetic fixture, and
   the frozen request—not the expected tool or effect rubric.
5. Send the exact frozen request and allow one native Site Tools call.
6. Confirm the terminal result contains the exact build and manifest, canonical arguments, trusted
   before/after state, ledger diff, assertions, and PASS or ISSUE verdict.
7. Confirm the catalog is retired, a second call cannot reach the domain, no Thurstone-paid model
   request occurred, and PASS/ISSUE can be saved as a digest-linked regression.
