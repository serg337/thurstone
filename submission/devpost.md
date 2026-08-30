# Thurstone by Invarra

_Previously developed and measured under the working name ToolProof; immutable evidence and
protocol identifiers retain that legacy name for provenance._

**Elevator pitch:** Semantic regression tests for WebMCP tools—unit tests for meaning, arguments, and effects.

**Built with:** WebMCP, TypeScript, Next.js, React, OpenAI Responses API, GPT-5.6 Terra, Chrome for Testing, Playwright, Vitest, Vercel, Upstash Redis

## Problem

Agent-callable websites are often tested like ordinary APIs: did a tool exist, did the call return JSON, and did the page avoid crashing? Those checks miss the more important failure. Two requests can mean the same thing but trigger different tools, or one small change in intent can cross a consequential boundary without the system noticing.

Thurstone asks a stricter question: **does WebMCP behavior track the meaning a human approved?** It makes tool selection, canonical arguments, observable effects, clarification behavior, and over-action independently inspectable.

The project was inspired by the gap between integration tests that prove a tool can run and the human question that actually matters: did the agent do the same thing when the request meant the same thing, and stop or change course when one meaningful detail changed?

## What Thurstone Does

Thurstone is a deterministic simulated checkout with five native WebMCP tools. Four appear on the initial fixture—`cart_get`, `cart_update`, `checkout_request`, and `order_review`—while `checkout_cancel` exists only when a simulated checkout is pending.

A human reviews a semantic contract containing meaning-equivalent requests and matched boundaries. Thurstone freezes that contract, runs fresh model contexts against the live catalog, executes at most one native tool per case, captures before/after state and exact effects, and scores the trace outside the model context. Results remain filterable by version, Development versus Builder-blinded holdout, family, case, outcome, and error class.

The reference experiment contains 24 cases per version. Baseline and revised both scored `23/24`: Development stayed `12/12`, holdout stayed `11/12`, and the same tentative-checkout case abstained rather than asking the required clarification. The one-description revision therefore shows **no measured improvement** in this one-trial snapshot. Thurstone presents that result rather than optimizing it away.

| Metric                      | Baseline → revised |
| --------------------------- | -----------------: |
| Equivalence consistency     |        `8/8 → 8/8` |
| Boundary sensitivity        |        `7/8 → 7/8` |
| Approved tool/action        |    `23/24 → 23/24` |
| Canonical arguments         |    `20/20 → 20/20` |
| Observable effects          |    `24/24 → 24/24` |
| Over-action                 |      `0/10 → 0/10` |
| Deterministic clarification |        `3/4 → 3/4` |

The most useful lesson was negative: a clearer description did not improve this frozen one-trial suite. Trace-level failure identity mattered more than a flattering aggregate, and the result justified preserving clarification as its own contract rather than treating every no-call as safe success. Broader usefulness remains a human claims decision, not a measured fact.

Thurstone also includes a separately scored **Invocation Integrity Matrix**. Three deterministic,
provider-free native WebMCP cases test privileged-field injection, a schema-valid nonexistent item,
and exact replay/idempotency. The production result is `3/3` on execution build
`0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786`; it is never combined with semantic accuracy.

> **Thurstone tests both sides of a declared WebMCP contract: whether benign requests produce the represented effects, and whether tested hostile invocations preserve site-defined invariants.**

Limitations: Thurstone is a testing/audit system, not runtime enforcement, certification,
guaranteed security, arbitrary-site verification, or proof that a malicious website will behave
identically after testing.

**Simulated checkout — no purchase occurs.** There is no payment, inventory, account, messaging, shipment, or external transaction path.

## Why WebMCP Is Essential

WebMCP is the object under test and the execution substrate—not a decorative integration. The visible interface and the agent share one document-owned state store. Thurstone registers real top-level Site Tools, verifies the exact discovered catalog, supports the current native argument representations through one calibrated adapter, propagates cancellation, and binds each consumer call to one canonical handler trace and state effect.

That makes questions possible that a detached API benchmark cannot answer: Did the model select the tool actually available on this page? Did the visible UI update before result delivery? Did a pending-only tool appear at the right lifecycle boundary? Did reset restore both state and catalog? Did a prohibited action occur and later get hidden by compensating state?

## Human + Agent

The workflow preserves genuine human authority. A 24-case package was reviewed and frozen before scored inference. After the baseline, a fresh Repair Builder received only the 12 Development cases—zero holdout prompts, labels, traces, aggregates, or hints—and proposed one revised `checkout_request` description. Sergio reviewed the exact description and one-line source proof before the unchanged 24-case rerun.

Studio shows the frozen contract and human receipt. Lab exposes the deterministic fixture and native trust surface without expected answers. Results reveal the paired traces only after terminal evidence. Direct ChatGPT/Codex Site Tools observations, non-scored calibration, native plumbing, the one-call judge lane, and the scored Custom Probe remain separate evidence namespaces and denominators.

## Challenge-Period Build

The high-level concept and planning predate the challenge under the working name ToolProof. The public WebMCP product was built during the challenge period: the five-tool checkout domain, lifecycle-safe registry, native adapter, replay-safe operations, verified reset, trace ledger, evidence exports, blinded 24-case protocol, bounded model runner, Results inspector, signed-out judge lane, browser/accessibility suite, security controls, documentation, and release package. Sergio adopted the current Thurstone name on 29 August 2026 after the scored evidence was captured; the rename does not rewrite historical receipts or protocol identifiers.

OpenAI Codex assisted with implementation, testing, audits, and collateral. Controlled model decisions use the OpenAI Responses API with GPT-5.6 Terra. Every dependency and adapted upstream component is pinned and attributed; no generated answer is treated as human approval or authentic browser evidence.

## 60-Second Test

1. In Chrome 149+, enable `chrome://flags/#enable-webmcp-testing`, relaunch the browser, and open the live Lab signed out. Alternatively, use the latest ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra. No Thurstone login, judge-supplied key, extension, or Thurstone-specific setup is required.
2. Confirm `consumer-ready` and the clean four-tool catalog.
3. In **One fixed decision, one verified native read**, load the already sealed bounded judge decision.
4. Run the required fresh current-build native `cart_get`, then inspect or download the combined proof. The server accepts only its displayed judge-only request; its sole challenge-lifetime provider call was consumed on the evidence root, and archive recovery cannot make another model request.
5. Open Results and inspect `23/24 → 23/24`, the one-line contract diff, the shared failure, exact state/effect hashes, and limitations.

For the official Site Tools experience, open the same Lab in the latest ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra and ask one of the documented fresh-chat requests. Those observations are reported separately from the scored experiment.

## Implementation

Thurstone uses strict TypeScript, Next.js, and React. A serialized domain/session layer owns fixture state, schemas, idempotency tombstones, mutation admission, cancellation, and reset. A per-tool registry manager drains calls before catalog changes and verifies exact discovery. Append-only traces retain raw and canonical arguments, native results, before/after state, effect diffs, runtime identity, and hashes.

The hardest engineering work was browser lifecycle correctness rather than drawing the UI: tolerating omitted native execution context while preserving cancellation; keeping pending-only registration synchronized across route remounts; proving committed state is visible before outer result delivery; making reset restore state, ledger, and catalog together; and surviving refresh, duplicate tabs, lost responses, and ambiguous dispatch without spending twice. Those failures drove the document-owned store, drain-before-registration transitions, append-only receipts, and conservative recovery rules.

The model-backed boundary is stateless (`store:false`), fixed to one provider/model/settings projection, and permits one decision plus at most one target call. A durable Redis policy caps the entire challenge lifetime at 160 calls and USD `$10`, independent of provider-window resets. Signed single-use authorization, replay/rate/concurrency controls, encrypted permanent receipts, conservative uncertain settlement, origin/body limits, security headers, no source maps, secret scanning, and a dedicated project hard limit keep the public surface narrow.

The signed-out judge lane accepts no prompt, model, schema, URL, tool, or arguments from the browser. Its judge-only request and case identity are source-fixed. The sole provider decision is sealed on evidence root `e2cf8d47375abfeeb4f32bd6f5973918acf4c091` and selected `cart_get` with `{}`. Upstash's automatic JSON deserialization exposed a string-only archive-reader assumption after the permanent capture; the record, lifetime guard, and cost were unchanged. The recovery build repairs only archive presentation with zero provider retries and zero store rewrites. Because provider and native evidence remain separate, that build must execute its own digest-verified empty-argument `cart_get` on a clean, halt-free catalog. Gate 9 may later add one optional link-only release hop after the verified recovery transition.

## Impact

Thurstone turns “the tool call worked” into an evidence-backed semantic regression question. The same approach can apply to editors, dashboards, support consoles, travel planners, and other agent-callable interfaces where equivalent phrasing should preserve behavior and a small intent change should not silently cross an action boundary.

The useful artifact is not a flattering aggregate. It is the combination of a human-approved contract, native page effects, trace-level provenance, separate failure classes, and a reproducible way to compare versions without exposing holdout truth during repair.

## Limitations

- This is one synthetic checkout domain and one provider model.
- Each case has one trial per version, so `23/24 → 23/24` is a demonstration snapshot, not a stability estimate.
- The revision produced no measured improvement.
- The same tentative-checkout holdout failed in both versions.
- Operational blinding is enforced by the product, not by an independent third party or cryptographic protocol.
- Direct Site Tools observations demonstrate the intended experience but do not estimate a rate and are not merged with Custom Probe scores.
- Gate 7 completion is deployment-bound: the live receipt must verify the recovery archive and a fresh current-build native replay; source prose is not used as a substitute.
- Hashes establish internal consistency, not independent timestamping, model understanding, safety certification, or generality.
- WebMCP and Site Tools availability remain evolving and client-dependent.

## Links

Live app: https://toolproof-rust.vercel.app

Invocation Integrity: https://toolproof-rust.vercel.app/invocation-integrity

Public repository: reserved for the verified Gate 9 link-only release commit

Release: reserved for the verified Gate 9 link-only release commit

Demo video: reserved for the verified Gate 9 link-only release commit

Submission receipt: recorded only in the durable private manifest after Sergio's reserved final submission; the frozen public repository is not edited afterward.

### Additional Devpost form values

- **Project name:** Thurstone by Invarra
- **Elevator pitch:** Semantic regression tests for WebMCP tools—unit tests for meaning, arguments, and effects.
- **Submitter Type:** Individual
- **Country of residence:** Germany
- **App Status:** New
- **Existing-work explanation:** The high-level concept and planning predated the challenge under the working name ToolProof. The submitted public WebMCP implementation, native checkout tools, evidence system, evaluation, and release package were built during the challenge period. The public product was renamed Thurstone on 29 August 2026 after evidence capture; immutable receipts retain the working name.
- **Live URL:** https://toolproof-rust.vercel.app
- **Testing instructions:** Use Chrome 149+ after enabling `chrome://flags/#enable-webmcp-testing` and relaunching, or the latest ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra. Open `/lab` signed out, confirm the four-tool `consumer-ready` catalog, run the one fixed judge proof, inspect/download the sealed receipt, then open `/results`. No Thurstone login or judge-supplied key is required; checkout is simulated and no purchase occurs.
- **Public code repository:** populate only from the verified Gate 9 public-release field; never submit the private URL.
- **Tested clients:** Chrome 151/152 native WebMCP; Codex in the ChatGPT desktop built-in browser using Site Tools; GPT-5.6 Terra through the bounded OpenAI Responses API Custom Probe.
- **AI tools leveraged:** OpenAI Codex for implementation, testing, audits, and collateral; GPT-5.6 Terra for bounded calibration/reference decisions; Codex Site Tools observations in the ChatGPT desktop built-in browser.
- **Level of learning:** Significant
- **Career AI value:** Yes
- **Video demo link:** populate only after Sergio uploads and verifies the final sub-three-minute narrated demo.
