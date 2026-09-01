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
  evidence boundaries, catalog/suite referential integrity, Result v3, regression lineage, atomic
  handoff state, and deterministic evaluation.
- Browser tests cover navigation, responsive layout, accessibility, ordinary UI behavior, WebMCP
  support messaging, the five-stage owner workflow, two-to-four-tool catalog selection,
  multi-case suite operations, the nested arm confirmation, explicit observation start, all four
  verdict classes, and fail-closed controls.
- Native Chrome verification confirms real Site Tools discovery and execution.
- The primary `/demo` → `/demo/handoff` → `/demo/run` BYOA check confirms that the owner contract
  remains outside the agent projection, the exact selected two-to-four-tool catalog registers only
  after explicit start, one external native call is admitted, browser-local site-owned state and
  ledger evidence decide the Result v3 verdict, and the catalog retires after terminal evidence.
- `/demo/controlled` executes one deterministic wrong native invocation through a real adapter and
  evaluator. Its `deterministic-controlled-example` evidence remains separate from the visitor's
  result and from both reference denominators.
- **My Tests v2** accepts only PASS/ISSUE Result v3 artifacts, keeps immutable predecessor/successor
  lineage for reruns, and rejects transient opaque handoff data from export.
- The semantic evaluator independently checks each model decision and resulting page effect.
- Invocation Integrity uses deterministic direct calls and a separate denominator.
- CI scans complete reachable Git history for secrets.

The one-call BYOA trial checks single admission, tool selection, arguments, and effect. It does not
measure replay. Replay/idempotency is measured only by the separate Invocation Integrity lane.

The challenge reference state, suite, Result v3, and My Tests v2 artifacts are bounded and
browser-local. Redis is used only as an expiring atomic handoff/admission ledger; those short-lived
digest-bound records are not customer state and do not form a customer database.

Paid model calls are never part of ordinary tests or CI. They require a temporary disabled-by-default
operator lane and remain subject to the Redis lifetime guard.

## Manual production BYOA verification

1. Verify `/api/health` reports the exact release SHA. In a genuinely fresh GPT-5.6 Sol or Terra
   ChatGPT Work or Codex task, use the latest ChatGPT desktop app's built-in Browser and send
   `@Browser Open https://thurstone.invarra.ai/demo`. Do not use Chrome extension side chat.
2. **Stage 1 — Understand the semantic boundary:** confirm the read-only versus explicit-checkout
   examples and fixed-fixture explanation are visible.
3. **Stage 2 — Choose the real WebMCP test catalog:** keep the default pair or select two to four
   real reference tools. Confirm the agent preview equals the chosen names, descriptors, schemas,
   and annotations, and that `/demo` registers zero target tools.
4. **Stage 3 — Build the contract suite:** create at least two cases, select exactly one live case,
   and open **Review and arm selected case**. Confirm **Owner expects** and **Agent receives** are
   separate, the selected case is explicit, and the technical preflight is ready.
5. Choose **Arm live test**. On the owner-only prepared screen, copy the complete `@Browser`
   command, including `then follow the request shown on the page.` Keep the opaque URL out of
   recordings, screenshots, logs, exports, and public text. It expires after ten minutes, and the
   owner surface registers no target tools or timer.
6. Paste the command in a new supported task that does not share, fork, reference, or resume the
   owner task. Confirm the opaque link opens the non-consuming `/demo/handoff` landing without
   registering tools or starting the timer. Choose **Receive isolated test** exactly once and
   confirm the claimed task enters `/demo/run`.
7. At **Test received**, confirm only the request, selected catalog, and fixture are visible. The
   expected action, arguments, effects, replay policy, approval class, and scoring assertions must
   be absent from DOM, accessibility tree, URL, storage, transport, logs, and client-visible errors.
8. Choose **Continue to readiness**, then **Start live observation**. Confirm the timer and exact
   selected catalog begin only at that explicit boundary. Let the fresh agent follow the frozen
   request and admit one native Site Tools call.
9. Confirm Result v3 contains the exact build and manifest, launch mode and evidence tier,
   canonical arguments, browser-local site-owned state, ledger diff, assertions, diagnosis, and an
   honest PASS, ISSUE, INCOMPLETE, or UNAVAILABLE verdict. A wrong first eligible call must close as
   ISSUE; no-call must remain INCOMPLETE.
10. Confirm the catalog retires, later/concurrent attempts reject before domain execution, no
    Thurstone-paid model request occurred, and only PASS/ISSUE can save to **My Tests v2**. Export
    once and confirm no opaque capability appears.
11. Open **See how Thurstone catches a mismatch**. Confirm `/demo/controlled` is labeled
    **Controlled example — no model call**, uses a separate result, and changes neither 24/24 nor
    the separate 3/3 score.
12. Open **Results** and confirm **My Tests v2** appears before the unchanged 24/24 semantic
    reference and separate 3/3 Invocation Integrity matrix.

The app proves withholding inside its own projection and atomic handoff. It cannot certify the
hidden context or identity of every consumer surface. Count a run as `independent-agent-native`
only when an actually fresh supported built-in Browser task and the authentic native invocation
are observed. Verify flagged Chrome separately as direct compatibility evidence, never as an
independent agent-selection result.
