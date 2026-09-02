import { z } from "zod";

import {
  THURSTONE_CONTRACT_SUITE_MAX_CASES,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { createContinuousJourneyPlanDraft } from "@/lib/demo/continuous-journey-plan";

export const CONTRACT_RUN_QUEUE_VERSION = "thurstone-contract-run-queue@2" as const;
export const CONTRACT_RUN_QUEUE_STORAGE_KEY = "thurstone:contract-run-queue@2" as const;

export const contractRunModeSchema = z.enum(["regression", "continuous"]);
export type ContractRunMode = z.infer<typeof contractRunModeSchema>;

const caseIdSchema = z.string().regex(/^case_[0-9a-f-]{36}$/u);

const queueResultSchema = z
  .object({
    caseId: caseIdSchema,
    verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]),
    resultDigest: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export const contractRunQueueSchema = z
  .object({
    version: z.literal(CONTRACT_RUN_QUEUE_VERSION),
    mode: contractRunModeSchema,
    suiteId: z.string().regex(/^suite_[0-9a-f-]{36}$/u),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedCaseIds: z.array(caseIdSchema).min(1).max(THURSTONE_CONTRACT_SUITE_MAX_CASES),
    results: z.array(queueResultSchema).max(THURSTONE_CONTRACT_SUITE_MAX_CASES),
    currentCaseId: caseIdSchema.nullable()
  })
  .strict()
  .superRefine((queue, context) => {
    if (new Set(queue.orderedCaseIds).size !== queue.orderedCaseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["orderedCaseIds"],
        message: "Case IDs must be unique."
      });
    }
    const resultIds = queue.results.map(({ caseId }) => caseId);
    if (
      new Set(resultIds).size !== resultIds.length ||
      resultIds.some((caseId) => !queue.orderedCaseIds.includes(caseId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "Queue results are invalid."
      });
    }
    if (queue.currentCaseId !== null && !queue.orderedCaseIds.includes(queue.currentCaseId)) {
      context.addIssue({
        code: "custom",
        path: ["currentCaseId"],
        message: "Current case is invalid."
      });
    }
  });

export type ContractRunQueue = z.infer<typeof contractRunQueueSchema>;

export function createContractRunQueue(
  suite: ThurstoneContractSuiteV1,
  mode: ContractRunMode = "regression",
  continuousCaseIds?: readonly string[]
): ContractRunQueue {
  if (suite.cases.length === 0)
    throw new Error("A contract run requires at least one request case.");
  const orderedCaseIds =
    mode === "continuous"
      ? (continuousCaseIds ?? createContinuousJourneyPlanDraft(suite).orderedCaseIds)
      : suite.cases.map(({ caseId }) => caseId);
  return contractRunQueueSchema.parse({
    version: CONTRACT_RUN_QUEUE_VERSION,
    mode,
    suiteId: suite.suiteId,
    catalogDigest: suite.catalogDigest,
    orderedCaseIds,
    results: [],
    currentCaseId: orderedCaseIds[0]!
  });
}

export function canRunContinuousJourney(suite: ThurstoneContractSuiteV1): boolean {
  return suite.cases.length >= 2;
}

export function readContractRunQueue(storage: Storage): ContractRunQueue | null {
  const encoded = storage.getItem(CONTRACT_RUN_QUEUE_STORAGE_KEY);
  if (encoded === null) return null;
  try {
    return contractRunQueueSchema.parse(JSON.parse(encoded) as unknown);
  } catch {
    storage.removeItem(CONTRACT_RUN_QUEUE_STORAGE_KEY);
    return null;
  }
}

export function writeContractRunQueue(storage: Storage, queue: ContractRunQueue): void {
  storage.setItem(
    CONTRACT_RUN_QUEUE_STORAGE_KEY,
    JSON.stringify(contractRunQueueSchema.parse(queue))
  );
}

export function queueRemainingCaseIds(queue: ContractRunQueue): readonly string[] {
  const completed = new Set(queue.results.map(({ caseId }) => caseId));
  return queue.orderedCaseIds.filter((caseId) => !completed.has(caseId));
}

export function recordContractRunResult(
  queue: ContractRunQueue,
  input: ContractRunQueue["results"][number]
): ContractRunQueue {
  const existing = queue.results.find(({ caseId }) => caseId === input.caseId);
  if (existing !== undefined) {
    if (existing.verdict !== input.verdict || existing.resultDigest !== input.resultDigest) {
      throw new Error("A contract request result cannot be replaced.");
    }
    return queue;
  }
  const results = [...queue.results, input];
  const completed = new Set(results.map(({ caseId }) => caseId));
  const currentCaseId = queue.orderedCaseIds.find((caseId) => !completed.has(caseId)) ?? null;
  return contractRunQueueSchema.parse({ ...queue, results, currentCaseId });
}

export function clearContractRunQueue(storage: Storage): void {
  storage.removeItem(CONTRACT_RUN_QUEUE_STORAGE_KEY);
}
