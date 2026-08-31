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
npm run verify:third-party
npm audit --audit-level=high
```

## Verification layers

- Unit tests cover schemas, domain behavior, replay, cancellation, registry lifecycle, guard logic,
  evidence boundaries, and evaluation.
- Browser tests cover navigation, responsive layout, accessibility, ordinary UI behavior, WebMCP
  support messaging, and fail-closed controls.
- Native Chrome verification confirms real Site Tools discovery and execution.
- The semantic evaluator independently checks each model decision and resulting page effect.
- Invocation Integrity uses deterministic direct calls and a separate denominator.
- CI scans complete reachable Git history for secrets.

Paid model calls are never part of ordinary tests or CI. They require a temporary disabled-by-default
operator lane and remain subject to the Redis lifetime guard.
