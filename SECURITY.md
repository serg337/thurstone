# Security policy

## Challenge safety boundary

ToolProof is a deterministic simulated checkout/review sandbox. It has no real purchase, payment, account, inventory, email, messaging, or external mutation path. A checkout request creates only a local simulated pending-human-approval state; no WebMCP approval tool exists.

## WebMCP boundary

- Tools are top-level and same-origin only; no `exposedTo` cross-origin grant is used.
- `Permissions-Policy: tools=(self)` and origin isolation are preserved.
- Tool metadata is static, reviewed, concise, and treated as untrusted agent context.
- Inputs are captured into owned descriptor-safe snapshots before queueing, then bounded and validated in handlers; schemas are not authorization.
- Read-only annotations must match actual behavior.
- Mutation operation IDs are document-lifetime replay tombstones; reset cannot make an old ID reusable against a new fixture.
- Cancellation is latched through asynchronous evidence finalization. Duplicate operations, blocked admission, partial mutations, and unexpected failures remain explicitly distinguishable.
- Registry transitions stop new admission, preserve in-flight calls, verify exact discovery, and fail closed or quarantine on bounded lifecycle failure.
- Reset holds operation admission until state, registry, session-summary, archive, and full trace evidence agree.
- The Gate 1 evidence download uses controlled project snapshots and explicit allowlisted runtime projections. Application payloads are synthetic; exact public origin and raw browser user agent are the limited runtime-provenance exception. It never reads or exports cookies, browser history, account data, storage outside ToolProof, live `Window`/ModelContext objects, handlers, signals, controllers, secrets, or environment variables.
- Export fails closed on unfinished native attempts, journal faults/overflow, chain/digest mismatch, oversized output, credential-like material, email addresses, or absolute local paths. The file is downloaded locally through a temporary object URL and is never uploaded automatically.
- One-button proof uses session storage only for a size-bounded, exact-key, build/path/expiry-bound reload request. It consumes the marker before parsing or awaiting, requires a real reload, never derives tool arguments from it, and never exports storage. The runner owns all Lab admission, does not retry native calls, stops on the first mismatch, and requests a download only after strict sequence verification. Because browsers may block programmatic downloads, the UI retains the immutable verified bundle for an identical manual retry and never claims the file was saved.
- Unsupported clients receive an honest explanation and never a polyfilled native result.

## Model-backed lane

The hosted Probe lane is disabled by default. Its approved v0.3 challenge-lifetime policy permits exactly 160 provider attempts: 9 calibration, 72 baseline, 2 Repair Builder, 72 revised, and 5 bounded judge/reference calls. Every granted attempt permanently commits 62,500,000 nano-USD, so 160 grants bind the USD $10 ceiling exactly and a resetting provider window cannot restore ToolProof capacity. Concurrency is one.

The server-only guard uses signed short-lived authorizations and atomic Redis transitions: `ISSUED → IN_FLIGHT → KNOWN | UNCERTAIN`. Policy/counter/authorization/tombstone records have no reset TTL. Only an explicit fresh `GRANTED_NEW` receipt can authorize one future provider request. Ambiguous outcomes retain the reservation and quarantine the guard; critical drift or settlement conflicts halt it. Production routes never initialize missing state.

The first four calibration calls are retained as a separate authentic semantic failure. The fifth call is retained as a separate terminal-invalid infrastructure attempt with no reconstructed semantic row. Two explicitly approved, chained policy migrations preserve the immutable predecessor receipt and every `KNOWN` authorization/provider/settlement/usage record. The v0.3 transition requires the exact idle five-call guard, heterogeneous historical policy/script identities, and the exact predecessor receipt; it changes only the versioned policy/script identities plus calibration/judge limits and writes a distinct permanent replay-safe receipt. It never initializes, reaps, resets, relabels, overwrites, or deletes prior state.

The dedicated claimed durable store, separate random signing and activation secrets, Production-only provider/store credentials, real concurrent Lua verification, and immutable guard receipts are established. The Gate 2 route requires one exact production project/build, operator-pinned policy/Lua/runner/recovery hashes, both chained migration receipts, a valid activation HMAC, an open internally consistent guard, a short-lived HttpOnly Secure SameSite=Strict session, and a constant-time matching CSRF header. Without every binding, all model routes return `503 probe_disabled` and make no inference.

The one authorized calibration launch is not publicly claimable. Activation binds only the SHA-256 of a random 32-byte operator capability. An unlinked same-origin arm route exchanges the raw value in a bounded request body, clears it from the document immediately, atomically binds the operator actor, and returns a fixed-expiry HttpOnly cookie. Invalid capabilities and cookies are rejected before any durable-store read. Operator authority is non-renewing and must retain a positive margin beyond the complete recovery window before a new run anchor can be created.

The active final-calibration issuer chooses only one of four unchanged server-held synthetic requests. It rejects arbitrary prompts, models, settings, manifests, fixtures, URLs, or tools. Runner-owned operation IDs are deterministically bound to signed opaque trial identity and prebound into every mutation schema; the model never obtains an authorization to choose or reuse them. Request bodies are streamed through byte limits, require exact JSON media type and same-origin fetch metadata, and never enter logs. The Responses adapter is stateless (`store:false`, no conversation or previous response), fixed to `gpt-5.6-terra`, permits one provider request with no inference retry, and retains its timeout through body delivery.

Each trial occupies the guard from provider dispatch through native execution, evidence capture, deterministic server-side evaluation, and verified post-reset. Provider and completion responses are AES-GCM sealed into a separate replay-recovery namespace before delivery or settlement, so a lost HTTP response cannot cause another model call. Uncertain dispatch quarantines rather than retries. Before the initial response, the server also writes a fixed-expiry encrypted run index; each sealed row advances it monotonically. A separate signed HttpOnly recovery credential can reissue only the same short-lived session, CSRF value, and opaque continuation after lost browser storage or ordinary session expiry. A per-revision document lease is checked atomically on authorization, grant, native admission, completion, and advancement; duplicate tabs cannot seal a competing row. Expired provider tokens may recover existing durable state but can never create a new native allowance. Recovery cannot extend the run deadline or authorize a second inference/native execution. The Lab carries only opaque ciphertext between fresh documents; prior requests, decisions, results, evaluator truth, and retained-attempt lineage are absent from its DOM, accessibility tree, URL, client chunks, and session storage. Only terminal `/results` reveals attempt-3 rows and the two separately retained prior-attempt lineages; none enters benchmark counts.

Native execution has its own durable single-use admission written immediately before `executeTool()`. A recovered document can never redispatch an already-admitted target action; if the prior document vanished before terminal evidence, the row is preserved as an indeterminate infrastructure failure and cannot pass calibration. Terminal reveal is byte-stable and remains recoverable until the user explicitly acknowledges that the verified evidence file has been saved.

Public status/readiness receipts are CDN-cached briefly to protect the free durable-store command quota. They are diagnostics only and never authorize a call; the future decision path must revalidate Redis atomically for every dispatch.

Only synthetic challenge text and minimal fixture state may reach the disclosed provider. Preview deployments must not receive production provider, Redis-write, signing, or activation credentials.

## Reporting a vulnerability

Until the public repository exists, report a security issue privately to the repository owner. After release, use GitHub private vulnerability reporting if enabled. Do not include live credentials, personal data, or unsafe proof-of-concept payloads in a public issue.

An exposed credential may be revoked immediately to prevent harm. Any incident affecting judged artifacts must be recorded and disclosed; it must not be hidden through a silent release mutation.
