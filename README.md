# ToolProof

> ToolProof tests whether agent actions track declared human-approved meaning rather than superficial wording.

**ToolProof by Invarra — created by Sergio Valencia.**

Status: Gates 0–5 are complete and Gate 6 evidence-product work is in progress. Gate 2 passed authentically at 4/4 on the exact pinned Chrome 151 fallback after every failed attempt, call, cost, receipt, and the expired pre-dispatch authorization tombstone was preserved. The replacement frozen 24-case baseline and unchanged one-description rerun are terminal and acknowledged: both scored `23/24`, with Development `12/12` and Builder-blinded holdout `11/12`. The same tentative-checkout holdout failed both times because the model abstained instead of asking the required clarification, so the measured revision shows **no improvement** in this one-trial snapshot. An earlier baseline and Repair remain immutable **superseded-protocol** evidence and are never merged into the primary Matrix. Public release, video, and Devpost submission are not yet claimed.

**Simulated checkout — no purchase occurs.** ToolProof contains no payment, account, inventory, messaging, or external transaction path. When enabled later, model-backed evaluation may send synthetic prompts to the disclosed provider.

## Current judge path

1. Open `/lab` in the current ChatGPT built-in browser with Site Tools support, or Chrome 149+ with WebMCP testing enabled.
2. Confirm the capability matrix reports `registerTool()` independently from `getTools()` and `executeTool()`.
3. Confirm the initial catalog contains `cart_get`, `order_review`, `cart_update`, and `checkout_request`.
4. Click **Run clean Gate 1 proof and download** once. ToolProof reloads into a fresh document, waits for each exact Registry/Readiness boundary, runs the fixed ten native calls plus one verified reset, records step timing, verifies the strict sequence, and requests one JSON download.
5. If the browser blocks the automatic download, click **Download verified proof again**; it reissues the identical already-verified bytes without rerunning tools.
6. Use the normal UI or direct native controls only for diagnostics. A failure stops the automated sequence without a verified download and offers a clean one-click restart.
7. Open `/results` and confirm model-backed rows appear only after a terminal sealed run; Gate 1 plumbing evidence never populates the semantic result denominator.

Direct native-plumbing controls are deterministic Gate 1 diagnostics, not model-selection evidence.

## Supported-path status

| Capability                                                     | Current status                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Site Tools provider via `document.modelContext.registerTool()` | Implemented and authentically observed on the deployed Chrome 151 path                   |
| In-page discovery via `getTools()`                             | Authentically verified across exact initial/pending/reset catalogs in Chrome 152         |
| In-page execution via `executeTool()`                          | Authentically verified for every active tool, replay/error/reset/cancellation boundaries |
| Direct ChatGPT observations                                    | Not collected                                                                            |
| Judge-accessible model-backed lane                             | Gate 2 fallback passed 4/4; scored execution remains operator- and freeze-gated          |
| Authentic baseline/revised results                             | Terminal and paired: `23/24 → 23/24`; exact traces retained; no measured improvement     |

Mocks, direct domain calls, unit tests, and Playwright's ordinary browser build are never counted as native WebMCP or model-selection evidence.

## Local development

Requirements: Node `22.23.2` and npm `10.9.8` on Linux.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Ordinary browsers can use the human interface and inspect support messaging; they do not receive fake WebMCP behavior.

Core verification:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run verify:publication
```

`npm run durable-store:check`, `npm run probe-controls:integration`, and the operator-only Probe guard commands require a dedicated Redis environment. They perform no provider inference. Missing durable configuration fails closed.

`npm run fallback:smoke:native` uses the exact local Chrome-for-Testing pin for native plumbing only and makes zero provider calls. `npm run fallback:calibrate` is the historical human-gated paid operator command used for the completed Gate 2 run; it refuses to start without exact activation and a hidden one-time capability. Do not rerun it: the calibration allocation is terminal and no v0.6 exists.

`npm run verify:evidence` verifies the canonical public reference package and, when the ignored raw artifacts are supplied locally, recomputes it byte-for-byte from those sealed inputs.

## Architecture

ToolProof uses separate `/studio`, `/lab`, and `/results` documents as distinct trust surfaces. A strict TypeScript domain/session layer owns deterministic state, schema validation, replay-safe operation IDs, reset admission, and document-lifetime tombstones. Normal UI controls and native WebMCP handlers share that store. A per-tool registry manager preserves unchanged registrations, drains in-flight handlers and outer consumer delivery before catalog changes, verifies discovery, and fails closed under lifecycle faults. The native adapter freezes one argument mode with a harmless `cart_get` call and binds each later direct call to exactly one canonical handler trace. Server-only Probe controls reserve one versioned challenge-lifetime call/spend slot before provider dispatch. Stored freezes and scored bundles preserve legacy hash domains while successor runs bind the acknowledged predecessor, prior Repair receipt, cumulative call offsets, and permanently terminated Authoring context. Successor/frozen Studio is read-only and registers no authoring meta-tools.

The calibration browser carries only opaque ciphertext. A one-time server-verified operator capability prevents the public Internet from claiming the sole calibration run; the raw capability is never stored server-side or shipped in public JavaScript. A short-lived signed session is recoverable through a separate fixed-expiry HttpOnly credential and a monotonic encrypted server-side run index. Losing browser storage, crossing the ordinary session TTL, receiving a duplicated tab, or losing an HTTP response cannot create another provider decision or native allowance. Per-document ownership is enforced in the same Redis transitions that issue authorization, begin provider dispatch, admit native execution, seal completion, and advance the index. Recovery never exposes prior requests, decisions, scores, or evidence to the active Lab.

The Lab also owns a document-lifetime proof journal. One local JSON download contains its sanitized Registry/Readiness transitions, native attempt starts/finishes, reset receipts, automated-step timestamps/durations, full trace ledger, state inspection, chained event hashes, and bundle digests. A bounded build/path/time-bound session marker requests one clean reload and is consumed before execution; it is never exported or treated as attestation. Application payloads are synthetic; the exact public origin and raw browser user agent are disclosed only as required runtime provenance. The export reads no account/browser-history data and performs no upload. Hashes prove internal consistency, not external attestation.

See [architecture](docs/architecture.md), [methodology](docs/methodology.md), [testing](docs/testing.md), [challenge requirements](CHALLENGE.md), and [official-source check](docs/OFFICIAL_SOURCE_CHECK.md).

## Evidence and claims

ToolProof measures whether WebMCP behavior remains consistent across requests a human approved as meaning-equivalent and changes appropriately at declared semantic boundaries. It does not prove model understanding, guarantee safety, prevent all unintended actions, or provide a certification.

The public evidence package keeps custom Probe, Direct ChatGPT, calibration, native plumbing, and exploratory observations in separate namespaces and denominators. The scored reference evidence was measured on baseline commit `3431a2b876d058eb562b7e6075570ad05b165ea0` and revised commit `251c44be34456ecc022839da6c8b85fe1c10e1fc`. Post-measurement commit `b5ab0f812b0c0fd39f5372603ff80ac1a4f341a1` changes only four test files; it is disclosed separately and is never called the measured v2 build.

## Ownership, assistance, and license

Sergio Valencia is the individual entrant, repository owner, copyright owner, and prize recipient. The ToolProof name and high-level concept predate the challenge; the public WebMCP implementation is challenge-period work documented in [HACKATHON_BUILD.md](HACKATHON_BUILD.md). Codex assists with implementation, testing, and collateral under Sergio's review and reserved approvals.

Unless otherwise stated, original ToolProof repository material is MIT-licensed by Sergio Valencia. Third-party components and assets remain under the licenses recorded in `THIRD_PARTY_NOTICES.md`.
