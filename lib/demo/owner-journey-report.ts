import { z } from "zod";

import { byoaHandoffReportRequestV2Schema } from "@/lib/demo/agent-handoff-v2";
import { OWNER_JOURNEY_REPORT_STORAGE_KEY } from "@/lib/demo/owner-journey-report-marker";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export {
  OWNER_JOURNEY_REPORT_CHANGE_EVENT,
  OWNER_JOURNEY_REPORT_STORAGE_KEY
} from "@/lib/demo/owner-journey-report-marker";

export const OWNER_JOURNEY_REPORT_VERSION = "thurstone-owner-journey-report@3" as const;
const OWNER_JOURNEY_REPORT_MAX_BYTES = 64 * 1024;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const ownerJourneyReportResultSchema = z
  .object({
    position: z.number().int().min(1).max(12),
    caseId: z.string().regex(/^case_[0-9a-f-]{36}$/u),
    verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]),
    resultDigest: sha256Schema,
    ownerSummary: byoaHandoffReportRequestV2Schema.shape.ownerSummary
  })
  .strict();

const ownerJourneyReportNotRunSchema = z
  .object({
    position: z.number().int().min(1).max(12),
    caseId: z.string().regex(/^case_[0-9a-f-]{36}$/u),
    request: z.string().min(1).max(280),
    expectedTool: z.string().min(1).max(64),
    reason: z.string().min(1).max(500)
  })
  .strict();

const ownerJourneyReportCountsSchema = z
  .object({
    passed: z.number().int().min(0).max(12),
    issues: z.number().int().min(0).max(12),
    incomplete: z.number().int().min(0).max(12),
    unavailable: z.number().int().min(0).max(12),
    notRun: z.number().int().min(0).max(12)
  })
  .strict();

const ownerJourneyReportPayloadSchema = z
  .object({
    version: z.literal(OWNER_JOURNEY_REPORT_VERSION),
    mode: z.enum(["continuous", "regression"]),
    suiteId: z.string().regex(/^suite_[0-9a-f-]{36}$/u),
    catalogDigest: sha256Schema,
    completedAt: z.string().datetime({ offset: false }),
    total: z.number().int().min(2).max(12),
    counts: ownerJourneyReportCountsSchema,
    results: z.array(ownerJourneyReportResultSchema).min(1).max(12),
    notRun: z.array(ownerJourneyReportNotRunSchema).max(11),
    finalTrustedState: byoaHandoffReportRequestV2Schema.shape.ownerSummary.shape.trustedStateAfter
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.results.some(
        (result, index) =>
          result.position !== index + 1 ||
          result.caseId !== result.ownerSummary.caseId ||
          (report.mode === "continuous" &&
            index < report.results.length - 1 &&
            result.verdict !== "pass")
      ) ||
      report.notRun.some(
        (result, index) => result.position !== report.results.length + index + 1
      ) ||
      new Set([...report.results, ...report.notRun].map(({ caseId }) => caseId)).size !==
        report.total ||
      report.results.length + report.notRun.length !== report.total
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "Journey ordering is invalid."
      });
    }
    const measured = {
      passed: report.results.filter(({ verdict }) => verdict === "pass").length,
      issues: report.results.filter(({ verdict }) => verdict === "issue").length,
      incomplete: report.results.filter(({ verdict }) => verdict === "incomplete").length,
      unavailable: report.results.filter(({ verdict }) => verdict === "unavailable").length,
      notRun: report.notRun.length
    };
    if (canonicalJson(report.counts) !== canonicalJson(measured)) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Journey counts are invalid."
      });
    }
    const final = report.results.at(-1)?.ownerSummary.trustedStateAfter;
    if (final === undefined || canonicalJson(report.finalTrustedState) !== canonicalJson(final)) {
      context.addIssue({
        code: "custom",
        path: ["finalTrustedState"],
        message: "Final trusted state is not bound to the last result."
      });
    }
  });

export const ownerJourneyReportSchema = ownerJourneyReportPayloadSchema.extend({
  reportDigest: sha256Schema
});

export type OwnerJourneyReport = z.infer<typeof ownerJourneyReportSchema>;
export type OwnerJourneyReportResult = z.infer<typeof ownerJourneyReportResultSchema>;
export type OwnerJourneyReportNotRun = z.infer<typeof ownerJourneyReportNotRunSchema>;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function createOwnerJourneyReport(input: {
  readonly suiteId: string;
  readonly mode: "continuous" | "regression";
  readonly catalogDigest: string;
  readonly completedAt: string;
  readonly total: number;
  readonly results: readonly Omit<OwnerJourneyReportResult, "position">[];
  readonly plannedCases?: readonly {
    readonly caseId: string;
    readonly request: string;
    readonly expectedTool: string;
  }[];
}): Promise<OwnerJourneyReport> {
  const results = input.results.map((result, index) => ({ ...result, position: index + 1 }));
  if (input.plannedCases !== undefined) {
    if (
      input.plannedCases.length !== input.total ||
      results.some(
        (result, index) =>
          result.caseId !== input.plannedCases?.[index]?.caseId ||
          result.ownerSummary.request !== input.plannedCases[index]?.request ||
          result.ownerSummary.expectedTool !== input.plannedCases[index]?.expectedTool
      )
    ) {
      throw new Error("The owner report does not match its complete planned test order.");
    }
  } else if (results.length !== input.total) {
    throw new Error("A partial owner report requires its complete planned test order.");
  }
  const stoppedAfter = results.length;
  const notRun = (input.plannedCases ?? []).slice(stoppedAfter).map((planned, index) => ({
    position: stoppedAfter + index + 1,
    caseId: planned.caseId,
    request: planned.request,
    expectedTool: planned.expectedTool,
    reason:
      input.mode === "continuous"
        ? `Not run because the journey stopped after test ${stoppedAfter}. Continuing from an unverified state could produce unreliable results; fix the failed case and rerun the journey.`
        : `Not run because the regression suite ended before this independent case was executed.`
  }));
  const payload = ownerJourneyReportPayloadSchema.parse({
    version: OWNER_JOURNEY_REPORT_VERSION,
    mode: input.mode,
    suiteId: input.suiteId,
    catalogDigest: input.catalogDigest,
    completedAt: input.completedAt,
    total: input.total,
    counts: {
      passed: results.filter(({ verdict }) => verdict === "pass").length,
      issues: results.filter(({ verdict }) => verdict === "issue").length,
      incomplete: results.filter(({ verdict }) => verdict === "incomplete").length,
      unavailable: results.filter(({ verdict }) => verdict === "unavailable").length,
      notRun: notRun.length
    },
    results,
    notRun,
    finalTrustedState: results.at(-1)?.ownerSummary.trustedStateAfter
  });
  return ownerJourneyReportSchema.parse({
    ...payload,
    reportDigest: await canonicalSha256(payload)
  });
}

export async function verifyOwnerJourneyReport(value: unknown): Promise<OwnerJourneyReport> {
  const report = ownerJourneyReportSchema.parse(value);
  const { reportDigest, ...payload } = report;
  if ((await canonicalSha256(ownerJourneyReportPayloadSchema.parse(payload))) !== reportDigest) {
    throw new Error("Owner journey report digest does not match its canonical payload.");
  }
  return report;
}

export async function writeOwnerJourneyReport(
  storage: Storage,
  input: Parameters<typeof createOwnerJourneyReport>[0]
): Promise<OwnerJourneyReport> {
  const report = await createOwnerJourneyReport(input);
  const encoded = canonicalJson(report);
  if (encodedBytes(encoded) > OWNER_JOURNEY_REPORT_MAX_BYTES) {
    throw new Error("Owner journey report exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(OWNER_JOURNEY_REPORT_STORAGE_KEY, encoded);
  return report;
}

export async function readOwnerJourneyReport(storage: Storage): Promise<OwnerJourneyReport | null> {
  const encoded = storage.getItem(OWNER_JOURNEY_REPORT_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > OWNER_JOURNEY_REPORT_MAX_BYTES) {
    throw new Error("Stored owner journey report exceeds the tab-scoped storage boundary.");
  }
  return verifyOwnerJourneyReport(JSON.parse(encoded) as unknown);
}

export function clearOwnerJourneyReport(storage: Storage): void {
  storage.removeItem(OWNER_JOURNEY_REPORT_STORAGE_KEY);
}

export function ownerJourneyReportJson(report: OwnerJourneyReport): string {
  return `${canonicalJson(ownerJourneyReportSchema.parse(report))}\n`;
}
