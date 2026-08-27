# ToolProof

> ToolProof tests whether agent actions track declared human-approved meaning rather than superficial wording.

**ToolProof by Invarra — created by Sergio Valencia.**

Status: Gate 0 is complete. The Gate 1 five-tool sandbox, dynamic registry, native execution adapter, reset verifier, trace ledger, and one-file native-proof export are locally implemented and deterministically verified; authentic native proof must be rerun on the exact export-enabled deployment. Chrome previously discovered and invoked deployed ToolProof tools, and the production lifetime guard remains verified at zero use. The model-backed lane is disabled; no model-selection run, score, public repository release, or video exists yet.

**Simulated checkout — no purchase occurs.** ToolProof contains no payment, account, inventory, messaging, or external transaction path. When enabled later, model-backed evaluation may send synthetic prompts to the disclosed provider.

## Current judge path

1. Open `/lab` in the current ChatGPT built-in browser with Site Tools support, or Chrome 149+ with WebMCP testing enabled.
2. Confirm the capability matrix reports `registerTool()` independently from `getTools()` and `executeTool()`.
3. Confirm the initial catalog contains `cart_get`, `order_review`, `cart_update`, and `checkout_request`.
4. Use the normal UI or the clearly labeled direct native-plumbing controls to read, update, and review the shared deterministic fixture.
5. Request simulated checkout and confirm `checkout_cancel` appears only while that request is pending; cancel it and verify the four-tool catalog returns.
6. Hard reset and inspect the registry-bound reset verification receipt.
7. Download the Gate 1 proof JSON once to preserve the document&apos;s complete Registry/Readiness timeline, native attempts, reset receipts, and trace ledger.
8. Open `/results` and confirm ToolProof says **No authentic evidence is available** until terminal model-backed runs exist.

Direct native-plumbing controls are deterministic Gate 1 diagnostics, not model-selection evidence.

## Supported-path status

| Capability                                                     | Current status                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Site Tools provider via `document.modelContext.registerTool()` | Implemented and authentically observed on the deployed Chrome 151 path                                     |
| In-page discovery via `getTools()`                             | Exact four/five-tool comparison and canonical registry receipt implemented; fresh deployed proof pending   |
| In-page execution via `executeTool()`                          | One-call object/JSON-string calibration and at-most-once adapter implemented; fresh deployed proof pending |
| Direct ChatGPT observations                                    | Not collected                                                                                              |
| Judge-accessible model-backed lane                             | Disabled until Gate 2; production lifetime guard is initialized and verified at zero calls                 |
| Authentic baseline/revised results                             | No run yet                                                                                                 |

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

`npm run verify:evidence` deliberately fails closed until an authentic frozen-run manifest exists.

## Architecture

ToolProof uses separate `/studio`, `/lab`, and `/results` documents as distinct trust surfaces. A strict TypeScript domain/session layer owns deterministic state, schema validation, replay-safe operation IDs, reset admission, and document-lifetime tombstones. Normal UI controls and native WebMCP handlers share that store. A per-tool registry manager preserves unchanged registrations, drains in-flight handlers before catalog changes, verifies discovery, and fails closed under lifecycle faults. The native adapter freezes one argument mode with a harmless `cart_get` call and binds each later direct call to exactly one canonical handler trace. Server-only Probe controls reserve one immutable challenge-lifetime call/spend slot before any future provider dispatch; public issue/decision routes currently fail closed with inference disabled.

The Lab also owns a document-lifetime proof journal. One local JSON download contains its sanitized Registry/Readiness transitions, native attempt starts/finishes, reset receipts, full trace ledger, state inspection, chained event hashes, and bundle digests. Application payloads are synthetic; the exact public origin and raw browser user agent are disclosed only as required runtime provenance. The export reads no account/browser-history data and performs no upload. Hashes prove internal consistency, not external attestation.

See [architecture](docs/architecture.md), [methodology](docs/methodology.md), [testing](docs/testing.md), [challenge requirements](CHALLENGE.md), and [official-source check](docs/OFFICIAL_SOURCE_CHECK.md).

## Evidence and claims

ToolProof measures whether WebMCP behavior remains consistent across requests a human approved as meaning-equivalent and changes appropriately at declared semantic boundaries. It does not prove model understanding, guarantee safety, prevent all unintended actions, or provide a certification.

The future public evidence package will keep custom Probe, Direct ChatGPT, calibration, native plumbing, and exploratory observations in separate namespaces and denominators.

## Ownership, assistance, and license

Sergio Valencia is the individual entrant, repository owner, copyright owner, and prize recipient. The ToolProof name and high-level concept predate the challenge; the public WebMCP implementation is challenge-period work documented in [HACKATHON_BUILD.md](HACKATHON_BUILD.md). Codex assists with implementation, testing, and collateral under Sergio's review and reserved approvals.

Unless otherwise stated, original ToolProof repository material is MIT-licensed by Sergio Valencia. Third-party components and assets remain under the licenses recorded in `THIRD_PARTY_NOTICES.md`.
