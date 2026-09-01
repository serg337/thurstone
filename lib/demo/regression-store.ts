import { z } from "zod";

import {
  createRegressionCase,
  parseRegressionCase,
  regressionCaseSchema,
  type RegressionCaseV1
} from "@/lib/demo/regression-case";
import {
  byoaDemoResultSchema,
  verifyByoaDemoResult,
  type ByoaDemoResultV2
} from "@/lib/demo/result-v2";
import { canonicalJson } from "@/lib/evidence/digest";

export const MY_TESTS_VERSION = "thurstone-my-tests@1" as const;
export const MY_TESTS_STORAGE_KEY = "thurstone:my-tests@1" as const;
export const MY_TESTS_MAX_BYTES = 512 * 1024;
export const MY_TESTS_MAX_CASES = 20;
export const MY_TESTS_MAX_RESULTS_PER_CASE = 12;

const savedEntrySchema = z
  .object({
    case: regressionCaseSchema,
    results: z.array(byoaDemoResultSchema).min(1).max(MY_TESTS_MAX_RESULTS_PER_CASE)
  })
  .strict();

export const myTestsSchema = z
  .object({
    version: z.literal(MY_TESTS_VERSION),
    entries: z.array(savedEntrySchema).max(MY_TESTS_MAX_CASES)
  })
  .strict();

export type SavedRegressionEntry = z.infer<typeof savedEntrySchema>;
export type MyTestsV1 = z.infer<typeof myTestsSchema>;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseMyTests(value: unknown): MyTestsV1 {
  return Object.freeze(JSON.parse(canonicalJson(myTestsSchema.parse(value))) as MyTestsV1);
}

export async function readMyTests(storage: Storage): Promise<MyTestsV1> {
  const encoded = storage.getItem(MY_TESTS_STORAGE_KEY);
  if (encoded === null) return Object.freeze({ version: MY_TESTS_VERSION, entries: [] });
  if (encodedBytes(encoded) > MY_TESTS_MAX_BYTES) {
    throw new Error("Stored My Tests evidence exceeds the allowed size.");
  }
  const parsed = parseMyTests(JSON.parse(encoded) as unknown);
  for (const entry of parsed.entries) {
    parseRegressionCase(entry.case);
    for (const result of entry.results) await verifyByoaDemoResult(result);
    if (entry.results[0]?.resultDigest !== entry.case.sourceResultDigest) {
      throw new Error("Saved regression source result does not match the immutable case.");
    }
    for (let index = 1; index < entry.results.length; index += 1) {
      if (entry.results[index]?.previousResultDigest !== entry.results[index - 1]?.resultDigest) {
        throw new Error("Saved regression results do not form one successor chain.");
      }
    }
  }
  return parsed;
}

async function writeMyTests(storage: Storage, value: MyTestsV1): Promise<MyTestsV1> {
  const parsed = parseMyTests(value);
  const encoded = JSON.stringify(parsed);
  if (encodedBytes(encoded) > MY_TESTS_MAX_BYTES) {
    throw new Error("My Tests evidence exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(MY_TESTS_STORAGE_KEY, encoded);
  return readMyTests(storage);
}

export async function saveRegressionResult(input: {
  readonly storage: Storage;
  readonly result: ByoaDemoResultV2;
  readonly existingCaseDigest?: string | null;
  readonly createdAt: string;
}): Promise<SavedRegressionEntry> {
  const result = await verifyByoaDemoResult(input.result);
  if (result.verdict !== "pass" && result.verdict !== "fail") {
    throw new Error("Only verified pass or issue results can be saved in My Tests.");
  }
  const current = await readMyTests(input.storage);
  const existingIndex = input.existingCaseDigest
    ? current.entries.findIndex(({ case: saved }) => saved.caseDigest === input.existingCaseDigest)
    : -1;
  let entry: SavedRegressionEntry;
  let entries: SavedRegressionEntry[];
  if (existingIndex >= 0) {
    const existing = current.entries[existingIndex];
    if (!existing) throw new Error("Saved regression entry disappeared.");
    const previous = existing.results.at(-1);
    if (!previous || result.previousResultDigest !== previous.resultDigest) {
      throw new Error("Rerun result does not continue the saved regression lineage.");
    }
    entry = savedEntrySchema.parse({
      case: existing.case,
      results: [...existing.results, result]
    });
    entries = current.entries.map((candidate, index) =>
      index === existingIndex ? entry : candidate
    );
  } else {
    const regressionCase = await createRegressionCase(result, input.createdAt);
    entry = savedEntrySchema.parse({ case: regressionCase, results: [result] });
    entries = [entry, ...current.entries];
  }
  const saved = await writeMyTests(input.storage, { version: MY_TESTS_VERSION, entries });
  const stored = saved.entries.find(
    ({ case: candidate }) => candidate.caseDigest === entry.case.caseDigest
  );
  if (!stored) throw new Error("Saved regression entry was not retained.");
  return stored;
}

export async function clearMyTests(storage: Storage): Promise<void> {
  storage.removeItem(MY_TESTS_STORAGE_KEY);
}

export async function removeMyTest(storage: Storage, caseDigest: string): Promise<MyTestsV1> {
  const current = await readMyTests(storage);
  return writeMyTests(storage, {
    version: MY_TESTS_VERSION,
    entries: current.entries.filter(({ case: saved }) => saved.caseDigest !== caseDigest)
  });
}

export function latestRegressionResult(entry: SavedRegressionEntry): ByoaDemoResultV2 {
  const result = entry.results.at(-1);
  if (!result) throw new Error("Saved regression entry has no result.");
  return result;
}

export function regressionCaseForEntry(entry: SavedRegressionEntry): RegressionCaseV1 {
  return parseRegressionCase(entry.case);
}
