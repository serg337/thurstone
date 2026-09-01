import { z } from "zod";

import {
  byoaContractV3Schema,
  verifyByoaContractV3,
  type ByoaContractV3
} from "@/lib/demo/contract-v3";
import {
  byoaEvidenceTierSchema,
  byoaLaunchModeSchema,
  verifyByoaDemoResultV3,
  type ByoaDemoResultV3
} from "@/lib/demo/result-v3";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const REGRESSION_CASE_V2_VERSION = "thurstone-regression-case@2" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const runIdSchema = z.string().regex(/^byoa_run_[0-9a-f-]{36}$/u);
const suiteIdSchema = z.string().regex(/^suite_[0-9a-f-]{36}$/u);
const contractCaseIdSchema = z.string().regex(/^case_[0-9a-f-]{36}$/u);

export const regressionCaseV2Schema = z
  .object({
    version: z.literal(REGRESSION_CASE_V2_VERSION),
    regressionCaseDigest: sha256Schema,
    sourceResultDigest: sha256Schema,
    sourcePreviousResultDigest: sha256Schema.nullable(),
    sourceRunId: runIdSchema,
    sourceVerdict: z.enum(["pass", "issue"]),
    contract: byoaContractV3Schema,
    contractDigest: sha256Schema,
    suiteId: suiteIdSchema,
    suiteDigest: sha256Schema,
    contractCaseId: contractCaseIdSchema,
    contractCaseDigest: sha256Schema,
    catalogDigest: sha256Schema,
    originalBuildCommit: commitSchema,
    originalEvidenceTier: byoaEvidenceTierSchema,
    originalLaunchMode: byoaLaunchModeSchema,
    fixtureId: z.literal("checkout-seed-v1"),
    trustedStateSource: z.literal("thurstone-reference-checkout-ledger"),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict()
  .superRefine((value, context) => {
    const identities = [
      ["suiteId", value.suiteId, value.contract.suiteId],
      ["suiteDigest", value.suiteDigest, value.contract.suiteDigest],
      ["contractCaseId", value.contractCaseId, value.contract.caseId],
      ["contractCaseDigest", value.contractCaseDigest, value.contract.caseDigest],
      ["catalogDigest", value.catalogDigest, value.contract.catalogDigest],
      ["originalBuildCommit", value.originalBuildCommit, value.contract.buildCommit],
      ["fixtureId", value.fixtureId, value.contract.fixtureId],
      ["trustedStateSource", value.trustedStateSource, value.contract.trustedStateSource]
    ] as const;
    for (const [field, actual, expected] of identities) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must match the immutable source Contract v3.`
        });
      }
    }
  });

export type RegressionCaseV2 = z.infer<typeof regressionCaseV2Schema>;

function regressionCaseMaterial(
  value: Omit<RegressionCaseV2, "regressionCaseDigest"> | RegressionCaseV2
) {
  const { regressionCaseDigest, ...material } = value as RegressionCaseV2;
  void regressionCaseDigest;
  return material;
}

export async function createRegressionCaseV2(
  sourceValue: ByoaDemoResultV3,
  createdAt: string
): Promise<RegressionCaseV2> {
  const source = await verifyByoaDemoResultV3(sourceValue);
  if (source.verdict !== "pass" && source.verdict !== "issue") {
    throw new Error("Only verified PASS or ISSUE Result v3 evidence can become a regression case.");
  }
  const material = {
    version: REGRESSION_CASE_V2_VERSION,
    sourceResultDigest: source.resultDigest,
    sourcePreviousResultDigest: source.previousResultDigest,
    sourceRunId: source.runId,
    sourceVerdict: source.verdict,
    contract: source.contract,
    contractDigest: source.contractDigest,
    suiteId: source.suiteId,
    suiteDigest: source.suiteDigest,
    contractCaseId: source.caseId,
    contractCaseDigest: source.caseDigest,
    catalogDigest: source.catalogDigest,
    originalBuildCommit: source.buildCommit,
    originalEvidenceTier: source.evidenceTier,
    originalLaunchMode: source.launchMode,
    fixtureId: source.contract.fixtureId,
    trustedStateSource: source.contract.trustedStateSource,
    createdAt
  } as const;
  const regressionCaseDigest = await canonicalSha256(material);
  return verifyRegressionCaseV2({ ...material, regressionCaseDigest });
}

export function parseRegressionCaseV2(value: unknown): RegressionCaseV2 {
  return Object.freeze(
    JSON.parse(canonicalJson(regressionCaseV2Schema.parse(value))) as RegressionCaseV2
  );
}

export async function verifyRegressionCaseV2(value: unknown): Promise<RegressionCaseV2> {
  const parsed = parseRegressionCaseV2(value);
  await verifyByoaContractV3(parsed.contract, {
    suiteId: parsed.suiteId,
    suiteDigest: parsed.suiteDigest,
    caseId: parsed.contractCaseId,
    catalogDigest: parsed.catalogDigest
  });
  if ((await canonicalSha256(parsed.contract)) !== parsed.contractDigest) {
    throw new Error("Regression Case v2 contract digest does not match Contract v3.");
  }
  if ((await canonicalSha256(regressionCaseMaterial(parsed))) !== parsed.regressionCaseDigest) {
    throw new Error("Regression Case v2 digest does not match its canonical material.");
  }
  return parsed;
}

export function regressionCaseV2Reference(value: RegressionCaseV2) {
  const parsed = parseRegressionCaseV2(value);
  return Object.freeze({
    regressionCaseDigest: parsed.regressionCaseDigest,
    sourceResultDigest: parsed.sourceResultDigest,
    suiteId: parsed.suiteId,
    contractCaseId: parsed.contractCaseId
  });
}

export function sameRegressionContractMeaning(
  original: ByoaContractV3,
  successor: ByoaContractV3
): boolean {
  const dynamicFields = new Set(["contractId", "buildCommit", "createdAt"]);
  const staticMaterial = (contract: ByoaContractV3) =>
    Object.fromEntries(Object.entries(contract).filter(([field]) => !dynamicFields.has(field)));
  return canonicalJson(staticMaterial(original)) === canonicalJson(staticMaterial(successor));
}
