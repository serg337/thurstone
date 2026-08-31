import { z } from "zod";

import { byoaContractSchema } from "@/lib/demo/contract-v2";
import { verifyByoaDemoResult, type ByoaDemoResultV2 } from "@/lib/demo/result-v2";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const REGRESSION_CASE_VERSION = "thurstone-regression-case@1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const regressionCaseSchema = z
  .object({
    version: z.literal(REGRESSION_CASE_VERSION),
    caseDigest: sha256Schema,
    sourceResultDigest: sha256Schema,
    previousResultDigest: sha256Schema.nullable(),
    contract: byoaContractSchema,
    fixtureId: z.literal("checkout-seed-v1"),
    originalCatalogDigest: sha256Schema,
    originalBuildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    createdAt: z.string().datetime({ offset: false })
  })
  .strict();

export type RegressionCaseV1 = z.infer<typeof regressionCaseSchema>;

function caseMaterial(value: Omit<RegressionCaseV1, "caseDigest"> | RegressionCaseV1) {
  const { caseDigest, ...material } = value as RegressionCaseV1;
  void caseDigest;
  return material;
}

export async function createRegressionCase(
  source: ByoaDemoResultV2,
  createdAt: string
): Promise<RegressionCaseV1> {
  const result = await verifyByoaDemoResult(source);
  if (result.verdict !== "pass" && result.verdict !== "fail") {
    throw new Error("Only terminal pass or fail results can become verified regression cases.");
  }
  const material = {
    version: REGRESSION_CASE_VERSION,
    sourceResultDigest: result.resultDigest,
    previousResultDigest: result.previousResultDigest,
    contract: result.contract,
    fixtureId: result.contract.fixtureId,
    originalCatalogDigest: result.manifestHash,
    originalBuildCommit: result.buildCommit,
    createdAt
  };
  const caseDigest = await canonicalSha256(material);
  return verifyRegressionCase({ ...material, caseDigest });
}

export function parseRegressionCase(value: unknown): RegressionCaseV1 {
  return Object.freeze(
    JSON.parse(canonicalJson(regressionCaseSchema.parse(value))) as RegressionCaseV1
  );
}

export async function verifyRegressionCase(value: unknown): Promise<RegressionCaseV1> {
  const parsed = parseRegressionCase(value);
  if ((await canonicalSha256(caseMaterial(parsed))) !== parsed.caseDigest) {
    throw new Error("Regression-case digest does not match its canonical material.");
  }
  return parsed;
}

export function regressionCaseReference(regressionCase: RegressionCaseV1) {
  const parsed = parseRegressionCase(regressionCase);
  return Object.freeze({
    caseDigest: parsed.caseDigest,
    sourceResultDigest: parsed.sourceResultDigest
  });
}
