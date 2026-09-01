import { z } from "zod";

import { canonicalJson } from "@/lib/evidence/digest";

export const REGRESSION_RERUN_VERSION = "thurstone-regression-rerun@1" as const;
export const REGRESSION_RERUN_STORAGE_KEY = "thurstone:regression-rerun@1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const regressionRerunSchema = z
  .object({
    version: z.literal(REGRESSION_RERUN_VERSION),
    caseDigest: sha256Schema,
    previousResultDigest: sha256Schema
  })
  .strict();

export type RegressionRerunV1 = z.infer<typeof regressionRerunSchema>;

export function writeRegressionRerun(storage: Storage, value: RegressionRerunV1): void {
  storage.setItem(REGRESSION_RERUN_STORAGE_KEY, canonicalJson(regressionRerunSchema.parse(value)));
}

export function readRegressionRerun(storage: Storage): RegressionRerunV1 | null {
  const encoded = storage.getItem(REGRESSION_RERUN_STORAGE_KEY);
  return encoded === null
    ? null
    : Object.freeze(
        JSON.parse(
          canonicalJson(regressionRerunSchema.parse(JSON.parse(encoded) as unknown))
        ) as RegressionRerunV1
      );
}

export function clearRegressionRerun(storage: Storage): void {
  storage.removeItem(REGRESSION_RERUN_STORAGE_KEY);
}
