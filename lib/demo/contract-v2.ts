import { z } from "zod";

import {
  CHECKOUT_OPERATION_JSON_SCHEMA,
  EMPTY_TOOL_JSON_SCHEMA
} from "@/lib/domain/checkout-schemas";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { jsonValueSchema } from "@/lib/demo/diagnostic-contract";
import { workshopEffectPredicateSchema, type WorkshopEffectPredicate } from "@/lib/demo/contract";
import { CHECKOUT_REQUEST_METADATA } from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_METADATA } from "@/lib/webmcp/order-review-tool";

export const BYOA_CONTRACT_VERSION = "thurstone-byoa-contract@2" as const;
export const BYOA_DEMO_TOOLSET_VERSION = "thurstone-byoa-demo-toolset@1" as const;
export const BYOA_FIXTURE_ID = "checkout-seed-v1" as const;
export const BYOA_TRUSTED_STATE_SOURCE = "thurstone-reference-checkout-ledger" as const;
export const BYOA_TOOL_NAMES = ["order_review", "checkout_request"] as const;

export type ByoaToolName = (typeof BYOA_TOOL_NAMES)[number];

const unsafeTextPattern =
  /(?:https?:\/\/|www\.|<[^>]*>|`{1,3}|\[[^\]]*\]\([^)]*\)|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)|-----BEGIN)/u;

function boundedPlainText(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
      `${label} must not contain control characters.`
    )
    .refine(
      (value) => !unsafeTextPattern.test(value),
      `${label} must be plain synthetic text without URLs, markup, or secret-shaped values.`
    );
}

export const byoaArgumentPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("empty") }).strict(),
  z
    .object({
      kind: z.literal("checkout_request"),
      operationId: z.literal("valid_unique")
    })
    .strict(),
  z
    .object({
      kind: z.literal("cart_update"),
      operationId: z.literal("valid_unique"),
      operation: z.literal("set_quantity"),
      itemId: z.enum(["field-notebook", "stoneware-mug"]),
      quantity: z.number().int().min(1).max(10)
    })
    .strict()
]);

export type DemoArgumentPredicate = z.infer<typeof byoaArgumentPredicateSchema>;

const annotationsSchema = z
  .object({
    readOnlyHint: z.boolean(),
    untrustedContentHint: z.boolean().optional()
  })
  .strict();

export const byoaToolDescriptorSchema = z
  .object({
    name: z.enum(BYOA_TOOL_NAMES),
    title: boundedPlainText(3, 80, "Tool title"),
    description: boundedPlainText(20, 600, "Tool description"),
    inputSchema: jsonValueSchema.refine(
      (
        value
      ): value is { readonly [key: string]: import("@/lib/demo/diagnostic-contract").JsonValue } =>
        typeof value === "object" && value !== null && !Array.isArray(value),
      "Tool inputSchema must be a JSON object."
    ),
    annotations: annotationsSchema
  })
  .strict();

export type ByoaToolDescriptorV1 = z.infer<typeof byoaToolDescriptorSchema>;

function expectedSchema(name: ByoaToolName): object {
  return name === "order_review" ? EMPTY_TOOL_JSON_SCHEMA : CHECKOUT_OPERATION_JSON_SCHEMA;
}

function expectedReadOnly(name: ByoaToolName): boolean {
  return name === "order_review";
}

export const byoaContractSchema = z
  .object({
    version: z.literal(BYOA_CONTRACT_VERSION),
    contractId: z.string().regex(/^byoa_[0-9a-f-]{36}$/u),
    title: boundedPlainText(1, 60, "Contract title").nullable(),
    request: boundedPlainText(1, 280, "Synthetic request"),
    fixtureId: z.literal(BYOA_FIXTURE_ID),
    expectedTool: z.enum(BYOA_TOOL_NAMES),
    argumentPredicate: byoaArgumentPredicateSchema,
    allowedEffects: z.array(workshopEffectPredicateSchema).max(2),
    forbiddenEffects: z.array(workshopEffectPredicateSchema).min(1).max(5),
    replayPolicy: z.enum(["read_only", "exactly_once"]),
    trustedStateSource: z.literal(BYOA_TRUSTED_STATE_SOURCE),
    approvalClass: z.enum(["read_only", "consequential"]),
    descriptors: z.array(byoaToolDescriptorSchema).length(2),
    descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict()
  .superRefine((contract, context) => {
    const names = contract.descriptors.map(({ name }) => name);
    if (canonicalJson(names) !== canonicalJson(BYOA_TOOL_NAMES)) {
      context.addIssue({
        code: "custom",
        path: ["descriptors"],
        message: "Descriptors must contain the exact frozen two-tool order."
      });
    }
    for (const [index, descriptor] of contract.descriptors.entries()) {
      if (
        canonicalJson(descriptor.inputSchema) !== canonicalJson(expectedSchema(descriptor.name))
      ) {
        context.addIssue({
          code: "custom",
          path: ["descriptors", index, "inputSchema"],
          message: "Tool schemas are frozen for the BYOA reference environment."
        });
      }
      if (descriptor.annotations.readOnlyHint !== expectedReadOnly(descriptor.name)) {
        context.addIssue({
          code: "custom",
          path: ["descriptors", index, "annotations"],
          message: "Tool annotations must match the frozen handler behavior."
        });
      }
    }
    const forbiddenKinds = new Set(contract.forbiddenEffects.map(({ kind }) => kind));
    if (!forbiddenKinds.has("unmodeled_state")) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: "Every BYOA contract must forbid unmodeled state."
      });
    }
    if (contract.expectedTool === "order_review") {
      if (
        contract.argumentPredicate.kind !== "empty" ||
        contract.allowedEffects.length !== 0 ||
        contract.replayPolicy !== "read_only" ||
        contract.approvalClass !== "read_only"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "order_review requires empty arguments, no allowed mutation, read-only replay, and read-only approval."
        });
      }
    } else {
      if (
        contract.argumentPredicate.kind !== "checkout_request" ||
        contract.allowedEffects.length !== 1 ||
        contract.allowedEffects[0]?.kind !== "pending_checkout" ||
        contract.replayPolicy !== "exactly_once" ||
        contract.approvalClass !== "consequential"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "checkout_request requires a unique operation ID, one pending-checkout effect, exactly-once replay, and consequential approval."
        });
      }
      if (!forbiddenKinds.has("duplicate_transition")) {
        context.addIssue({
          code: "custom",
          path: ["forbiddenEffects"],
          message: "A mutating contract must forbid duplicate transition."
        });
      }
    }
  });

export type ByoaContractV2 = z.infer<typeof byoaContractSchema>;

export interface CreateByoaDescriptorInput {
  readonly orderReview?: { readonly title?: string; readonly description?: string };
  readonly checkoutRequest?: { readonly title?: string; readonly description?: string };
}

export async function createByoaDescriptorSnapshot(input: CreateByoaDescriptorInput = {}): Promise<{
  readonly descriptors: readonly ByoaToolDescriptorV1[];
  readonly descriptorDigest: string;
}> {
  const descriptors = [
    {
      ...ORDER_REVIEW_METADATA,
      title: input.orderReview?.title?.trim() || ORDER_REVIEW_METADATA.title,
      description: input.orderReview?.description?.trim() || ORDER_REVIEW_METADATA.description
    },
    {
      ...CHECKOUT_REQUEST_METADATA,
      title: input.checkoutRequest?.title?.trim() || CHECKOUT_REQUEST_METADATA.title,
      description:
        input.checkoutRequest?.description?.trim() || CHECKOUT_REQUEST_METADATA.description
    }
  ].map((value) => byoaToolDescriptorSchema.parse(value));
  const frozen = Object.freeze(
    JSON.parse(canonicalJson(descriptors)) as readonly ByoaToolDescriptorV1[]
  );
  return Object.freeze({ descriptors: frozen, descriptorDigest: await canonicalSha256(frozen) });
}

export interface CreateByoaContractInput {
  readonly contractId: string;
  readonly title?: string;
  readonly request: string;
  readonly expectedTool: ByoaToolName;
  readonly argumentPredicate: DemoArgumentPredicate;
  readonly allowedEffects: readonly WorkshopEffectPredicate[];
  readonly forbiddenEffects: readonly WorkshopEffectPredicate[];
  readonly replayPolicy: ByoaContractV2["replayPolicy"];
  readonly approvalClass: ByoaContractV2["approvalClass"];
  readonly descriptors: readonly ByoaToolDescriptorV1[];
  readonly descriptorDigest: string;
  readonly buildCommit: string;
  readonly createdAt: string;
}

export function parseByoaContract(value: unknown): ByoaContractV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(byoaContractSchema.parse(value))) as ByoaContractV2
  );
}

export function createByoaContract(input: CreateByoaContractInput): ByoaContractV2 {
  return parseByoaContract({
    version: BYOA_CONTRACT_VERSION,
    contractId: input.contractId,
    title: input.title?.trim() || null,
    request: input.request.trim(),
    fixtureId: BYOA_FIXTURE_ID,
    expectedTool: input.expectedTool,
    argumentPredicate: input.argumentPredicate,
    allowedEffects: input.allowedEffects,
    forbiddenEffects: input.forbiddenEffects,
    replayPolicy: input.replayPolicy,
    trustedStateSource: BYOA_TRUSTED_STATE_SOURCE,
    approvalClass: input.approvalClass,
    descriptors: input.descriptors,
    descriptorDigest: input.descriptorDigest,
    buildCommit: input.buildCommit,
    createdAt: input.createdAt
  });
}

export async function verifyByoaContract(contract: unknown): Promise<ByoaContractV2> {
  const parsed = parseByoaContract(contract);
  const digest = await canonicalSha256(parsed.descriptors);
  if (digest !== parsed.descriptorDigest) {
    throw new Error("BYOA descriptor digest does not match the frozen descriptor snapshot.");
  }
  return parsed;
}

export async function byoaContractDigest(contract: ByoaContractV2): Promise<string> {
  return canonicalSha256(await verifyByoaContract(contract));
}
