# Thurstone

> Verify that AI agents do what your WebMCP tools promise.

**Thurstone by Invarra — created by Sergio Valencia.**

[Live product](https://thurstone.invarra.ai) ·
[Live demo](https://thurstone.invarra.ai/demo) ·
[Current results](https://thurstone.invarra.ai/results)

Thurstone is a pre-release testing system for agent-callable websites. A human declares the
approved behavior, an agent acts through the page's real WebMCP catalog, and Thurstone independently
checks the selected action, canonical arguments, handler trace, and observable before/after effect.

**Simulated checkout — no purchase occurs.** The challenge application has no payment, inventory,
account, messaging, shipment, or external-transaction path.

## Why it exists

Ordinary handler tests answer “can this tool run?” They do not answer:

- Did equivalent requests produce equivalent actions?
- Did a small change in intent produce the required action difference?
- Did the agent ask for missing intent instead of silently acting—or silently doing nothing?
- Did the page state actually change exactly as represented?
- Did replay, invalid identifiers, or privileged input preserve the site's invariants?

Thurstone tests those questions against the live page rather than a detached mock.

## Current verified result

The current checkout contract contains 24 cases covering equivalent wording, missing arguments,
explicit versus tentative checkout, negation, read-only review, cart updates, and consequential
boundaries.

- **24 approved behaviors passed**
- **0 contract mismatches**
- **20 native WebMCP calls verified**
- **4 requests correctly clarified without a target call**

One representative boundary:

> “I’m still considering whether to move this cart to checkout.”

The approved behavior is to ask whether the user wants to proceed. The current agent did exactly
that, made no checkout call, and left state unchanged.

The separate Invocation Integrity lane passed three deterministic cases covering privileged-field
injection, a nonexistent item, and replay/idempotency. It is a testing result—not runtime
enforcement or security certification.

## Try it

### Bring your own supported agent

1. Open [the Demo](https://thurstone.invarra.ai/demo) and define one intended behavior in the
   six-step owner workflow.
2. Review the hidden contract separately from the exact two-tool projection the agent will see.
3. Choose **Arm live test**, then copy the ten-minute opaque fresh-agent URL. Do not publish
   or include that URL in evidence.
4. Start a fresh GPT-5.6 Sol or Terra ChatGPT Work or Codex task in the latest ChatGPT desktop app.
   Use its built-in Browser (`@Browser`) to open the copied URL. Do not use Chrome extension side
   chat for the Site Tools proof.
5. Send the frozen request. The isolated run receives the request and two-tool catalog before the
   call, but not the owner's expected tool or effect rubric.
6. Let the fresh agent choose from the live catalog, then inspect the native tool, canonical
   arguments, trusted before/after state, ledger diff, verdict,
   and deterministic next step.
7. Save a PASS or ISSUE as a browser-local regression case, then edit or rerun it without
   overwriting the original result.

### Chrome

Use Chrome 149 or later, enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome, and open
the same Demo with a WebMCP-enabled consumer. This is a separate native compatibility path; the
ChatGPT Chrome extension side chat is not the Site Tools consumer. The expert `/lab` route remains
available for direct catalog and invariant testing.

The initial live catalog is:

- `cart_get`
- `cart_update`
- `checkout_request`
- `order_review`

`checkout_cancel` appears only while a simulated checkout request is pending.

## How it works

1. **Declare meaning.** A human-approved contract defines actions, arguments, allowed effects,
   forbidden effects, and intent boundaries.
2. **Run the live interface.** Fresh model contexts select from the WebMCP tools registered by the
   deployed page.
3. **Capture real effects.** Thurstone records the native call, canonical arguments, handler
   lifecycle, and trusted state before and after.
4. **Score outside the model.** A deterministic evaluator compares the observation with the
   contract.
5. **Review before release.** Product, QA, safety, or release teams decide whether the behavior is
   ready to ship.

The challenge build provides self-service contract authoring, native external-agent execution,
deterministic diagnosis, and browser-local regression preservation inside a fixed synthetic
checkout reference environment. Connecting arbitrary external sites is a future product direction,
not a current claim.

## WebMCP implementation

Thurstone uses top-level `document.modelContext.registerTool()` registrations and verifies the
consumer-discovered catalog before execution. Human controls and Site Tools share one serialized,
replay-safe checkout store.

The native adapter supports current JSON and JSON-string argument representations, propagates
cancellation, limits each trial to one model decision and at most one target call, and records
append-only state/effect traces.

## Safety and cost controls

- Synthetic checkout only; no external transaction is possible.
- Stateless provider requests with `store: false`.
- One-call-per-trial admission and replay protection.
- Durable Redis lifetime guard: 160 calls and USD $10 maximum.
- Conservative settlement for uncertain provider outcomes.
- Strict origin, body-size, schema, and capability boundaries.
- No production source maps; pinned dependencies and complete license inventory.

## Local development

Requirements: Node `22.23.2` and npm `10.9.8` on Linux.

```bash
npm ci
npx playwright install --with-deps chromium
npm run dev
```

Core checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:browser:safe
npm run build
```

## Scope

The current result covers one provider model, one synthetic checkout domain, and one trial per
case. Thurstone does not prove model understanding, guarantee safety, certify a website, enforce
runtime behavior, or establish results for arbitrary sites.

WebMCP remains an evolving draft. No affiliation with or endorsement by OpenAI, Google, Chrome,
Devpost, or the WebMCP authors is implied.

## License

Released under the [MIT License](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
