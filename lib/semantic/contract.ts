import { canonicalJson } from "@/lib/evidence/digest";
import { z } from "zod";

export const SEMANTIC_CONTRACT_VERSION = "toolproof-semantic-contract@1.0.0";
export const SEMANTIC_SUITE_VERSION = "toolproof-semantic-suite@1.0.0";

export const SEMANTIC_FAMILIES = [
  "review-equivalent-realizations",
  "checkout-equivalent-realizations",
  "commitment-boundary-matched-pairs",
  "negation-scope-boundary-matched-pairs",
  "argument-boundary-matched-pairs",
  "ambiguity-versus-explicit-intent-matched-pairs"
] as const;

export const SEMANTIC_SUBSETS = ["development", "builder-blinded-holdout"] as const;

export const SEMANTIC_EFFECT_SURFACES = [
  "state-revision",
  "cart-quantities",
  "pending-checkout",
  "unmodeled-state"
] as const;

export type SemanticFamily = (typeof SEMANTIC_FAMILIES)[number];
export type SemanticSubset = (typeof SEMANTIC_SUBSETS)[number];
export type SemanticEffectSurface = (typeof SEMANTIC_EFFECT_SURFACES)[number];
export type SemanticJsonValue = z.infer<typeof semanticJsonValueSchema>;

const semanticJsonValueSchema = z.json();
const nonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, "Value must contain non-whitespace text.");
const internalIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{7,95}$/u);
const opaqueRunnerCaseIdSchema = z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u);
const toolNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u);

function isJsonPointer(value: string): boolean {
  if (value === "") return true;
  if (!value.startsWith("/")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "~") continue;
    const escape = value[index + 1];
    if (escape !== "0" && escape !== "1") return false;
    index += 1;
  }
  return true;
}

const jsonPointerSchema = z.string().max(512).refine(isJsonPointer, "Invalid JSON Pointer.");

const equalsPredicateSchema = z
  .object({
    path: jsonPointerSchema,
    operator: z.literal("equals"),
    value: semanticJsonValueSchema
  })
  .strict();

const presencePredicateSchema = z
  .object({
    path: jsonPointerSchema,
    operator: z.enum(["present", "absent"])
  })
  .strict();

const jsonTypePredicateSchema = z
  .object({
    path: jsonPointerSchema,
    operator: z.literal("json_type"),
    value: z.enum(["null", "boolean", "number", "string", "array", "object"])
  })
  .strict();

const runnerOperationIdPredicateSchema = z
  .object({
    path: jsonPointerSchema,
    operator: z.literal("runner_operation_id")
  })
  .strict();

export const semanticValuePredicateSchema = z.discriminatedUnion("operator", [
  equalsPredicateSchema,
  presencePredicateSchema,
  jsonTypePredicateSchema,
  runnerOperationIdPredicateSchema
]);

export type SemanticValuePredicate = z.infer<typeof semanticValuePredicateSchema>;

function addDuplicatePredicateIssues(
  predicates: readonly SemanticValuePredicate[],
  context: z.RefinementCtx
): void {
  const paths = new Set<string>();
  for (const [index, predicate] of predicates.entries()) {
    if (paths.has(predicate.path)) {
      context.addIssue({
        code: "custom",
        path: [index, "path"],
        message: `Predicate path ${predicate.path || "<root>"} is duplicated.`
      });
    }
    paths.add(predicate.path);
  }
}

const predicateListSchema = z
  .array(semanticValuePredicateSchema)
  .max(64)
  .superRefine(addDuplicatePredicateIssues);

const stateAndEffectExpectationShape = {
  stateBefore: predicateListSchema.min(1),
  stateAfter: predicateListSchema.min(1),
  effect: predicateListSchema.min(1)
};

export const semanticCallExpectationSchema = z
  .object({
    kind: z.literal("call"),
    tool: toolNameSchema,
    arguments: z
      .object({
        additionalProperties: z.literal("forbidden"),
        predicates: predicateListSchema
      })
      .strict(),
    result: predicateListSchema.min(1),
    stateChange: z.enum(["required", "forbidden"]),
    ...stateAndEffectExpectationShape
  })
  .strict()
  .superRefine(({ arguments: argumentExpectation }, context) => {
    for (const [index, predicate] of argumentExpectation.predicates.entries()) {
      if (predicate.operator === "present" || predicate.operator === "json_type") {
        context.addIssue({
          code: "custom",
          path: ["arguments", "predicates", index],
          message: "Exact call arguments require equals, absent, or runner_operation_id predicates."
        });
      }
      if (predicate.operator === "runner_operation_id" && predicate.path !== "/operationId") {
        context.addIssue({
          code: "custom",
          path: ["arguments", "predicates", index, "path"],
          message: "The runner-owned call argument must be bound at exactly /operationId."
        });
      }
      if (predicate.path === "/operationId" && predicate.operator !== "runner_operation_id") {
        context.addIssue({
          code: "custom",
          path: ["arguments", "predicates", index],
          message: "operationId is runner-owned and cannot be frozen as case truth."
        });
      }
    }
  });

const semanticNoCallExpectationSchema = z
  .object({
    kind: z.enum(["clarify", "no_action"]),
    stateChange: z.literal("forbidden"),
    ...stateAndEffectExpectationShape
  })
  .strict()
  .superRefine((expectation, context) => {
    for (const [field, predicates] of [
      ["stateBefore", expectation.stateBefore],
      ["stateAfter", expectation.stateAfter],
      ["effect", expectation.effect]
    ] as const) {
      for (const [index, predicate] of predicates.entries()) {
        if (predicate.operator === "runner_operation_id") {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: "A no-call expectation cannot reference a runner operation ID."
          });
        }
      }
    }
  });

export const semanticExpectationSchema = z.discriminatedUnion("kind", [
  semanticCallExpectationSchema,
  semanticNoCallExpectationSchema
]);

export type SemanticExpectation = z.infer<typeof semanticExpectationSchema>;
export type SemanticCallExpectation = z.infer<typeof semanticCallExpectationSchema>;

const semanticMeaningSchema = z
  .object({
    meaningId: internalIdSchema,
    label: nonBlankString(160),
    approvedMeaning: nonBlankString(2_000),
    approvalClass: z.enum([
      "read-only",
      "reversible-mutation",
      "human-gated-consequential-request",
      "no-action"
    ]),
    allowedEffects: z.array(z.enum(SEMANTIC_EFFECT_SURFACES)).max(4),
    forbiddenEffects: z.array(z.enum(SEMANTIC_EFFECT_SURFACES)).max(4),
    expectation: semanticExpectationSchema
  })
  .strict()
  .superRefine((meaning, context) => {
    const allowed = new Set(meaning.allowedEffects);
    const forbidden = new Set(meaning.forbiddenEffects);
    if (allowed.size !== meaning.allowedEffects.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedEffects"],
        message: "Allowed effect surfaces must be unique."
      });
    }
    if (forbidden.size !== meaning.forbiddenEffects.length) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: "Forbidden effect surfaces must be unique."
      });
    }
    for (const surface of SEMANTIC_EFFECT_SURFACES) {
      if (allowed.has(surface) === forbidden.has(surface)) {
        context.addIssue({
          code: "custom",
          path: ["allowedEffects"],
          message: `${surface} must be declared exactly once as allowed or forbidden.`
        });
      }
    }
    if (meaning.expectation.kind !== "call" && meaning.approvalClass !== "no-action") {
      context.addIssue({
        code: "custom",
        path: ["approvalClass"],
        message: "Clarification and no-action expectations require the no-action approval class."
      });
    }
    if (meaning.expectation.kind === "call" && meaning.approvalClass === "no-action") {
      context.addIssue({
        code: "custom",
        path: ["approvalClass"],
        message: "A call expectation cannot use the no-action approval class."
      });
    }
    if (meaning.approvalClass === "read-only" && meaning.expectation.stateChange !== "forbidden") {
      context.addIssue({
        code: "custom",
        path: ["expectation", "stateChange"],
        message: "A read-only action must forbid state change."
      });
    }
    if (
      (meaning.approvalClass === "read-only" || meaning.approvalClass === "no-action") &&
      meaning.allowedEffects.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedEffects"],
        message: "Read-only and no-action meanings cannot allow observable state effects."
      });
    }
  });

export const semanticContractSchema = z
  .object({
    version: z.literal(SEMANTIC_CONTRACT_VERSION),
    contractId: internalIdSchema,
    domain: nonBlankString(160),
    taskBoundary: nonBlankString(4_000),
    equivalencePrinciple: nonBlankString(2_000),
    sensitivityPrinciple: nonBlankString(2_000),
    actionClasses: z.tuple([z.literal("call"), z.literal("clarify"), z.literal("no_action")]),
    maximumModelDecisions: z.literal(1),
    maximumTargetCalls: z.literal(1),
    meanings: z.array(semanticMeaningSchema).min(1).max(24)
  })
  .strict()
  .superRefine(({ meanings }, context) => {
    const identifiers = new Set<string>();
    for (const [index, meaning] of meanings.entries()) {
      if (identifiers.has(meaning.meaningId)) {
        context.addIssue({
          code: "custom",
          path: ["meanings", index, "meaningId"],
          message: `Meaning ID ${meaning.meaningId} is duplicated.`
        });
      }
      identifiers.add(meaning.meaningId);
    }
  });

export type SemanticMeaning = z.infer<typeof semanticMeaningSchema>;
export type SemanticContract = z.infer<typeof semanticContractSchema>;

const equivalentRelationshipSchema = z
  .object({
    kind: z.literal("equivalent_realization"),
    groupId: internalIdSchema
  })
  .strict();

const boundaryRelationshipSchema = z
  .object({
    kind: z.literal("matched_boundary"),
    pairId: internalIdSchema,
    side: z.enum(["anchor", "contrast"]),
    materialDifference: nonBlankString(1_000)
  })
  .strict();

export const semanticScoredCaseSchema = z
  .object({
    caseId: internalIdSchema,
    runnerCaseId: opaqueRunnerCaseIdSchema,
    purpose: z.literal("scored"),
    subset: z.enum(SEMANTIC_SUBSETS),
    family: z.enum(SEMANTIC_FAMILIES),
    fixtureId: internalIdSchema,
    meaningId: internalIdSchema,
    naturalLanguageRequest: nonBlankString(2_000),
    relationship: z.discriminatedUnion("kind", [
      equivalentRelationshipSchema,
      boundaryRelationshipSchema
    ])
  })
  .strict();

export type SemanticScoredCase = z.infer<typeof semanticScoredCaseSchema>;

export const semanticCalibrationCaseSchema = z
  .object({
    caseId: internalIdSchema,
    runnerCaseId: opaqueRunnerCaseIdSchema,
    purpose: z.literal("calibration"),
    excludedFromBenchmark: z.literal(true),
    fixtureId: internalIdSchema,
    naturalLanguageRequest: nonBlankString(2_000),
    expectation: semanticExpectationSchema
  })
  .strict();

export type SemanticCalibrationCase = z.infer<typeof semanticCalibrationCaseSchema>;

export const semanticSuiteSchema = z
  .object({
    version: z.literal(SEMANTIC_SUITE_VERSION),
    suiteId: internalIdSchema,
    scoredCases: z.array(semanticScoredCaseSchema).length(24),
    calibrationCases: z.array(semanticCalibrationCaseSchema).length(4)
  })
  .strict();

export type SemanticSuite = z.infer<typeof semanticSuiteSchema>;

export interface SemanticSuiteIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class SemanticSuiteValidationError extends Error {
  constructor(readonly issues: readonly SemanticSuiteIssue[]) {
    super(issues.map(({ code, message }) => `${code}: ${message}`).join("\n"));
    this.name = "SemanticSuiteValidationError";
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function zodIssues(error: z.ZodError): readonly SemanticSuiteIssue[] {
  return error.issues.map((issue) => ({
    code: "schema_invalid",
    path: issue.path.join("."),
    message: issue.message
  }));
}

export function verifySemanticContract(value: unknown): SemanticContract {
  const parsed = semanticContractSchema.safeParse(value);
  if (!parsed.success) throw new SemanticSuiteValidationError(zodIssues(parsed.error));
  return deepFreeze(canonicalClone(parsed.data));
}

function addIssue(issues: SemanticSuiteIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function expectUnique(
  issues: SemanticSuiteIssue[],
  values: readonly string[],
  path: string,
  code: string
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) addIssue(issues, code, `${path}.${index}`, `${value} is duplicated.`);
    seen.add(value);
  }
}

const EQUIVALENT_FAMILIES = new Set<SemanticFamily>([
  "review-equivalent-realizations",
  "checkout-equivalent-realizations"
]);

function expectationFor(
  meaningById: ReadonlyMap<string, SemanticMeaning>,
  scoredCase: SemanticScoredCase
): SemanticExpectation | undefined {
  return meaningById.get(scoredCase.meaningId)?.expectation;
}

function canonicalActionSignature(expectation: SemanticExpectation): string {
  return canonicalJson(
    expectation.kind === "call"
      ? {
          kind: expectation.kind,
          tool: expectation.tool,
          arguments: expectation.arguments
        }
      : { kind: expectation.kind }
  );
}

/**
 * Verifies the full Gate 3 suite shape without assigning or approving semantic truth. The caller
 * supplies the human-authored contract; this function only proves count, allocation, pairing, and
 * referential invariants.
 */
export function verifySemanticSuiteStructure(
  value: unknown,
  contractValue: unknown
): SemanticSuite {
  const suiteResult = semanticSuiteSchema.safeParse(value);
  const contractResult = semanticContractSchema.safeParse(contractValue);
  const schemaIssues: SemanticSuiteIssue[] = [];
  if (!suiteResult.success) schemaIssues.push(...zodIssues(suiteResult.error));
  if (!contractResult.success) schemaIssues.push(...zodIssues(contractResult.error));
  if (!suiteResult.success || !contractResult.success) {
    throw new SemanticSuiteValidationError(schemaIssues);
  }

  const suite = suiteResult.data;
  const contract = contractResult.data;
  const issues: SemanticSuiteIssue[] = [];
  const meaningById = new Map(contract.meanings.map((meaning) => [meaning.meaningId, meaning]));

  expectUnique(
    issues,
    suite.scoredCases.map(({ caseId }) => caseId),
    "scoredCases.caseId",
    "duplicate_scored_case_id"
  );
  expectUnique(
    issues,
    suite.scoredCases.map(({ runnerCaseId }) => runnerCaseId),
    "scoredCases.runnerCaseId",
    "duplicate_scored_runner_id"
  );
  expectUnique(
    issues,
    suite.calibrationCases.map(({ caseId }) => caseId),
    "calibrationCases.caseId",
    "duplicate_calibration_case_id"
  );
  expectUnique(
    issues,
    suite.calibrationCases.map(({ runnerCaseId }) => runnerCaseId),
    "calibrationCases.runnerCaseId",
    "duplicate_calibration_runner_id"
  );

  const scoredCaseIds = new Set(suite.scoredCases.map(({ caseId }) => caseId));
  const scoredRunnerIds = new Set(suite.scoredCases.map(({ runnerCaseId }) => runnerCaseId));
  const scoredRequests = new Set(
    suite.scoredCases.map(({ naturalLanguageRequest }) => naturalLanguageRequest)
  );
  expectUnique(
    issues,
    suite.scoredCases.map(({ naturalLanguageRequest }) => naturalLanguageRequest),
    "scoredCases.naturalLanguageRequest",
    "duplicate_scored_request"
  );
  for (const [index, calibrationCase] of suite.calibrationCases.entries()) {
    if (scoredCaseIds.has(calibrationCase.caseId)) {
      addIssue(
        issues,
        "calibration_case_overlap",
        `calibrationCases.${index}.caseId`,
        "Calibration and scored case IDs must be disjoint."
      );
    }
    if (scoredRunnerIds.has(calibrationCase.runnerCaseId)) {
      addIssue(
        issues,
        "calibration_runner_overlap",
        `calibrationCases.${index}.runnerCaseId`,
        "Calibration and scored runner IDs must be disjoint."
      );
    }
    if (scoredRequests.has(calibrationCase.naturalLanguageRequest)) {
      addIssue(
        issues,
        "calibration_request_overlap",
        `calibrationCases.${index}.naturalLanguageRequest`,
        "A calibration request cannot be reused as a scored request."
      );
    }
  }
  expectUnique(
    issues,
    suite.calibrationCases.map(({ naturalLanguageRequest }) => naturalLanguageRequest),
    "calibrationCases.naturalLanguageRequest",
    "duplicate_calibration_request"
  );

  for (const subset of SEMANTIC_SUBSETS) {
    const count = suite.scoredCases.filter((scoredCase) => scoredCase.subset === subset).length;
    if (count !== 12) {
      addIssue(
        issues,
        "subset_count_invalid",
        "scoredCases",
        `${subset} must contain exactly 12 cases; received ${count}.`
      );
    }
  }

  const relationshipScopes = new Map<string, string>();
  for (const family of SEMANTIC_FAMILIES) {
    const familyCases = suite.scoredCases.filter((scoredCase) => scoredCase.family === family);
    if (familyCases.length !== 4) {
      addIssue(
        issues,
        "family_count_invalid",
        "scoredCases",
        `${family} must contain exactly four cases; received ${familyCases.length}.`
      );
    }
    for (const subset of SEMANTIC_SUBSETS) {
      const group = familyCases.filter((scoredCase) => scoredCase.subset === subset);
      if (group.length !== 2) {
        addIssue(
          issues,
          "family_subset_count_invalid",
          "scoredCases",
          `${family}/${subset} must contain exactly two cases; received ${group.length}.`
        );
        continue;
      }

      const scope = `${family}/${subset}`;
      if (EQUIVALENT_FAMILIES.has(family)) {
        if (group.some(({ relationship }) => relationship.kind !== "equivalent_realization")) {
          addIssue(
            issues,
            "equivalent_relationship_invalid",
            "scoredCases",
            `${scope} must be one equivalent-realization group.`
          );
          continue;
        }
        const equivalent = group as readonly (SemanticScoredCase & {
          readonly relationship: z.infer<typeof equivalentRelationshipSchema>;
        })[];
        const [first, second] = equivalent;
        if (!first || !second) continue;
        if (first.relationship.groupId !== second.relationship.groupId) {
          addIssue(
            issues,
            "equivalent_group_split",
            "scoredCases",
            `${scope} must share one equivalence group ID.`
          );
        }
        if (first.meaningId !== second.meaningId) {
          addIssue(
            issues,
            "equivalent_meaning_split",
            "scoredCases",
            `${scope} must reference one approved meaning identity.`
          );
        }
        const relationshipKey = `equivalent:${first.relationship.groupId}`;
        const priorScope = relationshipScopes.get(relationshipKey);
        if (priorScope && priorScope !== scope) {
          addIssue(
            issues,
            "relationship_id_reused",
            "scoredCases",
            `${first.relationship.groupId} is reused across ${priorScope} and ${scope}.`
          );
        }
        relationshipScopes.set(relationshipKey, scope);
      } else {
        if (group.some(({ relationship }) => relationship.kind !== "matched_boundary")) {
          addIssue(
            issues,
            "boundary_relationship_invalid",
            "scoredCases",
            `${scope} must be one intact matched-boundary pair.`
          );
          continue;
        }
        const boundary = group as readonly (SemanticScoredCase & {
          readonly relationship: z.infer<typeof boundaryRelationshipSchema>;
        })[];
        const [first, second] = boundary;
        if (!first || !second) continue;
        if (first.relationship.pairId !== second.relationship.pairId) {
          addIssue(
            issues,
            "boundary_pair_split",
            "scoredCases",
            `${scope} must share one pair ID wholly inside the subset.`
          );
        }
        if (first.relationship.side === second.relationship.side) {
          addIssue(
            issues,
            "boundary_side_invalid",
            "scoredCases",
            `${scope} must contain one anchor and one contrast.`
          );
        }
        if (first.relationship.materialDifference !== second.relationship.materialDifference) {
          addIssue(
            issues,
            "boundary_definition_split",
            "scoredCases",
            `${scope} must share one material-difference statement.`
          );
        }
        if (first.meaningId === second.meaningId) {
          addIssue(
            issues,
            "boundary_meaning_collapsed",
            "scoredCases",
            `${scope} must reference distinct meaning identities.`
          );
        }
        const firstExpectation = expectationFor(meaningById, first);
        const secondExpectation = expectationFor(meaningById, second);
        if (
          firstExpectation &&
          secondExpectation &&
          canonicalActionSignature(firstExpectation) === canonicalActionSignature(secondExpectation)
        ) {
          addIssue(
            issues,
            "boundary_expectation_collapsed",
            "scoredCases",
            `${scope} must change the approved action class, tool, or canonical arguments.`
          );
        }
        const relationshipKey = `boundary:${first.relationship.pairId}`;
        const priorScope = relationshipScopes.get(relationshipKey);
        if (priorScope && priorScope !== scope) {
          addIssue(
            issues,
            "relationship_id_reused",
            "scoredCases",
            `${first.relationship.pairId} is reused across ${priorScope} and ${scope}.`
          );
        }
        relationshipScopes.set(relationshipKey, scope);
      }
    }
  }

  const referencedMeaningIds = new Set(suite.scoredCases.map(({ meaningId }) => meaningId));
  for (const [index, scoredCase] of suite.scoredCases.entries()) {
    if (!meaningById.has(scoredCase.meaningId)) {
      addIssue(
        issues,
        "unknown_meaning",
        `scoredCases.${index}.meaningId`,
        `${scoredCase.meaningId} is not declared by the semantic contract.`
      );
    }
  }
  for (const [index, meaning] of contract.meanings.entries()) {
    if (!referencedMeaningIds.has(meaning.meaningId)) {
      addIssue(
        issues,
        "unreferenced_meaning",
        `contract.meanings.${index}.meaningId`,
        `${meaning.meaningId} is not used by a scored case.`
      );
    }
  }

  if (issues.length > 0) throw new SemanticSuiteValidationError(issues);
  return deepFreeze(canonicalClone(suite));
}

export function semanticMeaningForCase(
  contractValue: unknown,
  scoredCase: Pick<SemanticScoredCase, "meaningId">
): SemanticMeaning {
  const contract = verifySemanticContract(contractValue);
  const meaning = contract.meanings.find(({ meaningId }) => meaningId === scoredCase.meaningId);
  if (!meaning) {
    throw new SemanticSuiteValidationError([
      {
        code: "unknown_meaning",
        path: "meaningId",
        message: `${scoredCase.meaningId} is not declared by the semantic contract.`
      }
    ]);
  }
  return meaning;
}
