# ToolProof

> ToolProof tests whether agent actions track declared human-approved meaning rather than superficial wording.

**ToolProof by Invarra — created by Sergio Valencia.**

Status: Gate 0 is complete. Gate 1 is implementing the deterministic five-tool sandbox and native execution adapter. Chrome 151 authentically discovered and invoked the deployed `cart_get` provider, and the production lifetime guard is verified at zero use. The model-backed lane remains disabled; no model-selection run, score, public repository release, or video exists yet.

**Simulated checkout — no purchase occurs.** ToolProof contains no payment, account, inventory, messaging, or external transaction path. When enabled later, model-backed evaluation may send synthetic prompts to the disclosed provider.

## Current judge path

1. Open `/lab` in the current ChatGPT built-in browser with Site Tools support, or Chrome 149+ with WebMCP testing enabled.
2. Confirm the capability matrix reports `registerTool()` independently from `getTools()` and `executeTool()`.
3. Use **Read cart in UI** to inspect the deterministic shared-domain result.
4. Invoke the registered `cart_get` tool through the supported Site Tools/Chrome path and compare its native receipt.
5. Open `/results` and confirm ToolProof says **No authentic evidence is available** until terminal model-backed runs exist.

The full 60-second review-versus-checkout path will unlock only after all five sandbox tools and authentic evidence are ready.

## Supported-path status

| Capability                                                     | Current status                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Site Tools provider via `document.modelContext.registerTool()` | Implemented and authentically observed on the deployed Chrome 151 path                     |
| In-page discovery via `getTools()`                             | Feature-detected; target-runtime verification pending                                      |
| In-page execution via `executeTool()`                          | Narrow compatibility boundary planned; argument mode not yet frozen                        |
| Direct ChatGPT observations                                    | Not collected                                                                              |
| Judge-accessible model-backed lane                             | Disabled until Gate 2; production lifetime guard is initialized and verified at zero calls |
| Authentic baseline/revised results                             | No run yet                                                                                 |

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

ToolProof uses separate `/studio`, `/lab`, and `/results` documents as distinct trust surfaces. A strict TypeScript domain layer owns the deterministic fixture and state transitions. Normal UI controls and native WebMCP handlers call the same functions. A central registry manager owns registration promises and abort controllers so React StrictMode cannot silently double-register a tool. Server-only Probe controls reserve one immutable challenge-lifetime call/spend slot before any future provider dispatch; public issue/decision routes currently fail closed with inference disabled.

See [architecture](docs/architecture.md), [methodology](docs/methodology.md), [testing](docs/testing.md), [challenge requirements](CHALLENGE.md), and [official-source check](docs/OFFICIAL_SOURCE_CHECK.md).

## Evidence and claims

ToolProof measures whether WebMCP behavior remains consistent across requests a human approved as meaning-equivalent and changes appropriately at declared semantic boundaries. It does not prove model understanding, guarantee safety, prevent all unintended actions, or provide a certification.

The future public evidence package will keep custom Probe, Direct ChatGPT, calibration, native plumbing, and exploratory observations in separate namespaces and denominators.

## Ownership, assistance, and license

Sergio Valencia is the individual entrant, repository owner, copyright owner, and prize recipient. The ToolProof name and high-level concept predate the challenge; the public WebMCP implementation is challenge-period work documented in [HACKATHON_BUILD.md](HACKATHON_BUILD.md). Codex assists with implementation, testing, and collateral under Sergio's review and reserved approvals.

Unless otherwise stated, original ToolProof repository material is MIT-licensed by Sergio Valencia. Third-party components and assets remain under the licenses recorded in `THIRD_PARTY_NOTICES.md`.
