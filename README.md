# ToolProof

> ToolProof tests whether agent actions track declared human-approved meaning rather than superficial wording.

**ToolProof by Invarra — created by Sergio Valencia.**

Live app: https://toolproof-rust.vercel.app

Public repository: https://github.com/serg337/toolproof

The versioned release and verified demo-video links are added only in the final collateral-only Gate 9 commit after Sergio's approval.

Status: Gates 0–6 are complete and Gate 7 security, browser, accessibility, judge-path, and Direct Site Tools verification is in progress. Gate 2 passed authentically at 4/4 on the exact pinned Chrome 151 fallback after every failed attempt, call, cost, receipt, and the expired pre-dispatch authorization tombstone was preserved. The replacement frozen 24-case baseline and unchanged one-description rerun are terminal and acknowledged: both scored `23/24`, with Development `12/12` and Builder-blinded holdout `11/12`. The same tentative-checkout holdout failed both times because the model abstained instead of asking the required clarification, so the measured revision shows **no improvement** in this one-trial snapshot. An earlier baseline and Repair remain immutable **superseded-protocol** evidence and are never merged into the primary Matrix. Public release, video, and Devpost submission are not yet claimed.

**Simulated checkout — no purchase occurs.** ToolProof contains no payment, account, inventory, messaging, or external transaction path. The bounded model-backed judge lane may send its one fixed synthetic request to OpenAI; it accepts no public prompt, key, model, schema, URL, or tool choice.

## Current judge path

1. Open `/lab` signed out in a supported Chrome 149+ WebMCP build; no ToolProof login, key, extension, or local setup is required.
2. Confirm the capability matrix reaches `consumer-ready` with the exact initial catalog: `cart_get`, `cart_update`, `checkout_request`, and `order_review`.
3. In **One fixed decision, one verified native read**, click **Run bounded model decision + native cart_get**. The server accepts only the displayed fixed cart-read intent and can consume at most the single challenge-lifetime judge allocation.
4. Inspect the sealed model projection and current native receipt. Download the complete judge proof JSON; after the call, the same decision remains replayable without another model request.
5. Open `/results` to inspect the separate 24-case baseline/revised evidence, exact `23/24 → 23/24` result, one-description diff, complete traces, and limitations.
6. For the official Site Tools path, open the same Lab in the latest ChatGPT desktop built-in browser with GPT-5.6 Sol or Terra. Direct observations are recorded separately from the judge lane and scored denominator.

Direct native-plumbing controls are deterministic Gate 1 diagnostics, not model-selection evidence.

## Supported-path status

| Capability                                                     | Current status                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Site Tools provider via `document.modelContext.registerTool()` | Implemented and authentically observed on the deployed Chrome 151 path                   |
| In-page discovery via `getTools()`                             | Authentically verified across exact initial/pending/reset catalogs in Chrome 152         |
| In-page execution via `executeTool()`                          | Authentically verified for every active tool, replay/error/reset/cancellation boundaries |
| Direct ChatGPT/Codex Site Tools observations                   | Gate 7 collection pending; never merged into the scored denominator                      |
| Judge-accessible model-backed lane                             | One fixed signed-out read case; one durable global call; sealed replay uses no judge key |
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
npm run gate7:verify-adversarial
npm run verify:sample-evidence
npm run build
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
npm run verify:publication
```

`npm run durable-store:check`, `npm run probe-controls:integration`, and the operator-only Probe guard commands require a dedicated Redis environment. They perform no provider inference. Missing durable configuration fails closed.

`npm run fallback:smoke:native` uses the exact local Chrome-for-Testing pin for native plumbing only and makes zero provider calls. `npm run fallback:calibrate` is the historical human-gated paid operator command used for the completed Gate 2 run; it refuses to start without exact activation and a hidden one-time capability. Do not rerun it: the calibration allocation is terminal and no v0.6 exists.

`npm run verify:evidence` verifies the canonical public reference package and, when the ignored raw artifacts are supplied locally, recomputes it byte-for-byte from those sealed inputs.

### Hosted environment names

The application builds and serves the deterministic UI without a model key. Production-only model and durable controls use host secret/config storage; values must never enter Git, client bundles, logs, screenshots, examples, or command arguments.

| Name                                                                                                                    | Purpose                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                                                                        | Dedicated restricted OpenAI project key; Sensitive and Production-only                |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`                                                                                  | Production-only durable guard and encrypted evidence store                            |
| `TOOLPROOF_SIGNING_SECRET`                                                                                              | Base64url encoding of exactly 32 random bytes for signed/encrypted server artifacts   |
| `TOOLPROOF_GUARD_INSTANCE_ID`, `TOOLPROOF_GUARD_INITIALIZED_COMMIT`                                                     | Immutable lifetime-guard identity                                                     |
| `TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID`, `TOOLPROOF_COMMIT_SHA`                                                          | Exact deployment/project identity checks                                              |
| `TOOLPROOF_JUDGE_LANE_MODE`, `TOOLPROOF_JUDGE_ACTIVE_COMMIT`                                                            | Enables only the exact reviewed judge build                                           |
| `TOOLPROOF_JUDGE_PRESENTATION_MODE`                                                                                     | `predecessor` on the evidence build; `successor` only on the proven link-only release |
| `TOOLPROOF_JUDGE_PRESENTATION_BINDING_B64`, `TOOLPROOF_JUDGE_PRESENTATION_BINDING_HASH`, `TOOLPROOF_JUDGE_GIT_PACK_B64` | Provider-free predecessor/successor archive proof; absent on the evidence build       |

The historical Probe/scored operator variables are documented by name in [`.env.example`](.env.example) and remain absent during ordinary runtime. Preview deployments receive no Production provider, Redis-write, signing, activation, or judge credentials and fail closed.

## Architecture

ToolProof uses separate `/studio`, `/lab`, and `/results` documents as distinct trust surfaces. A strict TypeScript domain/session layer owns deterministic state, schema validation, replay-safe operation IDs, reset admission, and document-lifetime tombstones. Normal UI controls and native WebMCP handlers share that store. A per-tool registry manager preserves unchanged registrations, drains in-flight handlers and outer consumer delivery before catalog changes, verifies discovery, and fails closed under lifecycle faults. The native adapter freezes one argument mode with a harmless `cart_get` call and binds each later direct call to exactly one canonical handler trace. Server-only Probe controls reserve one versioned challenge-lifetime call/spend slot before provider dispatch. Stored freezes and scored bundles preserve legacy hash domains while successor runs bind the acknowledged predecessor, prior Repair receipt, cumulative call offsets, and permanently terminated Authoring context. Successor/frozen Studio is read-only and registers no authoring meta-tools.

The calibration browser carries only opaque ciphertext. A one-time server-verified operator capability prevents the public Internet from claiming the sole calibration run; the raw capability is never stored server-side or shipped in public JavaScript. A short-lived signed session is recoverable through a separate fixed-expiry HttpOnly credential and a monotonic encrypted server-side run index. Losing browser storage, crossing the ordinary session TTL, receiving a duplicated tab, or losing an HTTP response cannot create another provider decision or native allowance. Per-document ownership is enforced in the same Redis transitions that issue authorization, begin provider dispatch, admit native execution, seal completion, and advance the index. Recovery never exposes prior requests, decisions, scores, or evidence to the active Lab.

The public judge lane is a smaller, separate boundary. Its POST body is a fixed intent token rather than a prompt; the server owns the judge-only synthetic request, exact fixture, four-tool manifest, model/settings, and one-call ceiling. One AES-GCM singleton anchor ensures a concurrent public burst can create only one authorization/subject/rate footprint before the existing lifetime guard atomically reserves purpose `judge`. A separate permanent namespace encrypts the complete provider receipt before known settlement, and interrupted dispatch closes rather than retries. Only a digest-bound sanitized projection reaches the browser. The Lab re-verifies the current native catalog and executes only a returned empty-argument `cart_get`; provider-only evidence remains visible if native verification cannot complete. A later collateral-only release may replay the archive only through an exact predecessor/successor presentation proof and never through a second model call.

The Lab also owns a document-lifetime proof journal. One local JSON download contains its sanitized Registry/Readiness transitions, native attempt starts/finishes, reset receipts, automated-step timestamps/durations, full trace ledger, state inspection, chained event hashes, and bundle digests. A bounded build/path/time-bound session marker requests one clean reload and is consumed before execution; it is never exported or treated as attestation. Application payloads are synthetic; the exact public origin and raw browser user agent are disclosed only as required runtime provenance. The export reads no account/browser-history data and performs no upload. Hashes prove internal consistency, not external attestation.

See [architecture](docs/architecture.md), [methodology](docs/methodology.md), [testing](docs/testing.md), [challenge requirements](CHALLENGE.md), and [official-source check](docs/OFFICIAL_SOURCE_CHECK.md).

## Evidence and claims

ToolProof measures whether WebMCP behavior remains consistent across requests a human approved as meaning-equivalent and changes appropriately at declared semantic boundaries. It does not prove model understanding, guarantee safety, prevent all unintended actions, or provide a certification.

The public evidence package keeps custom Probe, Direct Site Tools, calibration, native plumbing, the one-call judge lane, and exploratory observations in separate namespaces and denominators. The scored reference evidence was measured on baseline commit `3431a2b876d058eb562b7e6075570ad05b165ea0` and revised commit `251c44be34456ecc022839da6c8b85fe1c10e1fc`. Post-measurement commit `b5ab0f812b0c0fd39f5372603ff80ac1a4f341a1` changes only four test files; it is disclosed separately and is never called the measured v2 build.

## Ownership, assistance, and license

Sergio Valencia is the individual entrant, repository owner, copyright owner, and prize recipient. The ToolProof name and high-level concept predate the challenge; the public WebMCP implementation is challenge-period work documented in [HACKATHON_BUILD.md](HACKATHON_BUILD.md). Codex assists with implementation, testing, and collateral under Sergio's review and reserved approvals.

Unless otherwise stated, original ToolProof repository material is MIT-licensed by Sergio Valencia. Third-party components and assets remain under the licenses recorded in `THIRD_PARTY_NOTICES.md`.
