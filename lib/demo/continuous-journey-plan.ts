import { z } from "zod";

import type { ThurstoneContractCaseV1, ThurstoneContractSuiteV1 } from "@/lib/demo/contract-suite";

export const CONTINUOUS_JOURNEY_PLAN_VERSION = "thurstone-continuous-journey-plan@2" as const;
export const CONTINUOUS_JOURNEY_MAX_STEPS = 12;

const caseIdSchema = z.string().regex(/^case_[0-9a-f-]{36}$/u);

export const continuousJourneyPlanDraftSchema = z
  .object({
    version: z.literal(CONTINUOUS_JOURNEY_PLAN_VERSION),
    suiteId: z.string().regex(/^suite_[0-9a-f-]{36}$/u),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedCaseIds: z.array(caseIdSchema).min(2).max(CONTINUOUS_JOURNEY_MAX_STEPS),
    anyOrderMiddle: z.boolean()
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.orderedCaseIds).size !== plan.orderedCaseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["orderedCaseIds"],
        message: "Journey steps must use distinct contract cases."
      });
    }
  });

export type ContinuousJourneyPlanDraft = z.infer<typeof continuousJourneyPlanDraftSchema>;

export interface ContinuousJourneyValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly orderedCases: readonly ThurstoneContractCaseV1[];
}

export function createContinuousJourneyPlanDraft(
  suite: ThurstoneContractSuiteV1
): ContinuousJourneyPlanDraft {
  if (suite.cases.length < 2) {
    throw new Error("Add at least two contract requests before building a continuous journey.");
  }
  const firstCasePerTool = new Map<string, ThurstoneContractCaseV1>();
  for (const testCase of suite.cases) {
    if (!firstCasePerTool.has(testCase.expectedTool)) {
      firstCasePerTool.set(testCase.expectedTool, testCase);
    }
  }
  const representativeCases = [...firstCasePerTool.values()];
  const initialCases =
    representativeCases.length >= 2 ? representativeCases : suite.cases.slice(0, 2);
  const standardCases = initialCases.filter(
    ({ expectedTool }) => !suite.processEndingToolNames.includes(expectedTool)
  );
  const processEndingCases = initialCases.filter(({ expectedTool }) =>
    suite.processEndingToolNames.includes(expectedTool)
  );
  const orderedCaseIds = [...standardCases, ...processEndingCases]
    .slice(0, CONTINUOUS_JOURNEY_MAX_STEPS)
    .map(({ caseId }) => caseId);
  return continuousJourneyPlanDraftSchema.parse({
    version: CONTINUOUS_JOURNEY_PLAN_VERSION,
    suiteId: suite.suiteId,
    catalogDigest: suite.catalogDigest,
    orderedCaseIds,
    anyOrderMiddle: false
  });
}

export function reconcileContinuousJourneyPlanDraft(
  suite: ThurstoneContractSuiteV1,
  value: unknown
): ContinuousJourneyPlanDraft {
  const fallback = createContinuousJourneyPlanDraft(suite);
  const parsed = continuousJourneyPlanDraftSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.suiteId !== suite.suiteId ||
    parsed.data.catalogDigest !== suite.catalogDigest
  ) {
    return fallback;
  }
  const chosenCaseIds = new Set<string>();
  for (const caseId of parsed.data.orderedCaseIds) {
    const testCase = suite.cases.find((candidate) => candidate.caseId === caseId);
    if (testCase === undefined || chosenCaseIds.has(caseId)) return fallback;
    chosenCaseIds.add(caseId);
  }
  return parsed.data;
}

export function selectContinuousJourneyCase(
  plan: ContinuousJourneyPlanDraft,
  suite: ThurstoneContractSuiteV1,
  position: number,
  caseId: string
): ContinuousJourneyPlanDraft {
  const selected = suite.cases.find((testCase) => testCase.caseId === caseId);
  const current = suite.cases.find((testCase) => testCase.caseId === plan.orderedCaseIds[position]);
  if (
    selected === undefined ||
    current === undefined ||
    selected.expectedTool !== current.expectedTool
  ) {
    throw new Error("A journey step may only select another request for the same real tool.");
  }
  if (plan.orderedCaseIds.some((value, index) => index !== position && value === caseId)) {
    throw new Error("Each journey step must use a distinct contract request case.");
  }
  return continuousJourneyPlanDraftSchema.parse({
    ...plan,
    orderedCaseIds: plan.orderedCaseIds.map((value, index) => (index === position ? caseId : value))
  });
}

export function moveContinuousJourneyStep(
  plan: ContinuousJourneyPlanDraft,
  from: number,
  to: number
): ContinuousJourneyPlanDraft {
  if (
    from === to ||
    from < 0 ||
    from >= plan.orderedCaseIds.length ||
    to < 0 ||
    to >= plan.orderedCaseIds.length
  ) {
    return plan;
  }
  const orderedCaseIds = [...plan.orderedCaseIds];
  const [moved] = orderedCaseIds.splice(from, 1);
  if (moved === undefined) return plan;
  orderedCaseIds.splice(to, 0, moved);
  return continuousJourneyPlanDraftSchema.parse({
    ...plan,
    orderedCaseIds,
    anyOrderMiddle: false
  });
}

export function addContinuousJourneyStep(
  plan: ContinuousJourneyPlanDraft,
  suite: ThurstoneContractSuiteV1,
  caseId: string
): ContinuousJourneyPlanDraft {
  const selected = suite.cases.find((testCase) => testCase.caseId === caseId);
  if (selected === undefined) throw new Error("The selected contract request is unavailable.");
  if (plan.orderedCaseIds.includes(caseId)) {
    throw new Error("That contract request already appears in this journey.");
  }
  if (plan.orderedCaseIds.length >= CONTINUOUS_JOURNEY_MAX_STEPS) {
    throw new Error("This bounded Demo journey is full.");
  }
  if (
    suite.processEndingToolNames.includes(selected.expectedTool) &&
    plan.orderedCaseIds.some((value) => {
      const testCase = suite.cases.find((candidate) => candidate.caseId === value);
      return testCase ? suite.processEndingToolNames.includes(testCase.expectedTool) : false;
    })
  ) {
    throw new Error(
      "Replace the current process-ending request instead of adding another terminal step."
    );
  }
  const terminalIndex = plan.orderedCaseIds.findIndex((value) => {
    const testCase = suite.cases.find((candidate) => candidate.caseId === value);
    return testCase ? suite.processEndingToolNames.includes(testCase.expectedTool) : false;
  });
  const orderedCaseIds = [...plan.orderedCaseIds];
  orderedCaseIds.splice(terminalIndex < 0 ? orderedCaseIds.length : terminalIndex, 0, caseId);
  return continuousJourneyPlanDraftSchema.parse({
    ...plan,
    orderedCaseIds,
    anyOrderMiddle: false
  });
}

export function removeContinuousJourneyStep(
  plan: ContinuousJourneyPlanDraft,
  caseId: string
): ContinuousJourneyPlanDraft {
  if (!plan.orderedCaseIds.includes(caseId)) return plan;
  if (plan.orderedCaseIds.length <= 2) {
    throw new Error("A continuous journey requires at least two requests.");
  }
  return continuousJourneyPlanDraftSchema.parse({
    ...plan,
    orderedCaseIds: plan.orderedCaseIds.filter((value) => value !== caseId),
    anyOrderMiddle: false
  });
}

export function validateContinuousJourneyPlan(
  suite: ThurstoneContractSuiteV1,
  planValue: ContinuousJourneyPlanDraft
): ContinuousJourneyValidation {
  const plan = reconcileContinuousJourneyPlanDraft(suite, planValue);
  const orderedCases = plan.orderedCaseIds.map((caseId) =>
    suite.cases.find((testCase) => testCase.caseId === caseId)
  );
  if (orderedCases.some((testCase) => testCase === undefined)) {
    return {
      valid: false,
      errors: ["One selected journey request no longer exists."],
      orderedCases: []
    };
  }
  const cases = orderedCases as ThurstoneContractCaseV1[];
  const errors: string[] = [];
  for (const [index, testCase] of cases.entries()) {
    if (
      suite.processEndingToolNames.includes(testCase.expectedTool) &&
      index !== cases.length - 1
    ) {
      errors.push(`${testCase.expectedTool} is marked process-ending, so nothing may follow it.`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors, orderedCases: cases });
}

export function continuousJourneyPlanStorageKey(suiteId: string): string {
  return `thurstone:continuous-journey-plan@2:${suiteId}`;
}
