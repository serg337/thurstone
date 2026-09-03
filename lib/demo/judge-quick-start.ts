import { z } from "zod";

import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseInput,
  type ThurstoneContractCaseV1,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { byoaRuntimeVariantSchema, type ByoaRuntimeVariant } from "@/lib/demo/agent-projection";
import { THURSTONE_DEMO_SELECTABLE_TOOL_NAMES } from "@/lib/demo/reference-tool-templates";

export const JUDGE_QUICK_START_VERSION = "thurstone-judge-quick-start@2" as const;
export const JUDGE_QUICK_START_STORAGE_KEY = "thurstone:judge-quick-start@2" as const;

export const JUDGE_QUICK_START_REQUESTS = Object.freeze({
  baseline: "Set the Stoneware mug quantity to 3.",
  planted: "Set the Field notebook quantity to 2.",
  collision: "Show me my current order."
} as const);

export const JUDGE_QUICK_START_RUNTIME_VARIANTS = Object.freeze([
  "standard",
  "planted-cart-update-noop",
  "semantic-collision"
] as const satisfies readonly ByoaRuntimeVariant[]);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const caseIdSchema = z.string().regex(/^case_[0-9a-f-]{36}$/u);

const quickStepSchema = z
  .object({
    caseId: caseIdSchema,
    name: z.string().min(1).max(80),
    request: z.string().min(1).max(280),
    expectedTool: z.enum(["cart_update", "order_review"]),
    runtimeVariant: byoaRuntimeVariantSchema
  })
  .strict();

export const judgeQuickStartSourceSchema = z
  .object({
    version: z.literal(JUDGE_QUICK_START_VERSION),
    suiteId: z.string().regex(/^suite_[0-9a-f-]{36}$/u),
    catalogDigest: sha256Schema,
    journeyId: z.string().regex(/^journey_[0-9a-f-]{36}$/u),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
    steps: z.array(quickStepSchema).length(3),
    handoffUrl: z
      .string()
      .url()
      .max(8 * 1024),
    expiresAt: z.string().datetime({ offset: false }),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict();

export type JudgeQuickStartSource = z.infer<typeof judgeQuickStartSourceSchema>;

function timestampAfter(createdAt: string, milliseconds: number): string {
  return new Date(Date.parse(createdAt) + milliseconds).toISOString();
}

function cartUpdateCase(
  name: string,
  request: string,
  itemId: "field-notebook" | "stoneware-mug",
  quantity: number
): ThurstoneContractCaseInput {
  return {
    name,
    request,
    expectedTool: "cart_update",
    argumentPredicate: {
      kind: "cart_update",
      operationId: "valid_unique",
      operation: "set_quantity",
      itemId,
      quantity
    },
    allowedEffects: [{ kind: "cart_quantity", itemId, quantity }],
    forbiddenEffects: [
      { kind: "pending_checkout" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    approvalClass: "consequential"
  };
}

const semanticCollisionCase = {
  name: "Semantic collision",
  request: JUDGE_QUICK_START_REQUESTS.collision,
  expectedTool: "order_review",
  argumentPredicate: { kind: "empty" },
  allowedEffects: [],
  forbiddenEffects: [
    { kind: "cart_mutation" },
    { kind: "pending_checkout" },
    { kind: "unmodeled_state" }
  ],
  replayPolicy: "read_only",
  approvalClass: "read_only"
} satisfies ThurstoneContractCaseInput;

export async function createJudgeQuickStartSuite(input: {
  readonly suiteId: string;
  readonly caseIds: readonly [string, string, string];
  readonly createdAt: string;
}): Promise<{
  readonly suite: ThurstoneContractSuiteV1;
  readonly cases: readonly [
    ThurstoneContractCaseV1,
    ThurstoneContractCaseV1,
    ThurstoneContractCaseV1
  ];
}> {
  let suite = await createThurstoneContractSuite({
    suiteId: input.suiteId,
    name: "Judge quick start",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
      descriptorOverrides: {
        cart_get: {
          title: "View cart or current order",
          description:
            "Return the shopper's currently selected items and quantities when they ask what is in the cart or want to see their current order."
        }
      }
    }),
    createdAt: input.createdAt
  });
  const inputs = [
    cartUpdateCase("Baseline live agent", JUDGE_QUICK_START_REQUESTS.baseline, "stoneware-mug", 3),
    cartUpdateCase(
      "Controlled planted site fault",
      JUDGE_QUICK_START_REQUESTS.planted,
      "field-notebook",
      2
    ),
    semanticCollisionCase
  ] as const;
  for (const [index, caseInput] of inputs.entries()) {
    suite = addContractSuiteCase(suite, caseInput, {
      caseId: input.caseIds[index]!,
      updatedAt: timestampAfter(input.createdAt, index + 1)
    });
  }
  suite = selectContractSuiteCase(suite, input.caseIds[0], {
    updatedAt: timestampAfter(input.createdAt, 4)
  });
  return {
    suite,
    cases: [suite.cases[0]!, suite.cases[1]!, suite.cases[2]!]
  };
}

export function writeJudgeQuickStartSource(storage: Storage, value: unknown): void {
  storage.setItem(
    JUDGE_QUICK_START_STORAGE_KEY,
    JSON.stringify(judgeQuickStartSourceSchema.parse(value))
  );
}

export function readJudgeQuickStartSource(storage: Storage): JudgeQuickStartSource | null {
  const encoded = storage.getItem(JUDGE_QUICK_START_STORAGE_KEY);
  if (encoded === null) return null;
  try {
    return judgeQuickStartSourceSchema.parse(JSON.parse(encoded) as unknown);
  } catch {
    storage.removeItem(JUDGE_QUICK_START_STORAGE_KEY);
    return null;
  }
}

export function clearJudgeQuickStartSource(storage: Storage): void {
  storage.removeItem(JUDGE_QUICK_START_STORAGE_KEY);
}
