import { z } from "zod";

import {
  cartUpdateInputSchema,
  checkoutOperationInputSchema,
  emptyToolInputSchema
} from "@/lib/domain/checkout-schemas";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { CheckoutToolName } from "@/lib/webmcp/catalog";

export const WORKSHOP_CONTRACT_VERSION = "thurstone-workshop-contract@1" as const;
export const WORKSHOP_TRUSTED_STATE_SOURCE = "thurstone-reference-checkout-ledger" as const;
export const WORKSHOP_FIXTURE_ID = "checkout-seed-v1" as const;

const effectKindSchema = z.enum([
  "cart_quantity",
  "pending_checkout",
  "cart_mutation",
  "duplicate_transition",
  "unmodeled_state"
]);

export type WorkshopEffectKind = z.infer<typeof effectKindSchema>;

export const workshopEffectPredicateSchema = z
  .object({
    kind: effectKindSchema,
    itemId: z.enum(["field-notebook", "stoneware-mug"]).optional(),
    quantity: z.number().int().min(1).max(10).optional()
  })
  .strict()
  .superRefine((effect, context) => {
    if (
      effect.kind === "cart_quantity" &&
      (effect.itemId === undefined || effect.quantity === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "cart_quantity requires itemId and quantity."
      });
    }
    if (
      effect.kind !== "cart_quantity" &&
      (effect.itemId !== undefined || effect.quantity !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: `${effect.kind} cannot carry itemId or quantity.`
      });
    }
  });

export type WorkshopEffectPredicate = z.infer<typeof workshopEffectPredicateSchema>;

const callDecisionSchema = z.discriminatedUnion("toolName", [
  z
    .object({
      kind: z.literal("call"),
      toolName: z.literal("cart_get"),
      arguments: emptyToolInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("call"),
      toolName: z.literal("order_review"),
      arguments: emptyToolInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("call"),
      toolName: z.literal("cart_update"),
      arguments: cartUpdateInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("call"),
      toolName: z.literal("checkout_request"),
      arguments: checkoutOperationInputSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("call"),
      toolName: z.literal("checkout_cancel"),
      arguments: checkoutOperationInputSchema
    })
    .strict()
]);

export const workshopDecisionSchema = z.union([
  callDecisionSchema,
  z.object({ kind: z.literal("clarify") }).strict(),
  z.object({ kind: z.literal("no_action") }).strict()
]);

export type WorkshopDecision = z.infer<typeof workshopDecisionSchema>;

export const workshopContractSchema = z
  .object({
    version: z.literal(WORKSHOP_CONTRACT_VERSION),
    testId: z.string().regex(/^workshop_[0-9a-f-]{36}$/u),
    title: z.string().min(1).max(60).nullable(),
    request: z.string().min(1).max(280),
    fixtureId: z.literal(WORKSHOP_FIXTURE_ID),
    expectedDecision: workshopDecisionSchema,
    allowedEffects: z.array(workshopEffectPredicateSchema).max(4),
    forbiddenEffects: z.array(workshopEffectPredicateSchema).min(1).max(5),
    replayPolicy: z.enum(["not_applicable", "read_only", "exactly_once"]),
    trustedStateSource: z.literal(WORKSHOP_TRUSTED_STATE_SOURCE),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict()
  .superRefine((contract, context) => {
    const decision = contract.expectedDecision;
    const forbiddenKinds = new Set(contract.forbiddenEffects.map(({ kind }) => kind));
    if (!forbiddenKinds.has("unmodeled_state")) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: "Every Workshop contract must forbid unmodeled state."
      });
    }
    if (decision.kind !== "call") {
      if (contract.replayPolicy !== "not_applicable" || contract.allowedEffects.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "Clarification and no-action contracts cannot allow effects or replay."
        });
      }
      return;
    }
    const readOnly = decision.toolName === "cart_get" || decision.toolName === "order_review";
    if (readOnly) {
      if (contract.replayPolicy !== "read_only" || contract.allowedEffects.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "Read-only tools require read_only replay and no allowed state effect."
        });
      }
      return;
    }
    if (contract.replayPolicy !== "exactly_once") {
      context.addIssue({ code: "custom", message: "Mutation tools require exactly_once replay." });
    }
    const allowedKinds = contract.allowedEffects.map(({ kind }) => kind);
    if (decision.toolName === "cart_update" && allowedKinds.join(",") !== "cart_quantity") {
      context.addIssue({
        code: "custom",
        path: ["allowedEffects"],
        message: "cart_update requires exactly one cart_quantity effect."
      });
    }
    if (
      (decision.toolName === "checkout_request" || decision.toolName === "checkout_cancel") &&
      allowedKinds.join(",") !== "pending_checkout"
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedEffects"],
        message: `${decision.toolName} requires exactly one pending_checkout effect.`
      });
    }
  });

export type WorkshopContractV1 = z.infer<typeof workshopContractSchema>;

export interface WorkshopContractInput {
  readonly title?: string;
  readonly request: string;
  readonly expectedDecision: WorkshopDecision;
  readonly allowedEffects: readonly WorkshopEffectPredicate[];
  readonly forbiddenEffects: readonly WorkshopEffectPredicate[];
  readonly replayPolicy: WorkshopContractV1["replayPolicy"];
}

export function createWorkshopContract(
  input: WorkshopContractInput,
  options: { readonly testId: string; readonly createdAt: string }
): WorkshopContractV1 {
  const value = workshopContractSchema.parse({
    version: WORKSHOP_CONTRACT_VERSION,
    testId: options.testId,
    title: input.title?.trim() || null,
    request: input.request.trim(),
    fixtureId: WORKSHOP_FIXTURE_ID,
    expectedDecision: input.expectedDecision,
    allowedEffects: input.allowedEffects,
    forbiddenEffects: input.forbiddenEffects,
    replayPolicy: input.replayPolicy,
    trustedStateSource: WORKSHOP_TRUSTED_STATE_SOURCE,
    createdAt: options.createdAt
  });
  return Object.freeze(JSON.parse(canonicalJson(value)) as WorkshopContractV1);
}

export function parseWorkshopContract(value: unknown): WorkshopContractV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(workshopContractSchema.parse(value))) as WorkshopContractV1
  );
}

export async function workshopContractDigest(contract: WorkshopContractV1): Promise<string> {
  return canonicalSha256(parseWorkshopContract(contract));
}

export function mutationOperationId(toolName: CheckoutToolName): string {
  return `${toolName}_${globalThis.crypto.randomUUID()}`;
}
