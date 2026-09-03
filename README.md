# Thurstone

> **WebMCP makes website tools callable. It does not guarantee correct tool choice or permitted
> effects.**

**The owner defines what a request should mean. A visitor's agent uses the live WebMCP tools.
Thurstone checks whether the action and page state match that meaning.**

Thurstone is a pre-release semantic testing system for WebMCP. It joins the owner's contract, an
external agent's decision, the browser-native invocation, canonical arguments, trusted site state,
prohibited effects, and a deterministic verdict in one inspectable run.

**Thurstone by Invarra. Created and owned by Sergio Valencia.**

[Live application](https://thurstone.invarra.ai) ·
[Judge quick start](https://thurstone.invarra.ai/judge) ·
[Test Thurstone](https://thurstone.invarra.ai/demo) ·
[Research](https://thurstone.invarra.ai/research) ·
[Source](https://github.com/serg337/thurstone) ·
[Current semantic evidence](evidence/thurstone-current-result.json) ·
[Invocation Integrity](evidence/thurstone-invocation-integrity.md) ·
[Public sample run](evidence/sample-report.md)

Public release: pending final challenge release · Video: pending final public YouTube URL

**The reference checkout is simulated. No purchase, payment, shipment, inventory change, message,
or external transaction occurs.**

## The failure ordinary tests miss

A WebMCP handler can accept schema-valid arguments, execute correctly, and return success while the
agent still chose the wrong action for the person's meaning—or while the page changed something the
owner prohibited.

Unit tests prove that a handler works. Model-only evals can test the function and arguments a model
intends to call. Thurstone binds those layers to the live site:

**intended meaning → agent decision → native WebMCP → canonical arguments → trusted state and
ledger → verdict → saved regression**

Chrome's [WebMCP eval guidance](https://developer.chrome.com/docs/ai/webmcp/evals) recommends both
probabilistic agent evaluations and classic deterministic application tests. Thurstone complements
that guidance by making one owner-facing live contract out of both halves, including what must not
happen.

## What the human and agent do together

- **Website owner:** selects the real catalog, supplies representative user requests, declares the
  expected action and arguments, and defines allowed and prohibited effects.
- **Visitor's agent:** interprets those requests and independently uses the live WebMCP tools
  without receiving Thurstone's expected actions or effects.
- **Thurstone:** observes each native invocation and verifies its actual effect against site-owned
  state and the append-only ledger.
- **Human reviewer:** decides whether a result permits release and approves consequential actions,
  such as the simulated pending checkout.

The owner knows product policy, the agent supplies real consumer behavior, and the site supplies
authoritative effects. None of those can replace the others.

## Try it

### Judge quick start

The preloaded path needs no contract authoring and keeps the owner answer out of the fresh agent's
document:

1. Open [Judge quick start](https://thurstone.invarra.ai/judge) in any browser.
2. Review the preloaded request, expected tool, arguments, effect, and prohibited changes.
3. Choose **Arm quick test**, copy the exact command, and paste it into a fresh GPT-5.6 Sol or Terra
   Work or Codex chat in the latest ChatGPT desktop app.
4. Use ChatGPT's built-in Browser—not the Chrome side panel—and keep the owner page open.
5. Watch the visual verdict update automatically with observed action, trusted state, ledger, and
   contract checks.

No JSON is required. If no native action appears after one minute, the page gives consumer guidance
and a clean re-arm action. The handoff remains single use and expires after ten minutes.

### Controlled issue example

[The controlled example](https://thurstone.invarra.ai/demo/controlled) deliberately invokes the
wrong real tool through native WebMCP without a model call. It visually demonstrates expected versus
observed action, trusted state, failed assertions, and diagnosis. It is always labeled as controlled
and is never presented as an authentic agent failure.

### Full bring-your-own-agent Demo

1. Open [the Demo](https://thurstone.invarra.ai/demo) in any browser and review the fictional
   checkout boundary.
2. Select one to four real tools from the live reference catalog. Keep the verified wording or edit
   only its session-local agent-visible title and description.
3. Add representative requests and choose:
   - **Regression suite:** every request runs in one agent chat against a clean fixture; independent
     issues do not prevent later cases from running.
   - **Continuous journey:** two or more ordered requests run in one agent context with verified
     state carried forward; the journey stops on the first issue so later cases never inherit
     untrusted state.
4. Review, arm, and copy the generated secure command into a fresh GPT-5.6 Sol or Terra Work or
   Codex chat in the latest ChatGPT desktop app. Use ChatGPT's built-in Browser—not the Chrome
   extension side panel.
5. Keep the owner page open while Thurstone admits and verifies one native action per case, then
   inspect or download the synchronized results.

The handoff is single use and expires after ten minutes. Its command contains the owner's authorized
request queue but never the expected actions, effects, assertions, or diagnosis. If ChatGPT asks
once for permission to open the token-bearing `thurstone.invarra.ai` URL, confirm only when the
displayed domain and command are exact.

## Reference WebMCP catalog

The challenge Demo uses four real tools:

- `cart_get` — return item identities and quantities without changing state;
- `cart_update` — set one current cart line's quantity, including zero to remove it;
- `order_review` — return the priced order summary without changing state;
- `checkout_request` — create exactly one simulated pending approval when checkout is explicitly
  authorized.

`checkout_cancel` appears only while a pending simulated checkout exists and remains available in
the technical Lab.

The reference catalog is intentionally bounded. Connecting arbitrary external sites is a future
direction, not a challenge claim.

## How Thurstone works

1. **Define:** translate product policy into a contract covering action, arguments, allowed effects,
   prohibited effects, replay, and trusted state.
2. **Arm:** freeze the contract, catalog, fixture, and build while keeping the answer key outside the
   fresh-agent projection.
3. **Test:** let a supported external agent use the live browser-native WebMCP catalog.
4. **Verify:** compare native calls and canonical arguments with independent before/after state and
   ledger evidence.
5. **Diagnose:** identify the failed assertion and an evidence-backed place to investigate without
   claiming to read the model's private reasoning.
6. **Save:** preserve a PASS or ISSUE as an immutable browser-local regression.
7. **Rerun:** retest the same boundary after descriptions, schemas, handlers, models, browsers, or
   site behavior change.

Regression cases reset trusted state and continue after independent issues. Stateful journeys stop
after the first issue because later results would otherwise be scored against poisoned state.

## Where the WebMCP is

- [Native registration and lifecycle](lib/webmcp/registry-manager.ts#L657-L677) — the central
  registry calls `ModelContext.registerTool()` and binds cancellation to each registration.
- [Consumer execution adapter](lib/webmcp/runtime.ts#L500-L574) — validates manifest identity,
  consumes each execution ID once, and invokes the consumer-discovered tool.
- [Shared checkout state and operation ledger](lib/domain/checkout-session.ts#L324-L386) — serializes
  state transitions and retains native operation evidence.
- [Independent effect evaluation](lib/demo/evaluator-v3.ts#L338-L650) — derives canonical arguments,
  state change, ledger diff, assertions, and verdict.
- [Deterministic diagnosis](lib/demo/diagnose-result.ts#L330-L425) — separates verified facts from
  investigation hypotheses.
- [Frozen reference tool contracts](lib/demo/reference-tool-templates.ts) — defines expected
  arguments, effects, replay policy, and trusted-state assertions.

The checked-in registration path is equivalent to:

```ts
await document.modelContext.registerTool(
  {
    name,
    title,
    description,
    inputSchema,
    annotations,
    execute: async (input, { signal } = {}) => execute(input, signal)
  },
  { signal: registrationController.signal }
);
```

The implementation registers the complete tool object—including name, title, description,
`inputSchema`, annotations, and `execute`—from checked-in source. The registry verifies the exact
consumer-discovered catalog before execution.

## Architecture

```text
Owner contract ──freeze──▶ private handoff ledger
       │                         │
       │ expected behavior       │ authorized request queue
       ▼                         ▼
Deterministic evaluator ◀── native WebMCP ◀── fresh external agent
       ▲                         │
       └──── trusted state + append-only operation ledger
```

- Next.js and React provide the owner workspace, isolated agent document, and results.
- A deterministic checkout reducer is shared by human controls and WebMCP handlers.
- Browser-local site-owned storage contains the Demo contract, checkout state, and results.
- Upstash Redis stores only expiring digest-bound handoff/admission records; it is not a customer
  database.
- The judge-facing BYOA path uses the visitor's supported agent and makes no Thurstone-paid model
  call.

## Evidence hierarchy

Evidence classes remain separate:

1. **Current successor semantic snapshot:** `24/24` frozen cases, one trial per case, 20 native calls
   and four correct clarifications. This is bounded reference regression coverage, not an
   independent benchmark or proof of general model behavior.
2. **Historical paired experiment:** `23/24 → 23/24` after one description change, with the honest
   conclusion **no measured improvement**. It uses a different frozen protocol and is not the
   predecessor of the current snapshot.
3. **Invocation Integrity:** separate `3/3`, using four deterministic native calls and zero model
   calls for privileged-field injection, nonexistent item, and replay/idempotency.
4. **Direct Site Tools observations:** four fresh-context observations kept separate from scored
   reference evidence.
5. **Controlled mismatch:** a provider-free product demonstration; it enters no score.

The [public sample run](evidence/sample-report.md) preserves an authentic Chrome 152 native
checkout PASS with complete contract, canonical arguments, trusted state, ledger diff, and seven
assertions. It is labeled direct compatibility evidence—not answer-isolated model selection.

Hashes bind internal artifacts and release lineage. They are integrity checks, not independent
attestation or certification.

## Built during the challenge

Thurstone product work began on **August 26, 2026**, during the challenge period. The application,
reference WebMCP catalog, contract system, supported-agent path, native invocation capture,
trusted-effect verifier, diagnostic results, evidence pipeline, Demo, and judge UX are
challenge-period work documented by the repository history.

Two Invarra measurement notes—LIP and CSR—were published on **June 28, 2026** and predate the
challenge. They supplied conceptual background only: hold intended meaning fixed, vary how someone
expresses it, and measure the resulting behavior. No Thurstone software, catalog, or agent path
existed before the challenge.

## Local development

Requirements: Linux, Node `22.23.2`, and npm `10.9.8`.

```bash
git clone https://github.com/serg337/thurstone.git
cd thurstone
npm ci
npx playwright install --with-deps chromium
npm run dev
```

Open `http://127.0.0.1:3000`. The deterministic UI and tests run with all values in
[`.env.example`](.env.example) absent. Production secrets belong only in the deployment provider's
server-side environment store; never put real values into `.env.example`.

Core verification:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:browser:safe
npm run build
npm run verify:evidence
npm run verify:publication
```

## Safety and operating boundaries

- No real commerce or external mutation exists.
- Consequential checkout creates only a simulated pending-human-approval record.
- Closed schemas reject server-authoritative fields and nonexistent items.
- Per-case native admission rejects later or concurrent calls before domain execution.
- Replay/idempotency is verified separately through direct native calls.
- Provider-backed historical evaluations used `store: false` and remain behind a permanent
  160-call / USD `$10` lifetime guard.
- Opaque handoffs are origin-bound, single-use, and short-lived.
- Production source maps are disabled; dependencies and required notices are pinned and inventoried.

## Limitations

The self-service challenge experience uses one fictional reference checkout and one supported
external-agent path. It does not connect to arbitrary sites. Thurstone can verify what its own
fresh-agent page exposes, but it cannot certify every consumer's hidden context or identity.
Chrome's direct compatibility path is separate from answer-isolated agent-selection evidence.

Thurstone is a pre-release testing and audit system—not runtime enforcement, certification,
guaranteed security, statistical proof of model understanding, or proof that a malicious website
will behave identically after testing. Every result applies only to its declared contract, agent
observation, fixture, and tested build.

## License

Unless otherwise stated, original Thurstone repository material is MIT-licensed by Sergio
Valencia. Third-party components and assets remain under the licenses recorded in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
