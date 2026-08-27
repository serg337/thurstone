# Architecture

ToolProof separates authoring, execution, and results into three top-level documents so expected answers and repair hints do not share the active Lab trust surface.

```text
/studio   draft, human review, freeze, phase-specific meta-tools
/lab      deterministic sandbox and state-appropriate target tools only
/results  post-unlock sealed evidence, inspector, exports, repair controls
```

## Shared deterministic domain

The checkout fixture and domain functions are strict TypeScript modules behind one serialized session store. Normal UI controls and native WebMCP handlers call that same store. `cart_get` returns only line-item identity and quantity; the non-overlapping `order_review` tool owns prices, totals, shipping, and delivery framing.

Every mutation requires a bounded operation ID. The same ID and canonical command replay the original terminal receipt without another effect; conflicting reuse fails. Document-lifetime tombstones survive fixture reset so a late retry cannot mutate a fresh fixture. Checkout can only enter or leave a simulated pending-human-approval state.

## Native WebMCP

The Lab feature-detects provider registration separately from in-page discovery and execution. A central per-tool registry manager owns registration promises and `AbortController` lifecycles. It preserves unchanged tool identities, blocks new admission while transitioning, drains in-flight handlers, and verifies the exact discovered catalog. The document-scoped Lab environment preserves handler identities across same-document route remounts.

The official ambient type package currently lacks `executeTool()`, while the draft and Chrome guide differ on object versus JSON-string arguments. ToolProof keeps this difference behind one narrow adapter. It detects one mode with exactly one harmless read-only `cart_get` call, freezes that mode for the document, owns a data-only snapshot of every later input, consumes each execution ID before asynchronous work, and never retries with another representation.

Chrome 151's `getTools()` descriptor serializes `inputSchema`. Discovery parses that representation once and then requires the schema content, title, description, and annotations to match the provider declaration exactly.

Readiness keeps the active tool-registry hash separate from the fixture state hash. The registry hash covers the state-appropriate metadata, annotations, handler/domain/toolset versions, and application commit; ordinary quantity changes therefore do not masquerade as registry changes. Each direct native adapter receipt binds raw/canonical result, trace ID, before/after state, effect digest, and the registry used at dispatch.

A document-owned Gate 1 proof journal records explicit Registry statuses, sanitized Readiness receipts, native attempt starts/finishes, and reset outcomes across same-document route remounts. It never serializes live `Window`, ModelContext, handler, signal, store, or controller objects. Export seals the journal into a SHA-256 chain and combines it with the full trace ledger, state inspection, archives, current receipts, commit, origin, and runtime identity in one local JSON download. Full reload intentionally starts a new proof document.

## Reset and trace boundary

Reset temporarily closes session admission, drains prior work through the serialized store, archives the old trajectory, restores exact fixture bytes, reconciles the initial catalog, and verifies both session summaries and full canonical trace-ledger evidence before releasing admission. An invalid or interrupted verification cannot start a trial.

Raw input is captured at public method entry before queueing or validation. Descriptor-safe normalization does not invoke ordinary getters and retains otherwise non-JSON structure as tagged evidence. Canonical arguments remain separate. Cancellation is latched through asynchronous trace finalization; post-result cancellation and post-state-commit cancellation are recorded separately.

## Probe and evaluator boundary

The preferred Probe is a bounded server-assisted model decision plus in-page native execution. The model receives one natural-language request, minimum fixture synopsis, live state-appropriate catalog, and a frozen generic instruction. It receives no expectations, family/subset labels, prior result, or repair hint.

Evaluator truth remains outside the Lab and model request. A server-issued signed single-use envelope binds opaque run/case/trial, session, build, fixture, request, settings, and manifest hashes. A stable Redis namespace enforces an immutable 160-attempt/USD $10 lifetime policy across deployments and provider resets. Each granted call permanently consumes one slot and $0.0625 of admission capacity; uncertain outcomes quarantine rather than refund. The public status route is diagnostic, while issue/decision routes stay disabled until the remaining Gate 2 allowlist, CSRF, bounded-body, provider, and live-store checks pass.

## Evidence

Raw model bytes, parsed decision, raw/canonical arguments, native result, before/after state bytes, effect diff, runtime identity, and deterministic score remain separate layers joined by canonical hashes and terminal receipts. The Gate 1 bundle is explicitly native-plumbing evidence, never model-selection, semantic-scoring, or Direct ChatGPT evidence. Hashes establish internal consistency; they are not independent attestation.
