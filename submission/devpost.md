# ToolProof by Invarra

**Elevator pitch:** Semantic regression tests for WebMCP tools—unit tests for meaning, arguments, and effects.

**Built with:** WebMCP, TypeScript, Next.js, React, OpenAI Responses API, GPT-5.6 Terra, Chrome for Testing, Playwright, Vitest, Vercel, Upstash Redis

## Problem

Agent-callable websites are often tested like ordinary APIs: did a tool exist, did the call return JSON, and did the page avoid crashing? Those checks miss the more important failure. Two requests can mean the same thing but trigger different tools, or one small change in intent can cross a consequential boundary without the system noticing.

ToolProof asks a stricter question: **does WebMCP behavior track the meaning a human approved?** It makes tool selection, canonical arguments, observable effects, clarification behavior, and over-action independently inspectable.

## What ToolProof Does

ToolProof is a deterministic simulated checkout with five native WebMCP tools. Four appear on the initial fixture—`cart_get`, `cart_update`, `checkout_request`, and `order_review`—while `checkout_cancel` exists only when a simulated checkout is pending.

A human reviews a semantic contract containing meaning-equivalent requests and matched boundaries. ToolProof freezes that contract, runs fresh model contexts against the live catalog, executes at most one native tool per case, captures before/after state and exact effects, and scores the trace outside the model context. Results remain filterable by version, Development versus Builder-blinded holdout, family, case, outcome, and error class.

The reference experiment contains 24 cases per version. Baseline and revised both scored `23/24`: Development stayed `12/12`, holdout stayed `11/12`, and the same tentative-checkout case abstained rather than asking the required clarification. The one-description revision therefore shows **no measured improvement** in this one-trial snapshot. ToolProof presents that result rather than optimizing it away.

**Simulated checkout — no purchase occurs.** There is no payment, inventory, account, messaging, shipment, or external transaction path.

## Why WebMCP Is Essential

WebMCP is the object under test and the execution substrate—not a decorative integration. The visible interface and the agent share one document-owned state store. ToolProof registers real top-level Site Tools, verifies the exact discovered catalog, supports the current native argument representations through one calibrated adapter, propagates cancellation, and binds each consumer call to one canonical handler trace and state effect.

That makes questions possible that a detached API benchmark cannot answer: Did the model select the tool actually available on this page? Did the visible UI update before result delivery? Did a pending-only tool appear at the right lifecycle boundary? Did reset restore both state and catalog? Did a prohibited action occur and later get hidden by compensating state?

## Human + Agent

The workflow preserves genuine human authority. A 24-case package was reviewed and frozen before scored inference. After the baseline, a fresh Repair Builder received only the 12 Development cases—zero holdout prompts, labels, traces, aggregates, or hints—and proposed one revised `checkout_request` description. Sergio reviewed the exact description and one-line source proof before the unchanged 24-case rerun.

Studio shows the frozen contract and human receipt. Lab exposes the deterministic fixture and native trust surface without expected answers. Results reveal the paired traces only after terminal evidence. Direct ChatGPT/Codex Site Tools observations, non-scored calibration, native plumbing, the one-call judge lane, and the scored Custom Probe remain separate evidence namespaces and denominators.

## Challenge-Period Build

The ToolProof name and high-level concept predate the challenge. The public WebMCP product was built during the challenge period: the five-tool checkout domain, lifecycle-safe registry, native adapter, replay-safe operations, verified reset, trace ledger, evidence exports, blinded 24-case protocol, bounded model runner, Results inspector, signed-out judge lane, browser/accessibility suite, security controls, documentation, and release package.

OpenAI Codex assisted with implementation, testing, audits, and collateral. Controlled model decisions use the OpenAI Responses API with GPT-5.6 Terra. Every dependency and adapted upstream component is pinned and attributed; no generated answer is treated as human approval or authentic browser evidence.

## 60-Second Test

1. Open the live Lab signed out in a supported Chrome 149+ WebMCP build. No ToolProof login, judge key, extension, or local setup is required.
2. Confirm `consumer-ready` and the clean four-tool catalog.
3. In **One fixed decision, one verified native read**, run the bounded judge proof.
4. Inspect the sealed model projection and native `cart_get` receipt, or download the complete JSON. The server accepts only its displayed judge-only request and can consume at most one challenge-lifetime judge call; the archive replays without another model request.
5. Open Results and inspect `23/24 → 23/24`, the one-line contract diff, the shared failure, exact state/effect hashes, and limitations.

For the official Site Tools experience, open the same Lab in the latest ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra and ask one of the documented fresh-chat requests. Those observations are reported separately from the scored experiment.

## Implementation

ToolProof uses strict TypeScript, Next.js, and React. A serialized domain/session layer owns fixture state, schemas, idempotency tombstones, mutation admission, cancellation, and reset. A per-tool registry manager drains calls before catalog changes and verifies exact discovery. Append-only traces retain raw and canonical arguments, native results, before/after state, effect diffs, runtime identity, and hashes.

The model-backed boundary is stateless (`store:false`), fixed to one provider/model/settings projection, and permits one decision plus at most one target call. A durable Redis policy caps the entire challenge lifetime at 160 calls and USD `$10`, independent of provider-window resets. Signed single-use authorization, replay/rate/concurrency controls, encrypted permanent receipts, conservative uncertain settlement, origin/body limits, security headers, no source maps, secret scanning, and a dedicated project hard limit keep the public surface narrow.

The signed-out judge lane accepts no prompt, model, schema, URL, tool, or arguments from the browser. Its judge-only request and case identity are source-fixed. The browser executes only a digest-verified empty-argument `cart_get` on a clean, halt-free current catalog. A later release can present the one archived decision only through an actual Git predecessor/successor proof permitting exact HTTPS link fields and zero functional changes.

## Impact

ToolProof turns “the tool call worked” into an evidence-backed semantic regression question. The same approach can apply to editors, dashboards, support consoles, travel planners, and other agent-callable interfaces where equivalent phrasing should preserve behavior and a small intent change should not silently cross an action boundary.

The useful artifact is not a flattering aggregate. It is the combination of a human-approved contract, native page effects, trace-level provenance, separate failure classes, and a reproducible way to compare versions without exposing holdout truth during repair.

## Limitations

- This is one synthetic checkout domain and one provider model.
- Each case has one trial per version, so `23/24 → 23/24` is a demonstration snapshot, not a stability estimate.
- The revision produced no measured improvement.
- The same tentative-checkout holdout failed in both versions.
- Operational blinding is enforced by the product, not by an independent third party or cryptographic protocol.
- Direct Site Tools observations demonstrate the intended experience but do not estimate a rate and are not merged with Custom Probe scores.
- Hashes establish internal consistency, not independent timestamping, model understanding, safety certification, or generality.
- WebMCP and Site Tools availability remain evolving and client-dependent.

## Links

Live app: https://toolproof-rust.vercel.app

Public repository: https://github.com/serg337/toolproof

The approved demo-video URL is added only during the final collateral-only release step after Sergio uploads the verified capture.
