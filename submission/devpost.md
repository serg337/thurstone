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

The owner chooses two to four real tools from a bounded reference WebMCP library, then builds a
human-readable contract suite from representative requests. Each independent case declares an
expected tool, argument predicate, permitted state changes, forbidden effects, and policy. The
owner selects one case for one live trial. Thurstone then creates an opaque, expiring handoff whose
fresh page exposes only the frozen request, fixture, and selected agent-visible WebMCP catalog. A
real external agent—such as the judge's own supported ChatGPT agent—uses the native Site Tools path.

Thurstone does not trust the model’s explanation or even the tool response. It independently checks
the selected tool, canonical arguments, native handler trace, trusted site state before and after,
and append-only ledger. A deterministic evaluator returns PASS, ISSUE, INCOMPLETE, or UNAVAILABLE.
When a test finds an issue, Thurstone identifies the failed contract layer and recommends the next
investigation step while keeping verified facts separate from hypotheses. Passes and issues can be
saved as browser-local regression cases, exported, edited, and rerun without overwriting the
original result.

The challenge experience is intentionally bring-your-own-agent. It lets a judge act like a WebMCP
owner instead of watching a hard-coded animation:

1. understand one consequential meaning boundary in a known synthetic fixture;
2. choose two to four preconfigured real WebMCP tools and preview exactly what the agent receives;
3. build a named multi-case contract suite, select one case, and review the isolated answer key;
4. send that selected case through an opaque one-time handoff to a genuinely fresh supported
   agent;
5. explicitly start one bounded observation, then inspect Result v3, deterministic diagnosis, and
   a browser-local regression artifact.

A separate `/demo/controlled` example deliberately invokes the wrong real tool with no model call.
It shows how an action that looks plausible without verification becomes an evidence-backed ISSUE
when the owner contract, trusted state, ledger, and assertions are compared. It is never presented
as an authentic model failure and never enters either reference score.

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
Upstash Redis, Playwright, and Vitest. Strict versioned catalog, suite, case, live-contract, Result
v3, and My Tests v2 schemas bind results to the exact fixture, toolset, manifest, build, state,
ledger, descriptor, and regression lineage. The isolated BYOA runner moves through received and
ready states before explicit start, synchronously admits at most one eligible native call, retires
its catalog after terminal evidence, and propagates cancellation.

The challenge checkout's trusted state, contract suites, results, and saved regressions are bounded
browser-local, site-owned data. Redis holds only an expiring, digest-bound ledger for atomic handoff
issue, claim, start, and terminal transitions; it is not a customer database.

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

The current self-service challenge product authors and runs suites in Thurstone's synthetic
reference checkout with two to four preconfigured real target tools. It does not connect to
arbitrary external sites. The one-call BYOA trial does not measure replay; replay/idempotency is a
separate Invocation Integrity case. Thurstone can verify that its own fresh page withholds the
owner answer, but it cannot certify every consumer's hidden context or identity. An
`independent-agent-native` claim therefore requires an actually fresh supported built-in Browser
task and authentic capture. Flagged Chrome is a separate compatibility path, not independent
agent-selection evidence. Thurstone is a testing and audit system—not runtime enforcement,
certification, guaranteed security, or proof that a malicious site will behave identically after
testing. A result applies to the declared contract, agent observation, fixture, and tested build.

**No purchase occurs.** The application contains no payment, account, inventory, messaging,
shipment, or external transaction path.

## Built with

WebMCP, TypeScript, Next.js, React, OpenAI, GPT-5.6 Terra, Chrome, Playwright, Vitest, Vercel,
Upstash Redis

## Try it

Live URL: https://thurstone.invarra.ai

Testing instructions:

1. In a genuinely fresh GPT-5.6 Sol or Terra ChatGPT Work or Codex task, use the latest ChatGPT
   desktop app's built-in Browser and send `@Browser Open https://thurstone.invarra.ai/demo`. The
   Chrome extension side chat is not the Site Tools consumer.
2. **Stage 1:** review the meaning boundary and fixed synthetic fixture.
3. **Stage 2:** keep the default pair or choose two to four real reference tools. You may edit only
   agent-visible titles and descriptions; schemas, annotations, handlers, and effects stay fixed.
4. **Stage 3:** name the suite, add one to six independent cases, choose one live case, then select
   **Review and arm selected case**. Confirm **Owner expects** is separate from **Agent receives**,
   then choose **Arm live test**.
5. On the owner-only prepared screen, copy the complete `@Browser` command. Do not publish, record,
   or export its opaque URL; it expires after ten minutes.
6. Paste the command into a genuinely fresh supported task—not a share, fork, reference, or resume
   of the owner task. Confirm only the request, fixture, and selected catalog are visible.
7. Choose **Continue to readiness**, then **Start live observation**. Only then does Thurstone
   register the exact catalog and start the timer. Let the fresh agent follow the frozen request;
   the first eligible native callback is the one admitted call.
8. Inspect Result v3: expected and observed behavior, canonical arguments, browser-local site-owned
   before/after state, ledger diff, assertions, evidence tier, verdict, diagnosis, and recommended
   next step. Save PASS/ISSUE to **My Tests v2** or export it; INCOMPLETE/UNAVAILABLE remains
   honestly inconclusive.
9. Open **See how Thurstone catches a mismatch** for the separate controlled no-model-call example.
   Then open **Results** for **My Tests v2**, unchanged **24/24 semantic behaviors**, and the
   separate **3/3 Invocation Integrity Matrix**.
10. Use `/lab` only for advanced direct catalog, cart, cancellation, reset, and native-receipt
    compatibility testing.

Public repository URL: pending final public release

Video URL: pending final public YouTube upload
