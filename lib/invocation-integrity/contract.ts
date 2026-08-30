import { z } from "zod";

import {
  CHECKOUT_DOMAIN_VERSION,
  cartGet,
  createCheckoutFixture,
  type CheckoutState,
  type MutationResult
} from "@/lib/domain/checkout";
import type { VerifiedCheckoutResetReceipt } from "@/lib/domain/checkout-reset";
import type { CheckoutResetReceipt as DomainCheckoutResetReceipt } from "@/lib/domain/checkout-session";
import { FIXTURE_RESET_HANDLER_VERSION } from "@/lib/evidence/checkout-trace-ledger";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  checkoutEffectDiff,
  type CanonicalEvidence,
  type JsonSafeValue,
  type OperationTrace
} from "@/lib/evidence/operation-trace";
import { normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";
import { CART_UPDATE_HANDLER_VERSION } from "@/lib/webmcp/cart-update-tool";
import { CART_GET_HANDLER_VERSION } from "@/lib/webmcp/cart-get-tool";
import { CHECKOUT_TOOLSET_VERSION, checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import { CHECKOUT_REQUEST_HANDLER_VERSION } from "@/lib/webmcp/checkout-request-tool";
import type {
  ExecuteArgumentMode,
  ExecuteOnceResult,
  RuntimeCompatibilityReceipt
} from "@/lib/webmcp/runtime";

export const INVOCATION_INTEGRITY_VERSION = "thurstone-invocation-integrity@1.0.0";
export const INVOCATION_INTEGRITY_TRANSCRIPT_VERSION =
  "thurstone-invocation-integrity-transcript@2.0.0";
export const INVOCATION_INTEGRITY_PREFLIGHT_VERSION =
  "thurstone-invocation-integrity-preflight@1.0.0";
export const INVOCATION_INTEGRITY_RECEIPT_VERSION = "thurstone-invocation-integrity-receipt@2.0.0";
export const INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION =
  "thurstone-invocation-integrity-failure-input@1.0.0";
export const INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION =
  "thurstone-invocation-integrity-failure-receipt@1.0.0";
export const INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY =
  "self-reported-browser-transcript-verified-against-source-fixed-server-replay" as const;
export const INVOCATION_INTEGRITY_AMENDMENT_PATH =
  "Thurstone_Brief_v2.1_Invocation_Integrity_Amendment.md";
export const INVOCATION_INTEGRITY_AMENDMENT_COMMIT = "feef201241db3d1f4da437bfa3d66a55ca34d178";
export const INVOCATION_INTEGRITY_AMENDMENT_SHA256 =
  "118ab0c19d6be6d82ef631308cff25c0855e41e08ec58aa49bd860d217d0c8c9";

export const INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 =
  "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457";
export const INVOCATION_INTEGRITY_FINAL_STATE_SHA256 =
  "312a6de6c07d096e8ff4689e2ccbd7d2457c0d930af452a6812025a78c38161d";

export const INVOCATION_INTEGRITY_CASE_IDS = ["II-01", "II-02", "II-03"] as const;
export type InvocationIntegrityCaseId = (typeof INVOCATION_INTEGRITY_CASE_IDS)[number];

export const INVOCATION_INTEGRITY_INITIAL_CATALOG = [
  "cart_get",
  "cart_update",
  "checkout_request",
  "order_review"
] as const;
export const INVOCATION_INTEGRITY_PENDING_CATALOG = [
  "cart_get",
  "cart_update",
  "checkout_cancel",
  "checkout_request",
  "order_review"
] as const;
export const INVOCATION_INTEGRITY_STATE_KEYSETS = Object.freeze({
  root: Object.freeze([
    "currency",
    "fixtureId",
    "fixtureVersion",
    "fulfillment",
    "lines",
    "pendingCheckout",
    "revision",
    "seed"
  ]),
  line: Object.freeze(["itemId", "name", "quantity", "unitPriceCents"]),
  fulfillment: Object.freeze([
    "deliveryNotice",
    "deliveryWindow",
    "shippingCents",
    "shippingLabel",
    "shippingMethod"
  ]),
  pendingCheckout: Object.freeze([
    "cartSnapshotHash",
    "orderTotalCents",
    "pendingId",
    "requestOperationId",
    "requestedFromRevision",
    "status"
  ])
});

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Exact raw trace projection of the null-prototype dual-representation calibration object. */
export const INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS = deepFreeze({
  $toolproofTrace: "object_descriptors",
  prototype: "null",
  entries: [
    {
      key: { kind: "symbol", globalKey: null, description: "Symbol.toPrimitive" },
      enumerable: false,
      configurable: false,
      descriptor: "data",
      writable: false,
      value: { $toolproofTrace: "function", name: "value" }
    }
  ]
});

export const INVOCATION_INTEGRITY_PAYLOADS = deepFreeze({
  "II-01": {
    operationId: "ii01_request_00000001",
    cartSnapshotHash: "0".repeat(64),
    orderTotalCents: 1,
    pendingId: "pending_forged_00000001",
    requestOperationId: "attacker_owned_00000001",
    requestedFromRevision: 99,
    status: "pending_human_approval"
  },
  "II-02": {
    operationId: "ii02_update_00000001",
    operation: "set_quantity",
    itemId: "phantom-item",
    quantity: 3
  },
  "II-03": {
    operationId: "ii03_request_00000001"
  }
} as const);

export const INVOCATION_INTEGRITY_EXPECTED_RESULTS = deepFreeze({
  "II-01": [
    {
      ok: false,
      code: "invalid_arguments",
      message: "Arguments do not match the tool's closed input schema.",
      retryable: true,
      operationId: "ii01_request_00000001",
      replayed: false,
      stateRevision: 0
    }
  ],
  "II-02": [
    {
      ok: false,
      code: "invalid_item",
      message: "The requested cart item is not available in this fixture.",
      retryable: true,
      operationId: "ii02_update_00000001",
      replayed: false,
      stateRevision: 0
    }
  ],
  "II-03": [
    {
      ok: true,
      code: "pending_human_approval",
      operationId: "ii03_request_00000001",
      replayed: false,
      pendingId: "pending_a9889565b0e5_00000001",
      requestedFromRevision: 0,
      orderTotalCents: 7300,
      stateRevision: 1
    },
    {
      ok: true,
      code: "pending_human_approval",
      operationId: "ii03_request_00000001",
      replayed: true,
      pendingId: "pending_a9889565b0e5_00000001",
      requestedFromRevision: 0,
      orderTotalCents: 7300,
      stateRevision: 1
    }
  ]
} as const);

export interface InvocationIntegrityFrozenCase {
  readonly caseId: InvocationIntegrityCaseId;
  readonly title: string;
  readonly toolName: "cart_update" | "checkout_request";
  readonly invocations: readonly Readonly<Record<string, unknown>>[];
  readonly preconditions: {
    readonly stateSha256: string;
    readonly revision: number;
    readonly pendingCheckout: null;
    readonly operationLedgerCount: number;
    readonly tombstoneCount: number;
    readonly auditTraceCount: number;
  };
  readonly forbiddenOrServerAuthoritativeInputs: readonly string[];
  readonly expectedDisposition: "rejection-no-op" | "one-transition-then-replay-no-op";
  readonly expectedResults: readonly Readonly<Record<string, unknown>>[];
  readonly postconditions: {
    readonly stateSha256: string;
    readonly revision: number;
    readonly operationLedgerCount: number;
    readonly tombstoneCount: number;
    readonly auditTraceCount: number;
    readonly subscriberCommitCount: number;
  };
  readonly replayPolicy: string;
  readonly trustedStateSource: "source-fixed-server-replay";
}

export const INVOCATION_INTEGRITY_CASES: readonly InvocationIntegrityFrozenCase[] = deepFreeze([
  {
    caseId: "II-01",
    title: "Privileged-field injection",
    toolName: "checkout_request",
    invocations: [INVOCATION_INTEGRITY_PAYLOADS["II-01"]],
    preconditions: {
      stateSha256: INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
      revision: 0,
      pendingCheckout: null,
      operationLedgerCount: 0,
      tombstoneCount: 0,
      auditTraceCount: 0
    },
    forbiddenOrServerAuthoritativeInputs: [
      "cartSnapshotHash",
      "orderTotalCents",
      "pendingId",
      "requestOperationId",
      "requestedFromRevision",
      "status"
    ],
    expectedDisposition: "rejection-no-op",
    expectedResults: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-01"],
    postconditions: {
      stateSha256: INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
      revision: 0,
      operationLedgerCount: 0,
      tombstoneCount: 0,
      auditTraceCount: 1,
      subscriberCommitCount: 0
    },
    replayPolicy: "No replay is permitted.",
    trustedStateSource: "source-fixed-server-replay"
  },
  {
    caseId: "II-02",
    title: "Nonexistent item",
    toolName: "cart_update",
    invocations: [INVOCATION_INTEGRITY_PAYLOADS["II-02"]],
    preconditions: {
      stateSha256: INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
      revision: 0,
      pendingCheckout: null,
      operationLedgerCount: 0,
      tombstoneCount: 0,
      auditTraceCount: 1
    },
    forbiddenOrServerAuthoritativeInputs: ["itemFixtureMembership"],
    expectedDisposition: "rejection-no-op",
    expectedResults: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-02"],
    postconditions: {
      stateSha256: INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
      revision: 0,
      operationLedgerCount: 1,
      tombstoneCount: 1,
      auditTraceCount: 2,
      subscriberCommitCount: 0
    },
    replayPolicy: "No second invocation is permitted.",
    trustedStateSource: "source-fixed-server-replay"
  },
  {
    caseId: "II-03",
    title: "Replay",
    toolName: "checkout_request",
    invocations: [INVOCATION_INTEGRITY_PAYLOADS["II-03"], INVOCATION_INTEGRITY_PAYLOADS["II-03"]],
    preconditions: {
      stateSha256: INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
      revision: 0,
      pendingCheckout: null,
      operationLedgerCount: 1,
      tombstoneCount: 1,
      auditTraceCount: 2
    },
    forbiddenOrServerAuthoritativeInputs: [
      "cartSnapshotHash",
      "orderTotalCents",
      "pendingId",
      "requestOperationId",
      "requestedFromRevision",
      "status"
    ],
    expectedDisposition: "one-transition-then-replay-no-op",
    expectedResults: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-03"],
    postconditions: {
      stateSha256: INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
      revision: 1,
      operationLedgerCount: 2,
      tombstoneCount: 2,
      auditTraceCount: 4,
      subscriberCommitCount: 1
    },
    replayPolicy:
      "The second identical invocation is the frozen replay stimulus; no third invocation is permitted.",
    trustedStateSource: "source-fixed-server-replay"
  }
]);

type InvocationIntegrityStateReference = "initial" | "final";

interface InvocationIntegrityFrozenCallBoundary {
  readonly state: InvocationIntegrityStateReference;
  readonly operationLedgerCount: number;
  readonly tombstoneCount: number;
  readonly auditTraceCount: number;
  readonly subscriberCommitCount: number;
}

export interface InvocationIntegrityFrozenCall {
  readonly caseId: InvocationIntegrityCaseId;
  readonly callIndex: 1 | 2;
  readonly toolName: "cart_update" | "checkout_request";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly manifest: "initial" | "pending";
  readonly trace: {
    readonly status: "validation_error" | "expected_error" | "completed" | "duplicate";
    readonly commitDisposition: "none" | "committed" | "replayed";
    readonly effectApplied: boolean;
    readonly operationId: string;
    readonly canonicalInput: Readonly<Record<string, unknown>> | null;
    readonly canonicalCommand: string | null;
  };
  readonly before: InvocationIntegrityFrozenCallBoundary;
  readonly after: InvocationIntegrityFrozenCallBoundary;
}

function mutationCommand(
  toolName: InvocationIntegrityFrozenCall["toolName"],
  payload: Readonly<Record<string, unknown>>
): string {
  return canonicalJson({ toolName, input: payload });
}

/** Exact per-invocation trace and replay projections frozen by Brief v2.1. */
export const INVOCATION_INTEGRITY_FROZEN_CALLS: readonly InvocationIntegrityFrozenCall[] =
  deepFreeze([
    {
      caseId: "II-01",
      callIndex: 1,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-01"],
      result: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-01"][0],
      manifest: "initial",
      trace: {
        status: "validation_error",
        commitDisposition: "none",
        effectApplied: false,
        operationId: "ii01_request_00000001",
        canonicalInput: null,
        canonicalCommand: null
      },
      before: {
        state: "initial",
        operationLedgerCount: 0,
        tombstoneCount: 0,
        auditTraceCount: 0,
        subscriberCommitCount: 0
      },
      after: {
        state: "initial",
        operationLedgerCount: 0,
        tombstoneCount: 0,
        auditTraceCount: 1,
        subscriberCommitCount: 0
      }
    },
    {
      caseId: "II-02",
      callIndex: 1,
      toolName: "cart_update",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-02"],
      result: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-02"][0],
      manifest: "initial",
      trace: {
        status: "expected_error",
        commitDisposition: "none",
        effectApplied: false,
        operationId: "ii02_update_00000001",
        canonicalInput: INVOCATION_INTEGRITY_PAYLOADS["II-02"],
        canonicalCommand: mutationCommand("cart_update", INVOCATION_INTEGRITY_PAYLOADS["II-02"])
      },
      before: {
        state: "initial",
        operationLedgerCount: 0,
        tombstoneCount: 0,
        auditTraceCount: 1,
        subscriberCommitCount: 0
      },
      after: {
        state: "initial",
        operationLedgerCount: 1,
        tombstoneCount: 1,
        auditTraceCount: 2,
        subscriberCommitCount: 0
      }
    },
    {
      caseId: "II-03",
      callIndex: 1,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
      result: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-03"][0],
      manifest: "initial",
      trace: {
        status: "completed",
        commitDisposition: "committed",
        effectApplied: true,
        operationId: "ii03_request_00000001",
        canonicalInput: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
        canonicalCommand: mutationCommand(
          "checkout_request",
          INVOCATION_INTEGRITY_PAYLOADS["II-03"]
        )
      },
      before: {
        state: "initial",
        operationLedgerCount: 1,
        tombstoneCount: 1,
        auditTraceCount: 2,
        subscriberCommitCount: 0
      },
      after: {
        state: "final",
        operationLedgerCount: 2,
        tombstoneCount: 2,
        auditTraceCount: 3,
        subscriberCommitCount: 1
      }
    },
    {
      caseId: "II-03",
      callIndex: 2,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
      result: INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-03"][1],
      manifest: "pending",
      trace: {
        status: "duplicate",
        commitDisposition: "replayed",
        effectApplied: false,
        operationId: "ii03_request_00000001",
        canonicalInput: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
        canonicalCommand: mutationCommand(
          "checkout_request",
          INVOCATION_INTEGRITY_PAYLOADS["II-03"]
        )
      },
      before: {
        state: "final",
        operationLedgerCount: 2,
        tombstoneCount: 2,
        auditTraceCount: 3,
        subscriberCommitCount: 1
      },
      after: {
        state: "final",
        operationLedgerCount: 2,
        tombstoneCount: 2,
        auditTraceCount: 4,
        subscriberCommitCount: 1
      }
    }
  ]);

export interface InvocationIntegrityObservedCall {
  readonly caseId: InvocationIntegrityCaseId;
  readonly callIndex: 1 | 2;
  readonly receipt: ExecuteOnceResult;
  readonly trace: OperationTrace;
}

export interface InvocationIntegrityDescriptorProjection {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
  };
  readonly origin: string;
}

export function projectInvocationIntegrityDescriptors(
  tools: readonly {
    readonly name: string;
    readonly title?: string;
    readonly description: string;
    readonly inputSchema?: unknown;
    readonly annotations?: Readonly<WebMCP.ToolAnnotations>;
    readonly origin: string;
  }[]
): readonly InvocationIntegrityDescriptorProjection[] {
  const projected = tools
    .map((tool) => {
      const inputSchema = normalizeInputSchema(tool.inputSchema);
      let originValid = false;
      try {
        const url = new URL(tool.origin);
        originValid = url.protocol === "http:" || url.protocol === "https:";
      } catch {
        originValid = false;
      }
      if (!tool.title || inputSchema === null || !originValid) {
        throw new TypeError("invocation_integrity_descriptor_projection_invalid");
      }
      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? false,
          untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
        },
        origin: tool.origin
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return deepFreeze(
    JSON.parse(canonicalJson(projected)) as InvocationIntegrityDescriptorProjection[]
  );
}

export interface InvocationIntegrityRuntimeBoundary {
  readonly secureContext: true;
  readonly providerRegistration: true;
  readonly inPageDiscovery: true;
  readonly inPageExecution: true;
  readonly origin: string;
  readonly appCommit: string;
  readonly argumentMode: ExecuteArgumentMode;
  readonly userAgent: string;
  readonly initialCatalog: readonly string[];
  readonly pendingCatalog: readonly string[];
  readonly initialManifestHash: string;
  readonly pendingManifestHash: string;
}

export interface InvocationIntegrityPostResetBoundary {
  readonly inspection: {
    readonly sessionId: string;
    readonly trajectoryId: string;
    readonly state: CheckoutState;
    readonly stateHash: typeof INVOCATION_INTEGRITY_INITIAL_STATE_SHA256;
    readonly haltedReason: null;
    readonly currentOperationCount: 0;
    readonly retainedTombstoneCount: 0;
    readonly currentTraceCount: 0;
    readonly archivedTrajectoryCount: 1;
    readonly lastResetTraceEventId: string;
  };
  readonly trajectory: {
    readonly currentTraceCount: 0;
    readonly archivedTrajectoryCount: 1;
    readonly archivedTraceCount: 1;
    readonly resetTraceCount: 1;
    readonly totalTraceCount: 2;
  };
}

export interface InvocationIntegrityMeasuredPreflight {
  readonly preflightVersion: typeof INVOCATION_INTEGRITY_PREFLIGHT_VERSION;
  readonly initialDescriptors: readonly InvocationIntegrityDescriptorProjection[];
  readonly pendingDescriptors: readonly InvocationIntegrityDescriptorProjection[];
  readonly compatibility: {
    readonly receipt: RuntimeCompatibilityReceipt;
    readonly trace: OperationTrace;
  };
  readonly reset: {
    readonly domainReceipt: DomainCheckoutResetReceipt;
    readonly verifiedReceipt: VerifiedCheckoutResetReceipt;
    readonly trace: OperationTrace;
  };
  readonly caseTraceOffset: 2;
  readonly postReset: InvocationIntegrityPostResetBoundary;
}

export interface InvocationIntegrityFailurePreflight extends Omit<
  InvocationIntegrityMeasuredPreflight,
  "pendingDescriptors"
> {
  readonly pendingDescriptors: readonly InvocationIntegrityDescriptorProjection[] | null;
}

export interface InvocationIntegrityFailureRuntimeBoundary extends Omit<
  InvocationIntegrityRuntimeBoundary,
  "pendingCatalog" | "pendingManifestHash"
> {
  readonly pendingCatalog: readonly string[] | null;
  readonly pendingManifestHash: string | null;
}

export interface InvocationIntegrityTranscript {
  readonly transcriptVersion: typeof INVOCATION_INTEGRITY_TRANSCRIPT_VERSION;
  readonly runtime: InvocationIntegrityRuntimeBoundary;
  readonly preflight: InvocationIntegrityMeasuredPreflight;
  readonly calls: readonly [
    InvocationIntegrityObservedCall,
    InvocationIntegrityObservedCall,
    InvocationIntegrityObservedCall,
    InvocationIntegrityObservedCall
  ];
}

export interface InvocationIntegrityTerminalInspection {
  readonly sessionId: string;
  readonly trajectoryId: string;
  readonly state: CheckoutState;
  readonly stateHash: string;
  readonly stateRevision: number;
  readonly currentOperationCount: number;
  readonly retainedTombstoneCount: number;
  readonly currentTraceCount: number;
  readonly totalTraceCount: number;
  readonly haltedReason: {
    readonly code: "subscriber_failure" | "trace_sink_failure";
    readonly eventId: string;
    readonly observedAt: string;
    readonly message: string;
  } | null;
  readonly lastTraceEventId: string | null;
}

export interface InvocationIntegritySafeFailureError {
  readonly stage: "native" | "verification";
  readonly name: string;
  readonly message: string;
  readonly code: string | null;
  readonly nativeCallMade: boolean;
  readonly rawResultSha256: string | null;
}

export interface InvocationIntegrityFailureInput {
  readonly failureInputVersion: typeof INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION;
  readonly runtime: InvocationIntegrityFailureRuntimeBoundary;
  readonly preflight: InvocationIntegrityFailurePreflight;
  readonly completedCalls: readonly InvocationIntegrityObservedCall[];
  readonly error: InvocationIntegritySafeFailureError;
  readonly terminalInspection: InvocationIntegrityTerminalInspection;
  readonly failedAt: string;
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const isoTimestampSchema = z.iso.datetime({ offset: false });
const jsonSafeSchema: z.ZodType<JsonSafeValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonSafeSchema),
    z.record(z.string(), jsonSafeSchema)
  ])
);
const checkoutLineSchema = z
  .object({
    itemId: z.enum(["field-notebook", "stoneware-mug"]),
    name: z.string(),
    quantity: z.number().int(),
    unitPriceCents: z.number().int()
  })
  .strict();
const fulfillmentSchema = z
  .object({
    shippingMethod: z.literal("standard"),
    shippingLabel: z.literal("Standard shipping"),
    shippingCents: z.literal(700),
    deliveryWindow: z.literal("3-5-business-days"),
    deliveryNotice: z.literal("Simulated estimate; no shipment occurs.")
  })
  .strict();
const pendingCheckoutSchema = z
  .object({
    status: z.literal("pending_human_approval"),
    pendingId: z.string().min(1),
    requestOperationId: z.string().min(1),
    requestedFromRevision: z.number().int().nonnegative(),
    cartSnapshotHash: hashSchema,
    orderTotalCents: z.number().int().nonnegative()
  })
  .strict();
const checkoutStateSchema = z
  .object({
    fixtureId: z.literal("checkout-seed-v1"),
    fixtureVersion: z.literal("checkout-fixture@1.0.0"),
    seed: z.literal("toolproof-checkout-seed-001"),
    revision: z.number().int().nonnegative(),
    currency: z.literal("USD"),
    lines: z.tuple([checkoutLineSchema, checkoutLineSchema]),
    fulfillment: fulfillmentSchema,
    pendingCheckout: pendingCheckoutSchema.nullable()
  })
  .strict();
const canonicalEvidenceSchema = z
  .object({ value: jsonSafeSchema, bytes: z.string(), sha256: hashSchema })
  .strict();
const checkoutEffectSchema = z
  .object({
    stateChanged: z.boolean(),
    revision: z
      .object({
        before: z.number().int(),
        after: z.number().int(),
        delta: z.number().int(),
        changed: z.boolean()
      })
      .strict(),
    quantities: z
      .array(
        z
          .object({
            itemId: z.string(),
            beforeQuantity: z.number().int().nullable(),
            afterQuantity: z.number().int().nullable(),
            delta: z.number().int().nullable(),
            changed: z.boolean()
          })
          .strict()
      )
      .length(2),
    pendingCheckout: z
      .object({ before: jsonSafeSchema, after: jsonSafeSchema, changed: z.boolean() })
      .strict(),
    unmodeledStateChanged: z.boolean()
  })
  .strict();
const operationTraceSchema = z
  .object({
    traceVersion: z.literal("operation-trace@1.0.0"),
    eventId: z.string().min(1),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    parentEventId: z.string().min(1).nullable(),
    sequence: z.number().int().positive(),
    source: z.enum(["ui", "native"]),
    toolName: z.string().min(1),
    operationId: z.string().min(1).nullable(),
    observedAt: isoTimestampSchema,
    registryHash: hashSchema,
    fixture: z
      .object({
        fixtureId: z.literal("checkout-seed-v1"),
        fixtureVersion: z.literal("checkout-fixture@1.0.0"),
        fixtureSeed: z.literal("toolproof-checkout-seed-001")
      })
      .strict(),
    handlerVersion: z.string().min(1),
    domainVersion: z.string().min(1),
    toolsetVersion: z.string().min(1),
    appCommit: commitSchema,
    runtime: z
      .object({
        executionPath: z.enum(["ui", "native-webmcp"]),
        origin: z.string().min(1),
        userAgent: z.string().min(1),
        argumentMode: z.enum(["not-applicable", "unverified", "object", "json-string"])
      })
      .strict(),
    status: z.enum([
      "completed",
      "validation_error",
      "expected_error",
      "unexpected_error",
      "duplicate",
      "canceled",
      "partial"
    ]),
    commitDisposition: z.enum(["none", "committed", "replayed", "partial"]),
    cancellationObservedAfterCommit: z.boolean(),
    cancellationObservedAfterCompletion: z.boolean(),
    rawArguments: canonicalEvidenceSchema,
    canonicalArguments: canonicalEvidenceSchema.nullable(),
    rawResult: canonicalEvidenceSchema.nullable(),
    canonicalResult: canonicalEvidenceSchema.nullable(),
    error: canonicalEvidenceSchema.nullable(),
    stateBefore: canonicalEvidenceSchema,
    stateAfter: canonicalEvidenceSchema,
    effect: checkoutEffectSchema
  })
  .strict();
const nativeReceiptSchema = z
  .object({
    executionId: z.string().min(1),
    toolName: z.string().min(1),
    argumentMode: z.enum(["object", "json-string"]),
    rawResult: z.string(),
    canonicalResult: jsonSafeSchema,
    resultDigest: hashSchema,
    nativeCallCount: z.literal(1),
    handlerTraceId: z.string().min(1),
    handlerTraceStatus: z.string().min(1),
    effectDigest: hashSchema,
    stateBeforeDigest: hashSchema,
    stateAfterDigest: hashSchema,
    manifestHash: hashSchema
  })
  .strict();
const compatibilityReceiptSchema = z
  .object({
    status: z.literal("compatibility-verified"),
    argumentMode: z.enum(["object", "json-string"]),
    toolName: z.literal("cart_get"),
    nativeCallCount: z.literal(1),
    coercionCount: z.union([z.literal(0), z.literal(1)]),
    rawResult: z.string(),
    canonicalResult: jsonSafeSchema,
    resultDigest: hashSchema,
    handlerTraceId: z.string().min(1),
    effectDigest: hashSchema,
    stateBeforeDigest: hashSchema,
    stateAfterDigest: hashSchema,
    manifestHashBefore: hashSchema,
    manifestHashAfter: hashSchema,
    registrationGeneration: z.number().int().positive()
  })
  .strict();
const descriptorProjectionSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), jsonSafeSchema),
    annotations: z
      .object({ readOnlyHint: z.boolean(), untrustedContentHint: z.boolean() })
      .strict(),
    origin: z.string().url()
  })
  .strict();
const resetCoreSchema = z
  .object({
    fixtureId: z.literal("checkout-seed-v1"),
    fixtureVersion: z.literal("checkout-fixture@1.0.0"),
    fixtureSeed: z.literal("toolproof-checkout-seed-001"),
    stateRevision: z.literal(0),
    stateHash: z.literal(INVOCATION_INTEGRITY_INITIAL_STATE_SHA256),
    pendingCheckout: z.null(),
    lines: z.tuple([
      z.object({ itemId: z.literal("field-notebook"), quantity: z.literal(1) }).strict(),
      z.object({ itemId: z.literal("stoneware-mug"), quantity: z.literal(2) }).strict()
    ]),
    currentOperationCount: z.literal(0)
  })
  .strict();
const domainResetReceiptSchema = z
  .object({
    ok: z.literal(true),
    code: z.literal("fixture_reset"),
    receiptScope: z.literal("domain_core"),
    registryVerification: z.literal("pending"),
    resetId: z.string().min(1),
    resetEventId: z.string().min(1),
    resetAt: isoTimestampSchema,
    sessionId: z.string().min(1),
    trajectoryId: z.string().min(1),
    archivedTrajectoryId: z.string().min(1),
    archivedEventCount: z.literal(1),
    retainedTombstoneCount: z.literal(0),
    core: resetCoreSchema,
    coreHash: hashSchema
  })
  .strict();
const verifiedResetReceiptSchema = z
  .object({
    receiptVersion: z.literal("checkout-reset@1"),
    status: z.literal("verified"),
    resetId: z.string().min(1),
    fixtureId: z.literal("checkout-seed-v1"),
    fixtureVersion: z.literal("checkout-fixture@1.0.0"),
    seed: z.literal("toolproof-checkout-seed-001"),
    stateRevision: z.literal(0),
    stateHash: z.literal(INVOCATION_INTEGRITY_INITIAL_STATE_SHA256),
    expectedStateHash: z.literal(INVOCATION_INTEGRITY_INITIAL_STATE_SHA256),
    registryHash: hashSchema,
    registeredToolNames: z.tuple([
      z.literal("cart_get"),
      z.literal("cart_update"),
      z.literal("checkout_request"),
      z.literal("order_review")
    ]),
    operationLedgerCount: z.literal(0),
    currentTrajectoryCount: z.literal(0),
    checkedAt: isoTimestampSchema
  })
  .strict();
const postResetBoundarySchema = z
  .object({
    inspection: z
      .object({
        sessionId: z.string().min(1),
        trajectoryId: z.string().min(1),
        state: checkoutStateSchema,
        stateHash: z.literal(INVOCATION_INTEGRITY_INITIAL_STATE_SHA256),
        haltedReason: z.null(),
        currentOperationCount: z.literal(0),
        retainedTombstoneCount: z.literal(0),
        currentTraceCount: z.literal(0),
        archivedTrajectoryCount: z.literal(1),
        lastResetTraceEventId: z.string().min(1)
      })
      .strict(),
    trajectory: z
      .object({
        currentTraceCount: z.literal(0),
        archivedTrajectoryCount: z.literal(1),
        archivedTraceCount: z.literal(1),
        resetTraceCount: z.literal(1),
        totalTraceCount: z.literal(2)
      })
      .strict()
  })
  .strict();
const preflightSchema = z
  .object({
    preflightVersion: z.literal(INVOCATION_INTEGRITY_PREFLIGHT_VERSION),
    initialDescriptors: z
      .array(descriptorProjectionSchema)
      .length(INVOCATION_INTEGRITY_INITIAL_CATALOG.length),
    pendingDescriptors: z
      .array(descriptorProjectionSchema)
      .length(INVOCATION_INTEGRITY_PENDING_CATALOG.length),
    compatibility: z
      .object({ receipt: compatibilityReceiptSchema, trace: operationTraceSchema })
      .strict(),
    reset: z
      .object({
        domainReceipt: domainResetReceiptSchema,
        verifiedReceipt: verifiedResetReceiptSchema,
        trace: operationTraceSchema
      })
      .strict(),
    caseTraceOffset: z.literal(2),
    postReset: postResetBoundarySchema
  })
  .strict();
const runtimeBoundarySchema = z
  .object({
    secureContext: z.literal(true),
    providerRegistration: z.literal(true),
    inPageDiscovery: z.literal(true),
    inPageExecution: z.literal(true),
    origin: z.string().url(),
    appCommit: commitSchema,
    argumentMode: z.enum(["object", "json-string"]),
    userAgent: z.string().min(1).max(1_024),
    initialCatalog: z.tuple([
      z.literal("cart_get"),
      z.literal("cart_update"),
      z.literal("checkout_request"),
      z.literal("order_review")
    ]),
    pendingCatalog: z.tuple([
      z.literal("cart_get"),
      z.literal("cart_update"),
      z.literal("checkout_cancel"),
      z.literal("checkout_request"),
      z.literal("order_review")
    ]),
    initialManifestHash: hashSchema,
    pendingManifestHash: hashSchema
  })
  .strict();
const fixedCallSchema = (caseId: InvocationIntegrityCaseId, callIndex: 1 | 2) =>
  z
    .object({
      caseId: z.literal(caseId),
      callIndex: z.literal(callIndex),
      receipt: nativeReceiptSchema,
      trace: operationTraceSchema
    })
    .strict();

const transcriptSchema = z
  .object({
    transcriptVersion: z.literal(INVOCATION_INTEGRITY_TRANSCRIPT_VERSION),
    runtime: runtimeBoundarySchema,
    preflight: preflightSchema,
    calls: z.tuple([
      fixedCallSchema("II-01", 1),
      fixedCallSchema("II-02", 1),
      fixedCallSchema("II-03", 1),
      fixedCallSchema("II-03", 2)
    ])
  })
  .strict();

const terminalInspectionSchema = z
  .object({
    sessionId: z.string().min(1),
    trajectoryId: z.string().min(1),
    state: checkoutStateSchema,
    stateHash: hashSchema,
    stateRevision: z.number().int().nonnegative(),
    currentOperationCount: z.number().int().nonnegative(),
    retainedTombstoneCount: z.number().int().nonnegative(),
    currentTraceCount: z.number().int().nonnegative(),
    totalTraceCount: z.number().int().nonnegative(),
    haltedReason: z
      .object({
        code: z.enum(["subscriber_failure", "trace_sink_failure"]),
        eventId: z.string().min(1),
        observedAt: isoTimestampSchema,
        message: z.string().min(1).max(500)
      })
      .strict()
      .nullable(),
    lastTraceEventId: z.string().min(1).nullable()
  })
  .strict();
const safeFailureErrorSchema = z
  .object({
    stage: z.enum(["native", "verification"]),
    name: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    code: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{1,80}$/u)
      .nullable(),
    nativeCallMade: z.boolean(),
    rawResultSha256: hashSchema.nullable()
  })
  .strict();
const observedCallSchema = z.union([
  fixedCallSchema("II-01", 1),
  fixedCallSchema("II-02", 1),
  fixedCallSchema("II-03", 1),
  fixedCallSchema("II-03", 2)
]);
const failureRuntimeBoundarySchema = runtimeBoundarySchema.extend({
  pendingCatalog: runtimeBoundarySchema.shape.pendingCatalog.nullable(),
  pendingManifestHash: hashSchema.nullable()
});
const failurePreflightSchema = preflightSchema.extend({
  pendingDescriptors: preflightSchema.shape.pendingDescriptors.nullable()
});
const failureInputSchema = z
  .object({
    failureInputVersion: z.literal(INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION),
    runtime: failureRuntimeBoundarySchema,
    preflight: failurePreflightSchema,
    completedCalls: z.array(observedCallSchema).max(4),
    error: safeFailureErrorSchema,
    terminalInspection: terminalInspectionSchema,
    failedAt: isoTimestampSchema
  })
  .strict();

export function parseInvocationIntegrityTranscript(input: unknown): InvocationIntegrityTranscript {
  return transcriptSchema.parse(input) as unknown as InvocationIntegrityTranscript;
}

export function parseInvocationIntegrityFailureInput(
  input: unknown
): InvocationIntegrityFailureInput {
  return failureInputSchema.parse(input) as unknown as InvocationIntegrityFailureInput;
}

export interface InvocationIntegrityAssertion {
  readonly assertionId: string;
  readonly passed: true;
}

const INVOCATION_INTEGRITY_BASE_ASSERTION_IDS = Object.freeze([
  "source_fixed_invocation",
  "native_webmcp_trace_binding",
  "exact_expected_outcome",
  "trusted_state_keysets",
  "trusted_state_hashes",
  "domain_operation_ledger_diff",
  "audit_trace_diff",
  "subscriber_commit_count",
  "no_unmodeled_state"
] as const);

export function invocationIntegrityAssertionIds(
  caseId: InvocationIntegrityCaseId
): readonly string[] {
  return Object.freeze([
    ...INVOCATION_INTEGRITY_BASE_ASSERTION_IDS,
    ...(caseId === "II-03" ? (["one_commit_then_replay_no_op"] as const) : [])
  ]);
}

export interface InvocationIntegrityLedgerDiff {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface InvocationIntegrityStateEvidence {
  readonly value: CheckoutState;
  readonly sha256: string;
  readonly keysets: {
    readonly root: readonly string[];
    readonly line: readonly string[];
    readonly fulfillment: readonly string[];
    readonly pendingCheckout: readonly string[];
  };
}

export interface InvocationIntegrityResultRow {
  readonly caseId: InvocationIntegrityCaseId;
  readonly title: string;
  readonly toolName: "cart_update" | "checkout_request";
  readonly exactInvocations: readonly Readonly<Record<string, unknown>>[];
  readonly expectedOutcome: readonly Readonly<Record<string, unknown>>[];
  readonly actualOutcome: readonly MutationResult[];
  readonly trustedStateBefore: InvocationIntegrityStateEvidence;
  readonly trustedStateAfter: InvocationIntegrityStateEvidence;
  readonly domainOperationLedgerDiff: InvocationIntegrityLedgerDiff;
  readonly tombstoneDiff: InvocationIntegrityLedgerDiff;
  readonly auditTraceDiff: InvocationIntegrityLedgerDiff;
  readonly subscriberCommitCount: number;
  readonly assertions: readonly InvocationIntegrityAssertion[];
  readonly browserObservationDigests: readonly string[];
  readonly trustedObservationDigests: readonly string[];
  readonly buildSha: string;
  readonly timestamp: string;
  readonly passed: true;
  readonly rowDigest: string;
}

export interface InvocationIntegrityReceipt {
  readonly receiptVersion: typeof INVOCATION_INTEGRITY_RECEIPT_VERSION;
  readonly status: "verified";
  readonly amendment: {
    readonly path: typeof INVOCATION_INTEGRITY_AMENDMENT_PATH;
    readonly commit: typeof INVOCATION_INTEGRITY_AMENDMENT_COMMIT;
    readonly sha256: typeof INVOCATION_INTEGRITY_AMENDMENT_SHA256;
  };
  readonly buildSha: string;
  readonly initialManifestHash: string;
  readonly pendingManifestHash: string;
  readonly trustedStateSource: "source-fixed-server-replay";
  readonly browserEvidenceBoundary: typeof INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY;
  readonly measuredTranscript: InvocationIntegrityTranscript;
  readonly measuredTranscriptDigest: string;
  readonly modelCallCount: 0;
  readonly includedInSemanticDenominator: false;
  readonly rows: readonly InvocationIntegrityResultRow[];
  readonly score: {
    readonly earned: 3;
    readonly possible: 3;
    readonly label: "3/3";
  };
  readonly finalStateSha256: typeof INVOCATION_INTEGRITY_FINAL_STATE_SHA256;
  readonly completedAt: string;
  readonly receiptDigest: string;
}

export interface InvocationIntegrityFailureReceipt {
  readonly receiptVersion: typeof INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION;
  readonly status: "failed";
  readonly buildSha: string;
  readonly origin: string;
  readonly browserEvidenceBoundary: typeof INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY;
  readonly runtime: InvocationIntegrityFailureRuntimeBoundary;
  readonly preflight: InvocationIntegrityFailurePreflight;
  readonly preflightDigest: string;
  readonly completedCalls: readonly InvocationIntegrityObservedCall[];
  readonly completedCallsDigest: string;
  readonly error: InvocationIntegritySafeFailureError;
  readonly terminalInspection: InvocationIntegrityTerminalInspection;
  readonly terminalInspectionDigest: string;
  readonly score: {
    readonly earned: 0 | 1 | 2;
    readonly possible: 3;
    readonly label: "0/3" | "1/3" | "2/3";
  };
  readonly claimPosition: "forbidden";
  readonly claimAllowed: false;
  readonly modelCallCount: 0;
  readonly includedInSemanticDenominator: false;
  readonly failedAt: string;
  readonly receiptDigest: string;
}

const ledgerDiffSchema = z
  .object({
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
    delta: z.number().int().nonnegative()
  })
  .strict();
const keysetsSchema = z
  .object({
    root: z.array(z.string()),
    line: z.array(z.string()),
    fulfillment: z.array(z.string()),
    pendingCheckout: z.array(z.string())
  })
  .strict();
const stateEvidenceSchema = z
  .object({ value: z.unknown(), sha256: hashSchema, keysets: keysetsSchema })
  .strict();
const assertionSchema = z
  .object({ assertionId: z.string().min(1), passed: z.literal(true) })
  .strict();
const resultRowSchema = z
  .object({
    caseId: z.enum(INVOCATION_INTEGRITY_CASE_IDS),
    title: z.string().min(1),
    toolName: z.enum(["cart_update", "checkout_request"]),
    exactInvocations: z.array(z.record(z.string(), z.unknown())).min(1).max(2),
    expectedOutcome: z.array(z.record(z.string(), z.unknown())).min(1).max(2),
    actualOutcome: z.array(z.record(z.string(), z.unknown())).min(1).max(2),
    trustedStateBefore: stateEvidenceSchema,
    trustedStateAfter: stateEvidenceSchema,
    domainOperationLedgerDiff: ledgerDiffSchema,
    tombstoneDiff: ledgerDiffSchema,
    auditTraceDiff: ledgerDiffSchema,
    subscriberCommitCount: z.number().int().nonnegative(),
    assertions: z.array(assertionSchema).min(1),
    browserObservationDigests: z.array(hashSchema).min(1).max(2),
    trustedObservationDigests: z.array(hashSchema).min(1).max(2),
    buildSha: commitSchema,
    timestamp: z.iso.datetime({ offset: false }),
    passed: z.literal(true),
    rowDigest: hashSchema
  })
  .strict();
const receiptSchema = z
  .object({
    receiptVersion: z.literal(INVOCATION_INTEGRITY_RECEIPT_VERSION),
    status: z.literal("verified"),
    amendment: z
      .object({
        path: z.literal(INVOCATION_INTEGRITY_AMENDMENT_PATH),
        commit: z.literal(INVOCATION_INTEGRITY_AMENDMENT_COMMIT),
        sha256: z.literal(INVOCATION_INTEGRITY_AMENDMENT_SHA256)
      })
      .strict(),
    buildSha: commitSchema,
    initialManifestHash: hashSchema,
    pendingManifestHash: hashSchema,
    trustedStateSource: z.literal("source-fixed-server-replay"),
    browserEvidenceBoundary: z.literal(INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY),
    measuredTranscript: transcriptSchema,
    measuredTranscriptDigest: hashSchema,
    modelCallCount: z.literal(0),
    includedInSemanticDenominator: z.literal(false),
    rows: z.array(resultRowSchema).length(3),
    score: z
      .object({ earned: z.literal(3), possible: z.literal(3), label: z.literal("3/3") })
      .strict(),
    finalStateSha256: z.literal(INVOCATION_INTEGRITY_FINAL_STATE_SHA256),
    completedAt: z.iso.datetime({ offset: false }),
    receiptDigest: hashSchema
  })
  .strict();
const failureScoreSchema = z.union([
  z.object({ earned: z.literal(0), possible: z.literal(3), label: z.literal("0/3") }).strict(),
  z.object({ earned: z.literal(1), possible: z.literal(3), label: z.literal("1/3") }).strict(),
  z.object({ earned: z.literal(2), possible: z.literal(3), label: z.literal("2/3") }).strict()
]);
const failureReceiptSchema = z
  .object({
    receiptVersion: z.literal(INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION),
    status: z.literal("failed"),
    buildSha: commitSchema,
    origin: z.string().url(),
    browserEvidenceBoundary: z.literal(INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY),
    runtime: failureRuntimeBoundarySchema,
    preflight: failurePreflightSchema,
    preflightDigest: hashSchema,
    completedCalls: z.array(observedCallSchema).max(4),
    completedCallsDigest: hashSchema,
    error: safeFailureErrorSchema,
    terminalInspection: terminalInspectionSchema,
    terminalInspectionDigest: hashSchema,
    score: failureScoreSchema,
    claimPosition: z.literal("forbidden"),
    claimAllowed: z.literal(false),
    modelCallCount: z.literal(0),
    includedInSemanticDenominator: z.literal(false),
    failedAt: isoTimestampSchema,
    receiptDigest: hashSchema
  })
  .strict();

export function parseInvocationIntegrityReceipt(input: unknown): InvocationIntegrityReceipt {
  return receiptSchema.parse(input) as unknown as InvocationIntegrityReceipt;
}

export function parseInvocationIntegrityFailureReceipt(
  input: unknown
): InvocationIntegrityFailureReceipt {
  return failureReceiptSchema.parse(input) as unknown as InvocationIntegrityFailureReceipt;
}

async function verifyPortableCanonicalEvidence(
  evidence: CanonicalEvidence | null,
  expected: unknown,
  code: string
): Promise<void> {
  if (!evidence) throw new TypeError(code);
  const bytes = canonicalJson(expected);
  if (
    canonicalJson(evidence.value) !== bytes ||
    evidence.bytes !== bytes ||
    evidence.sha256 !== (await canonicalSha256(expected))
  ) {
    throw new TypeError(code);
  }
}

async function verifyPortableMeasuredPreflight(receipt: InvocationIntegrityReceipt): Promise<void> {
  const runtime = receipt.measuredTranscript.runtime;
  const preflight = receipt.measuredTranscript.preflight;
  const initialState = createCheckoutFixture();
  const pendingState = receipt.rows[2]!.trustedStateAfter.value;
  const expectedInitialDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(initialState).manifest.map((tool) => ({
      ...tool,
      origin: runtime.origin
    }))
  );
  const expectedPendingDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(pendingState).manifest.map((tool) => ({
      ...tool,
      origin: runtime.origin
    }))
  );
  if (
    canonicalJson(preflight.initialDescriptors) !== canonicalJson(expectedInitialDescriptors) ||
    canonicalJson(preflight.pendingDescriptors) !== canonicalJson(expectedPendingDescriptors)
  ) {
    throw new TypeError("invocation_integrity_receipt_preflight_descriptor_mismatch");
  }

  const compatibility = preflight.compatibility;
  const compatibilityTrace = compatibility.trace;
  const expectedCart = cartGet(initialState);
  const expectedEffect = checkoutEffectDiff(initialState, initialState);
  const expectedRawArguments =
    runtime.argumentMode === "object" ? INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS : {};
  let rawCompatibilityResult: unknown;
  try {
    rawCompatibilityResult = JSON.parse(compatibility.receipt.rawResult) as unknown;
  } catch {
    throw new TypeError("invocation_integrity_receipt_preflight_compatibility_result_invalid");
  }
  if (
    compatibility.receipt.argumentMode !== runtime.argumentMode ||
    compatibility.receipt.coercionCount !== (runtime.argumentMode === "json-string" ? 1 : 0) ||
    compatibility.receipt.handlerTraceId !== compatibilityTrace.eventId ||
    compatibility.receipt.resultDigest !== (await canonicalSha256(expectedCart)) ||
    compatibility.receipt.effectDigest !== (await canonicalSha256(expectedEffect)) ||
    compatibility.receipt.stateBeforeDigest !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    compatibility.receipt.stateAfterDigest !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    compatibility.receipt.manifestHashBefore !== receipt.initialManifestHash ||
    compatibility.receipt.manifestHashAfter !== receipt.initialManifestHash ||
    canonicalJson(rawCompatibilityResult) !== canonicalJson(expectedCart) ||
    canonicalJson(compatibility.receipt.canonicalResult) !== canonicalJson(expectedCart) ||
    compatibilityTrace.source !== "native" ||
    compatibilityTrace.toolName !== "cart_get" ||
    compatibilityTrace.operationId !== null ||
    compatibilityTrace.sequence !== 1 ||
    compatibilityTrace.parentEventId !== null ||
    compatibilityTrace.registryHash !== receipt.initialManifestHash ||
    compatibilityTrace.handlerVersion !== CART_GET_HANDLER_VERSION ||
    compatibilityTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    compatibilityTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    compatibilityTrace.appCommit !== receipt.buildSha ||
    compatibilityTrace.status !== "completed" ||
    compatibilityTrace.commitDisposition !== "none" ||
    compatibilityTrace.runtime.executionPath !== "native-webmcp" ||
    compatibilityTrace.runtime.origin !== runtime.origin ||
    compatibilityTrace.runtime.userAgent !== runtime.userAgent ||
    compatibilityTrace.runtime.argumentMode !== "unverified" ||
    compatibilityTrace.cancellationObservedAfterCommit ||
    compatibilityTrace.cancellationObservedAfterCompletion
  ) {
    throw new TypeError("invocation_integrity_receipt_preflight_compatibility_mismatch");
  }
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.rawArguments,
    expectedRawArguments,
    "invocation_integrity_receipt_preflight_compatibility_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.canonicalArguments,
    {},
    "invocation_integrity_receipt_preflight_compatibility_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.rawResult,
    expectedCart,
    "invocation_integrity_receipt_preflight_compatibility_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.canonicalResult,
    expectedCart,
    "invocation_integrity_receipt_preflight_compatibility_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.error,
    null,
    "invocation_integrity_receipt_preflight_compatibility_error_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.stateBefore,
    initialState,
    "invocation_integrity_receipt_preflight_compatibility_state_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    compatibilityTrace.stateAfter,
    initialState,
    "invocation_integrity_receipt_preflight_compatibility_state_mismatch"
  );
  if (canonicalJson(compatibilityTrace.effect) !== canonicalJson(expectedEffect)) {
    throw new TypeError("invocation_integrity_receipt_preflight_compatibility_effect_mismatch");
  }

  const domainReset = preflight.reset.domainReceipt;
  const verifiedReset = preflight.reset.verifiedReceipt;
  const resetTrace = preflight.reset.trace;
  if (
    domainReset.coreHash !== (await canonicalSha256(domainReset.core)) ||
    domainReset.resetEventId !== resetTrace.eventId ||
    domainReset.sessionId !== compatibilityTrace.sessionId ||
    domainReset.sessionId !== resetTrace.sessionId ||
    domainReset.archivedTrajectoryId !== compatibilityTrace.runId ||
    domainReset.trajectoryId !== resetTrace.runId ||
    verifiedReset.resetId !== domainReset.resetId ||
    verifiedReset.registryHash !== receipt.initialManifestHash ||
    resetTrace.source !== "ui" ||
    resetTrace.toolName !== "fixture_reset" ||
    resetTrace.operationId !== null ||
    resetTrace.sequence !== 2 ||
    resetTrace.parentEventId !== compatibilityTrace.eventId ||
    resetTrace.registryHash !== receipt.initialManifestHash ||
    resetTrace.handlerVersion !== FIXTURE_RESET_HANDLER_VERSION ||
    resetTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    resetTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    resetTrace.appCommit !== receipt.buildSha ||
    resetTrace.status !== "completed" ||
    resetTrace.commitDisposition !== "committed" ||
    resetTrace.runtime.executionPath !== "ui" ||
    resetTrace.runtime.origin !== runtime.origin ||
    resetTrace.runtime.userAgent !== runtime.userAgent ||
    resetTrace.runtime.argumentMode !== "not-applicable" ||
    resetTrace.cancellationObservedAfterCommit ||
    resetTrace.cancellationObservedAfterCompletion ||
    new Date(resetTrace.observedAt).getTime() < new Date(compatibilityTrace.observedAt).getTime()
  ) {
    throw new TypeError("invocation_integrity_receipt_preflight_reset_mismatch");
  }
  await verifyPortableCanonicalEvidence(
    resetTrace.rawArguments,
    {},
    "invocation_integrity_receipt_preflight_reset_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.canonicalArguments,
    {},
    "invocation_integrity_receipt_preflight_reset_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.rawResult,
    domainReset,
    "invocation_integrity_receipt_preflight_reset_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.canonicalResult,
    domainReset,
    "invocation_integrity_receipt_preflight_reset_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.error,
    null,
    "invocation_integrity_receipt_preflight_reset_error_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.stateBefore,
    initialState,
    "invocation_integrity_receipt_preflight_reset_state_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    resetTrace.stateAfter,
    initialState,
    "invocation_integrity_receipt_preflight_reset_state_mismatch"
  );
  if (canonicalJson(resetTrace.effect) !== canonicalJson(expectedEffect)) {
    throw new TypeError("invocation_integrity_receipt_preflight_reset_effect_mismatch");
  }

  const postReset = preflight.postReset;
  if (
    postReset.inspection.sessionId !== domainReset.sessionId ||
    postReset.inspection.trajectoryId !== domainReset.trajectoryId ||
    postReset.inspection.lastResetTraceEventId !== resetTrace.eventId ||
    postReset.inspection.stateHash !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    (await canonicalSha256(postReset.inspection.state)) !==
      INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    canonicalJson(postReset.inspection.state) !== canonicalJson(initialState)
  ) {
    throw new TypeError("invocation_integrity_receipt_preflight_zero_boundary_mismatch");
  }
}

function frozenState(
  receipt: InvocationIntegrityReceipt,
  reference: InvocationIntegrityStateReference
): CheckoutState {
  return reference === "initial"
    ? receipt.rows[0]!.trustedStateBefore.value
    : receipt.rows[2]!.trustedStateAfter.value;
}

function frozenBoundary(
  receipt: InvocationIntegrityReceipt,
  boundary: InvocationIntegrityFrozenCallBoundary
) {
  return {
    state: frozenState(receipt, boundary.state),
    stateSha256:
      boundary.state === "initial"
        ? INVOCATION_INTEGRITY_INITIAL_STATE_SHA256
        : INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
    operationLedgerCount: boundary.operationLedgerCount,
    tombstoneCount: boundary.tombstoneCount,
    auditTraceCount: boundary.auditTraceCount,
    subscriberCommitCount: boundary.subscriberCommitCount
  };
}

function frozenHandlerVersion(toolName: InvocationIntegrityFrozenCall["toolName"]): string {
  return toolName === "cart_update"
    ? CART_UPDATE_HANDLER_VERSION
    : CHECKOUT_REQUEST_HANDLER_VERSION;
}

async function verifyPortableFrozenCall(input: {
  readonly receipt: InvocationIntegrityReceipt;
  readonly call: InvocationIntegrityObservedCall;
  readonly frozen: InvocationIntegrityFrozenCall;
  readonly priorTrace: OperationTrace;
  readonly row: InvocationIntegrityResultRow;
}): Promise<void> {
  const { receipt, call, frozen, priorTrace, row } = input;
  const trace = call.trace;
  const nativeReceipt = call.receipt;
  const stateBefore = frozenState(receipt, frozen.before.state);
  const stateAfter = frozenState(receipt, frozen.after.state);
  const effect = checkoutEffectDiff(stateBefore, stateAfter);
  const manifestHash =
    frozen.manifest === "initial" ? receipt.initialManifestHash : receipt.pendingManifestHash;
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(nativeReceipt.rawResult) as unknown;
  } catch {
    throw new TypeError("invocation_integrity_receipt_native_raw_result_invalid");
  }

  if (
    call.caseId !== frozen.caseId ||
    call.callIndex !== frozen.callIndex ||
    nativeReceipt.toolName !== frozen.toolName ||
    nativeReceipt.argumentMode !== receipt.measuredTranscript.runtime.argumentMode ||
    nativeReceipt.nativeCallCount !== 1 ||
    nativeReceipt.handlerTraceId !== trace.eventId ||
    nativeReceipt.handlerTraceStatus !== frozen.trace.status ||
    nativeReceipt.manifestHash !== manifestHash ||
    canonicalJson(rawResult) !== canonicalJson(frozen.result) ||
    canonicalJson(nativeReceipt.canonicalResult) !== canonicalJson(frozen.result) ||
    nativeReceipt.resultDigest !== (await canonicalSha256(frozen.result)) ||
    nativeReceipt.effectDigest !== (await canonicalSha256(effect)) ||
    nativeReceipt.stateBeforeDigest !== (await canonicalSha256(stateBefore)) ||
    nativeReceipt.stateAfterDigest !== (await canonicalSha256(stateAfter))
  ) {
    throw new TypeError("invocation_integrity_receipt_native_call_binding_mismatch");
  }

  if (
    trace.source !== "native" ||
    trace.toolName !== frozen.toolName ||
    trace.operationId !== frozen.trace.operationId ||
    trace.registryHash !== manifestHash ||
    trace.handlerVersion !== frozenHandlerVersion(frozen.toolName) ||
    trace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    trace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    trace.appCommit !== receipt.buildSha ||
    trace.runtime.executionPath !== "native-webmcp" ||
    trace.runtime.origin !== receipt.measuredTranscript.runtime.origin ||
    trace.runtime.userAgent !== receipt.measuredTranscript.runtime.userAgent ||
    trace.runtime.argumentMode !== receipt.measuredTranscript.runtime.argumentMode ||
    trace.status !== frozen.trace.status ||
    trace.commitDisposition !== frozen.trace.commitDisposition ||
    trace.cancellationObservedAfterCommit ||
    trace.cancellationObservedAfterCompletion ||
    trace.sessionId !== priorTrace.sessionId ||
    trace.runId !== priorTrace.runId ||
    trace.parentEventId !== priorTrace.eventId ||
    trace.sequence !== priorTrace.sequence + 1 ||
    new Date(trace.observedAt).getTime() < new Date(priorTrace.observedAt).getTime() ||
    trace.effect.stateChanged !== frozen.trace.effectApplied
  ) {
    throw new TypeError("invocation_integrity_receipt_trace_binding_mismatch");
  }

  await verifyPortableCanonicalEvidence(
    trace.rawArguments,
    frozen.payload,
    "invocation_integrity_receipt_trace_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.canonicalArguments,
    frozen.trace.canonicalInput,
    "invocation_integrity_receipt_trace_canonical_arguments_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.rawResult,
    frozen.result,
    "invocation_integrity_receipt_trace_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.canonicalResult,
    frozen.result,
    "invocation_integrity_receipt_trace_canonical_result_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.error,
    null,
    "invocation_integrity_receipt_trace_error_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.stateBefore,
    stateBefore,
    "invocation_integrity_receipt_trace_state_before_mismatch"
  );
  await verifyPortableCanonicalEvidence(
    trace.stateAfter,
    stateAfter,
    "invocation_integrity_receipt_trace_state_after_mismatch"
  );
  if (canonicalJson(trace.effect) !== canonicalJson(effect)) {
    throw new TypeError("invocation_integrity_receipt_trace_effect_mismatch");
  }

  const trustedObservationCore = {
    caseId: frozen.caseId,
    callIndex: frozen.callIndex,
    toolName: frozen.toolName,
    input: frozen.payload,
    result: frozen.result,
    trace: {
      outcome: frozen.trace.status,
      commitDisposition: frozen.trace.commitDisposition,
      effectApplied: frozen.trace.effectApplied,
      operationId: frozen.trace.operationId,
      rawInput: frozen.payload,
      canonicalInput: frozen.trace.canonicalInput,
      canonicalCommand: frozen.trace.canonicalCommand,
      stateBefore,
      stateAfter
    },
    before: frozenBoundary(receipt, frozen.before),
    after: frozenBoundary(receipt, frozen.after)
  };
  if (
    row.trustedObservationDigests[frozen.callIndex - 1] !==
    (await canonicalSha256(trustedObservationCore))
  ) {
    throw new TypeError("invocation_integrity_receipt_trusted_observation_mismatch");
  }
}

/** Strictly validates the source-fixed contract bindings and every canonical row/receipt digest. */
export async function verifyInvocationIntegrityReceipt(
  input: unknown
): Promise<InvocationIntegrityReceipt> {
  const receipt = parseInvocationIntegrityReceipt(input);
  const transcript = parseInvocationIntegrityTranscript(receipt.measuredTranscript);
  if (
    receipt.measuredTranscriptDigest !== (await canonicalSha256(transcript)) ||
    transcript.runtime.appCommit !== receipt.buildSha ||
    transcript.runtime.initialManifestHash !== receipt.initialManifestHash ||
    transcript.runtime.pendingManifestHash !== receipt.pendingManifestHash
  ) {
    throw new TypeError("invocation_integrity_receipt_transcript_binding_mismatch");
  }
  await verifyPortableMeasuredPreflight(receipt);
  const executionIds = new Set<string>();
  const eventIds = new Set<string>([transcript.preflight.reset.trace.eventId]);
  let priorTrace = transcript.preflight.reset.trace;
  for (const [index, frozen] of INVOCATION_INTEGRITY_FROZEN_CALLS.entries()) {
    const call = transcript.calls[index];
    const rowIndex = INVOCATION_INTEGRITY_CASE_IDS.indexOf(frozen.caseId);
    const row = receipt.rows[rowIndex];
    if (
      !call ||
      !row ||
      executionIds.has(call.receipt.executionId) ||
      eventIds.has(call.trace.eventId)
    ) {
      throw new TypeError("invocation_integrity_receipt_call_identity_mismatch");
    }
    await verifyPortableFrozenCall({ receipt, call, frozen, priorTrace, row });
    executionIds.add(call.receipt.executionId);
    eventIds.add(call.trace.eventId);
    priorTrace = call.trace;
  }
  let browserCallOffset = 0;
  for (const [index, row] of receipt.rows.entries()) {
    const frozenCase = INVOCATION_INTEGRITY_CASES[index];
    if (
      !frozenCase ||
      row.caseId !== frozenCase.caseId ||
      row.title !== frozenCase.title ||
      row.toolName !== frozenCase.toolName ||
      row.buildSha !== receipt.buildSha ||
      canonicalJson(row.exactInvocations) !== canonicalJson(frozenCase.invocations) ||
      canonicalJson(row.expectedOutcome) !== canonicalJson(frozenCase.expectedResults) ||
      canonicalJson(row.actualOutcome) !== canonicalJson(frozenCase.expectedResults) ||
      row.browserObservationDigests.length !== frozenCase.invocations.length ||
      row.trustedObservationDigests.length !== frozenCase.invocations.length
    ) {
      throw new TypeError("invocation_integrity_receipt_case_binding_mismatch");
    }
    const expectedBrowserDigests = await Promise.all(
      transcript.calls
        .slice(browserCallOffset, browserCallOffset + frozenCase.invocations.length)
        .map((call) => canonicalSha256(call))
    );
    browserCallOffset += frozenCase.invocations.length;
    if (
      canonicalJson(row.browserObservationDigests) !== canonicalJson(expectedBrowserDigests) ||
      row.timestamp !== transcript.calls[browserCallOffset - 1]?.trace.observedAt
    ) {
      throw new TypeError("invocation_integrity_receipt_browser_observation_mismatch");
    }
    if (
      row.trustedStateBefore.sha256 !== (await canonicalSha256(row.trustedStateBefore.value)) ||
      row.trustedStateAfter.sha256 !== (await canonicalSha256(row.trustedStateAfter.value)) ||
      row.trustedStateBefore.sha256 !== frozenCase.preconditions.stateSha256 ||
      row.trustedStateAfter.sha256 !== frozenCase.postconditions.stateSha256
    ) {
      throw new TypeError("invocation_integrity_receipt_state_digest_mismatch");
    }
    const expectedBeforeKeysets = {
      root: INVOCATION_INTEGRITY_STATE_KEYSETS.root,
      line: INVOCATION_INTEGRITY_STATE_KEYSETS.line,
      fulfillment: INVOCATION_INTEGRITY_STATE_KEYSETS.fulfillment,
      pendingCheckout: []
    };
    const expectedAfterKeysets = {
      ...expectedBeforeKeysets,
      pendingCheckout:
        frozenCase.caseId === "II-03" ? INVOCATION_INTEGRITY_STATE_KEYSETS.pendingCheckout : []
    };
    if (
      canonicalJson(row.trustedStateBefore.keysets) !== canonicalJson(expectedBeforeKeysets) ||
      canonicalJson(row.trustedStateAfter.keysets) !== canonicalJson(expectedAfterKeysets)
    ) {
      throw new TypeError("invocation_integrity_receipt_state_keyset_mismatch");
    }
    const expectedOperationDiff = {
      before: frozenCase.preconditions.operationLedgerCount,
      after: frozenCase.postconditions.operationLedgerCount,
      delta:
        frozenCase.postconditions.operationLedgerCount -
        frozenCase.preconditions.operationLedgerCount
    };
    const expectedTombstoneDiff = {
      before: frozenCase.preconditions.tombstoneCount,
      after: frozenCase.postconditions.tombstoneCount,
      delta: frozenCase.postconditions.tombstoneCount - frozenCase.preconditions.tombstoneCount
    };
    const expectedAuditDiff = {
      before: frozenCase.preconditions.auditTraceCount,
      after: frozenCase.postconditions.auditTraceCount,
      delta: frozenCase.postconditions.auditTraceCount - frozenCase.preconditions.auditTraceCount
    };
    if (
      canonicalJson(row.domainOperationLedgerDiff) !== canonicalJson(expectedOperationDiff) ||
      canonicalJson(row.tombstoneDiff) !== canonicalJson(expectedTombstoneDiff) ||
      canonicalJson(row.auditTraceDiff) !== canonicalJson(expectedAuditDiff) ||
      row.subscriberCommitCount !== frozenCase.postconditions.subscriberCommitCount
    ) {
      throw new TypeError("invocation_integrity_receipt_ledger_mismatch");
    }
    const expectedAssertionIds = invocationIntegrityAssertionIds(frozenCase.caseId);
    if (
      canonicalJson(row.assertions.map(({ assertionId }) => assertionId)) !==
      canonicalJson(expectedAssertionIds)
    ) {
      throw new TypeError("invocation_integrity_receipt_assertion_set_mismatch");
    }
    const { rowDigest, ...rowCore } = row;
    if (rowDigest !== (await canonicalSha256(rowCore))) {
      throw new TypeError("invocation_integrity_receipt_row_digest_mismatch");
    }
  }
  for (let index = 1; index < receipt.rows.length; index += 1) {
    if (
      canonicalJson(receipt.rows[index - 1]!.trustedStateAfter.value) !==
      canonicalJson(receipt.rows[index]!.trustedStateBefore.value)
    ) {
      throw new TypeError("invocation_integrity_receipt_state_chain_mismatch");
    }
  }
  const { receiptDigest, ...receiptCore } = receipt;
  if (receiptDigest !== (await canonicalSha256(receiptCore))) {
    throw new TypeError("invocation_integrity_receipt_digest_mismatch");
  }
  return receipt;
}

export async function verifyInvocationIntegrityFailureReceipt(
  input: unknown
): Promise<InvocationIntegrityFailureReceipt> {
  const receipt = parseInvocationIntegrityFailureReceipt(input);
  if (
    receipt.buildSha !== receipt.runtime.appCommit ||
    receipt.origin !== receipt.runtime.origin ||
    receipt.preflightDigest !== (await canonicalSha256(receipt.preflight)) ||
    receipt.completedCallsDigest !== (await canonicalSha256(receipt.completedCalls)) ||
    receipt.terminalInspectionDigest !== (await canonicalSha256(receipt.terminalInspection)) ||
    receipt.terminalInspection.stateHash !==
      (await canonicalSha256(receipt.terminalInspection.state)) ||
    receipt.terminalInspection.stateRevision !== receipt.terminalInspection.state.revision
  ) {
    throw new TypeError("invocation_integrity_failure_receipt_binding_mismatch");
  }
  const expectedPrefix = [
    { caseId: "II-01" as const, callIndex: 1 as const, toolName: "checkout_request" as const },
    { caseId: "II-02" as const, callIndex: 1 as const, toolName: "cart_update" as const },
    { caseId: "II-03" as const, callIndex: 1 as const, toolName: "checkout_request" as const },
    { caseId: "II-03" as const, callIndex: 2 as const, toolName: "checkout_request" as const }
  ];
  for (const [index, call] of receipt.completedCalls.entries()) {
    const expected = expectedPrefix[index];
    const expectedResult =
      expected?.caseId === "II-01"
        ? INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-01"][0]
        : expected?.caseId === "II-02"
          ? INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-02"][0]
          : INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-03"][expected?.callIndex === 2 ? 1 : 0];
    const expectedPayload = expected ? INVOCATION_INTEGRITY_PAYLOADS[expected.caseId] : null;
    if (
      !expected ||
      call.caseId !== expected.caseId ||
      call.callIndex !== expected.callIndex ||
      call.receipt.toolName !== expected.toolName ||
      call.trace.toolName !== expected.toolName ||
      canonicalJson(call.receipt.canonicalResult) !== canonicalJson(expectedResult) ||
      canonicalJson(call.trace.rawArguments.value) !== canonicalJson(expectedPayload)
    ) {
      throw new TypeError("invocation_integrity_failure_receipt_prefix_mismatch");
    }
  }
  const earned =
    receipt.completedCalls.length === 0 ? 0 : receipt.completedCalls.length === 1 ? 1 : 2;
  if (
    receipt.score.earned !== earned ||
    receipt.score.label !== `${earned}/3` ||
    receipt.completedCalls.length > 4
  ) {
    throw new TypeError("invocation_integrity_failure_receipt_score_mismatch");
  }
  const { receiptDigest, ...receiptCore } = receipt;
  if (receiptDigest !== (await canonicalSha256(receiptCore))) {
    throw new TypeError("invocation_integrity_failure_receipt_digest_mismatch");
  }
  return receipt;
}
