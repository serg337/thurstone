import { z } from "zod";

import {
  parseThurstoneDemoCatalogSnapshot,
  thurstoneDemoCatalogDigest,
  thurstoneDemoCatalogSnapshotSchema,
  type ThurstoneDemoCatalogSnapshotV1
} from "@/lib/demo/catalog-snapshot";
import {
  getArmableContractSuiteSelection,
  parseThurstoneContractCase,
  thurstoneContractCaseArgumentPredicateSchema,
  thurstoneContractCaseSchema,
  thurstoneContractSuiteDigest,
  verifyThurstoneContractSuite,
  type ThurstoneContractCaseV1,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { byoaRuntimeVariantSchema, type ByoaRuntimeVariant } from "@/lib/demo/agent-projection";
import { workshopEffectPredicateSchema } from "@/lib/demo/contract";
import {
  THURSTONE_DEMO_FIXTURE_ID,
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_DEMO_TRUSTED_STATE_SOURCE
} from "@/lib/demo/reference-tool-templates";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const BYOA_CONTRACT_V3_VERSION = "thurstone-byoa-contract@3" as const;
export const BYOA_DEMO_TOOLSET_V2_VERSION = "thurstone-byoa-demo-toolset@2" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const idSuffixPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const contractIdSchema = z.string().regex(new RegExp(`^byoa_${idSuffixPattern}$`, "u"));
const suiteIdSchema = z.string().regex(new RegExp(`^suite_${idSuffixPattern}$`, "u"));
const caseIdSchema = z.string().regex(new RegExp(`^case_${idSuffixPattern}$`, "u"));

export const byoaContractV3Schema = z
  .object({
    version: z.literal(BYOA_CONTRACT_V3_VERSION),
    toolsetVersion: z.literal(BYOA_DEMO_TOOLSET_V2_VERSION),
    contractId: contractIdSchema,
    suiteId: suiteIdSchema,
    suiteDigest: sha256Schema,
    caseId: caseIdSchema,
    caseDigest: sha256Schema,
    title: z.string().trim().min(1).max(80),
    request: z.string().trim().min(1).max(280),
    fixtureId: z.literal(THURSTONE_DEMO_FIXTURE_ID),
    expectedAction: z.literal("call"),
    expectedTool: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
    argumentPredicate: thurstoneContractCaseArgumentPredicateSchema,
    allowedEffects: z.array(workshopEffectPredicateSchema).max(2),
    forbiddenEffects: z.array(workshopEffectPredicateSchema).min(1).max(6),
    replayPolicy: z.enum(["read_only", "exactly_once"]),
    trustedStateSource: z.literal(THURSTONE_DEMO_TRUSTED_STATE_SOURCE),
    approvalClass: z.enum(["read_only", "consequential"]),
    catalogSnapshot: thurstoneDemoCatalogSnapshotSchema,
    catalogDigest: sha256Schema,
    runtimeVariant: byoaRuntimeVariantSchema.optional(),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.catalogSnapshot.fixtureId !== contract.fixtureId) {
      context.addIssue({
        code: "custom",
        path: ["fixtureId"],
        message: "The live contract fixture must match the selected catalog snapshot."
      });
    }
    if (contract.catalogSnapshot.trustedStateSource !== contract.trustedStateSource) {
      context.addIssue({
        code: "custom",
        path: ["trustedStateSource"],
        message: "The live contract trusted-state source must match the catalog snapshot."
      });
    }
    if (!contract.catalogSnapshot.tools.some(({ name }) => name === contract.expectedTool)) {
      context.addIssue({
        code: "custom",
        path: ["expectedTool"],
        message: "The selected case tool must exist in the live catalog."
      });
    }
    const selectedCase = selectedCaseFromContractValue(contract);
    const caseResult = thurstoneContractCaseSchema.safeParse(selectedCase);
    if (!caseResult.success) {
      for (const issue of caseResult.error.issues) {
        context.addIssue({
          code: "custom",
          path: ["selectedCase", ...issue.path],
          message: issue.message
        });
      }
    }
  });

export type ByoaContractV3 = z.infer<typeof byoaContractV3Schema>;

export interface CreateByoaContractV3Input {
  readonly contractId: string;
  readonly suite: ThurstoneContractSuiteV1;
  readonly buildCommit: string;
  readonly createdAt: string;
  readonly runtimeVariant?: ByoaRuntimeVariant;
}

export interface ByoaContractV3ExpectedLineage {
  readonly suiteId: string;
  readonly suiteDigest: string;
  readonly caseId: string;
  readonly catalogDigest: string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function selectedCaseFromContractValue(
  contract: Pick<
    ByoaContractV3,
    | "caseId"
    | "title"
    | "request"
    | "expectedAction"
    | "expectedTool"
    | "argumentPredicate"
    | "allowedEffects"
    | "forbiddenEffects"
    | "replayPolicy"
    | "approvalClass"
    | "trustedStateSource"
    | "catalogDigest"
  >
): ThurstoneContractCaseV1 {
  return parseThurstoneContractCase({
    caseId: contract.caseId,
    name: contract.title,
    request: contract.request,
    expectedAction: contract.expectedAction,
    expectedTool: contract.expectedTool,
    argumentPredicate: contract.argumentPredicate,
    allowedEffects: contract.allowedEffects,
    forbiddenEffects: contract.forbiddenEffects,
    replayPolicy: contract.replayPolicy,
    approvalClass: contract.approvalClass,
    trustedStateSource: contract.trustedStateSource,
    catalogDigest: contract.catalogDigest
  });
}

export function parseByoaContractV3(value: unknown): ByoaContractV3 {
  return deepFreeze(JSON.parse(canonicalJson(byoaContractV3Schema.parse(value))) as ByoaContractV3);
}

export function selectedCaseFromByoaContractV3(contract: ByoaContractV3): ThurstoneContractCaseV1 {
  return selectedCaseFromContractValue(parseByoaContractV3(contract));
}

export async function createByoaContractV3(
  input: CreateByoaContractV3Input
): Promise<ByoaContractV3> {
  const { suite, selectedCase } = await getArmableContractSuiteSelection(input.suite);
  const suiteDigest = await thurstoneContractSuiteDigest(suite);
  const caseDigest = await canonicalSha256(selectedCase);
  return parseByoaContractV3({
    version: BYOA_CONTRACT_V3_VERSION,
    toolsetVersion: BYOA_DEMO_TOOLSET_V2_VERSION,
    contractId: input.contractId,
    suiteId: suite.suiteId,
    suiteDigest,
    caseId: selectedCase.caseId,
    caseDigest,
    title: selectedCase.name,
    request: selectedCase.request,
    fixtureId: suite.catalogSnapshot.fixtureId,
    expectedAction: selectedCase.expectedAction,
    expectedTool: selectedCase.expectedTool,
    argumentPredicate: selectedCase.argumentPredicate,
    allowedEffects: selectedCase.allowedEffects,
    forbiddenEffects: selectedCase.forbiddenEffects,
    replayPolicy: selectedCase.replayPolicy,
    trustedStateSource: selectedCase.trustedStateSource,
    approvalClass: selectedCase.approvalClass,
    catalogSnapshot: suite.catalogSnapshot,
    catalogDigest: suite.catalogDigest,
    ...(input.runtimeVariant ? { runtimeVariant: input.runtimeVariant } : {}),
    buildCommit: input.buildCommit,
    createdAt: input.createdAt
  });
}

export async function verifyByoaContractV3(
  value: unknown,
  expectedLineage: ByoaContractV3ExpectedLineage
): Promise<ByoaContractV3> {
  const contract = parseByoaContractV3(value);
  const catalog = parseThurstoneDemoCatalogSnapshot(contract.catalogSnapshot);
  if ((await thurstoneDemoCatalogDigest(catalog)) !== contract.catalogDigest) {
    throw new Error("BYOA Contract v3 catalog digest does not match the frozen catalog snapshot.");
  }
  if ((await canonicalSha256(selectedCaseFromContractValue(contract))) !== contract.caseDigest) {
    throw new Error("BYOA Contract v3 case digest does not match the selected case.");
  }
  if (
    expectedLineage.suiteId !== contract.suiteId ||
    expectedLineage.suiteDigest !== contract.suiteDigest ||
    expectedLineage.caseId !== contract.caseId ||
    expectedLineage.catalogDigest !== contract.catalogDigest
  ) {
    throw new Error("BYOA Contract v3 does not match the expected suite and case lineage.");
  }
  return contract;
}

export async function expectedLineageForThurstoneSuite(
  value: unknown
): Promise<ByoaContractV3ExpectedLineage> {
  const suite = await verifyThurstoneContractSuite(value);
  const { selectedCase } = await getArmableContractSuiteSelection(suite);
  return Object.freeze({
    suiteId: suite.suiteId,
    suiteDigest: await thurstoneContractSuiteDigest(suite),
    caseId: selectedCase.caseId,
    catalogDigest: suite.catalogDigest
  });
}

export async function byoaContractV3Digest(
  value: unknown,
  expectedLineage: ByoaContractV3ExpectedLineage
): Promise<string> {
  return canonicalSha256(await verifyByoaContractV3(value, expectedLineage));
}

export function byoaContractV3Catalog(value: unknown): ThurstoneDemoCatalogSnapshotV1 {
  return parseByoaContractV3(value).catalogSnapshot;
}
