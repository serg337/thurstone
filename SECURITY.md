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

The hosted Probe lane is disabled by default. Its migrated v0.5 challenge-lifetime policy permits exactly 160 provider attempts: 17 calibration, 70 baseline, 2 Repair Builder, 70 revised, and 1 bounded judge/reference call. Every granted attempt permanently commits 62,500,000 nano-USD, so 160 grants bind the USD $10 ceiling exactly and a resetting provider window cannot restore ToolProof capacity. Concurrency is one.

The server-only guard uses signed short-lived authorizations and atomic Redis transitions: `ISSUED → IN_FLIGHT → KNOWN | UNCERTAIN`. Policy/counter/authorization/tombstone records have no reset TTL. Only an explicit fresh `GRANTED_NEW` receipt can authorize one future provider request. Ambiguous outcomes retain the reservation and quarantine the guard; critical drift or settlement conflicts halt it. Production routes never initialize missing state.

The first four calibration calls are retained as a separate authentic 0/4 semantic failure. The fifth call is retained as a separate terminal-invalid infrastructure attempt with no reconstructed semantic row. Calls six through nine form the sealed third/final preferred attempt, which is also an authentic 0/4 semantic failure. “Sealed” means the evidence is complete and immutable; it does not mean the Gate 2 acceptance criterion passed. Two explicitly approved, chained policy migrations preserve the immutable predecessor receipt and every `KNOWN` authorization/provider/settlement/usage record. The v0.3 transition required the exact idle five-call guard, heterogeneous historical policy/script identities, and the exact predecessor receipt; it changed only the versioned policy/script identities plus calibration/judge limits and wrote a distinct permanent replay-safe receipt. It never initialized, reaped, reset, relabeled, overwrote, or deleted prior state.

The dedicated claimed durable store, separate random signing and activation secrets, Production-only provider/store credentials, real concurrent Lua verification, and immutable guard receipts are established. The Gate 2 route requires one exact production project/build, operator-pinned policy/Lua/runner/recovery hashes, both chained migration receipts, a valid activation HMAC, an open internally consistent guard, a short-lived HttpOnly Secure SameSite=Strict session, and a constant-time matching CSRF header. Without every binding, all model routes return `503 probe_disabled` and make no inference.

The one authorized calibration launch is not publicly claimable. Activation binds only the SHA-256 of a random 32-byte operator capability. An unlinked same-origin arm route exchanges the raw value in a bounded request body, clears it from the document immediately, atomically binds the operator actor, and returns a fixed-expiry HttpOnly cookie. Invalid capabilities and cookies are rejected before any durable-store read. Operator authority is non-renewing and must retain a positive margin beyond the complete recovery window before a new run anchor can be created.

The active final-calibration issuer chooses only one of four unchanged server-held synthetic requests. It rejects arbitrary prompts, models, settings, manifests, fixtures, URLs, or tools. Runner-owned operation IDs are deterministically bound to signed opaque trial identity and prebound into every mutation schema; the model never obtains an authorization to choose or reuse them. Request bodies are streamed through byte limits, require exact JSON media type and same-origin fetch metadata, and never enter logs. The Responses adapter is stateless (`store:false`, no conversation or previous response), fixed to `gpt-5.6-terra`, permits one provider request with no inference retry, and retains its timeout through body delivery.

Each trial occupies the guard from provider dispatch through native execution, evidence capture, deterministic server-side evaluation, and verified post-reset. Provider and completion responses are AES-GCM sealed into a separate replay-recovery namespace before delivery or settlement, so a lost HTTP response cannot cause another model call. Uncertain dispatch quarantines rather than retries. Before the initial response, the server also writes a fixed-expiry encrypted run index; each sealed row advances it monotonically. A separate signed HttpOnly recovery credential can reissue only the same short-lived session, CSRF value, and opaque continuation after lost browser storage or ordinary session expiry. A per-revision document lease is checked atomically on authorization, grant, native admission, completion, and advancement; duplicate tabs cannot seal a competing row. Expired provider tokens may recover existing durable state but can never create a new native allowance. Recovery cannot extend the run deadline or authorize a second inference/native execution. The Lab carries only opaque ciphertext between fresh documents; prior requests, decisions, results, evaluator truth, and retained-attempt lineage are absent from its DOM, accessibility tree, URL, client chunks, and session storage. Only terminal `/results` reveals the current four rows and separately retained historical lineages; calibration evidence never enters benchmark counts.

Native execution has its own durable single-use admission written immediately before `executeTool()`. A recovered document can never redispatch an already-admitted target action; if the prior document vanished before terminal evidence, the row is preserved as an indeterminate infrastructure failure and cannot pass calibration. Terminal reveal is byte-stable and remains recoverable until the user explicitly acknowledges that the verified evidence file has been saved. After the human gate, the operator runner uses the fixed recovery credential to obtain a fresh short session and renew exact terminal document ownership before acknowledgement, so evidence-review time cannot strand encrypted recovery data.

The preferred Gate 2 path is exhausted at 0/4. The first pinned GoogleChromeLabs fallback attempt remains immutable authentic 3/4 evidence. After its post-trial reset defect was reproduced and repaired without a provider call, the final v0.5 attempt completed separately at authentic 4/4 and was acknowledged; Gate 2 is complete and the calibration guard is terminal. There is no v0.6 or calibration rerun.

The v0.5 policy uses `17 calibration / 70 baseline / 2 Repair Builder / 70 revised / 1 judge`, still exactly 160 calls and USD $10. Its migration preserved the complete v0.2→v0.4 receipt chain, every known call/cost, acknowledged run data, and the separately labeled expired pre-dispatch authorization tombstone without deleting, relabeling, refunding, or counting that tombstone as a call. The scored allocation fixes one trial per case and version, disclosed as a demonstration snapshot rather than stability evidence.

The first 24-case baseline and its first Repair call are permanently retained but superseded because a disabled v2 deployment exposed a source-versioning defect before revised inference. Successor Gate 3 lineage must reconstruct the original freeze, acknowledged full baseline, exact Repair receipt and KNOWN ledger record, cumulative offsets `24/1/0`, and unchanged semantic target/runner/evaluator projections before another baseline can start. The original Authoring Builder remains terminated; successor and frozen Studio expose no authoring tools. Any incomplete lineage fails closed.

The fallback runner is bound to GoogleChromeLabs `webmcp-tools` commit `bcb6e93939d7fcf05747ccde913ed77a688e3b94`, `puppeteer-core@25.4.0`, Chrome for Testing `151.0.7922.47` linux64 archive/executable hashes, one fresh process/profile per trial, CDP, the sole WebMCP feature flag, same-origin requests, and termination on any additional browser target. Version 1.1 additionally binds the Lab adapter, native bridge, trial runner, evidence, and unchanged browser runtime into the runner hash. Its server routes fail closed unless the exact v0.5 migration and activation bindings exist. The paid command requires that frozen runner hash plus an interactively entered one-time capability; it is never called by builds, tests, deployment hooks, or smoke verification. The verifier retains a separate frozen path for the old v1 3/4 bundle.

Public status/readiness receipts are CDN-cached briefly to protect the free durable-store command quota. They are diagnostics only and never authorize a call; the future decision path must revalidate Redis atomically for every dispatch.

### Signed-out judge lane

The public judge lane consumes only the final `judge:1` allocation. Its strict POST body contains one fixed intent token and no prompt, arguments, model, settings, manifest, schema, URL, or tool choice. Same-origin fetch metadata, exact JSON media type, streamed 128-byte limit, Production project/commit binding, the immutable primary-count boundary, and the complete lifetime call/spend policy are revalidated before issuance and dispatch.

A permanent AES-GCM singleton authorization anchor is written before common-ledger issuance, so a concurrent public burst can materialize only one JTI, subject, actor, claims hash, and rate-key footprint. Atomic `BEGIN` then records the sole in-flight JTI and bounded lease in the existing guard. The complete encrypted provider receipt is captured without TTL before known settlement. Captured known receipts settle and seal idempotently without another request. A lost process with an expired in-flight lease is conservatively settled uncertain and permanently closes the lane; no browser retry can redispatch. Public errors are allowlisted codes, and the sanitized archive omits authorization IDs, safety identifiers, raw request/response bytes, provider request IDs, and secrets.

The sole provider decision is permanently sealed on evidence root `e2cf8d47375abfeeb4f32bd6f5973918acf4c091` and selected `cart_get` with `{}`. During readback, Upstash's SDK automatically deserialized the stored projection JSON; the archive reader's string-only assumption rejected that otherwise valid value. The permanent encrypted record, guard counters, and accounted cost were not changed. Recovery performs zero provider retries and zero durable-store rewrites: it only accepts either wire representation before applying the same strict schema and digest checks.

The browser can execute only a digest-verified `cart_get` decision on the exact clean, halt-free initial fixture and current consumer-ready native catalog. Provider evidence survives a wrong/no-call or native failure without being relabeled as a completed browser proof. Native evidence from the evidence root is not inherited by a later build; the recovery deployment must perform and retain a fresh current-build native replay. Gate 7 passes only when the live receipt verifies that replay with the recovered archive; source prose does not preclaim that deployment-bound result. An optional Gate 9 collateral-only release may add one exact link-only hop after the recovery transition; neither hop receives another provider grant.

Only synthetic challenge text and minimal fixture state may reach the disclosed provider. Preview deployments must not receive production provider, Redis-write, signing, or activation credentials.

## Publication and local-path boundary

The publication verifier scans the current tracked tree, every reachable commit, commit messages,
and tags for user/workspace-root path material. The current candidate contains no such operational
or artifact path. Reachable history contains exactly 92 occurrences from three byte-hashed blobs:
two canonical workspace-root strings used only as negative fixtures by the evidence privacy
verifier, plus synthetic POSIX/Windows example-user paths used only to prove export rejection. The
scanner binds the exact commits, blob object IDs, blob SHA-256 values, paths, line hashes, and token
hashes; any additional occurrence fails publication.

These fixtures do not point to a file used by ToolProof, contain no username, credential, private
content, or dependency, and never appear in evidence, documentation, deployment output, or runtime
configuration. The current verifier constructs generic root-pattern checks without retaining the
historical workspace strings. Preserving the narrowly classified negative fixtures avoids
rewriting authentic deployment/observation lineage while maintaining a fail-closed actual-leak
boundary.

## Reporting a vulnerability

Until the public repository exists, report a security issue privately to the repository owner. After release, use GitHub private vulnerability reporting if enabled. Do not include live credentials, personal data, or unsafe proof-of-concept payloads in a public issue.

An exposed credential may be revoked immediately to prevent harm. Any incident affecting judged artifacts must be recorded and disclosed; it must not be hidden through a silent release mutation.
