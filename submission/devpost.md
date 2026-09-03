# Thurstone — Devpost submission

Everything below is paste-ready except the final public YouTube URL and any dynamic picker wording
shown by Devpost on submission day.

## General information

**Project name**

Thurstone

**Elevator pitch**

Release tests for whether agents understand—and safely execute—your WebMCP tools.

**Submitter**

Sergio Valencia, individual entrant, Germany. Invarra is the presentation/research brand, not an
incorporated entrant.

## About the project

### WebMCP makes tools callable. It does not make tool choice correct.

A WebMCP tool can have a valid schema and a handler that returns success while the agent still chose
the wrong action for what a person meant, supplied the wrong arguments, or caused an effect the
website owner prohibited. The code worked; the behavior was wrong.

Thurstone is a pre-release testing and audit system for that semantic boundary.

**The owner defines what a request should mean. A visitor's agent uses the live WebMCP tools.
Thurstone checks whether the action and page state match that meaning.**

### What Thurstone does

The owner selects real tools from the live catalog, writes representative user requests, and defines
the expected action, argument constraints, allowed effects, prohibited effects, replay policy, and
trusted state source.

A supported external agent receives the owner-authorized request queue and exact agent-visible
catalog—but not Thurstone's expected actions, effects, assertions, or diagnosis. The agent uses the
page's native WebMCP tools. Thurstone admits and verifies one eligible native action per case, then
compares the observed tool and canonical arguments with independent before-and-after site state and
an append-only operation ledger.

The result is PASS, ISSUE, INCOMPLETE, or UNAVAILABLE. A stateful journey also marks later requests
NOT RUN after an issue, because scoring them against poisoned state would be misleading. Thurstone
identifies the failed contract layer, shows the evidence, recommends where the owner should
investigate, and preserves verified cases as regressions.

Teams can use this workflow:

- before first launch;
- before every WebMCP change;
- after changing descriptions, schemas, handlers, models, browsers, or site behavior;
- to reproduce an agent mistake;
- as a scheduled post-launch regression suite.

### Why WebMCP is essential

Without WebMCP, Thurstone could test only a detached API or simulated action. WebMCP supplies the
site-owned catalog that the external agent actually discovers and invokes. That connects natural
language to the deployed tool definition, browser-native invocation, canonical arguments, and real
site effect in one auditable contract.

The reference site registers complete tool definitions with
`document.modelContext.registerTool()`. Thurstone verifies the consumer-discovered catalog before
execution, captures native handler traces, and checks the represented effect independently of the
tool's success response.

Chrome's [WebMCP eval guidance](https://developer.chrome.com/docs/ai/webmcp/evals) already recommends
probabilistic agent evaluations and classic deterministic application tests. Thurstone does not
claim to invent those layers. It binds them into one owner-facing live contract, including what
must not happen, and stops a stateful journey before later requests inherit untrusted state.

### Better experience for people

For WebMCP owners, semantic failures become reproducible release tests instead of customer reports
that are difficult to diagnose. A result says what was expected, what the agent did, what the site
actually changed, which assertion diverged, and where to investigate next.

For visitors, the benefit is direct: agents are more likely to perform the action the person
intended—and to ask for clarification when intent is not sufficient for a consequential action.

Most WebMCP products help an agent operate one application. Thurstone addresses a release risk
shared by all of them. Any merchant, publisher, SaaS team, or platform developer exposing WebMCP
tools can benefit from checking the boundary between human language, agent choice, and site effect.

### What the owner and agent do together

The owner knows the site's product policy and defines the contract. The visitor's agent supplies real
consumer behavior against the live catalog. The website supplies authoritative state. Thurstone
turns those three inputs into a repeatable release decision. A human remains responsible for the
contract, the release, and approval of consequential actions such as the simulated pending
checkout.

That collaboration was difficult to test as one unit before WebMCP made the agent's page action
structured and observable.

### Challenge experience

The Demo lets a judge work as a WebMCP owner:

1. select one to four real tools from the reference checkout's live catalog;
2. inspect or edit session-local agent-visible wording;
3. add representative requests with argument fields derived from each tool's JSON Schema;
4. run every independent request as a regression suite or arrange a stateful customer journey;
5. send one private, expiring command to a fresh ChatGPT desktop Browser task;
6. watch native actions and trusted state be verified one case at a time;
7. inspect, export, preserve, and rerun the results.

Regression cases use one agent chat and a clean fixture per request, so every case runs even after an
independent issue. Continuous journeys keep one agent context and carried state, allow repeated
tools, and stop at the first issue.

A separate `/demo/controlled` route deliberately invokes the wrong real tool with no model call. It
demonstrates the deterministic verdict engine and is clearly labeled so it is never confused with
authentic agent evidence.

### Implementation

Thurstone uses strict TypeScript, Next.js, React, native WebMCP, Vercel, Upstash Redis, JSON Schema,
Zod, Playwright, and Vitest.

The reference catalog contains `cart_get`, `cart_update`, `order_review`, and `checkout_request`,
plus state-dependent `checkout_cancel` in the technical Lab. A shared deterministic reducer,
browser-local site-owned state, native handler traces, and an append-only ledger create the trusted
before-and-after evidence.

Contract authoring and agent execution are isolated. The secure command contains every authorized
request but withholds expected actions and effects. A short-lived, digest-bound Redis ledger makes
handoff issue, claim, start, per-case admission, settlement, and owner synchronization atomic. Redis
does not store customer accounts or checkout data.

The native adapter supports current object and JSON-string argument representations, detects the
mode once with a harmless read-only operation, preserves cancellation, consumes execution IDs
once, and never retries a mutation using another encoding.

The judge-facing bring-your-own-agent path makes no Thurstone-paid model call: the user brings the
supported external agent.

### Evidence

The current successor snapshot reports **24/24 semantic cases**: one trial per frozen case, 20 native
calls, and four correct clarification outcomes. It covers equivalent wording, ambiguity, negation,
arguments, read-only behavior, and explicit-versus-tentative checkout. This is bounded reference
regression coverage—not an independent benchmark, certification, or proof of general model
behavior.

The historical paired one-description experiment remains separate: **23/24 → 23/24**, with the
honest conclusion **no measured improvement**. It used a different frozen protocol and is not the
predecessor of the current snapshot.

A separate **3/3 Invocation Integrity Matrix** uses four deterministic native calls and zero model
calls to test privileged-field injection, a nonexistent item, and replay/idempotency. Its
denominator is never combined with semantic behavior.

Fresh-context Direct Site Tools observations, judge-created Demo results, and the controlled
mismatch remain separate evidence classes. Hashes bind internal evidence and release lineage; they
are not independent attestation.

The public sample report contains a complete authentic Chrome 152 native checkout PASS: declared
contract, canonical arguments, trusted state before and after, ledger diff, and seven assertions.
It is explicitly direct compatibility evidence rather than answer-isolated model selection.

### Built during the challenge

Thurstone product work began on **August 26, 2026**, during the challenge period. The application,
reference WebMCP catalog, owner contract system, supported-agent path, native invocation capture,
trusted-effect verifier, diagnostic results, evidence pipeline, Demo, and judge UX are
challenge-period work documented by the repository history.

Two Invarra measurement notes—LIP and CSR—were published on **June 28, 2026** and predate the
challenge. They supplied conceptual background only: hold one intended meaning fixed, vary how a
person expresses it, and measure the resulting behavior. No Thurstone product, catalog, or agent
path existed before the challenge.

The narrow initial scope is deliberate: one owner contract system, one real reference catalog, one
supported external-agent path, and a deterministic verdict on meaning and effect, assembled into a
coherent product during the challenge.

### What we learned

A correct schema is not the same as preserved human meaning. A successful tool response cannot
replace trusted site state. Clarification and no-action are real outcomes. A partial run is not a
pass. Idempotency must be verified from state and ledger evidence rather than promised by a handler.

Diagnosis must also remain modest. Thurstone can prove which declared assertion diverged and suggest
where to investigate, but it cannot read the model's private reasoning.

### Limitations

The self-service challenge experience uses one fictional reference checkout with preconfigured real
tools; it does not connect to arbitrary external sites. The semantic path requires a supported fresh
ChatGPT desktop in-app Browser task. WebMCP-enabled Chrome provides direct native compatibility
testing, but the Chrome side-panel chat is not presented as answer-isolated agent-selection
evidence.

Thurstone is a testing and audit system—not runtime enforcement, certification, guaranteed
security, statistical proof of model understanding, or proof that a malicious site will behave
identically after testing. Every result applies only to the declared contract, agent observation,
fixture, and tested build.

The checkout is simulated. No purchase, payment, shipment, inventory change, message, or external
transaction occurs.

## Built with

WebMCP, TypeScript, Next.js, React, OpenAI, GPT-5.6 Terra, ChatGPT, Vercel, Upstash Redis,
Google Chrome, Playwright, Vitest, JSON Schema, Zod, GitHub Actions

## Try it out

- Live application: https://thurstone.invarra.ai
- Judge quick start: https://thurstone.invarra.ai/judge
- Demo: https://thurstone.invarra.ai/demo
- Research: https://thurstone.invarra.ai/research
- Public source: https://github.com/serg337/thurstone
- Video: pending final public YouTube URL

## Project media

- Project thumbnail: `public/thurstone-thumbnail.png`
- YouTube thumbnail: `submission/media/thurstone-video-thumbnail.png`
- Gallery files and paste-ready captions: [`submission/media/GALLERY.md`](media/GALLERY.md)
- Public YouTube demo URL: pending Sergio recording and publication

## Testing instructions

No Thurstone account or credentials are required. Start at
`https://thurstone.invarra.ai/judge`. ChatGPT access is required for the authentic-agent path.

### Judge quick start — no authoring required

1. Open `https://thurstone.invarra.ai/judge` in any browser.
2. Review the three preloaded cases: a healthy live baseline, a disclosed session-only site fault,
   and a real-agent semantic collision whose outcome is not predetermined.
3. Choose **Arm Judge Quick Start**.
4. Copy the exact command into a fresh GPT-5.6 Sol or Terra Work or Codex chat in the latest
   ChatGPT desktop app using its built-in Browser—not the Chrome extension side panel.
5. Continue all three cases in that same chat. Keep the owner page open; it tracks progress and
   automatically opens **Judge Results** with one row per request and a downloadable report.

If nothing is observed after approximately one minute, confirm the fresh chat is using ChatGPT
Desktop's built-in Browser and use **Re-arm three clean cases**. The handoff is single use and expires
after ten minutes.

### Controlled issue without an agent

Open `https://thurstone.invarra.ai/demo/controlled` and choose **Run controlled mismatch**. This is
a deterministic no-model demonstration, not an agent failure. It visually shows the declared
checkout intent, wrong native read-only call, unchanged trusted state, failed assertions, and
recommended investigation.

### Full authentic-agent workflow

1. Open `https://thurstone.invarra.ai/demo` in any browser.
2. Select one or more real reference tools in Stage 2.
3. Add representative requests in Stage 3 and choose **Regression suite** or **Continuous journey**.
4. Review, arm, and copy the generated secure command.
5. Paste it into a fresh Work or Codex chat in the latest ChatGPT desktop app using GPT-5.6 Sol or
   Terra and ChatGPT's built-in Browser. Do not use the Chrome extension side panel.
6. Keep the owner page open. The command shows the agent every authorized request but withholds
   expected actions, effects, assertions, and diagnoses. Thurstone verifies one case at a time and
   synchronizes the final results back to the owner page.
7. Inspect or download the report. Regression suites continue after independent issues; continuous
   journeys stop after the first issue.

The handoff is single use and expires after ten minutes. ChatGPT may ask once for permission to open
the token-bearing `thurstone.invarra.ai` URL. Confirm only if the domain and command are exact. If
the link is expired, claimed, or revoked, return to the owner Demo and arm a new handoff.

The checkout is fictional and simulated. No purchase, payment, shipment, or external transaction
occurs.

## Additional information

- Submitter type: Individual
- Country of residence: Germany
- App status: New
- Live URL: https://thurstone.invarra.ai
- Public repository: https://github.com/serg337/thurstone
- Tested clients: ChatGPT desktop built-in Browser / Site Tools with Codex using GPT-5.6 Terra;
  Google Chrome 152 with WebMCP testing enabled for direct native compatibility; OpenAI Responses
  API with GPT-5.6 Terra for bounded reference evaluation
- AI tools used: OpenAI Codex, ChatGPT, and OpenAI Responses API with GPT-5.6 Terra
- Learning: Significant
- Career value: Yes

Final legal attestations, video publication, rules acceptance, and Devpost submission remain Sergio
Valencia's actions.
