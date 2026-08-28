# ToolProof

> ToolProof tests whether agent actions track declared human-approved meaning rather than superficial wording.

**ToolProof by Invarra — created by Sergio Valencia.**

Status: Gates 0 and 1 are complete with an authentic Chrome native-proof bundle. Gate 2 is not complete. Three preferred-path failures remain separately retained, and the first exact-pinned GoogleChromeLabs fallback attempt is immutable authentic 3/4 evidence. Its fourth case selected the correct tool but lost native evidence during a now-repaired post-trial reset; the exact repair passes a zero-provider Chrome 151 `checkout_request` receipt/trace/reset reproducer. A final v0.5/fallback-v1.1 candidate preserves all 13 historical calls and proposes one last full four-case attempt under `17/70/2/70/1`, the unchanged 160-call/USD $10 ceilings, and a categorical no-v0.6 stop. No v0.5 migration, activation, final provider call, scored request, public repository release, or video is claimed yet.

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
| Judge-accessible model-backed lane                             | Preferred path terminal at sealed 0/4; reviewed fallback candidate remains inactive      |
| Authentic baseline/revised results                             | No run yet                                                                               |

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

`npm run fallback:smoke:native` uses the exact local Chrome-for-Testing pin for native plumbing only and makes zero provider calls. `npm run fallback:calibrate` is a human-gated paid operator command: it refuses to start without the exact frozen runner-hash confirmation and then reads the one-time capability through a hidden TTY prompt. After evidence is saved and the human approves `ACK`, it recovers a fresh short session before deleting encrypted recovery data. Do not run it unless the v0.5 migration, activation/deployment, and exactly four final calibration calls have been separately approved.

`npm run verify:evidence` deliberately fails closed until an authentic frozen-run manifest exists.

## Architecture

ToolProof uses separate `/studio`, `/lab`, and `/results` documents as distinct trust surfaces. A strict TypeScript domain/session layer owns deterministic state, schema validation, replay-safe operation IDs, reset admission, and document-lifetime tombstones. Normal UI controls and native WebMCP handlers share that store. A per-tool registry manager preserves unchanged registrations, drains in-flight handlers and outer consumer delivery before catalog changes, verifies discovery, and fails closed under lifecycle faults. The native adapter freezes one argument mode with a harmless `cart_get` call and binds each later direct call to exactly one canonical handler trace. Server-only Probe controls reserve one versioned challenge-lifetime call/spend slot before provider dispatch. Three preferred attempts remain separate immutable evidence, and the first pinned fallback attempt remains an authentic 3/4 infrastructure failure. Its failed `checkout_request` cleanup path now passes an exact zero-provider native reproducer, but Gate 2 remains incomplete until a separately authorized final four-case run completes end to end.

The calibration browser carries only opaque ciphertext. A one-time server-verified operator capability prevents the public Internet from claiming the sole calibration run; the raw capability is never stored server-side or shipped in public JavaScript. A short-lived signed session is recoverable through a separate fixed-expiry HttpOnly credential and a monotonic encrypted server-side run index. Losing browser storage, crossing the ordinary session TTL, receiving a duplicated tab, or losing an HTTP response cannot create another provider decision or native allowance. Per-document ownership is enforced in the same Redis transitions that issue authorization, begin provider dispatch, admit native execution, seal completion, and advance the index. Recovery never exposes prior requests, decisions, scores, or evidence to the active Lab.

The Lab also owns a document-lifetime proof journal. One local JSON download contains its sanitized Registry/Readiness transitions, native attempt starts/finishes, reset receipts, automated-step timestamps/durations, full trace ledger, state inspection, chained event hashes, and bundle digests. A bounded build/path/time-bound session marker requests one clean reload and is consumed before execution; it is never exported or treated as attestation. Application payloads are synthetic; the exact public origin and raw browser user agent are disclosed only as required runtime provenance. The export reads no account/browser-history data and performs no upload. Hashes prove internal consistency, not external attestation.

See [architecture](docs/architecture.md), [methodology](docs/methodology.md), [testing](docs/testing.md), [challenge requirements](CHALLENGE.md), and [official-source check](docs/OFFICIAL_SOURCE_CHECK.md).

## Evidence and claims

ToolProof measures whether WebMCP behavior remains consistent across requests a human approved as meaning-equivalent and changes appropriately at declared semantic boundaries. It does not prove model understanding, guarantee safety, prevent all unintended actions, or provide a certification.

The future public evidence package will keep custom Probe, Direct ChatGPT, calibration, native plumbing, and exploratory observations in separate namespaces and denominators.

## Ownership, assistance, and license

Sergio Valencia is the individual entrant, repository owner, copyright owner, and prize recipient. The ToolProof name and high-level concept predate the challenge; the public WebMCP implementation is challenge-period work documented in [HACKATHON_BUILD.md](HACKATHON_BUILD.md). Codex assists with implementation, testing, and collateral under Sergio's review and reserved approvals.

Unless otherwise stated, original ToolProof repository material is MIT-licensed by Sergio Valencia. Third-party components and assets remain under the licenses recorded in `THIRD_PARTY_NOTICES.md`.
