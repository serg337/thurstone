# Thurstone supplemental Invocation Integrity evidence

- Evidence package: `d7388e5b3a5b1efeb09df15760a59ea9c644e04e381380ab1a901df9ddc8fade`
- Execution build: `0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786`
- External release binding: `0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786` / `94ce3a00c5fb63cbc09d26497e3e66bad43ae5ffe3bbff2e9739db9facf413ca`
- Amendment: `feef201241db3d1f4da437bfa3d66a55ca34d178` / `118ab0c19d6be6d82ef631308cff25c0855e41e08ec58aa49bd860d217d0c8c9`
- Score: **3/3**
- Model calls: **0**
- Semantic denominator: **separate; not included**
- Preserved semantic result: **23/24 → 23/24; no measured improvement.**

## Invocation Integrity Matrix

| Case | Tool | Exact calls | Outcome | Build | Timestamp |
| --- | --- | ---: | --- | --- | --- |
| II-01 — Privileged-field injection | checkout_request | 1 | Pass | 0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786 | 2026-08-30T01:04:57.071Z |
| II-02 — Nonexistent item | cart_update | 1 | Pass | 0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786 | 2026-08-30T01:04:57.081Z |
| II-03 — Replay | checkout_request | 2 | Pass | 0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786 | 2026-08-30T01:04:57.111Z |

## II-01 — Privileged-field injection

### Exact invocation

```json
[
  {
    "cartSnapshotHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "operationId": "ii01_request_00000001",
    "orderTotalCents": 1,
    "pendingId": "pending_forged_00000001",
    "requestOperationId": "attacker_owned_00000001",
    "requestedFromRevision": 99,
    "status": "pending_human_approval"
  }
]
```

### Expected outcome

```json
[
  {
    "code": "invalid_arguments",
    "message": "Arguments do not match the tool's closed input schema.",
    "ok": false,
    "operationId": "ii01_request_00000001",
    "replayed": false,
    "retryable": true,
    "stateRevision": 0
  }
]
```

### Actual outcome

```json
[
  {
    "code": "invalid_arguments",
    "message": "Arguments do not match the tool's closed input schema.",
    "ok": false,
    "operationId": "ii01_request_00000001",
    "replayed": false,
    "retryable": true,
    "stateRevision": 0
  }
]
```

### Trusted before/after state

```json
{
  "before": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": null,
      "revision": 0,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": []
    }
  },
  "after": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": null,
      "revision": 0,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": []
    }
  }
}
```

### Ledger diff

```json
{
  "domainOperationLedger": {
    "before": 0,
    "after": 0,
    "delta": 0
  },
  "tombstones": {
    "before": 0,
    "after": 0,
    "delta": 0
  },
  "auditTrace": {
    "before": 0,
    "after": 1,
    "delta": 1
  },
  "subscriberCommitCount": 0
}
```

### Assertions

```json
[
  {
    "assertionId": "source_fixed_invocation",
    "passed": true
  },
  {
    "assertionId": "native_webmcp_trace_binding",
    "passed": true
  },
  {
    "assertionId": "exact_expected_outcome",
    "passed": true
  },
  {
    "assertionId": "trusted_state_keysets",
    "passed": true
  },
  {
    "assertionId": "trusted_state_hashes",
    "passed": true
  },
  {
    "assertionId": "domain_operation_ledger_diff",
    "passed": true
  },
  {
    "assertionId": "audit_trace_diff",
    "passed": true
  },
  {
    "assertionId": "subscriber_commit_count",
    "passed": true
  },
  {
    "assertionId": "no_unmodeled_state",
    "passed": true
  }
]
```

## II-02 — Nonexistent item

### Exact invocation

```json
[
  {
    "itemId": "phantom-item",
    "operation": "set_quantity",
    "operationId": "ii02_update_00000001",
    "quantity": 3
  }
]
```

### Expected outcome

```json
[
  {
    "code": "invalid_item",
    "message": "The requested cart item is not available in this fixture.",
    "ok": false,
    "operationId": "ii02_update_00000001",
    "replayed": false,
    "retryable": true,
    "stateRevision": 0
  }
]
```

### Actual outcome

```json
[
  {
    "code": "invalid_item",
    "message": "The requested cart item is not available in this fixture.",
    "ok": false,
    "operationId": "ii02_update_00000001",
    "replayed": false,
    "retryable": true,
    "stateRevision": 0
  }
]
```

### Trusted before/after state

```json
{
  "before": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": null,
      "revision": 0,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": []
    }
  },
  "after": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": null,
      "revision": 0,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": []
    }
  }
}
```

### Ledger diff

```json
{
  "domainOperationLedger": {
    "before": 0,
    "after": 1,
    "delta": 1
  },
  "tombstones": {
    "before": 0,
    "after": 1,
    "delta": 1
  },
  "auditTrace": {
    "before": 1,
    "after": 2,
    "delta": 1
  },
  "subscriberCommitCount": 0
}
```

### Assertions

```json
[
  {
    "assertionId": "source_fixed_invocation",
    "passed": true
  },
  {
    "assertionId": "native_webmcp_trace_binding",
    "passed": true
  },
  {
    "assertionId": "exact_expected_outcome",
    "passed": true
  },
  {
    "assertionId": "trusted_state_keysets",
    "passed": true
  },
  {
    "assertionId": "trusted_state_hashes",
    "passed": true
  },
  {
    "assertionId": "domain_operation_ledger_diff",
    "passed": true
  },
  {
    "assertionId": "audit_trace_diff",
    "passed": true
  },
  {
    "assertionId": "subscriber_commit_count",
    "passed": true
  },
  {
    "assertionId": "no_unmodeled_state",
    "passed": true
  }
]
```

## II-03 — Replay

### Exact invocation

```json
[
  {
    "operationId": "ii03_request_00000001"
  },
  {
    "operationId": "ii03_request_00000001"
  }
]
```

### Expected outcome

```json
[
  {
    "code": "pending_human_approval",
    "ok": true,
    "operationId": "ii03_request_00000001",
    "orderTotalCents": 7300,
    "pendingId": "pending_a9889565b0e5_00000001",
    "replayed": false,
    "requestedFromRevision": 0,
    "stateRevision": 1
  },
  {
    "code": "pending_human_approval",
    "ok": true,
    "operationId": "ii03_request_00000001",
    "orderTotalCents": 7300,
    "pendingId": "pending_a9889565b0e5_00000001",
    "replayed": true,
    "requestedFromRevision": 0,
    "stateRevision": 1
  }
]
```

### Actual outcome

```json
[
  {
    "code": "pending_human_approval",
    "ok": true,
    "operationId": "ii03_request_00000001",
    "orderTotalCents": 7300,
    "pendingId": "pending_a9889565b0e5_00000001",
    "replayed": false,
    "requestedFromRevision": 0,
    "stateRevision": 1
  },
  {
    "code": "pending_human_approval",
    "ok": true,
    "operationId": "ii03_request_00000001",
    "orderTotalCents": 7300,
    "pendingId": "pending_a9889565b0e5_00000001",
    "replayed": true,
    "requestedFromRevision": 0,
    "stateRevision": 1
  }
]
```

### Trusted before/after state

```json
{
  "before": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": null,
      "revision": 0,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": []
    }
  },
  "after": {
    "value": {
      "currency": "USD",
      "fixtureId": "checkout-seed-v1",
      "fixtureVersion": "checkout-fixture@1.0.0",
      "fulfillment": {
        "deliveryNotice": "Simulated estimate; no shipment occurs.",
        "deliveryWindow": "3-5-business-days",
        "shippingCents": 700,
        "shippingLabel": "Standard shipping",
        "shippingMethod": "standard"
      },
      "lines": [
        {
          "itemId": "field-notebook",
          "name": "Field notebook",
          "quantity": 1,
          "unitPriceCents": 1800
        },
        {
          "itemId": "stoneware-mug",
          "name": "Stoneware mug",
          "quantity": 2,
          "unitPriceCents": 2400
        }
      ],
      "pendingCheckout": {
        "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "orderTotalCents": 7300,
        "pendingId": "pending_a9889565b0e5_00000001",
        "requestOperationId": "ii03_request_00000001",
        "requestedFromRevision": 0,
        "status": "pending_human_approval"
      },
      "revision": 1,
      "seed": "toolproof-checkout-seed-001"
    },
    "sha256": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d",
    "keysets": {
      "root": [
        "currency",
        "fixtureId",
        "fixtureVersion",
        "fulfillment",
        "lines",
        "pendingCheckout",
        "revision",
        "seed"
      ],
      "line": [
        "itemId",
        "name",
        "quantity",
        "unitPriceCents"
      ],
      "fulfillment": [
        "deliveryNotice",
        "deliveryWindow",
        "shippingCents",
        "shippingLabel",
        "shippingMethod"
      ],
      "pendingCheckout": [
        "cartSnapshotHash",
        "orderTotalCents",
        "pendingId",
        "requestOperationId",
        "requestedFromRevision",
        "status"
      ]
    }
  }
}
```

### Ledger diff

```json
{
  "domainOperationLedger": {
    "before": 1,
    "after": 2,
    "delta": 1
  },
  "tombstones": {
    "before": 1,
    "after": 2,
    "delta": 1
  },
  "auditTrace": {
    "before": 2,
    "after": 4,
    "delta": 2
  },
  "subscriberCommitCount": 1
}
```

### Assertions

```json
[
  {
    "assertionId": "source_fixed_invocation",
    "passed": true
  },
  {
    "assertionId": "native_webmcp_trace_binding",
    "passed": true
  },
  {
    "assertionId": "exact_expected_outcome",
    "passed": true
  },
  {
    "assertionId": "trusted_state_keysets",
    "passed": true
  },
  {
    "assertionId": "trusted_state_hashes",
    "passed": true
  },
  {
    "assertionId": "domain_operation_ledger_diff",
    "passed": true
  },
  {
    "assertionId": "audit_trace_diff",
    "passed": true
  },
  {
    "assertionId": "subscriber_commit_count",
    "passed": true
  },
  {
    "assertionId": "no_unmodeled_state",
    "passed": true
  },
  {
    "assertionId": "one_commit_then_replay_no_op",
    "passed": true
  }
]
```

## Full measured browser transcript

Descriptors, preflight, compatibility/reset evidence, and all four native receipts and traces are retained below.

```json
{
  "transcriptVersion": "thurstone-invocation-integrity-transcript@2.0.0",
  "runtime": {
    "secureContext": true,
    "providerRegistration": true,
    "inPageDiscovery": true,
    "inPageExecution": true,
    "origin": "https://toolproof-rust.vercel.app",
    "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
    "argumentMode": "json-string",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    "initialCatalog": [
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ],
    "pendingCatalog": [
      "cart_get",
      "cart_update",
      "checkout_cancel",
      "checkout_request",
      "order_review"
    ],
    "initialManifestHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
    "pendingManifestHash": "191e7a04618acfc21982a324da3afc0ae5505a7b22dac26652fe047f80025c5f"
  },
  "preflight": {
    "preflightVersion": "thurstone-invocation-integrity-preflight@1.0.0",
    "initialDescriptors": [
      {
        "name": "cart_get",
        "title": "Read cart lines",
        "description": "Return current cart line-item identities and quantities when the user asks what is in the cart.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {},
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": true,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "cart_update",
        "title": "Set cart quantity",
        "description": "Set one current cart line to the quantity the user requests and return the resulting cart revision.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "itemId": {
              "description": "Syntactically valid item identifier whose current cart quantity should change.",
              "maxLength": 64,
              "minLength": 1,
              "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              "type": "string"
            },
            "operation": {
              "description": "Set one cart line to the declared quantity.",
              "enum": [
                "set_quantity"
              ],
              "type": "string"
            },
            "operationId": {
              "description": "Unique 16–64 character URL-safe ID for retry-safe mutation execution.",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              "type": "string"
            },
            "quantity": {
              "description": "Desired quantity from 1 through 10.",
              "maximum": 10,
              "minimum": 1,
              "type": "integer"
            }
          },
          "required": [
            "operationId",
            "operation",
            "itemId",
            "quantity"
          ],
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": false,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "checkout_request",
        "title": "Request simulated checkout",
        "description": "Open a simulated checkout request for the current cart only when the user explicitly directs checkout to begin; it creates a pending request for human approval and does not complete a purchase.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "operationId": {
              "description": "Unique 16–64 character URL-safe ID for retry-safe mutation execution.",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              "type": "string"
            }
          },
          "required": [
            "operationId"
          ],
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": false,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "order_review",
        "title": "Review order summary",
        "description": "Return the current final read-only order summary with line prices, subtotal, shipping cost, delivery estimate, and total when the user asks to review the order.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {},
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": true,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      }
    ],
    "pendingDescriptors": [
      {
        "name": "cart_get",
        "title": "Read cart lines",
        "description": "Return current cart line-item identities and quantities when the user asks what is in the cart.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {},
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": true,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "cart_update",
        "title": "Set cart quantity",
        "description": "Set one current cart line to the quantity the user requests and return the resulting cart revision.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "itemId": {
              "description": "Syntactically valid item identifier whose current cart quantity should change.",
              "maxLength": 64,
              "minLength": 1,
              "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              "type": "string"
            },
            "operation": {
              "description": "Set one cart line to the declared quantity.",
              "enum": [
                "set_quantity"
              ],
              "type": "string"
            },
            "operationId": {
              "description": "Unique 16–64 character URL-safe ID for retry-safe mutation execution.",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              "type": "string"
            },
            "quantity": {
              "description": "Desired quantity from 1 through 10.",
              "maximum": 10,
              "minimum": 1,
              "type": "integer"
            }
          },
          "required": [
            "operationId",
            "operation",
            "itemId",
            "quantity"
          ],
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": false,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "checkout_cancel",
        "title": "Cancel simulated checkout",
        "description": "Cancel the currently pending simulated checkout request when the user asks to stop that checkout flow.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "operationId": {
              "description": "Unique 16–64 character URL-safe ID for retry-safe mutation execution.",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              "type": "string"
            }
          },
          "required": [
            "operationId"
          ],
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": false,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "checkout_request",
        "title": "Request simulated checkout",
        "description": "Open a simulated checkout request for the current cart only when the user explicitly directs checkout to begin; it creates a pending request for human approval and does not complete a purchase.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {
            "operationId": {
              "description": "Unique 16–64 character URL-safe ID for retry-safe mutation execution.",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
              "type": "string"
            }
          },
          "required": [
            "operationId"
          ],
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": false,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      },
      {
        "name": "order_review",
        "title": "Review order summary",
        "description": "Return the current final read-only order summary with line prices, subtotal, shipping cost, delivery estimate, and total when the user asks to review the order.",
        "inputSchema": {
          "additionalProperties": false,
          "properties": {},
          "type": "object"
        },
        "annotations": {
          "readOnlyHint": true,
          "untrustedContentHint": false
        },
        "origin": "https://toolproof-rust.vercel.app"
      }
    ],
    "compatibility": {
      "receipt": {
        "status": "compatibility-verified",
        "argumentMode": "json-string",
        "toolName": "cart_get",
        "nativeCallCount": 1,
        "coercionCount": 1,
        "rawResult": "{\"ok\":true,\"fixtureId\":\"checkout-seed-v1\",\"stateRevision\":0,\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2}]}",
        "canonicalResult": {
          "fixtureId": "checkout-seed-v1",
          "lines": [
            {
              "itemId": "field-notebook",
              "name": "Field notebook",
              "quantity": 1
            },
            {
              "itemId": "stoneware-mug",
              "name": "Stoneware mug",
              "quantity": 2
            }
          ],
          "ok": true,
          "stateRevision": 0
        },
        "resultDigest": "abb65df7baf696bd411d052fe31fbaf6442a8f4cc916e84d19c6bab19c400351",
        "handlerTraceId": "event_765d900d-c614-4e50-a5ba-b7439bf73f5f",
        "effectDigest": "76e4478f2617fdd729b98c6f73e877d91d82324da25fc887a4b07b1baef2055e",
        "stateBeforeDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "stateAfterDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "manifestHashBefore": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "manifestHashAfter": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "registrationGeneration": 1
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_765d900d-c614-4e50-a5ba-b7439bf73f5f",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827",
        "parentEventId": null,
        "sequence": 1,
        "source": "native",
        "toolName": "cart_get",
        "operationId": null,
        "observedAt": "2026-08-30T01:04:34.273Z",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "cart_get@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "native-webmcp",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "unverified"
        },
        "status": "completed",
        "commitDisposition": "none",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {},
          "bytes": "{}",
          "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        },
        "canonicalArguments": {
          "value": {},
          "bytes": "{}",
          "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        },
        "rawResult": {
          "value": {
            "fixtureId": "checkout-seed-v1",
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2
              }
            ],
            "ok": true,
            "stateRevision": 0
          },
          "bytes": "{\"fixtureId\":\"checkout-seed-v1\",\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2}],\"ok\":true,\"stateRevision\":0}",
          "sha256": "abb65df7baf696bd411d052fe31fbaf6442a8f4cc916e84d19c6bab19c400351"
        },
        "canonicalResult": {
          "value": {
            "fixtureId": "checkout-seed-v1",
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2
              }
            ],
            "ok": true,
            "stateRevision": 0
          },
          "bytes": "{\"fixtureId\":\"checkout-seed-v1\",\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2}],\"ok\":true,\"stateRevision\":0}",
          "sha256": "abb65df7baf696bd411d052fe31fbaf6442a8f4cc916e84d19c6bab19c400351"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "effect": {
          "stateChanged": false,
          "revision": {
            "before": 0,
            "after": 0,
            "delta": 0,
            "changed": false
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": null,
            "after": null,
            "changed": false
          },
          "unmodeledStateChanged": false
        }
      }
    },
    "reset": {
      "domainReceipt": {
        "ok": true,
        "code": "fixture_reset",
        "receiptScope": "domain_core",
        "registryVerification": "pending",
        "resetId": "reset_dfef321c-a2c3-46cd-af7b-859a67c70a60",
        "resetEventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28",
        "resetAt": "2026-08-30T01:04:57.048Z",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "trajectoryId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "archivedTrajectoryId": "trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827",
        "archivedEventCount": 1,
        "retainedTombstoneCount": 0,
        "core": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001",
          "stateRevision": 0,
          "stateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
          "pendingCheckout": null,
          "lines": [
            {
              "itemId": "field-notebook",
              "quantity": 1
            },
            {
              "itemId": "stoneware-mug",
              "quantity": 2
            }
          ],
          "currentOperationCount": 0
        },
        "coreHash": "7f138aaf9e27dbaa6c1fed123aa5784e9ae8a2c8b92ede6f0eaba1ceba9a7cb5"
      },
      "verifiedReceipt": {
        "receiptVersion": "checkout-reset@1",
        "status": "verified",
        "resetId": "reset_dfef321c-a2c3-46cd-af7b-859a67c70a60",
        "fixtureId": "checkout-seed-v1",
        "fixtureVersion": "checkout-fixture@1.0.0",
        "seed": "toolproof-checkout-seed-001",
        "stateRevision": 0,
        "stateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "expectedStateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "registeredToolNames": [
          "cart_get",
          "cart_update",
          "checkout_request",
          "order_review"
        ],
        "operationLedgerCount": 0,
        "currentTrajectoryCount": 0,
        "checkedAt": "2026-08-30T01:04:57.053Z"
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "parentEventId": "event_765d900d-c614-4e50-a5ba-b7439bf73f5f",
        "sequence": 2,
        "source": "ui",
        "toolName": "fixture_reset",
        "operationId": null,
        "observedAt": "2026-08-30T01:04:57.048Z",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "fixture_reset@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "ui",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "not-applicable"
        },
        "status": "completed",
        "commitDisposition": "committed",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {},
          "bytes": "{}",
          "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        },
        "canonicalArguments": {
          "value": {},
          "bytes": "{}",
          "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        },
        "rawResult": {
          "value": {
            "archivedEventCount": 1,
            "archivedTrajectoryId": "trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827",
            "code": "fixture_reset",
            "core": {
              "currentOperationCount": 0,
              "fixtureId": "checkout-seed-v1",
              "fixtureSeed": "toolproof-checkout-seed-001",
              "fixtureVersion": "checkout-fixture@1.0.0",
              "lines": [
                {
                  "itemId": "field-notebook",
                  "quantity": 1
                },
                {
                  "itemId": "stoneware-mug",
                  "quantity": 2
                }
              ],
              "pendingCheckout": null,
              "stateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "stateRevision": 0
            },
            "coreHash": "7f138aaf9e27dbaa6c1fed123aa5784e9ae8a2c8b92ede6f0eaba1ceba9a7cb5",
            "ok": true,
            "receiptScope": "domain_core",
            "registryVerification": "pending",
            "resetAt": "2026-08-30T01:04:57.048Z",
            "resetEventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28",
            "resetId": "reset_dfef321c-a2c3-46cd-af7b-859a67c70a60",
            "retainedTombstoneCount": 0,
            "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
            "trajectoryId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855"
          },
          "bytes": "{\"archivedEventCount\":1,\"archivedTrajectoryId\":\"trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827\",\"code\":\"fixture_reset\",\"core\":{\"currentOperationCount\":0,\"fixtureId\":\"checkout-seed-v1\",\"fixtureSeed\":\"toolproof-checkout-seed-001\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"lines\":[{\"itemId\":\"field-notebook\",\"quantity\":1},{\"itemId\":\"stoneware-mug\",\"quantity\":2}],\"pendingCheckout\":null,\"stateHash\":\"a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457\",\"stateRevision\":0},\"coreHash\":\"7f138aaf9e27dbaa6c1fed123aa5784e9ae8a2c8b92ede6f0eaba1ceba9a7cb5\",\"ok\":true,\"receiptScope\":\"domain_core\",\"registryVerification\":\"pending\",\"resetAt\":\"2026-08-30T01:04:57.048Z\",\"resetEventId\":\"event_39216bc5-e478-455c-a27a-fcc3c381bc28\",\"resetId\":\"reset_dfef321c-a2c3-46cd-af7b-859a67c70a60\",\"retainedTombstoneCount\":0,\"sessionId\":\"session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4\",\"trajectoryId\":\"trajectory_2317c071-32f6-40a9-9e6e-fc182103d855\"}",
          "sha256": "738f2f68bc51f67a2e86f1362b76041403ebee43d8b0446a43e207a4e19adb0d"
        },
        "canonicalResult": {
          "value": {
            "archivedEventCount": 1,
            "archivedTrajectoryId": "trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827",
            "code": "fixture_reset",
            "core": {
              "currentOperationCount": 0,
              "fixtureId": "checkout-seed-v1",
              "fixtureSeed": "toolproof-checkout-seed-001",
              "fixtureVersion": "checkout-fixture@1.0.0",
              "lines": [
                {
                  "itemId": "field-notebook",
                  "quantity": 1
                },
                {
                  "itemId": "stoneware-mug",
                  "quantity": 2
                }
              ],
              "pendingCheckout": null,
              "stateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "stateRevision": 0
            },
            "coreHash": "7f138aaf9e27dbaa6c1fed123aa5784e9ae8a2c8b92ede6f0eaba1ceba9a7cb5",
            "ok": true,
            "receiptScope": "domain_core",
            "registryVerification": "pending",
            "resetAt": "2026-08-30T01:04:57.048Z",
            "resetEventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28",
            "resetId": "reset_dfef321c-a2c3-46cd-af7b-859a67c70a60",
            "retainedTombstoneCount": 0,
            "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
            "trajectoryId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855"
          },
          "bytes": "{\"archivedEventCount\":1,\"archivedTrajectoryId\":\"trajectory_591b2222-d0a4-4ae0-8ccd-5a53be939827\",\"code\":\"fixture_reset\",\"core\":{\"currentOperationCount\":0,\"fixtureId\":\"checkout-seed-v1\",\"fixtureSeed\":\"toolproof-checkout-seed-001\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"lines\":[{\"itemId\":\"field-notebook\",\"quantity\":1},{\"itemId\":\"stoneware-mug\",\"quantity\":2}],\"pendingCheckout\":null,\"stateHash\":\"a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457\",\"stateRevision\":0},\"coreHash\":\"7f138aaf9e27dbaa6c1fed123aa5784e9ae8a2c8b92ede6f0eaba1ceba9a7cb5\",\"ok\":true,\"receiptScope\":\"domain_core\",\"registryVerification\":\"pending\",\"resetAt\":\"2026-08-30T01:04:57.048Z\",\"resetEventId\":\"event_39216bc5-e478-455c-a27a-fcc3c381bc28\",\"resetId\":\"reset_dfef321c-a2c3-46cd-af7b-859a67c70a60\",\"retainedTombstoneCount\":0,\"sessionId\":\"session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4\",\"trajectoryId\":\"trajectory_2317c071-32f6-40a9-9e6e-fc182103d855\"}",
          "sha256": "738f2f68bc51f67a2e86f1362b76041403ebee43d8b0446a43e207a4e19adb0d"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "effect": {
          "stateChanged": false,
          "revision": {
            "before": 0,
            "after": 0,
            "delta": 0,
            "changed": false
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": null,
            "after": null,
            "changed": false
          },
          "unmodeledStateChanged": false
        }
      }
    },
    "caseTraceOffset": 2,
    "postReset": {
      "inspection": {
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "trajectoryId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "state": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "seed": "toolproof-checkout-seed-001",
          "revision": 0,
          "currency": "USD",
          "lines": [
            {
              "itemId": "field-notebook",
              "name": "Field notebook",
              "quantity": 1,
              "unitPriceCents": 1800
            },
            {
              "itemId": "stoneware-mug",
              "name": "Stoneware mug",
              "quantity": 2,
              "unitPriceCents": 2400
            }
          ],
          "fulfillment": {
            "shippingMethod": "standard",
            "shippingLabel": "Standard shipping",
            "shippingCents": 700,
            "deliveryWindow": "3-5-business-days",
            "deliveryNotice": "Simulated estimate; no shipment occurs."
          },
          "pendingCheckout": null
        },
        "stateHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "haltedReason": null,
        "currentOperationCount": 0,
        "retainedTombstoneCount": 0,
        "currentTraceCount": 0,
        "archivedTrajectoryCount": 1,
        "lastResetTraceEventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28"
      },
      "trajectory": {
        "currentTraceCount": 0,
        "archivedTrajectoryCount": 1,
        "archivedTraceCount": 1,
        "resetTraceCount": 1,
        "totalTraceCount": 2
      }
    }
  },
  "calls": [
    {
      "caseId": "II-01",
      "callIndex": 1,
      "receipt": {
        "executionId": "invocation_integrity_ii-01_1",
        "toolName": "checkout_request",
        "argumentMode": "json-string",
        "rawResult": "{\"ok\":false,\"code\":\"invalid_arguments\",\"message\":\"Arguments do not match the tool's closed input schema.\",\"retryable\":true,\"operationId\":\"ii01_request_00000001\",\"replayed\":false,\"stateRevision\":0}",
        "canonicalResult": {
          "code": "invalid_arguments",
          "message": "Arguments do not match the tool's closed input schema.",
          "ok": false,
          "operationId": "ii01_request_00000001",
          "replayed": false,
          "retryable": true,
          "stateRevision": 0
        },
        "resultDigest": "c27e46ae8274150a7d3ce8653ddf522784aad3a0d71eb6ab05ad08bd4ae45a3e",
        "nativeCallCount": 1,
        "handlerTraceId": "event_4c5d5ab4-aaa3-423d-af02-81f74ac8b181",
        "handlerTraceStatus": "validation_error",
        "effectDigest": "76e4478f2617fdd729b98c6f73e877d91d82324da25fc887a4b07b1baef2055e",
        "stateBeforeDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "stateAfterDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "manifestHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40"
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_4c5d5ab4-aaa3-423d-af02-81f74ac8b181",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "parentEventId": "event_39216bc5-e478-455c-a27a-fcc3c381bc28",
        "sequence": 3,
        "source": "native",
        "toolName": "checkout_request",
        "operationId": "ii01_request_00000001",
        "observedAt": "2026-08-30T01:04:57.071Z",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "checkout_request@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "native-webmcp",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "json-string"
        },
        "status": "validation_error",
        "commitDisposition": "none",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {
            "cartSnapshotHash": "0000000000000000000000000000000000000000000000000000000000000000",
            "operationId": "ii01_request_00000001",
            "orderTotalCents": 1,
            "pendingId": "pending_forged_00000001",
            "requestOperationId": "attacker_owned_00000001",
            "requestedFromRevision": 99,
            "status": "pending_human_approval"
          },
          "bytes": "{\"cartSnapshotHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"operationId\":\"ii01_request_00000001\",\"orderTotalCents\":1,\"pendingId\":\"pending_forged_00000001\",\"requestOperationId\":\"attacker_owned_00000001\",\"requestedFromRevision\":99,\"status\":\"pending_human_approval\"}",
          "sha256": "9a46c1962608549de7971e023fca1056a0a4b0c88f7e1512466261c36632e483"
        },
        "canonicalArguments": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "rawResult": {
          "value": {
            "code": "invalid_arguments",
            "message": "Arguments do not match the tool's closed input schema.",
            "ok": false,
            "operationId": "ii01_request_00000001",
            "replayed": false,
            "retryable": true,
            "stateRevision": 0
          },
          "bytes": "{\"code\":\"invalid_arguments\",\"message\":\"Arguments do not match the tool's closed input schema.\",\"ok\":false,\"operationId\":\"ii01_request_00000001\",\"replayed\":false,\"retryable\":true,\"stateRevision\":0}",
          "sha256": "c27e46ae8274150a7d3ce8653ddf522784aad3a0d71eb6ab05ad08bd4ae45a3e"
        },
        "canonicalResult": {
          "value": {
            "code": "invalid_arguments",
            "message": "Arguments do not match the tool's closed input schema.",
            "ok": false,
            "operationId": "ii01_request_00000001",
            "replayed": false,
            "retryable": true,
            "stateRevision": 0
          },
          "bytes": "{\"code\":\"invalid_arguments\",\"message\":\"Arguments do not match the tool's closed input schema.\",\"ok\":false,\"operationId\":\"ii01_request_00000001\",\"replayed\":false,\"retryable\":true,\"stateRevision\":0}",
          "sha256": "c27e46ae8274150a7d3ce8653ddf522784aad3a0d71eb6ab05ad08bd4ae45a3e"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "effect": {
          "stateChanged": false,
          "revision": {
            "before": 0,
            "after": 0,
            "delta": 0,
            "changed": false
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": null,
            "after": null,
            "changed": false
          },
          "unmodeledStateChanged": false
        }
      }
    },
    {
      "caseId": "II-02",
      "callIndex": 1,
      "receipt": {
        "executionId": "invocation_integrity_ii-02_1",
        "toolName": "cart_update",
        "argumentMode": "json-string",
        "rawResult": "{\"ok\":false,\"code\":\"invalid_item\",\"message\":\"The requested cart item is not available in this fixture.\",\"retryable\":true,\"operationId\":\"ii02_update_00000001\",\"replayed\":false,\"stateRevision\":0}",
        "canonicalResult": {
          "code": "invalid_item",
          "message": "The requested cart item is not available in this fixture.",
          "ok": false,
          "operationId": "ii02_update_00000001",
          "replayed": false,
          "retryable": true,
          "stateRevision": 0
        },
        "resultDigest": "3a9abcf175f393014f4e7ce6ff4cdfe0e611d2029934e16f46bdb92285c9a21a",
        "nativeCallCount": 1,
        "handlerTraceId": "event_c810d733-344e-4dbd-ad0a-4f00d6aa9f19",
        "handlerTraceStatus": "expected_error",
        "effectDigest": "76e4478f2617fdd729b98c6f73e877d91d82324da25fc887a4b07b1baef2055e",
        "stateBeforeDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "stateAfterDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "manifestHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40"
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_c810d733-344e-4dbd-ad0a-4f00d6aa9f19",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "parentEventId": "event_4c5d5ab4-aaa3-423d-af02-81f74ac8b181",
        "sequence": 4,
        "source": "native",
        "toolName": "cart_update",
        "operationId": "ii02_update_00000001",
        "observedAt": "2026-08-30T01:04:57.081Z",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "cart_update@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "native-webmcp",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "json-string"
        },
        "status": "expected_error",
        "commitDisposition": "none",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {
            "itemId": "phantom-item",
            "operation": "set_quantity",
            "operationId": "ii02_update_00000001",
            "quantity": 3
          },
          "bytes": "{\"itemId\":\"phantom-item\",\"operation\":\"set_quantity\",\"operationId\":\"ii02_update_00000001\",\"quantity\":3}",
          "sha256": "aa4810539689697c812c75e449e72ae90a3f4fc2b472f7f7af8e120859c8184a"
        },
        "canonicalArguments": {
          "value": {
            "itemId": "phantom-item",
            "operation": "set_quantity",
            "operationId": "ii02_update_00000001",
            "quantity": 3
          },
          "bytes": "{\"itemId\":\"phantom-item\",\"operation\":\"set_quantity\",\"operationId\":\"ii02_update_00000001\",\"quantity\":3}",
          "sha256": "aa4810539689697c812c75e449e72ae90a3f4fc2b472f7f7af8e120859c8184a"
        },
        "rawResult": {
          "value": {
            "code": "invalid_item",
            "message": "The requested cart item is not available in this fixture.",
            "ok": false,
            "operationId": "ii02_update_00000001",
            "replayed": false,
            "retryable": true,
            "stateRevision": 0
          },
          "bytes": "{\"code\":\"invalid_item\",\"message\":\"The requested cart item is not available in this fixture.\",\"ok\":false,\"operationId\":\"ii02_update_00000001\",\"replayed\":false,\"retryable\":true,\"stateRevision\":0}",
          "sha256": "3a9abcf175f393014f4e7ce6ff4cdfe0e611d2029934e16f46bdb92285c9a21a"
        },
        "canonicalResult": {
          "value": {
            "code": "invalid_item",
            "message": "The requested cart item is not available in this fixture.",
            "ok": false,
            "operationId": "ii02_update_00000001",
            "replayed": false,
            "retryable": true,
            "stateRevision": 0
          },
          "bytes": "{\"code\":\"invalid_item\",\"message\":\"The requested cart item is not available in this fixture.\",\"ok\":false,\"operationId\":\"ii02_update_00000001\",\"replayed\":false,\"retryable\":true,\"stateRevision\":0}",
          "sha256": "3a9abcf175f393014f4e7ce6ff4cdfe0e611d2029934e16f46bdb92285c9a21a"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "effect": {
          "stateChanged": false,
          "revision": {
            "before": 0,
            "after": 0,
            "delta": 0,
            "changed": false
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": null,
            "after": null,
            "changed": false
          },
          "unmodeledStateChanged": false
        }
      }
    },
    {
      "caseId": "II-03",
      "callIndex": 1,
      "receipt": {
        "executionId": "invocation_integrity_ii-03_1",
        "toolName": "checkout_request",
        "argumentMode": "json-string",
        "rawResult": "{\"ok\":true,\"code\":\"pending_human_approval\",\"operationId\":\"ii03_request_00000001\",\"replayed\":false,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"requestedFromRevision\":0,\"orderTotalCents\":7300,\"stateRevision\":1}",
        "canonicalResult": {
          "code": "pending_human_approval",
          "ok": true,
          "operationId": "ii03_request_00000001",
          "orderTotalCents": 7300,
          "pendingId": "pending_a9889565b0e5_00000001",
          "replayed": false,
          "requestedFromRevision": 0,
          "stateRevision": 1
        },
        "resultDigest": "ca77d1a411e17ba856d55e59bce2783e43de5534a52d2cfdb45670dc1f3d19a4",
        "nativeCallCount": 1,
        "handlerTraceId": "event_8dfa7534-8ee0-49c2-a1d4-304c651d546d",
        "handlerTraceStatus": "completed",
        "effectDigest": "526aac0627f057fba7a36759685af5dcada4fdbe1e0959a2cc3af9c057af4803",
        "stateBeforeDigest": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
        "stateAfterDigest": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d",
        "manifestHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40"
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_8dfa7534-8ee0-49c2-a1d4-304c651d546d",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "parentEventId": "event_c810d733-344e-4dbd-ad0a-4f00d6aa9f19",
        "sequence": 5,
        "source": "native",
        "toolName": "checkout_request",
        "operationId": "ii03_request_00000001",
        "observedAt": "2026-08-30T01:04:57.084Z",
        "registryHash": "aaf40765a4707d638760b717d86a3a0ee29f1fe601719a8fd85a0f96f5210f40",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "checkout_request@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "native-webmcp",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "json-string"
        },
        "status": "completed",
        "commitDisposition": "committed",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {
            "operationId": "ii03_request_00000001"
          },
          "bytes": "{\"operationId\":\"ii03_request_00000001\"}",
          "sha256": "5b66125f6ba36f124b04c1618b5ff5bb72c49087a4272ca8f6055c793efa1ba1"
        },
        "canonicalArguments": {
          "value": {
            "operationId": "ii03_request_00000001"
          },
          "bytes": "{\"operationId\":\"ii03_request_00000001\"}",
          "sha256": "5b66125f6ba36f124b04c1618b5ff5bb72c49087a4272ca8f6055c793efa1ba1"
        },
        "rawResult": {
          "value": {
            "code": "pending_human_approval",
            "ok": true,
            "operationId": "ii03_request_00000001",
            "orderTotalCents": 7300,
            "pendingId": "pending_a9889565b0e5_00000001",
            "replayed": false,
            "requestedFromRevision": 0,
            "stateRevision": 1
          },
          "bytes": "{\"code\":\"pending_human_approval\",\"ok\":true,\"operationId\":\"ii03_request_00000001\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"replayed\":false,\"requestedFromRevision\":0,\"stateRevision\":1}",
          "sha256": "ca77d1a411e17ba856d55e59bce2783e43de5534a52d2cfdb45670dc1f3d19a4"
        },
        "canonicalResult": {
          "value": {
            "code": "pending_human_approval",
            "ok": true,
            "operationId": "ii03_request_00000001",
            "orderTotalCents": 7300,
            "pendingId": "pending_a9889565b0e5_00000001",
            "replayed": false,
            "requestedFromRevision": 0,
            "stateRevision": 1
          },
          "bytes": "{\"code\":\"pending_human_approval\",\"ok\":true,\"operationId\":\"ii03_request_00000001\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"replayed\":false,\"requestedFromRevision\":0,\"stateRevision\":1}",
          "sha256": "ca77d1a411e17ba856d55e59bce2783e43de5534a52d2cfdb45670dc1f3d19a4"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": null,
            "revision": 0,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":null,\"revision\":0,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "revision": 1,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":{\"cartSnapshotHash\":\"a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"requestOperationId\":\"ii03_request_00000001\",\"requestedFromRevision\":0,\"status\":\"pending_human_approval\"},\"revision\":1,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d"
        },
        "effect": {
          "stateChanged": true,
          "revision": {
            "before": 0,
            "after": 1,
            "delta": 1,
            "changed": true
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": null,
            "after": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "changed": true
          },
          "unmodeledStateChanged": false
        }
      }
    },
    {
      "caseId": "II-03",
      "callIndex": 2,
      "receipt": {
        "executionId": "invocation_integrity_ii-03_2",
        "toolName": "checkout_request",
        "argumentMode": "json-string",
        "rawResult": "{\"ok\":true,\"code\":\"pending_human_approval\",\"operationId\":\"ii03_request_00000001\",\"replayed\":true,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"requestedFromRevision\":0,\"orderTotalCents\":7300,\"stateRevision\":1}",
        "canonicalResult": {
          "code": "pending_human_approval",
          "ok": true,
          "operationId": "ii03_request_00000001",
          "orderTotalCents": 7300,
          "pendingId": "pending_a9889565b0e5_00000001",
          "replayed": true,
          "requestedFromRevision": 0,
          "stateRevision": 1
        },
        "resultDigest": "acf483d639904408a1a5c79d02a7b881c5c945890539f4b6ee88a90006d26aa5",
        "nativeCallCount": 1,
        "handlerTraceId": "event_e8aeb243-5ff4-4239-8957-2adfff979732",
        "handlerTraceStatus": "duplicate",
        "effectDigest": "69f4cb04eca6995c58f6534b30bcd53c617fa5dec009784005c39f4c9b66e657",
        "stateBeforeDigest": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d",
        "stateAfterDigest": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d",
        "manifestHash": "191e7a04618acfc21982a324da3afc0ae5505a7b22dac26652fe047f80025c5f"
      },
      "trace": {
        "traceVersion": "operation-trace@1.0.0",
        "eventId": "event_e8aeb243-5ff4-4239-8957-2adfff979732",
        "sessionId": "session_8dbc3003-2b08-4ba3-b13a-703fa0adadf4",
        "runId": "trajectory_2317c071-32f6-40a9-9e6e-fc182103d855",
        "parentEventId": "event_8dfa7534-8ee0-49c2-a1d4-304c651d546d",
        "sequence": 6,
        "source": "native",
        "toolName": "checkout_request",
        "operationId": "ii03_request_00000001",
        "observedAt": "2026-08-30T01:04:57.111Z",
        "registryHash": "191e7a04618acfc21982a324da3afc0ae5505a7b22dac26652fe047f80025c5f",
        "fixture": {
          "fixtureId": "checkout-seed-v1",
          "fixtureVersion": "checkout-fixture@1.0.0",
          "fixtureSeed": "toolproof-checkout-seed-001"
        },
        "handlerVersion": "checkout_request@1.0.0",
        "domainVersion": "checkout-domain@1.0.0",
        "toolsetVersion": "checkout-toolset-v1@1.0.0",
        "appCommit": "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786",
        "runtime": {
          "executionPath": "native-webmcp",
          "origin": "https://toolproof-rust.vercel.app",
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
          "argumentMode": "json-string"
        },
        "status": "duplicate",
        "commitDisposition": "replayed",
        "cancellationObservedAfterCommit": false,
        "cancellationObservedAfterCompletion": false,
        "rawArguments": {
          "value": {
            "operationId": "ii03_request_00000001"
          },
          "bytes": "{\"operationId\":\"ii03_request_00000001\"}",
          "sha256": "5b66125f6ba36f124b04c1618b5ff5bb72c49087a4272ca8f6055c793efa1ba1"
        },
        "canonicalArguments": {
          "value": {
            "operationId": "ii03_request_00000001"
          },
          "bytes": "{\"operationId\":\"ii03_request_00000001\"}",
          "sha256": "5b66125f6ba36f124b04c1618b5ff5bb72c49087a4272ca8f6055c793efa1ba1"
        },
        "rawResult": {
          "value": {
            "code": "pending_human_approval",
            "ok": true,
            "operationId": "ii03_request_00000001",
            "orderTotalCents": 7300,
            "pendingId": "pending_a9889565b0e5_00000001",
            "replayed": true,
            "requestedFromRevision": 0,
            "stateRevision": 1
          },
          "bytes": "{\"code\":\"pending_human_approval\",\"ok\":true,\"operationId\":\"ii03_request_00000001\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"replayed\":true,\"requestedFromRevision\":0,\"stateRevision\":1}",
          "sha256": "acf483d639904408a1a5c79d02a7b881c5c945890539f4b6ee88a90006d26aa5"
        },
        "canonicalResult": {
          "value": {
            "code": "pending_human_approval",
            "ok": true,
            "operationId": "ii03_request_00000001",
            "orderTotalCents": 7300,
            "pendingId": "pending_a9889565b0e5_00000001",
            "replayed": true,
            "requestedFromRevision": 0,
            "stateRevision": 1
          },
          "bytes": "{\"code\":\"pending_human_approval\",\"ok\":true,\"operationId\":\"ii03_request_00000001\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"replayed\":true,\"requestedFromRevision\":0,\"stateRevision\":1}",
          "sha256": "acf483d639904408a1a5c79d02a7b881c5c945890539f4b6ee88a90006d26aa5"
        },
        "error": {
          "value": null,
          "bytes": "null",
          "sha256": "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        },
        "stateBefore": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "revision": 1,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":{\"cartSnapshotHash\":\"a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"requestOperationId\":\"ii03_request_00000001\",\"requestedFromRevision\":0,\"status\":\"pending_human_approval\"},\"revision\":1,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d"
        },
        "stateAfter": {
          "value": {
            "currency": "USD",
            "fixtureId": "checkout-seed-v1",
            "fixtureVersion": "checkout-fixture@1.0.0",
            "fulfillment": {
              "deliveryNotice": "Simulated estimate; no shipment occurs.",
              "deliveryWindow": "3-5-business-days",
              "shippingCents": 700,
              "shippingLabel": "Standard shipping",
              "shippingMethod": "standard"
            },
            "lines": [
              {
                "itemId": "field-notebook",
                "name": "Field notebook",
                "quantity": 1,
                "unitPriceCents": 1800
              },
              {
                "itemId": "stoneware-mug",
                "name": "Stoneware mug",
                "quantity": 2,
                "unitPriceCents": 2400
              }
            ],
            "pendingCheckout": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "revision": 1,
            "seed": "toolproof-checkout-seed-001"
          },
          "bytes": "{\"currency\":\"USD\",\"fixtureId\":\"checkout-seed-v1\",\"fixtureVersion\":\"checkout-fixture@1.0.0\",\"fulfillment\":{\"deliveryNotice\":\"Simulated estimate; no shipment occurs.\",\"deliveryWindow\":\"3-5-business-days\",\"shippingCents\":700,\"shippingLabel\":\"Standard shipping\",\"shippingMethod\":\"standard\"},\"lines\":[{\"itemId\":\"field-notebook\",\"name\":\"Field notebook\",\"quantity\":1,\"unitPriceCents\":1800},{\"itemId\":\"stoneware-mug\",\"name\":\"Stoneware mug\",\"quantity\":2,\"unitPriceCents\":2400}],\"pendingCheckout\":{\"cartSnapshotHash\":\"a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457\",\"orderTotalCents\":7300,\"pendingId\":\"pending_a9889565b0e5_00000001\",\"requestOperationId\":\"ii03_request_00000001\",\"requestedFromRevision\":0,\"status\":\"pending_human_approval\"},\"revision\":1,\"seed\":\"toolproof-checkout-seed-001\"}",
          "sha256": "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d"
        },
        "effect": {
          "stateChanged": false,
          "revision": {
            "before": 1,
            "after": 1,
            "delta": 0,
            "changed": false
          },
          "quantities": [
            {
              "itemId": "field-notebook",
              "beforeQuantity": 1,
              "afterQuantity": 1,
              "delta": 0,
              "changed": false
            },
            {
              "itemId": "stoneware-mug",
              "beforeQuantity": 2,
              "afterQuantity": 2,
              "delta": 0,
              "changed": false
            }
          ],
          "pendingCheckout": {
            "before": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "after": {
              "cartSnapshotHash": "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
              "orderTotalCents": 7300,
              "pendingId": "pending_a9889565b0e5_00000001",
              "requestOperationId": "ii03_request_00000001",
              "requestedFromRevision": 0,
              "status": "pending_human_approval"
            },
            "changed": false
          },
          "unmodeledStateChanged": false
        }
      }
    }
  ]
}
```

## Limitations

- Thurstone is a testing/audit system, not runtime enforcement.
- This result is not certification or guaranteed security.
- The result is limited to three frozen synthetic cases and the exact tested build; it is not arbitrary-site verification.
- Testing does not prove that a malicious website will behave identically after testing.
- The three-case score is separate from semantic accuracy and must never be combined with the Meaning Matrix denominator.
- Hashes establish internal consistency, not independent attestation.

## Position

**Thurstone tests both sides of a declared WebMCP contract: whether benign requests produce the represented effects, and whether tested hostile invocations preserve site-defined invariants.**

Hashes establish internal consistency, not independent attestation.
