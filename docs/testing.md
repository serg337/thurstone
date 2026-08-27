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
npm run durable-store:check
npm run probe-controls:integration
npm run probe-controls:migrate
npm run probe-continuation:integration
npm run verify:probe-no-leakage
npm run verify:publication
npm run verify:evidence
```

`verify:evidence` fails closed until a real frozen-run manifest exists. Paid model calls never run in ordinary CI.

`verify:probe-no-leakage` inspects every supported production static-output tree, binds Lab chunks to the Lab client-reference manifest, rejects server-truth sentinels and all production source maps, and separately proves that both retained-attempt lineages occur only in post-unlock Results chunks. The fake-provider service test runs all four exact attempt-3 cases from the migrated five-call base through signed issuance, bound transport IDs, decision receipts, authentic domain traces, post-reset evaluation, sealing, settlement, cumulative-cost reconciliation, and terminal reveal without network inference. The browser fake-provider test repeats the four trials across fresh documents, checks the DOM/URL/network/session-storage boundary before every completion, and remains explicitly emulated evidence rather than Gate 2 proof.

`npm run provider:check` performs only the official read-only model-metadata retrieval for the pinned Probe model. Vercel runs it before production builds with the Sensitive provider key; it never prints or stores that key and performs no inference.

`durable-store:check` verifies a configured Redis `PING` and non-mutating Lua execution without printing credentials. `probe-controls:integration` creates random isolated namespaces, executes the real atomic scripts through all 160 slots, proves concurrent replay and the 161st-call boundary, exercises new/replayed/conflicting/tampered policy migrations, then removes only those isolated test namespaces. It never calls the model provider. The Production v0.3 migration uses two separate builds: an explicit read-only preflight emits only source/migration/policy/script digests plus a 64-hex confirmation; a later Sensitive confirmation authorizes the one atomic transition. Neither path prints the private source receipt, JTI, guard identity, or call record. The production guard is never reinitialized or reset.

`probe-continuation:integration` creates random isolated Redis namespaces, exercises encrypted idempotent issue/decision/native/completion recovery plus fixed-expiry monotonic run-index create/advance/recovery through the real Lua scripts, and deletes and verifies deletion of only those temporary keys. It never touches the immutable production guard namespace and never calls the model provider.

The Vercel production build runs the durable-store check, isolated real Redis suite, encrypted-continuation suite, confirmed guard bootstrap/status-or-migration check, zero-token provider metadata check, application build, and client-leakage scan in that order. Preview has no production credentials and therefore fails closed before any provider request. Initialization, migration, and reaping are mutually exclusive operator intents and each requires Vercel's independently supplied Git commit/project identity plus its own exact one-time confirmation.

The production Vercel project is linked to `serg337/toolproof` on branch `main`. Vercel's system-provided `VERCEL_GIT_COMMIT_SHA` is the authoritative deployment-source identity for guard initialization and confirmed reaping; a manually claimed commit variable cannot substitute for it.

The production guard was initialized once from Git-linked commit `86584fe4fa308980bfb7d60f9722cc8b49b78644` after the isolated real Redis suite passed. Its initialization receipt recorded zero calls and zero committed nano-USD. The one-time confirmation variables were then removed; subsequent builds can only verify status unless a separately confirmed reap operation is present.

## Proof boundaries

- Unit tests prove deterministic domain, schema, canonicalization, and evaluator behavior.
- Integration tests with controlled test doubles prove registration-manager logic but are not native WebMCP proof.
- Ordinary Playwright tests prove the signed-out shell, responsive layouts, diagnostics, accessibility, error states, shared UI/native state, dynamic four/five-tool registration, reset locking, object mode, JSON-string mode, and the actual downloaded Gate 1 JSON bytes. Their in-page consumer is explicitly emulated and is not supported-runtime proof.
- Descriptor tests cover Chrome's serialized-schema representation while continuing to reject malformed or semantically different schemas and wrong titles.
- Native proof requires the deployed HTTPS origin in the supported ChatGPT browser or exact Chrome/WebMCP build, with the active tool and invocation visible in the supported runtime/DevTools path.
- Gate 0 native proof was observed in Chrome 151 for `cart_get`. Gate 1 requires fresh exact-deployment discovery/execution receipts for every active tool, the pending-only cancel transition, argument mode, raw/canonical result, state/effect binding, and reset receipt. Direct ChatGPT remains a separate later evidence lane.
- Direct expected calls prove plumbing only. Model-selection evidence requires a fresh model decision from natural language followed by native execution.
- Direct ChatGPT and custom Probe observations remain separately labeled.

The Gate 1 browser harness delays canonical trace finalization for one mutation and verifies that committed state is visible before the registered handler settles. It also exercises same-document route remounting, mutation replay versus fresh IDs, post-reset fresh operation IDs, both canceled-before-handler-completion and Chrome-style consumer-canceled-after-handler-completion timing, and Chrome 152 self-retirement timing where `checkout_cancel` must deliver its outer native result before its registration signal is aborted. The one-button test deliberately dirties a document, clicks once, proves exactly one clean reload/new session, validates all 11 timed steps and the strict ten-attempt sequence, receives one automatic download, retries identical verified bytes, and proves a later reload does not rerun. Injected native failure stops before reset/download, and malformed markers are consumed without native execution. Dynamic-state accessibility, keyboard focus, and mobile horizontal overflow are covered too. These remain deterministic export checks, not authentic native proof.

The release record will include exact commands, browser/build, deployment/commit, registry fingerprint, raw trace location, failures, retries, and limitations.
