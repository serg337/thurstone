import { z } from "zod";

import {
  type CheckoutState,
  CHECKOUT_CURRENCY,
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION
} from "@/lib/domain/checkout";
import {
  byoaContractDigest,
  byoaContractSchema,
  parseByoaContract,
  verifyByoaContract,
  type ByoaContractV2,
  type ByoaToolName
} from "@/lib/demo/contract-v2";
import { createDiagnosticEnvelope } from "@/lib/demo/diagnose-result";
import {
  diagnosticEnvelopeSchema,
  diagnosticEvidenceRefSchema,
  jsonValueSchema,
  type DiagnosticSignal,
  type JsonValue
} from "@/lib/demo/diagnostic-contract";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";

export const BYOA_RESULT_VERSION = "thurstone-byoa-result@2" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const itemIdSchema = z.enum(["field-notebook", "stoneware-mug"]);

const checkoutStateValueSchema = z
  .object({
    fixtureId: z.literal(CHECKOUT_FIXTURE_ID),
    fixtureVersion: z.literal(CHECKOUT_FIXTURE_VERSION),
    seed: z.literal(CHECKOUT_FIXTURE_SEED),
    revision: z.number().int().min(0),
    currency: z.literal(CHECKOUT_CURRENCY),
    lines: z
      .array(
        z
          .object({
            itemId: itemIdSchema,
            name: z.string().min(1).max(80),
            quantity: z.number().int().min(1).max(10),
            unitPriceCents: z.number().int().min(0)
          })
          .strict()
      )
      .max(2),
    fulfillment: z
      .object({
        shippingMethod: z.literal("standard"),
        shippingLabel: z.literal("Standard shipping"),
        shippingCents: z.literal(700),
        deliveryWindow: z.literal("3-5-business-days"),
        deliveryNotice: z.literal("Simulated estimate; no shipment occurs.")
      })
      .strict(),
    pendingCheckout: z
      .object({
        status: z.literal("pending_human_approval"),
        pendingId: z.string().min(1).max(128),
        requestOperationId: z.string().min(1).max(128),
        requestedFromRevision: z.number().int().min(0),
        cartSnapshotHash: sha256Schema,
        orderTotalCents: z.number().int().min(0)
      })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.lines.map(({ itemId }) => itemId);
    const expectedOrder = (["field-notebook", "stoneware-mug"] as const).filter((itemId) =>
      names.includes(itemId)
    );
    if (
      new Set(names).size !== names.length ||
      canonicalJson(names) !== canonicalJson(expectedOrder)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Trusted state lines must be a unique ordered subset of the frozen fixture."
      });
    }
    const expectedLines = [
      { itemId: "field-notebook", name: "Field notebook", unitPriceCents: 1800 },
      { itemId: "stoneware-mug", name: "Stoneware mug", unitPriceCents: 2400 }
    ] as const;
    for (const [index, actual] of value.lines.entries()) {
      const expected = expectedLines.find(({ itemId }) => itemId === actual.itemId);
      if (
        !expected ||
        actual.itemId !== expected.itemId ||
        actual.name !== expected.name ||
        actual.unitPriceCents !== expected.unitPriceCents
      ) {
        context.addIssue({
          code: "custom",
          path: ["lines", index],
          message: "Trusted state must retain the frozen identity of every present line."
        });
      }
    }
  });

export const checkoutStateEvidenceSchema = z
  .object({
    value: checkoutStateValueSchema,
    bytes: z
      .string()
      .min(2)
      .max(16 * 1024),
    sha256: sha256Schema
  })
  .strict();

export type CheckoutStateEvidence = z.infer<typeof checkoutStateEvidenceSchema>;

export const ledgerDiffProjectionSchema = z
  .object({
    eventCountBefore: z.number().int().min(0),
    eventCountAfter: z.number().int().min(0),
    eventCountDelta: z.number().int().min(0),
    stateTransitionCount: z.number().int().min(0).max(1),
    operationLedgerCountBefore: z.number().int().min(0),
    operationLedgerCountAfter: z.number().int().min(0),
    operationLedgerCountDelta: z.number().int().min(0).max(1),
    pendingCheckoutChanged: z.boolean(),
    rejectedAdditionalAttempts: z.number().int().min(0)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eventCountAfter - value.eventCountBefore !== value.eventCountDelta) {
      context.addIssue({
        code: "custom",
        path: ["eventCountDelta"],
        message: "Event-count delta is inconsistent."
      });
    }
    if (
      value.operationLedgerCountAfter - value.operationLedgerCountBefore !==
      value.operationLedgerCountDelta
    ) {
      context.addIssue({
        code: "custom",
        path: ["operationLedgerCountDelta"],
        message: "Operation-ledger delta is inconsistent."
      });
    }
  });

export type LedgerDiffProjection = z.infer<typeof ledgerDiffProjectionSchema>;

export const demoAssertionV2Schema = z
  .object({
    assertionId: z.string().min(1).max(160),
    scope: z.enum([
      "runtime",
      "selection",
      "arguments",
      "execution",
      "effects",
      "replay",
      "invariant"
    ]),
    path: z.string().min(1).max(400),
    expected: jsonValueSchema,
    actual: jsonValueSchema,
    passed: z.boolean(),
    label: z.string().min(1).max(200),
    detail: z.string().min(1).max(600),
    evidenceRefs: z.array(diagnosticEvidenceRefSchema).min(1).max(12)
  })
  .strict();

export type DemoAssertionV2 = z.infer<typeof demoAssertionV2Schema>;

export const byoaDemoResultSchema = z
  .object({
    version: z.literal(BYOA_RESULT_VERSION),
    evidenceClass: z.literal("exploratory-byoa"),
    includedInReferenceScore: z.literal(false),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    source: z.literal("external_agent_native"),
    promptBinding: z.literal("user-attested"),
    expectedAnswerIsolation: z.literal("withheld-from-agent-surface"),
    contract: byoaContractSchema,
    contractDigest: sha256Schema,
    descriptorDigest: sha256Schema,
    expectedTool: z.enum(["order_review", "checkout_request"]),
    observedTool: z.string().min(1).max(128).nullable(),
    rawArguments: jsonValueSchema.nullable(),
    canonicalArguments: jsonValueSchema.nullable(),
    trustedStateBefore: checkoutStateEvidenceSchema,
    trustedStateAfter: checkoutStateEvidenceSchema,
    ledgerDiff: ledgerDiffProjectionSchema,
    assertions: z.array(demoAssertionV2Schema).min(1).max(32),
    verdict: z.enum(["pass", "fail", "incomplete", "unavailable"]),
    diagnostic: diagnosticEnvelopeSchema,
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    manifestHash: sha256Schema,
    armedAt: z.string().datetime({ offset: false }),
    completedAt: z.string().datetime({ offset: false }),
    previousResultDigest: sha256Schema.nullable(),
    resultDigest: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    const assertionIds = value.assertions.map(({ assertionId }) => assertionId);
    if (new Set(assertionIds).size !== assertionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["assertions"],
        message: "Assertion IDs must be unique."
      });
    }
    if (value.expectedTool !== value.contract.expectedTool) {
      context.addIssue({
        code: "custom",
        path: ["expectedTool"],
        message: "Expected tool must match the frozen contract."
      });
    }
    if (value.descriptorDigest !== value.contract.descriptorDigest) {
      context.addIssue({
        code: "custom",
        path: ["descriptorDigest"],
        message: "Descriptor digest must match the frozen contract."
      });
    }
    if (value.buildCommit !== value.contract.buildCommit) {
      context.addIssue({
        code: "custom",
        path: ["buildCommit"],
        message: "Result build must match the armed contract build."
      });
    }
    if (
      value.diagnostic.contractDigest !== value.contractDigest ||
      value.diagnostic.buildCommit !== value.buildCommit ||
      value.diagnostic.completedAt !== value.completedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Diagnostic identity must match the terminal result identity."
      });
    }
    const everyPassed = value.assertions.every(({ passed }) => passed);
    if (value.verdict === "pass" && (!everyPassed || value.observedTool === null)) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Pass requires one observed tool and every assertion passing."
      });
    }
    if (value.verdict === "fail" && everyPassed) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Fail requires at least one failed assertion."
      });
    }
    if (
      value.verdict === "pass" &&
      (value.diagnostic.status !== "not-needed" ||
        value.diagnostic.releaseGuidance !== "case-passed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "A passing result requires a not-needed diagnosis and case-passed guidance."
      });
    }
    if (
      value.verdict === "fail" &&
      (value.observedTool === null || value.diagnostic.status !== "diagnosed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "A semantic failure requires an observed invocation and diagnosed evidence."
      });
    }
    if (
      (value.verdict === "incomplete" || value.verdict === "unavailable") &&
      (value.diagnostic.releaseGuidance !== "rerun-required" ||
        !["inconclusive", "invalid-evidence"].includes(value.diagnostic.status))
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Incomplete and unavailable results require rerun guidance."
      });
    }
  });

export type ByoaDemoResultV2 = z.infer<typeof byoaDemoResultSchema>;

function resultCore(value: Omit<ByoaDemoResultV2, "resultDigest"> | ByoaDemoResultV2) {
  const { diagnostic, resultDigest, ...core } = value as ByoaDemoResultV2;
  void diagnostic;
  void resultDigest;
  return core;
}

function resultWithoutDigest(value: ByoaDemoResultV2) {
  const { resultDigest, ...rest } = value;
  void resultDigest;
  return rest;
}

export async function createCheckoutStateEvidence(
  state: CheckoutState
): Promise<CheckoutStateEvidence> {
  const value = checkoutStateValueSchema.parse(state);
  const bytes = canonicalJson(value);
  return Object.freeze({ value, bytes, sha256: await sha256Hex(bytes) });
}

export async function verifyCheckoutStateEvidence(
  evidence: unknown
): Promise<CheckoutStateEvidence> {
  const parsed = checkoutStateEvidenceSchema.parse(evidence);
  const bytes = canonicalJson(parsed.value);
  if (bytes !== parsed.bytes || (await sha256Hex(bytes)) !== parsed.sha256) {
    throw new Error("Trusted checkout-state evidence digest does not match its canonical bytes.");
  }
  return parsed;
}

export interface CreateByoaResultInput {
  readonly runId: string;
  readonly contract: ByoaContractV2;
  readonly observedTool: string | null;
  readonly rawArguments: JsonValue | null;
  readonly canonicalArguments: JsonValue | null;
  readonly trustedStateBefore: CheckoutState;
  readonly trustedStateAfter: CheckoutState;
  readonly ledgerDiff: LedgerDiffProjection;
  readonly assertions: readonly DemoAssertionV2[];
  readonly diagnosticSignals: readonly DiagnosticSignal[];
  readonly verdict: ByoaDemoResultV2["verdict"];
  readonly manifestHash: string;
  readonly armedAt: string;
  readonly completedAt: string;
  readonly previousResultDigest?: string | null;
}

export async function createByoaDemoResult(
  input: CreateByoaResultInput
): Promise<ByoaDemoResultV2> {
  const contract = await verifyByoaContract(input.contract);
  const contractDigest = await byoaContractDigest(contract);
  const trustedStateBefore = await createCheckoutStateEvidence(input.trustedStateBefore);
  const trustedStateAfter = await createCheckoutStateEvidence(input.trustedStateAfter);
  const core = {
    version: BYOA_RESULT_VERSION,
    evidenceClass: "exploratory-byoa" as const,
    includedInReferenceScore: false as const,
    runId: input.runId,
    source: "external_agent_native" as const,
    promptBinding: "user-attested" as const,
    expectedAnswerIsolation: "withheld-from-agent-surface" as const,
    contract,
    contractDigest,
    descriptorDigest: contract.descriptorDigest,
    expectedTool: contract.expectedTool,
    observedTool: input.observedTool,
    rawArguments: input.rawArguments,
    canonicalArguments: input.canonicalArguments,
    trustedStateBefore,
    trustedStateAfter,
    ledgerDiff: ledgerDiffProjectionSchema.parse(input.ledgerDiff),
    assertions: input.assertions.map((assertion) => demoAssertionV2Schema.parse(assertion)),
    verdict: input.verdict,
    buildCommit: contract.buildCommit,
    manifestHash: input.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  };
  const sourceResultDigest = await canonicalSha256(core);
  const diagnostic = await createDiagnosticEnvelope({
    sourceResultDigest,
    contractDigest,
    buildCommit: contract.buildCommit,
    completedAt: input.completedAt,
    signals: input.diagnosticSignals
  });
  const withoutDigest = { ...core, diagnostic };
  const resultDigest = await canonicalSha256(withoutDigest);
  return verifyByoaDemoResult({ ...withoutDigest, resultDigest });
}

export function parseByoaDemoResult(value: unknown): ByoaDemoResultV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaDemoResultSchema.parse(value))) as ByoaDemoResultV2
  );
}

export async function verifyByoaDemoResult(value: unknown): Promise<ByoaDemoResultV2> {
  const parsed = parseByoaDemoResult(value);
  await verifyByoaContract(parsed.contract);
  if ((await byoaContractDigest(parsed.contract)) !== parsed.contractDigest) {
    throw new Error("BYOA contract digest does not match the stored contract.");
  }
  await verifyCheckoutStateEvidence(parsed.trustedStateBefore);
  await verifyCheckoutStateEvidence(parsed.trustedStateAfter);
  const sourceResultDigest = await canonicalSha256(resultCore(parsed));
  if (sourceResultDigest !== parsed.diagnostic.sourceResultDigest) {
    throw new Error("Diagnostic source digest does not match the terminal result core.");
  }
  if ((await canonicalSha256(resultWithoutDigest(parsed))) !== parsed.resultDigest) {
    throw new Error("BYOA result digest does not match the terminal result bytes.");
  }
  return parsed;
}

export function expectedToolForResult(result: ByoaDemoResultV2): ByoaToolName {
  return parseByoaContract(result.contract).expectedTool;
}
