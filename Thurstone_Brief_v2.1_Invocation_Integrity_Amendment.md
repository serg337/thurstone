# Thurstone Brief v2.1 — Invocation Integrity Amendment

- Status: **prospective frozen supplement**
- Freeze date: **2026-08-29**
- Evidence class: **supplemental invocation integrity**
- Model calls: **0**

## Relationship to Brief v2

This amendment supplements—and does not replace—canonical Brief v2. Brief v2 remains immutable.
The sealed evidence build `768af2539ca20c29928a897644ad22ba897c580d`, the approved 24-case
Meaning Matrix, its case meanings and expectations, and the authentic `23/24 → 23/24` result are
unchanged. The measured conclusion remains **no measured improvement**. Invocation Integrity has a
separate three-point denominator and may never be merged into semantic accuracy.

All cases below are deterministic direct WebMCP invocations. They use no LLM prompt, model decision,
provider call, purchase, payment, shipment, account, or external commerce mutation. Development or
emulated runs are not measured evidence.

## Frozen common boundary

### Fixture and sequence

The measured sequence is fixed as **II-01 → II-02 → II-03** in one freshly loaded production
document and one isolated checkout session. Compatibility `cart_get` and the verified reset that
prepares the fixture are excluded from case traces and scoring. Business state remains at the exact
initial fixture through II-01 and II-02, so II-03 also begins at revision `0` with no pending
checkout. The replay-safety ledger is append-only across the three-case sequence; each case freezes
its exact ledger precondition below.

| Field                           | Frozen initial value                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| Fixture ID                      | `checkout-seed-v1`                                                 |
| Fixture version                 | `checkout-fixture@1.0.0`                                           |
| Seed                            | `toolproof-checkout-seed-001`                                      |
| Canonical initial state SHA-256 | `a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457` |
| Revision                        | `0`                                                                |
| Field notebook                  | quantity `1`, unit price `1800` cents                              |
| Stoneware mug                   | quantity `2`, unit price `2400` cents                              |
| Fulfillment                     | standard shipping, `700` cents, `3-5-business-days`                |
| Pending checkout                | `null`                                                             |
| Current domain operation ledger | `0` entries                                                        |
| Retained operation tombstones   | `0`                                                                |
| Current case audit trace ledger | `0` traces                                                         |
| Orders created                  | `0` (no order-creation subsystem exists)                           |
| Payments created                | `0` (no payment subsystem exists)                                  |

### Runtime preconditions

The measured sequence must prove all of the following before II-01:

1. A signed-out secure production document is running an exact non-`unversioned` Git build.
2. `document.modelContext.registerTool()`, `getTools()`, and `executeTool()` are available.
3. The active same-origin registry is discovered through the real WebMCP consumer adapter.
4. The initial catalog contains exactly `cart_get`, `cart_update`, `checkout_request`, and
   `order_review`; each target is the discovered registered tool, not an internal handler.
5. The runtime has frozen its observed object or JSON-string argument mode through the existing
   harmless compatibility check.
6. A verified reset binds the fixture, state hash, revision, pending state, zeroed current operation
   ledger, and zeroed case trace ledger to the frozen initial values.
7. The source-fixed server verifier independently constructs the same fixture and accepts no
   caller-selected tool, schema, URL, expected answer, or replacement payload.

### Trusted state source

Tool responses are observations, not the sole source of truth. The trusted result is a canonical
receipt from a source-fixed server-only verifier that:

- selects only the frozen three-case sequence and exact case IDs;
- reconstructs a fresh `checkout-seed-v1` state and isolated server-side operation/audit ledger;
- independently executes the frozen sequence against the deterministic checkout reducer and
  idempotency store;
- requires exact state keysets and rejects unmodeled order, payment, purchase, approval, or external
  mutation fields;
- recomputes canonical before/after state, operation-ledger, audit-trace, effect, invocation, native
  result, manifest, and build bindings;
- compares those values with the browser's real WebMCP discovery/execution transcript; and
- emits a digest-bound receipt without Redis, provider access, or persistent server mutation.

The server verifier must not accept caller-provided expected values. Browser-owned state and traces
are retained measured observations and must match the independent server receipt.

`domainOperationLedgerDiff` and `auditTraceDiff` are distinct. A rejected invocation may append an
audit trace, and a valid terminal no-op may consume an operation ID for replay safety, without
changing business state.

## II-01 — Privileged-field injection

### Exact invocation

Tool: `checkout_request`

Invocation count: exactly `1`

```json
{
  "operationId": "ii01_request_00000001",
  "cartSnapshotHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "orderTotalCents": 1,
  "pendingId": "pending_forged_00000001",
  "requestOperationId": "attacker_owned_00000001",
  "requestedFromRevision": 99,
  "status": "pending_human_approval"
}
```

### Forbidden/server-authoritative inputs

`cartSnapshotHash`, `orderTotalCents`, `pendingId`, `requestOperationId`,
`requestedFromRevision`, and `status` are server-authoritative pending-checkout fields. The caller
may supply only `operationId` to `checkout_request`.

### Preconditions

Business state is the initial hash
`a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`; revision `0`; pending checkout `null`; domain
operation ledger/tombstones `0/0`; case audit traces `0`.

### Expected outcome

The strict handler boundary deterministically rejects the invocation:

```json
{
  "ok": false,
  "code": "invalid_arguments",
  "message": "Arguments do not match the tool's closed input schema.",
  "retryable": true,
  "operationId": "ii01_request_00000001",
  "replayed": false,
  "stateRevision": 0
}
```

Exactly one handler audit trace is required: `validation_error`,
`commitDisposition: "none"`, `effectApplied: false`, and no canonical command. The domain operation
ledger and tombstone count remain `0/0 → 0/0`.

### Postconditions

- Canonical state remains byte-equivalent to the initial fixture and hashes to
  `a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`.
- Revision remains `0`; line quantities and prices are unchanged; `pendingCheckout` remains `null`.
- No checkout request, order, payment, shipment, approval, or external effect exists.
- Domain operation-ledger diff is empty; audit-trace diff is exactly one rejection trace.

### Replay policy and score

No replay is permitted. II-01 earns one point only if every runtime, rejection, trusted-state,
ledger, trace, and postcondition assertion passes.

## II-02 — Nonexistent item

### Frozen schema boundary

For `cart_update`, `itemId` is a syntactically bounded lowercase-hyphen identifier matching
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, minimum length `1`, maximum length `64`. The WebMCP schema validates
syntax; membership in the current fixture remains server-authoritative. Existing item identifiers
and every frozen semantic case remain valid and unchanged.

### Exact invocation

Tool: `cart_update`

Invocation count: exactly `1`

```json
{
  "operationId": "ii02_update_00000001",
  "operation": "set_quantity",
  "itemId": "phantom-item",
  "quantity": 3
}
```

### Forbidden/server-authoritative input

`phantom-item` is syntactically schema-valid but is not a member of the frozen server-owned cart
fixture. A caller cannot create an item by naming it.

### Preconditions

Business state remains the initial hash
`a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`; revision `0`; pending checkout `null`;
domain operation ledger/tombstones `0/0`; case audit traces contain only II-01.

### Expected outcome

The server-owned membership check deterministically returns:

```json
{
  "ok": false,
  "code": "invalid_item",
  "message": "The requested cart item is not available in this fixture.",
  "retryable": true,
  "operationId": "ii02_update_00000001",
  "replayed": false,
  "stateRevision": 0
}
```

The handler trace is `expected_error`, `commitDisposition: "none"`, and `effectApplied: false`.
The replay-safety operation ledger records exactly one canonical terminal outcome and one tombstone
(`0/0 → 1/1`); this idempotency record is not a cart or checkout mutation.

### Postconditions

- Canonical business state remains byte-equivalent to the initial fixture and hashes to
  `a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`.
- Revision remains `0`; both original lines, quantities, prices, fulfillment, and currency are
  unchanged; `pendingCheckout` remains `null`; no new line exists.
- No checkout request, order, payment, shipment, approval, or external effect exists.
- Domain operation-ledger/tombstone diff is exactly one replay-safety record; audit-trace diff is
  exactly one expected-error trace.

### Replay policy and score

No second invocation is permitted. II-02 earns one point only if every schema, rejection,
trusted-state, ledger, trace, and postcondition assertion passes.

## II-03 — Replay

### Exact invocation

Tool: `checkout_request`

Invocation count: exactly `2`

Both invocations use the identical logical payload and operation ID:

```json
{
  "operationId": "ii03_request_00000001"
}
```

### Preconditions

Business state remains the initial hash
`a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`; revision `0`; pending checkout `null`;
domain operation ledger/tombstones `1/1` from II-02; `ii03_request_00000001` is unused; case audit
traces contain II-01 and II-02 in order.

### Expected first outcome

```json
{
  "ok": true,
  "code": "pending_human_approval",
  "operationId": "ii03_request_00000001",
  "replayed": false,
  "pendingId": "pending_a9889565b0e5_00000001",
  "requestedFromRevision": 0,
  "orderTotalCents": 7300,
  "stateRevision": 1
}
```

Exactly one permitted state transition occurs. The first trace is `completed`,
`commitDisposition: "committed"`, and `effectApplied: true`. The resulting canonical state hash is
`312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d`. Domain operation
ledger/tombstones move `1/1 → 2/2`.

### Expected second outcome

The second result is byte-equivalent to the original receipt except `replayed: true`. Its trace is
`duplicate`, `commitDisposition: "replayed"`, and `effectApplied: false`. It produces no subscriber
commit, no new tombstone, and no second state transition. Domain operation ledger/tombstones remain
`2/2`.

### Postconditions

- Final revision is exactly `1` with one `pending_human_approval` checkout bound to
  `ii03_request_00000001`, the initial cart snapshot, and total `7300` cents.
- Final canonical state hash is exactly `312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d`.
- The exact root, line, fulfillment, and pending-checkout keysets are enforced; line identities,
  quantities, prices, fulfillment, currency, and all unmodeled fields are unchanged.
- Exactly two current operation IDs and two tombstones exist after the sequence; replay creates no
  third record.
- Audit-trace diff for II-03 is exactly two traces in order: committed first call,
  duplicate/no-op replay.
- Exactly one checkout transition exists; no order, payment, shipment, approval, or external effect
  exists.

### Replay policy and score

The second invocation is the frozen replay stimulus, not a retry. No third invocation is permitted.
II-03 is one case worth one point and passes only if all first-call, replay, state, ledger, trace,
and postcondition assertions pass.

## Measured-run, failure, and scoring policy

1. The final evidence run allows one measured sequence on one exact production build.
2. There are no automatic retries or provider-internal retries. A post-dispatch failure is a
   preserved failure for that execution build, not a replaceable infrastructure event.
3. A later source repair requires a new build SHA and separately labeled evidence; it never
   overwrites or relabels an earlier failed candidate.
4. Each case earns `1` only when every frozen assertion passes; otherwise it earns `0`.
5. The Invocation Integrity score is `earned / 3`. II-03's two calls remain one case.
6. Semantic accuracy remains independently `23/24 → 23/24`; no combined denominator is permitted.
7. Exact payloads, discovered descriptors, native adapter receipts/errors, handler traces, trusted
   before/after state, operation-ledger diff, audit-trace diff, assertions, build SHA, UTC timestamp,
   and canonical digests must be retained for every case.
8. Failures are displayed and exported honestly. Assertions may not be weakened after observation.

## Supplemental evidence and presentation

The immutable supplemental package must be separate from existing Gate 6/reference/sample evidence.
It must identify this amendment's path, commit SHA, and file SHA-256; bind every row to the exact
execution build; state `modelCallCount: 0` and `includedInSemanticDenominator: false`; and expose its
own three-row Invocation Integrity Matrix and JSON/Markdown exports. Existing Meaning Matrix bytes,
metrics, endpoints, and exports remain unchanged.

Only after all three cases pass may Thurstone use this exact position:

> **Thurstone tests both sides of a declared WebMCP contract: whether benign requests produce the represented effects, and whether tested hostile invocations preserve site-defined invariants.**

Every use of that position must retain these limitations: Thurstone is a testing/audit system, not
runtime enforcement; not certification or guaranteed security; limited to the three frozen
synthetic cases and current tested build, not arbitrary-site verification; and not proof that a
malicious website will behave identically after testing.

## Deferral boundary

Stop and defer Gate 8.5 until after submission if satisfying this amendment would require changing
the frozen 24-case protocol, rerunning paid/provider evaluation, redesigning core architecture, or
expanding beyond II-01, II-02, and II-03. A bounded input-schema membership separation, fixed-case
server verifier, native runner, supplemental evidence package, separate matrix, and regression
proof are within this amendment; a generalized scanner, DSL, SDK, plugin system, or arbitrary-site
verification system is not.
