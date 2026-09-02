import { z } from "zod";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import {
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  parseThurstoneDemoCatalogSnapshot,
  thurstoneDemoCatalogDigest,
  thurstoneDemoCatalogSnapshotSchema,
  type ThurstoneDemoCatalogSnapshotV1,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/catalog-snapshot";
import { workshopEffectPredicateSchema, type WorkshopEffectPredicate } from "@/lib/demo/contract";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const THURSTONE_CONTRACT_SUITE_VERSION = "thurstone-contract-suite@1" as const;
export const THURSTONE_CONTRACT_SUITE_MAX_CASES = 64 as const;
export const THURSTONE_CONTRACT_SUITE_MAX_ISSUED_CASE_IDS = 128 as const;

const idSuffixPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const suiteIdSchema = z.string().regex(new RegExp(`^suite_${idSuffixPattern}$`, "u"));
const caseIdSchema = z.string().regex(new RegExp(`^case_${idSuffixPattern}$`, "u"));
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const utcTimestampSchema = z.string().datetime({ offset: false });

const unsafeTextPattern =
  /(?:https?:\/\/|www\.|<[^>]*>|`{1,3}|\[[^\]]*\]\([^)]*\)|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)|-----BEGIN)/u;

const seededQuantityByItem = Object.freeze(
  Object.fromEntries(
    createCheckoutFixture().lines.map(({ itemId, quantity }) => [itemId, quantity])
  )
) as Readonly<Record<"field-notebook" | "stoneware-mug", number>>;

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

export const thurstoneContractCaseArgumentPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("empty") }).strict(),
  z
    .object({
      kind: z.literal("cart_update"),
      operationId: z.literal("valid_unique"),
      operation: z.literal("set_quantity"),
      itemId: z.enum(["field-notebook", "stoneware-mug"]),
      quantity: z.number().int().min(0).max(10)
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkout_request"),
      operationId: z.literal("valid_unique")
    })
    .strict()
]);

export type ThurstoneContractCaseArgumentPredicate = z.infer<
  typeof thurstoneContractCaseArgumentPredicateSchema
>;

function effectKinds(
  effects: readonly WorkshopEffectPredicate[]
): Set<WorkshopEffectPredicate["kind"]> {
  return new Set(effects.map(({ kind }) => kind));
}

function requireForbiddenKinds(
  forbiddenKinds: ReadonlySet<WorkshopEffectPredicate["kind"]>,
  required: readonly WorkshopEffectPredicate["kind"][],
  context: z.RefinementCtx
): void {
  for (const kind of required) {
    if (!forbiddenKinds.has(kind)) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: `The ${kind} invariant must be prohibited for this tool.`
      });
    }
  }
}

export const thurstoneContractCaseSchema = z
  .object({
    caseId: caseIdSchema,
    name: boundedPlainText(1, 80, "Case name"),
    request: boundedPlainText(1, 280, "Representative request"),
    expectedAction: z.literal("call"),
    expectedTool: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
    argumentPredicate: thurstoneContractCaseArgumentPredicateSchema,
    allowedEffects: z.array(workshopEffectPredicateSchema).max(2),
    forbiddenEffects: z.array(workshopEffectPredicateSchema).min(1).max(6),
    replayPolicy: z.enum(["read_only", "exactly_once"]),
    approvalClass: z.enum(["read_only", "consequential"]),
    trustedStateSource: z.literal("thurstone-reference-checkout-ledger"),
    catalogDigest: sha256Schema
  })
  .strict()
  .superRefine((testCase, context) => {
    const allowedSignatures = testCase.allowedEffects.map((effect) => canonicalJson(effect));
    const forbiddenSignatures = testCase.forbiddenEffects.map((effect) => canonicalJson(effect));
    if (new Set(allowedSignatures).size !== allowedSignatures.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedEffects"],
        message: "Allowed effects must be unique."
      });
    }
    if (new Set(forbiddenSignatures).size !== forbiddenSignatures.length) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: "Prohibited effects must be unique."
      });
    }
    if (allowedSignatures.some((signature) => forbiddenSignatures.includes(signature))) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenEffects"],
        message: "The same effect cannot be both permitted and prohibited."
      });
    }

    const allowedKinds = effectKinds(testCase.allowedEffects);
    const forbiddenKinds = effectKinds(testCase.forbiddenEffects);
    requireForbiddenKinds(forbiddenKinds, ["unmodeled_state"], context);

    if (testCase.expectedTool === "cart_get" || testCase.expectedTool === "order_review") {
      if (
        testCase.argumentPredicate.kind !== "empty" ||
        testCase.allowedEffects.length !== 0 ||
        testCase.replayPolicy !== "read_only" ||
        testCase.approvalClass !== "read_only"
      ) {
        context.addIssue({
          code: "custom",
          message:
            `${testCase.expectedTool} requires empty arguments, no allowed mutation, ` +
            "read-only replay, and read-only approval."
        });
      }
      requireForbiddenKinds(forbiddenKinds, ["cart_mutation", "pending_checkout"], context);
      return;
    }

    if (testCase.replayPolicy !== "exactly_once" || testCase.approvalClass !== "consequential") {
      context.addIssue({
        code: "custom",
        message: "Mutation tools require exactly-once replay and consequential approval."
      });
    }
    requireForbiddenKinds(forbiddenKinds, ["duplicate_transition"], context);

    if (testCase.expectedTool === "cart_update") {
      if (testCase.argumentPredicate.kind !== "cart_update") {
        context.addIssue({
          code: "custom",
          path: ["argumentPredicate"],
          message: "cart_update requires a valid-and-unique set-quantity argument predicate."
        });
        return;
      }
      if (
        testCase.argumentPredicate.quantity ===
        seededQuantityByItem[testCase.argumentPredicate.itemId]
      ) {
        context.addIssue({
          code: "custom",
          path: ["argumentPredicate", "quantity"],
          message: "cart_update must request a quantity different from the exact seeded fixture."
        });
      }
      const expectedEffect = {
        kind: "cart_quantity",
        itemId: testCase.argumentPredicate.itemId,
        quantity: testCase.argumentPredicate.quantity
      } as const;
      if (
        testCase.allowedEffects.length !== 1 ||
        canonicalJson(testCase.allowedEffects[0]) !== canonicalJson(expectedEffect)
      ) {
        context.addIssue({
          code: "custom",
          path: ["allowedEffects"],
          message: "cart_update requires exactly one matching cart-quantity effect."
        });
      }
      requireForbiddenKinds(forbiddenKinds, ["pending_checkout"], context);
      return;
    }

    if (
      testCase.argumentPredicate.kind !== "checkout_request" ||
      testCase.allowedEffects.length !== 1 ||
      !allowedKinds.has("pending_checkout")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "checkout_request requires a valid-and-unique operation ID and exactly one " +
          "pending-checkout effect."
      });
    }
    requireForbiddenKinds(forbiddenKinds, ["cart_mutation"], context);
  });

export type ThurstoneContractCaseV1 = z.infer<typeof thurstoneContractCaseSchema>;

function semanticCaseSignature(testCase: ThurstoneContractCaseV1): string {
  return canonicalJson({
    request: testCase.request,
    expectedAction: testCase.expectedAction,
    expectedTool: testCase.expectedTool,
    argumentPredicate: testCase.argumentPredicate
  });
}

export const thurstoneContractSuiteSchema = z
  .object({
    version: z.literal(THURSTONE_CONTRACT_SUITE_VERSION),
    suiteId: suiteIdSchema,
    name: boundedPlainText(1, 80, "Contract-suite name"),
    catalogSnapshot: thurstoneDemoCatalogSnapshotSchema,
    catalogDigest: sha256Schema,
    processEndingToolNames: z
      .array(z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES))
      .max(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.length)
      .default([]),
    cases: z.array(thurstoneContractCaseSchema).max(THURSTONE_CONTRACT_SUITE_MAX_CASES),
    selectedCaseId: caseIdSchema.nullable(),
    issuedCaseIds: z.array(caseIdSchema).max(THURSTONE_CONTRACT_SUITE_MAX_ISSUED_CASE_IDS),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema
  })
  .strict()
  .superRefine((suite, context) => {
    if (Date.parse(suite.updatedAt) < Date.parse(suite.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Suite updatedAt cannot precede createdAt."
      });
    }

    const caseIds = suite.cases.map(({ caseId }) => caseId);
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "Case IDs must be unique within a contract suite."
      });
    }
    if (new Set(suite.issuedCaseIds).size !== suite.issuedCaseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["issuedCaseIds"],
        message: "Issued case IDs must be unique and never reused."
      });
    }
    const issuedCaseIds = new Set(suite.issuedCaseIds);
    for (const [index, caseId] of caseIds.entries()) {
      if (!issuedCaseIds.has(caseId)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "caseId"],
          message: "Every active case ID must be recorded in issuedCaseIds."
        });
      }
    }

    if (suite.selectedCaseId !== null && !caseIds.includes(suite.selectedCaseId)) {
      context.addIssue({
        code: "custom",
        path: ["selectedCaseId"],
        message: "The selected case must belong to the current contract suite."
      });
    }

    const catalogNames = new Set(suite.catalogSnapshot.tools.map(({ name }) => name));
    if (new Set(suite.processEndingToolNames).size !== suite.processEndingToolNames.length) {
      context.addIssue({
        code: "custom",
        path: ["processEndingToolNames"],
        message: "Process-ending tool names must be unique."
      });
    }
    for (const [index, toolName] of suite.processEndingToolNames.entries()) {
      if (!catalogNames.has(toolName)) {
        context.addIssue({
          code: "custom",
          path: ["processEndingToolNames", index],
          message: "A process-ending tool must exist in the selected catalog."
        });
      }
    }
    const semanticSignatures = new Set<string>();
    for (const [index, testCase] of suite.cases.entries()) {
      if (!catalogNames.has(testCase.expectedTool)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "expectedTool"],
          message: "The expected tool must exist in the selected catalog."
        });
      }
      if (testCase.catalogDigest !== suite.catalogDigest) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "catalogDigest"],
          message: "Every case must bind to the suite catalog digest."
        });
      }
      if (testCase.trustedStateSource !== suite.catalogSnapshot.trustedStateSource) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "trustedStateSource"],
          message: "Every case must use the catalog's trusted-state source."
        });
      }
      const signature = semanticCaseSignature(testCase);
      if (semanticSignatures.has(signature)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index],
          message: "An exact request, action, and argument case already exists in this suite."
        });
      }
      semanticSignatures.add(signature);
    }
  });

export type ThurstoneContractSuiteV1 = z.infer<typeof thurstoneContractSuiteSchema>;

export interface ThurstoneContractCaseInput {
  readonly name: string;
  readonly request: string;
  readonly expectedTool: ThurstoneDemoSelectableToolName;
  readonly argumentPredicate: ThurstoneContractCaseArgumentPredicate;
  readonly allowedEffects: readonly WorkshopEffectPredicate[];
  readonly forbiddenEffects: readonly WorkshopEffectPredicate[];
  readonly replayPolicy: ThurstoneContractCaseV1["replayPolicy"];
  readonly approvalClass: ThurstoneContractCaseV1["approvalClass"];
}

export interface CreateThurstoneContractSuiteInput {
  readonly suiteId: string;
  readonly name: string;
  readonly catalogSnapshot: ThurstoneDemoCatalogSnapshotV1;
  readonly createdAt: string;
}

export type ContractSuiteOperationErrorCode =
  | "case_id_already_issued"
  | "case_limit_reached"
  | "case_not_found"
  | "catalog_tool_referenced"
  | "duplicate_semantic_case"
  | "issued_case_id_limit_reached"
  | "selected_case_required"
  | "suite_empty"
  | "timestamp_must_advance"
  | "catalog_digest_mismatch";

export class ContractSuiteOperationError extends Error {
  readonly code: ContractSuiteOperationErrorCode;

  constructor(code: ContractSuiteOperationErrorCode, message: string) {
    super(message);
    this.name = "ContractSuiteOperationError";
    this.code = code;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function canonicalFreeze<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalJson(value)) as T);
}

export function parseThurstoneContractCase(value: unknown): ThurstoneContractCaseV1 {
  return canonicalFreeze(thurstoneContractCaseSchema.parse(value));
}

export function parseThurstoneContractSuite(value: unknown): ThurstoneContractSuiteV1 {
  return canonicalFreeze(thurstoneContractSuiteSchema.parse(value));
}

export async function verifyThurstoneContractSuite(
  value: unknown
): Promise<ThurstoneContractSuiteV1> {
  const suite = parseThurstoneContractSuite(value);
  const actualCatalogDigest = await thurstoneDemoCatalogDigest(suite.catalogSnapshot);
  if (actualCatalogDigest !== suite.catalogDigest) {
    throw new ContractSuiteOperationError(
      "catalog_digest_mismatch",
      "The suite catalog digest does not match its canonical catalog snapshot."
    );
  }
  return suite;
}

export async function createThurstoneContractSuite(
  input: CreateThurstoneContractSuiteInput
): Promise<ThurstoneContractSuiteV1> {
  const catalogSnapshot = parseThurstoneDemoCatalogSnapshot(input.catalogSnapshot);
  const catalogDigest = await thurstoneDemoCatalogDigest(catalogSnapshot);
  return parseThurstoneContractSuite({
    version: THURSTONE_CONTRACT_SUITE_VERSION,
    suiteId: input.suiteId,
    name: input.name,
    catalogSnapshot,
    catalogDigest,
    processEndingToolNames: [],
    cases: [],
    selectedCaseId: null,
    issuedCaseIds: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });
}

export function newThurstoneContractSuiteId(): string {
  return `suite_${globalThis.crypto.randomUUID()}`;
}

export function newThurstoneContractCaseId(): string {
  return `case_${globalThis.crypto.randomUUID()}`;
}

function assertTimestampAdvances(suite: ThurstoneContractSuiteV1, updatedAt: string): void {
  utcTimestampSchema.parse(updatedAt);
  if (Date.parse(updatedAt) <= Date.parse(suite.updatedAt)) {
    throw new ContractSuiteOperationError(
      "timestamp_must_advance",
      "The suite update timestamp must advance monotonically."
    );
  }
}

function caseFromInput(
  suite: ThurstoneContractSuiteV1,
  input: ThurstoneContractCaseInput,
  caseId: string
): ThurstoneContractCaseV1 {
  return parseThurstoneContractCase({
    caseId,
    name: input.name,
    request: input.request,
    expectedAction: "call",
    expectedTool: input.expectedTool,
    argumentPredicate: input.argumentPredicate,
    allowedEffects: input.allowedEffects,
    forbiddenEffects: input.forbiddenEffects,
    replayPolicy: input.replayPolicy,
    approvalClass: input.approvalClass,
    trustedStateSource: suite.catalogSnapshot.trustedStateSource,
    catalogDigest: suite.catalogDigest
  });
}

function throwIfSemanticDuplicate(
  suite: ThurstoneContractSuiteV1,
  candidate: ThurstoneContractCaseV1,
  ignoredCaseId?: string
): void {
  const signature = semanticCaseSignature(candidate);
  if (
    suite.cases.some(
      (testCase) =>
        testCase.caseId !== ignoredCaseId && semanticCaseSignature(testCase) === signature
    )
  ) {
    throw new ContractSuiteOperationError(
      "duplicate_semantic_case",
      "An exact request, action, and argument case already exists in this suite."
    );
  }
}

export function renameContractSuite(
  value: unknown,
  name: string,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  return parseThurstoneContractSuite({ ...suite, name, updatedAt: options.updatedAt });
}

export function setContractSuiteProcessEndingTool(
  value: unknown,
  toolName: ThurstoneDemoSelectableToolName,
  processEnding: boolean,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  if (!suite.catalogSnapshot.tools.some(({ name }) => name === toolName)) {
    throw new ContractSuiteOperationError(
      "case_not_found",
      "Only a tool in the selected catalog may receive Thurstone journey metadata."
    );
  }
  const names = new Set(suite.processEndingToolNames);
  if (processEnding) names.add(toolName);
  else names.delete(toolName);
  return parseThurstoneContractSuite({
    ...suite,
    processEndingToolNames: [...names],
    updatedAt: options.updatedAt
  });
}

export function addContractSuiteCase(
  value: unknown,
  input: ThurstoneContractCaseInput,
  options: { readonly caseId: string; readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  if (suite.cases.length >= THURSTONE_CONTRACT_SUITE_MAX_CASES) {
    throw new ContractSuiteOperationError(
      "case_limit_reached",
      `A contract suite may contain at most ${THURSTONE_CONTRACT_SUITE_MAX_CASES} cases.`
    );
  }
  if (suite.issuedCaseIds.length >= THURSTONE_CONTRACT_SUITE_MAX_ISSUED_CASE_IDS) {
    throw new ContractSuiteOperationError(
      "issued_case_id_limit_reached",
      "This browser-local suite has reached its bounded case-ID history limit."
    );
  }
  caseIdSchema.parse(options.caseId);
  if (suite.issuedCaseIds.includes(options.caseId)) {
    throw new ContractSuiteOperationError(
      "case_id_already_issued",
      "This case ID was already issued and cannot be reused after deletion."
    );
  }
  const testCase = caseFromInput(suite, input, options.caseId);
  throwIfSemanticDuplicate(suite, testCase);
  return parseThurstoneContractSuite({
    ...suite,
    cases: [...suite.cases, testCase],
    issuedCaseIds: [...suite.issuedCaseIds, testCase.caseId],
    updatedAt: options.updatedAt
  });
}

export function editContractSuiteCase(
  value: unknown,
  caseId: string,
  input: ThurstoneContractCaseInput,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  const index = suite.cases.findIndex((testCase) => testCase.caseId === caseId);
  if (index < 0) {
    throw new ContractSuiteOperationError("case_not_found", "The case to edit no longer exists.");
  }
  const replacement = caseFromInput(suite, input, caseId);
  throwIfSemanticDuplicate(suite, replacement, caseId);
  const cases = [...suite.cases];
  cases[index] = replacement;
  return parseThurstoneContractSuite({ ...suite, cases, updatedAt: options.updatedAt });
}

export function removeContractSuiteCase(
  value: unknown,
  caseId: string,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  if (!suite.cases.some((testCase) => testCase.caseId === caseId)) {
    throw new ContractSuiteOperationError("case_not_found", "The case to remove no longer exists.");
  }
  return parseThurstoneContractSuite({
    ...suite,
    cases: suite.cases.filter((testCase) => testCase.caseId !== caseId),
    selectedCaseId: suite.selectedCaseId === caseId ? null : suite.selectedCaseId,
    updatedAt: options.updatedAt
  });
}

export function clearContractSuiteCases(
  value: unknown,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  return parseThurstoneContractSuite({
    ...suite,
    cases: [],
    selectedCaseId: null,
    updatedAt: options.updatedAt
  });
}

export function selectContractSuiteCase(
  value: unknown,
  caseId: string,
  options: { readonly updatedAt: string }
): ThurstoneContractSuiteV1 {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  if (!suite.cases.some((testCase) => testCase.caseId === caseId)) {
    throw new ContractSuiteOperationError(
      "case_not_found",
      "Only a case in the current suite may be selected for a live test."
    );
  }
  return parseThurstoneContractSuite({
    ...suite,
    selectedCaseId: caseId,
    updatedAt: options.updatedAt
  });
}

export async function updateContractSuiteCatalog(
  value: unknown,
  catalogValue: unknown,
  options: { readonly updatedAt: string }
): Promise<ThurstoneContractSuiteV1> {
  const suite = parseThurstoneContractSuite(value);
  assertTimestampAdvances(suite, options.updatedAt);
  const catalogSnapshot = parseThurstoneDemoCatalogSnapshot(catalogValue);
  const names = new Set(catalogSnapshot.tools.map(({ name }) => name));
  const incompatibleCases = suite.cases.filter(({ expectedTool }) => !names.has(expectedTool));
  if (incompatibleCases.length > 0) {
    throw new ContractSuiteOperationError(
      "catalog_tool_referenced",
      `The catalog cannot remove ${incompatibleCases.map(({ expectedTool }) => expectedTool).join(", ")} ` +
        "until each dependent case is reassigned or deleted."
    );
  }
  const catalogDigest = await thurstoneDemoCatalogDigest(catalogSnapshot);
  return parseThurstoneContractSuite({
    ...suite,
    catalogSnapshot,
    catalogDigest,
    processEndingToolNames: suite.processEndingToolNames.filter((toolName) => names.has(toolName)),
    cases: suite.cases.map((testCase) => ({
      ...testCase,
      trustedStateSource: catalogSnapshot.trustedStateSource,
      catalogDigest
    })),
    updatedAt: options.updatedAt
  });
}

export async function getArmableContractSuiteSelection(value: unknown): Promise<{
  readonly suite: ThurstoneContractSuiteV1;
  readonly selectedCase: ThurstoneContractCaseV1;
}> {
  const suite = await verifyThurstoneContractSuite(value);
  if (suite.cases.length === 0) {
    throw new ContractSuiteOperationError(
      "suite_empty",
      "Add at least one contract case before arming a live test."
    );
  }
  if (suite.selectedCaseId === null) {
    throw new ContractSuiteOperationError(
      "selected_case_required",
      "Select one contract case before arming a live test."
    );
  }
  const selectedCase = suite.cases.find(({ caseId }) => caseId === suite.selectedCaseId);
  if (selectedCase === undefined) {
    throw new ContractSuiteOperationError(
      "selected_case_required",
      "The selected case no longer belongs to this suite."
    );
  }
  return Object.freeze({ suite, selectedCase });
}

export async function thurstoneContractSuiteDigest(value: unknown): Promise<string> {
  return canonicalSha256(await verifyThurstoneContractSuite(value));
}
