# Thurstone by Invarra

## Elevator pitch

Define what your WebMCP tools should mean, test them with a real agent, and verify what the website
actually did.

## About the project

WebMCP makes websites directly usable by AI agents. That creates a release risk that ordinary unit
tests cannot see: every handler may work perfectly while an agent chooses the wrong tool, supplies
the wrong arguments, misses a required clarification, or produces an effect the website owner did
not intend.

Thurstone is the missing semantic testing layer for that boundary.

The owner creates a human-readable contract for one behavior: the user request, expected tool,
allowed arguments, permitted state changes, forbidden effects, and replay policy. Thurstone then
opens an isolated page that exposes only the frozen agent-visible WebMCP catalog. A real external
agent—such as the judge’s own supported ChatGPT agent—uses the native Site Tools path.

Thurstone does not trust the model’s explanation or even the tool response. It independently checks
the selected tool, canonical arguments, native handler trace, trusted site state before and after,
and append-only ledger. A deterministic evaluator returns PASS, ISSUE, INCOMPLETE, or UNAVAILABLE.
When a test finds an issue, Thurstone identifies the failed contract layer and recommends the next
investigation step while keeping verified facts separate from hypotheses. Passes and issues can be
saved as browser-local regression cases, exported, edited, and rerun without overwriting the
original result.

The challenge experience is intentionally bring-your-own-agent. It lets a judge act like a WebMCP
owner instead of watching a hard-coded animation:

1. define intended meaning in a six-step contract wizard;
2. review exactly what the agent will and will not see;
3. arm one isolated two-tool Site Tools catalog;
4. send the frozen request to a fresh supported agent;
5. inspect the native call, trusted effect, verdict, diagnosis, and regression artifact.

## Why WebMCP is essential

Without WebMCP, Thurstone would only test a detached API or a simulated action. WebMCP provides the
site-owned, browser-native catalog that the external agent actually discovers and invokes. That
lets Thurstone connect natural-language intent to the deployed tool descriptor, native execution,
and real site effect in one auditable test.

## Reference evidence

The bundled synthetic checkout demonstrates two separate questions:

- **24/24 semantic behaviors** passed across equivalent wording, ambiguity, negation, arguments,
  read-only review, and explicit-versus-tentative checkout boundaries.
- **3/3 Invocation Integrity cases** passed for privileged-field injection, a nonexistent item,
  and replay/idempotency.

The denominators are never combined. The first tests benign agent meaning; the second tests three
declared invariants under deterministic hostile direct calls.

## How it was built

Thurstone uses TypeScript, Next.js, React, WebMCP `document.modelContext.registerTool()`, Vercel,
Upstash Redis, Playwright, and Vitest. The isolated BYOA runner synchronously admits at most one
eligible native call, retires its catalog after terminal evidence, propagates cancellation, and
binds results to the exact fixture, toolset, manifest, build, state, ledger, and descriptor digest.

Provider-backed reference evaluations are stateless (`store: false`) and protected by a durable
160-call / USD $10 lifetime guard. The judge-facing BYOA workflow itself makes no Thurstone-paid
model call: the user brings the external agent.

## What we learned

Publishing a correct schema is not the same as preserving human meaning. Clarification must be a
first-class outcome, no-call evidence must not be confused with success, and a persuasive tool
response cannot replace independent state verification. We also learned that diagnosis is most
useful when it says exactly which contract assertion failed without pretending to know a causal
fact that was never observed.

## Limitations

The current self-service challenge product authors and runs contracts in Thurstone’s synthetic
reference checkout with two frozen target tools. It does not connect to arbitrary external sites.
Thurstone is a testing and audit system—not runtime enforcement, certification, guaranteed
security, or proof that a malicious site will behave identically after testing. A result applies to
the declared contract, agent observation, fixture, and tested build.

**No purchase occurs.** The application contains no payment, account, inventory, messaging,
shipment, or external transaction path.

## Built with

WebMCP, TypeScript, Next.js, React, OpenAI, GPT-5.6 Terra, Chrome, Playwright, Vitest, Vercel,
Upstash Redis

## Try it

Live URL: https://thurstone.invarra.ai

Testing instructions:

1. Choose **Test Thurstone** and complete the six-step owner contract on `/demo`.
2. Keep the default explicit-checkout case for the shortest path, or edit the request and the two
   agent-visible tool descriptions.
3. Review the hidden owner contract separately from the projection the agent will receive, then
   choose **Arm live test** and copy the opaque fresh-agent URL.
4. Start a fresh GPT-5.6 Sol or Terra ChatGPT Work or Codex task in the latest ChatGPT desktop app.
   Use its built-in Browser (`@Browser`) to open the copied URL. The Chrome extension side chat is
   not the Site Tools consumer. The URL expires after ten minutes and should not be published.
5. Verify the isolated run shows the request and two native Site Tools without showing the expected
   tool or effect rubric. Send the exact request and let the fresh agent choose one tool.
6. Inspect expected versus observed behavior, canonical arguments, trusted state, ledger diff,
   assertions, verdict, and deterministic next step.
7. Save a PASS or ISSUE to **My Tests**, then open **Results** to see it before the unchanged 24/24
   semantic reference and separate 3/3 integrity matrix.
8. Use `/lab` only for the expert five-tool sandbox and historical native receipts.

Public repository URL: pending final public release

Video URL: pending final public YouTube upload
