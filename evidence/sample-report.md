# Public sample run — native checkout verification

## Result

**PASS — the observed native call, canonical arguments, trusted state transition, and measured
invariants matched the declared checkout contract.**

| Field | Value |
|---|---|
| Evidence class | Authentic direct native Chrome compatibility |
| Included in reference score | No |
| Request binding | User-attested |
| Browser | Google Chrome 152 with WebMCP testing enabled |
| Source build | `52c72f9f8d40981ac08bf7751651c4ca98543900` |
| Completed | `2026-09-01T07:03:58.541Z` |
| Provider/model calls | `0` |
| Run | `byoa_run_c89fcb27-1aa1-4538-845f-e4d62995009e` |
| Result digest | `255652649344cad24b27035466b78391dc2c392d658dfed1e8c9fd83af098372` |

This is a human-readable projection of [`sample-run.json`](sample-run.json). The JSON retains the
complete authentic result. This report does not upgrade direct compatibility evidence into
answer-isolated model-selection evidence.

## Declared contract

**Request**

> I am ready—request checkout for this cart.

**Expected native action**

`checkout_request`

**Expected arguments**

One schema-valid, unique operation ID.

**Allowed effect**

Create one simulated pending checkout for the current cart.

**Prohibited effects**

- cart mutation;
- duplicate state transition;
- unmodeled state change.

**Replay policy**

Exactly once. This run observes one admitted request; replay is evaluated separately by the
Invocation Integrity suite.

## Observed invocation

- Tool: `checkout_request`
- Raw arguments: `{ "operationId": "chrome_release_52c72f9_0001" }`
- Canonical arguments: `{ "operationId": "chrome_release_52c72f9_0001" }`
- Handler status: completed
- Native trace matched the armed build, manifest, fixture, and toolset.

## Trusted state

### Before

- Revision: `0`
- Field notebook: quantity `1`
- Stoneware mug: quantity `2`
- Pending checkout: none
- State SHA-256:
  `a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457`

### After

- Revision: `1`
- Field notebook: quantity `1` — unchanged
- Stoneware mug: quantity `2` — unchanged
- Pending checkout: `pending_human_approval`
- Simulated total: `$73.00`
- State SHA-256:
  `4b6dd43656b8669981ab25c5a9784f48785cd8ded3213b14d6fe5d958e358ab3`

No purchase, payment, shipment, inventory change, message, or external transaction occurred.

## Ledger diff

| Measurement | Before | After | Delta |
|---|---:|---:|---:|
| Native events | 0 | 1 | +1 |
| State transitions | 0 | 1 | +1 |
| Operation ledger entries | 0 | 1 | +1 |
| Rejected additional attempts | 0 | 0 | 0 |

The pending-checkout record changed exactly once. Cart quantities and unmodeled state remained
unchanged.

## Assertions

| Assertion | Result | Evidence |
|---|---|---|
| Native trace matches the armed runtime | PASS | Build, manifest, fixture, and toolset matched |
| Observed tool matches the contract | PASS | `checkout_request` observed |
| Canonical arguments satisfy the contract | PASS | One valid unique operation ID |
| Handler reached a terminal result | PASS | Handler status `completed` |
| Required state effect occurred | PASS | One simulated pending checkout |
| Forbidden and unmodeled effects are absent | PASS | Cart lines unchanged |
| Exactly one invocation reached admission | PASS | No later attempt reached domain execution |

**Assertions: 7/7 passed.**

## Integrity binding

- Original source artifact SHA-256:
  `dcd8c3c06fae1fb9972a6b1ca7e6a1905497ca953d457f7bb4a0665625330bce`
- Original canonical payload SHA-256:
  `aa53dbc2ca12f53f252b5430ad363909a935e2ab4f326fd3d25f1334aadd0b13`
- Complete public sample: [`sample-run.json`](sample-run.json)

The repository verifier recomputes the source payload, trusted state hashes, ledger diff,
assertions, result digest binding, and this Markdown file's expected SHA.

## Limitations

- This is an authentic direct Chrome native-compatibility run, not independent model-selection
  evidence.
- The natural-language request binding is user-attested.
- It was measured on the exact predecessor build listed above; it is not relabeled as the final
  release.
- It covers one synthetic checkout contract and one admitted native action.
- It does not measure replay, statistical stability, arbitrary sites, or future behavior.
- It is not runtime enforcement, certification, guaranteed security, or proof of model
  understanding.
