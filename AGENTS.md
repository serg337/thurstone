# Thurstone repository rules

## Authority and scope

- Build only the P0 checkout/review WebMCP submission until every P0 gate is green.
- Keep the product independently buildable from this public repository.
- Do not add private or proprietary dependencies, source material, credentials, personal data, or local absolute paths.
- Preserve authentic failures and evidence. Never seed, curate, relabel, or fabricate measured results.
- Human approval is required for semantic labels, the one-description repair, simulated approval actions, final claims, and submission.

## Engineering rules

- Use strict TypeScript and keep UI controls and WebMCP handlers on the same deterministic domain functions.
- Use native `document.modelContext` in judged paths. Mocks and direct calls are test aids only.
- Keep Studio, Lab, and Results as separate trust surfaces. Never expose expected answers on the active Lab path.
- Use explicit-path Git staging. Never stage all files, rewrite history, force-push, or publish ignored/local material.
- Pin dependencies and document every third-party component and license.
- Update `PLAN.md`, tests, documentation, and public evidence with each coherent green checkpoint.

## Required commands

The pinned package scripts must provide these stable interfaces once the application scaffold exists:

```text
npm ci
npm run install:check
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:browser:safe
npm run build
npm run verify:publication
npm run verify:evidence
```

Paid model evaluation must remain a separate explicit command and must never run in pull-request CI.

## Definition of done

P0 is done only when native WebMCP, the deterministic sandbox, human-approved frozen suite, authentic model-backed baseline/revision evidence, Direct ChatGPT observations, security/browser verification, clean-clone reproduction, public release, video, submission receipt, and judged-artifact freeze all resolve to one recorded release chain. P1 work starts only after that condition.
