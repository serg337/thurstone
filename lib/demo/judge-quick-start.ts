import { z } from "zod";

import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseV1,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { THURSTONE_DEMO_SELECTABLE_TOOL_NAMES } from "@/lib/demo/reference-tool-templates";

export const JUDGE_QUICK_START_VERSION = "thurstone-judge-quick-start@1" as const;
export const JUDGE_QUICK_START_STORAGE_KEY = "thurstone:judge-quick-start@1" as const;
export const JUDGE_QUICK_START_REQUEST = "Set the Stoneware mug quantity to 3." as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const judgeQuickStartSourceSchema = z
  .object({
    version: z.literal(JUDGE_QUICK_START_VERSION),
    runId: z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u),
    contractDigest: sha256Schema,
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

export async function createJudgeQuickStartSuite(input: {
  readonly suiteId: string;
  readonly caseId: string;
  readonly createdAt: string;
}): Promise<{
  readonly suite: ThurstoneContractSuiteV1;
  readonly selectedCase: ThurstoneContractCaseV1;
}> {
  let suite = await createThurstoneContractSuite({
    suiteId: input.suiteId,
    name: "Judge quick start",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: THURSTONE_DEMO_SELECTABLE_TOOL_NAMES
    }),
    createdAt: input.createdAt
  });
  suite = addContractSuiteCase(
    suite,
    {
      name: "Increase mug quantity",
      request: JUDGE_QUICK_START_REQUEST,
      expectedTool: "cart_update",
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 3
      },
      allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 3 }],
      forbiddenEffects: [
        { kind: "pending_checkout" },
        { kind: "duplicate_transition" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "exactly_once",
      approvalClass: "consequential"
    },
    { caseId: input.caseId, updatedAt: timestampAfter(input.createdAt, 1) }
  );
  suite = selectContractSuiteCase(suite, input.caseId, {
    updatedAt: timestampAfter(input.createdAt, 2)
  });
  return { suite, selectedCase: suite.cases[0]! };
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
