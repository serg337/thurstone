# Security policy

## Challenge safety boundary

ToolProof is a deterministic simulated checkout/review sandbox. It has no real purchase, payment, account, inventory, email, messaging, or external mutation path. A checkout request will eventually create only a local simulated pending-human-approval state; no WebMCP approval tool exists.

## WebMCP boundary

- Tools are top-level and same-origin only; no `exposedTo` cross-origin grant is used.
- `Permissions-Policy: tools=(self)` and origin isolation are preserved.
- Tool metadata is static, reviewed, concise, and treated as untrusted agent context.
- Inputs are bounded and validated in handlers; schemas are not authorization.
- Read-only annotations must match actual behavior.
- Cancellation, duplicate operations, partial mutations, and unexpected failures must remain trace-visible.
- Unsupported clients receive an honest explanation and never a polyfilled native result.

## Model-backed lane

The hosted Probe lane is disabled. Its frozen challenge-lifetime policy permits exactly 160 provider attempts: 4 calibration, 72 baseline, 2 Repair Builder, 72 revised, and 10 bounded judge/reference calls. Every granted attempt permanently commits 62,500,000 nano-USD, so 160 grants bind the USD $10 ceiling exactly and a resetting provider window cannot restore ToolProof capacity. Concurrency is one.

The server-only guard uses signed short-lived authorizations and atomic Redis transitions: `ISSUED → IN_FLIGHT → KNOWN | UNCERTAIN`. Policy/counter/authorization/tombstone records have no reset TTL. Only an explicit fresh `GRANTED_NEW` receipt can authorize one future provider request. Ambiguous outcomes retain the reservation and quarantine the guard; critical drift or settlement conflicts halt it. Production routes never initialize missing state.

The dedicated claimed durable store, random signing secret, Production-only provider/store credentials, real concurrent Lua verification, and immutable zero-use guard receipt are established. Activation remains forbidden until Gate 2 adds fixed case/manifest/model allowlists, session-bound CSRF, streamed body limits, safe redaction, and a terminal activation receipt. `/api/probe/issue` and `/api/probe/decide` currently return `503 probe_disabled` and make no inference.

Public status/readiness receipts are CDN-cached briefly to protect the free durable-store command quota. They are diagnostics only and never authorize a call; the future decision path must revalidate Redis atomically for every dispatch.

The active lane will accept no arbitrary public prompt, model, manifest, URL, code, or external action. Only synthetic challenge text and minimal fixture state may reach the disclosed provider. Preview deployments must not receive production provider, Redis-write, or signing credentials.

## Reporting a vulnerability

Until the public repository exists, report a security issue privately to the repository owner. After release, use GitHub private vulnerability reporting if enabled. Do not include live credentials, personal data, or unsafe proof-of-concept payloads in a public issue.

An exposed credential may be revoked immediately to prevent harm. Any incident affecting judged artifacts must be recorded and disclosed; it must not be hidden through a silent release mutation.
