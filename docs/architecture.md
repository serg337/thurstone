# Architecture

ToolProof separates authoring, execution, and results into three top-level documents so expected answers and repair hints do not share the active Lab trust surface.

```text
/studio   draft, human review, freeze, phase-specific meta-tools
/lab      deterministic sandbox and state-appropriate target tools only
/results  post-unlock sealed evidence, inspector, exports, repair controls
```

## Shared deterministic domain

The checkout fixture and domain functions are strict TypeScript modules. Normal UI controls and native WebMCP handlers call the same functions. `cart_get` returns only line-item identity and quantity; totals and final-order framing belong to the future non-overlapping `order_review` tool.

Every mutation added in Gate 1 will require a stable operation ID and either apply exactly once or return an explicit duplicate receipt. Checkout can only become a simulated pending-human-approval state.

## Native WebMCP

The Lab feature-detects provider registration separately from in-page discovery and execution. A central registry manager owns registration promises and `AbortController` lifecycles. Registration is serialized so React StrictMode cannot leave duplicate tools.

The official ambient type package currently lacks `executeTool()`, while the draft and Chrome guide differ on object versus JSON-string arguments. ToolProof keeps this difference behind one narrow adapter. It will detect one mode with a harmless read-only compatibility tool, freeze the mode in a readiness receipt, and never try a second representation during a scored or mutating call.

## Probe and evaluator boundary

The preferred future Probe is a bounded server-assisted model decision plus in-page native execution. The model receives one natural-language request, minimum fixture synopsis, live state-appropriate catalog, and a frozen generic instruction. It receives no expectations, family/subset labels, prior result, or repair hint.

Evaluator truth remains outside the Lab and model request. A server-issued signed single-use envelope binds opaque trial identity and manifest hash. Durable replay/rate/concurrency/spend controls are mandatory before the lane can be public.

## Evidence

Raw model bytes, parsed decision, raw/canonical arguments, native result, before/after state bytes, effect diff, runtime identity, and deterministic score remain separate layers joined by canonical hashes and terminal receipts. Hashes establish internal consistency; they are not independent attestation.
