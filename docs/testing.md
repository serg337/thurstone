# Testing

ToolProof keeps deterministic correctness, native WebMCP plumbing, model selection, and Direct ChatGPT observations as separate proof classes.

## Commands

```text
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

`verify:evidence` fails closed until a real frozen-run manifest exists. Paid model calls never run in ordinary CI.

`npm run provider:check` performs only the official read-only model-metadata retrieval for the pinned Probe model. Vercel runs it before production builds with the Sensitive provider key; it never prints or stores that key and performs no inference.

## Proof boundaries

- Unit tests prove deterministic domain, schema, canonicalization, and evaluator behavior.
- Integration tests with controlled test doubles prove registration-manager logic but are not native WebMCP proof.
- Ordinary Playwright tests prove the signed-out shell, responsive layouts, diagnostics, accessibility, and error states but are not automatically a supported native WebMCP runtime.
- Native proof requires the deployed HTTPS origin in the supported ChatGPT browser or exact Chrome/WebMCP build, with the active tool and invocation visible in the supported runtime/DevTools path.
- Direct expected calls prove plumbing only. Model-selection evidence requires a fresh model decision from natural language followed by native execution.
- Direct ChatGPT and custom Probe observations remain separately labeled.

The release record will include exact commands, browser/build, deployment/commit, registry fingerprint, raw trace location, failures, retries, and limitations.
