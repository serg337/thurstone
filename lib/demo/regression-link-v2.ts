import { z } from "zod";

export const REGRESSION_RERUN_LINK_V2_VERSION = "thurstone-regression-rerun-link@2" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

/**
 * Digest-only lineage carried inside the opaque Handoff v2 envelope.
 *
 * An INCOMPLETE or UNAVAILABLE result may be rerun but may not become a verified regression
 * case, so `regressionCaseDigest` is deliberately nullable. The link contains no handoff token,
 * URL, contract answer key, or customer data.
 */
export const regressionRerunLinkV2Schema = z
  .object({
    version: z.literal(REGRESSION_RERUN_LINK_V2_VERSION),
    previousResultDigest: sha256Schema,
    regressionCaseDigest: sha256Schema.nullable()
  })
  .strict();

export type RegressionRerunLinkV2 = z.infer<typeof regressionRerunLinkV2Schema>;

export function parseRegressionRerunLinkV2(value: unknown): RegressionRerunLinkV2 {
  return Object.freeze(regressionRerunLinkV2Schema.parse(value));
}
