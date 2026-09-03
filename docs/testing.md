# Testing Thurstone

## Local release verification

Run on Linux with the pinned Node/npm versions:

```bash
npm ci
npm run install:check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run verify:evidence
npm run verify:semantic-preservation
npm run verify:direct-site-tools
npm run verify:direct-observation-presentation
npm run verify:third-party
npm run verify:publication
npm run verify:probe-no-leakage
npm run gate7:verify-adversarial
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
npm run build
npm run test:browser:safe
```

Paid model calls are never part of ordinary tests or CI.

## What the layers prove

### Deterministic and integration tests

The Vitest suite covers:

- tool schemas, handlers, reducer effects, invalid inputs, replay, cancellation, and reset;
- WebMCP registration, discovery, argument-mode calibration, execution-ID consumption, and registry
  lifecycle;
- contract suite referential integrity and JSON-Schema-derived argument forms;
- regression queues and continuous journeys;
- one eligible native action per case and rejection of later/concurrent attempts;
- trusted before/after state, operation-ledger diff, assertions, verdict, and diagnosis;
- secure handoff issue, claim, start, settlement, synchronization, expiry, and recovery;
- evidence namespaces, hashes, presentation, and preservation;
- durable provider call/spend guards.

### Browser and accessibility tests

The safe Playwright suite covers desktop and mobile:

- primary navigation, responsive layout, keyboard behavior, reduced motion, forced colors, and
  serious/critical Axe findings;
- Stage 1 boundary explanation;
- Stage 2 selection of one to four real catalog tools without automatic scrolling;
- Stage 3 multi-request contracts and schema-derived arguments;
- independent regression execution using one agent chat and a clean fixture per case;
- continuous journeys with repeated tools, carried state, process-ending placement, and stop on the
  first issue;
- review, arm, secure command, single-use handoff, owner synchronization, and result routing;
- PASS, ISSUE, INCOMPLETE, UNAVAILABLE, and NOT RUN presentation;
- controlled no-model mismatch;
- Results export and regression preservation;
- Lab native compatibility and fail-closed unsupported-browser states.

Four calibration/model-dependent cases are intentionally excluded from the safe browser command and
are not silently counted as passes.

### Native WebMCP evidence

- Chrome verification confirms real Site Tools discovery and execution through
  `getTools()`/`executeTool()`.
- Direct Site Tools observations document fresh-context supported-consumer behavior separately.
- The controlled example invokes one deliberately wrong real tool through the native adapter with no
  model call.
- Invocation Integrity uses deterministic direct native calls and a denominator separate from
  semantic behavior.

### Semantic evidence

Evidence classes must remain distinct:

- historical paired experiment: `23/24 → 23/24`, no measured improvement;
- current separately frozen successor snapshot: `24/24`, one trial per case;
- Invocation Integrity: separate `3/3`, zero model calls;
- Direct Site Tools observations;
- visitor-created Demo results;
- controlled mismatch.

`npm run verify:evidence` and `npm run verify:semantic-preservation` recompute the current public
artifacts and fail if canonical bytes drift or denominators are combined.

## Manual judge quick start

1. Open `https://thurstone.invarra.ai/judge` in a clean browser tab.
2. Confirm the preloaded owner contract visibly expects `cart_update`, Stoneware mug quantity 3,
   revision `0 → 1`, one ledger transition, and no unrelated effects.
3. Choose **Arm quick test** once. Confirm `Armed. Clean revision 0. Awaiting one agent action.`
4. Copy the generated command into a genuinely fresh GPT-5.6 Sol or Terra Work or Codex chat in the
   latest ChatGPT desktop app using its built-in Browser—not the Chrome extension side panel.
5. Confirm the fresh agent document contains the request and four live tool descriptors but none of
   the owner's expected tool, arguments, effects, or assertions.
6. Invoke `cart_update` with a unique operation ID, `stoneware-mug`, and quantity 3.
7. Without refreshing the owner page, confirm it renders a visual verdict with:
   - observed tool and readable arguments;
   - mug quantity `2 → 3` and revision `0 → 1` from trusted state;
   - one operation-ledger entry and one state transition;
   - assertion totals and any failed checks;
   - a PASS, ISSUE, INCOMPLETE, or UNAVAILABLE result rather than raw JSON.
8. Confirm the page offers a clean rerun. If no action appears after approximately one minute,
   confirm the consumer hint and re-arm action appear.

### Controlled issue fallback

Use ChatGPT's built-in Browser or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`:

1. Open `https://thurstone.invarra.ai/demo/controlled`.
2. Choose **Run controlled mismatch**.
3. Confirm the result is labeled **Controlled example — no model call**.
4. Confirm expected `checkout_request`, observed `order_review`, unchanged trusted state, failed
   assertions, and deterministic investigation guidance.
5. Confirm the controlled result does not alter visitor results, `24/24`, or the separate `3/3`.

This fallback verifies the verdict mechanism, not agent performance.

## Manual full Demo verification

### Owner workflow

1. Confirm `/api/health` reports the exact candidate SHA.
2. Open `https://thurstone.invarra.ai/demo` in any browser.
3. In Stage 2, select between one and four real tools. Confirm no target tool is registered on the
   owner page and no tool is selected by default on a clean workspace.
4. Confirm only title and description are editable; names, schemas, annotations, handlers, and
   effects remain fixed. Mark a process-ending tool only when desired.
5. In Stage 3, add multiple representative requests. Confirm every request has its own
   schema-derived argument values.
6. Choose a run mode:
   - **Regression suite:** every request is queued, one agent chat is used, the fixture resets before
     each case, and the queue continues after an ISSUE.
   - **Continuous journey:** choose at least two ordered requests, allow repeated tools, carry
     verified state, place any process-ending tool last, and stop on the first ISSUE.
7. Review the queue. Confirm the owner sees expected actions/effects while the generated agent
   command contains authorized requests but no answer key.
8. Arm once and copy the complete secure command. Keep its opaque URL out of screenshots, logs,
   evidence, and public text.

### Fresh-agent workflow

1. Paste the command into a genuinely fresh GPT-5.6 Sol or Terra Work or Codex chat in the latest
   ChatGPT desktop app using its built-in Browser. Do not use the Chrome extension side panel.
2. If ChatGPT asks once for permission to open the token-bearing Thurstone URL, confirm only the
   exact `thurstone.invarra.ai` command.
3. Confirm the single-use handoff is claimed within ten minutes. An expired, claimed, revoked, or
   invalid link must be re-armed; never reused.
4. Confirm the isolated page exposes the authorized request queue and exact catalog but not expected
   actions, arguments, effects, assertions, or diagnosis.
5. Process one request at a time. Confirm Thurstone admits at most one eligible native action per
   case and verifies it before the next request.
6. For regression mode, confirm the site fixture resets and the queue continues after an independent
   issue.
7. For continuous mode, confirm trusted state carries forward and the journey stops after an issue.

### Owner result

1. Keep the original owner tab open and confirm progress synchronizes there.
2. At terminal completion, confirm the owner page routes to the Results report.
3. Verify every row records:
   - request;
   - expected and observed action;
   - expected and canonical arguments;
   - actual outcome;
   - trusted state before and after;
   - ledger and effect diff;
   - assertions;
   - build identity and timestamp;
   - verdict and diagnosis.
4. Confirm regression results show PASS or ISSUE for every executed case. Continuous results show
   NOT RUN for the remainder after an issue.
5. Export the report and confirm no opaque capability or secret is present.

## Limitations of verification

Thurstone proves what its own isolated page exposes and what the tested site state records. It
cannot certify every consumer's hidden context, identity, or future behavior. Count a result as
answer-isolated external-agent evidence only when a genuinely fresh supported task and authentic
native invocation are observed.

Chrome direct compatibility, controlled examples, reference evaluations, and visitor-created
results remain separate. None is a substitute for another.
