import { z } from "zod";

import {
  createRegressionCaseV2,
  regressionCaseV2Schema,
  sameRegressionContractMeaning,
  verifyRegressionCaseV2,
  type RegressionCaseV2
} from "@/lib/demo/regression-case-v2";
import {
  byoaDemoResultV3Schema,
  verifyByoaDemoResultV3,
  type ByoaDemoResultV3
} from "@/lib/demo/result-v3";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const MY_TESTS_V2_VERSION = "thurstone-my-tests@2" as const;
export const MY_TESTS_V2_STORAGE_KEY = "thurstone:my-tests@2" as const;
export const MY_TESTS_V2_MAX_BYTES = 4 * 1024 * 1024;
export const MY_TESTS_V2_MAX_CASES = 20;
export const MY_TESTS_V2_MAX_RESULTS_PER_CASE = 20;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const savedRegressionEntryV2Schema = z
  .object({
    entryDigest: sha256Schema,
    case: regressionCaseV2Schema,
    results: z.array(byoaDemoResultV3Schema).min(1).max(MY_TESTS_V2_MAX_RESULTS_PER_CASE)
  })
  .strict();

export const myTestsV2Schema = z
  .object({
    version: z.literal(MY_TESTS_V2_VERSION),
    entries: z.array(savedRegressionEntryV2Schema).max(MY_TESTS_V2_MAX_CASES),
    storeDigest: sha256Schema
  })
  .strict();

export type SavedRegressionEntryV2 = z.infer<typeof savedRegressionEntryV2Schema>;
export type MyTestsV2 = z.infer<typeof myTestsV2Schema>;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function entryMaterial(
  value: Omit<SavedRegressionEntryV2, "entryDigest"> | SavedRegressionEntryV2
) {
  const { entryDigest, ...material } = value as SavedRegressionEntryV2;
  void entryDigest;
  return material;
}

function storeMaterial(value: Omit<MyTestsV2, "storeDigest"> | MyTestsV2) {
  const { storeDigest, ...material } = value as MyTestsV2;
  void storeDigest;
  return material;
}

function parseMyTestsV2(value: unknown): MyTestsV2 {
  return Object.freeze(JSON.parse(canonicalJson(myTestsV2Schema.parse(value))) as MyTestsV2);
}

async function createEntry(
  regressionCase: RegressionCaseV2,
  results: readonly ByoaDemoResultV3[]
): Promise<SavedRegressionEntryV2> {
  const material = { case: regressionCase, results };
  return savedRegressionEntryV2Schema.parse({
    ...material,
    entryDigest: await canonicalSha256(material)
  });
}

async function verifyEntry(value: unknown): Promise<SavedRegressionEntryV2> {
  const entry = savedRegressionEntryV2Schema.parse(value);
  const regressionCase = await verifyRegressionCaseV2(entry.case);
  const results: ByoaDemoResultV3[] = [];
  for (const resultValue of entry.results) {
    results.push(await verifyByoaDemoResultV3(resultValue));
  }
  const original = results[0];
  if (!original || original.resultDigest !== regressionCase.sourceResultDigest) {
    throw new Error("Stored Regression Case v2 does not retain its immutable source Result v3.");
  }
  if (
    original.previousResultDigest !== regressionCase.sourcePreviousResultDigest ||
    original.runId !== regressionCase.sourceRunId ||
    original.verdict !== regressionCase.sourceVerdict ||
    original.contractDigest !== regressionCase.contractDigest ||
    original.evidenceTier !== regressionCase.originalEvidenceTier ||
    original.launchMode !== regressionCase.originalLaunchMode
  ) {
    throw new Error(
      "Stored Regression Case v2 source identity does not match its original result."
    );
  }
  for (const [index, result] of results.entries()) {
    if (
      result.suiteId !== regressionCase.suiteId ||
      result.suiteDigest !== regressionCase.suiteDigest ||
      result.caseId !== regressionCase.contractCaseId ||
      result.caseDigest !== regressionCase.contractCaseDigest ||
      result.catalogDigest !== regressionCase.catalogDigest ||
      !sameRegressionContractMeaning(regressionCase.contract, result.contract)
    ) {
      throw new Error("Stored Result v3 does not belong to the immutable regression case.");
    }
    const previous = results[index - 1];
    if (previous && result.previousResultDigest !== previous.resultDigest) {
      throw new Error("Stored Result v3 successors do not form one append-only lineage.");
    }
  }
  if ((await canonicalSha256(entryMaterial(entry))) !== entry.entryDigest) {
    throw new Error("Saved Regression Case v2 entry digest does not match its canonical bytes.");
  }
  return Object.freeze(entry);
}

async function emptyMyTestsV2(): Promise<MyTestsV2> {
  const material = { version: MY_TESTS_V2_VERSION, entries: [] } as const;
  return parseMyTestsV2({ ...material, storeDigest: await canonicalSha256(material) });
}

export async function readMyTestsV2(storage: Storage): Promise<MyTestsV2> {
  const encoded = storage.getItem(MY_TESTS_V2_STORAGE_KEY);
  if (encoded === null) return emptyMyTestsV2();
  if (encodedBytes(encoded) > MY_TESTS_V2_MAX_BYTES) {
    throw new Error("Stored My Tests v2 evidence exceeds the allowed size.");
  }
  const parsed = parseMyTestsV2(JSON.parse(encoded) as unknown);
  const entries: SavedRegressionEntryV2[] = [];
  for (const entry of parsed.entries) entries.push(await verifyEntry(entry));
  if ((await canonicalSha256(storeMaterial(parsed))) !== parsed.storeDigest) {
    throw new Error("My Tests v2 store digest does not match its canonical bytes.");
  }
  return parseMyTestsV2({ ...parsed, entries });
}

async function writeMyTestsV2(
  storage: Storage,
  entriesValue: readonly SavedRegressionEntryV2[]
): Promise<MyTestsV2> {
  if (entriesValue.length > MY_TESTS_V2_MAX_CASES) {
    throw new Error(`My Tests v2 permits at most ${MY_TESTS_V2_MAX_CASES} saved cases.`);
  }
  const entries: SavedRegressionEntryV2[] = [];
  for (const entry of entriesValue) entries.push(await verifyEntry(entry));
  const material = { version: MY_TESTS_V2_VERSION, entries } as const;
  const value = parseMyTestsV2({
    ...material,
    storeDigest: await canonicalSha256(material)
  });
  const encoded = canonicalJson(value);
  if (encodedBytes(encoded) > MY_TESTS_V2_MAX_BYTES) {
    throw new Error("My Tests v2 evidence exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(MY_TESTS_V2_STORAGE_KEY, encoded);
  return readMyTestsV2(storage);
}

export async function saveRegressionResultV2(input: {
  readonly storage: Storage;
  readonly result: ByoaDemoResultV3;
  readonly existingCaseDigest?: string | null;
  readonly createdAt: string;
}): Promise<SavedRegressionEntryV2> {
  const result = await verifyByoaDemoResultV3(input.result);
  if (result.verdict !== "pass" && result.verdict !== "issue") {
    throw new Error("Only verified PASS or ISSUE Result v3 evidence can be saved in My Tests.");
  }
  const current = await readMyTestsV2(input.storage);
  const requestedDigest = input.existingCaseDigest ?? null;
  const existingIndex =
    requestedDigest === null
      ? -1
      : current.entries.findIndex(
          ({ case: saved }) => saved.regressionCaseDigest === requestedDigest
        );
  if (requestedDigest !== null && existingIndex < 0) {
    throw new Error(
      "The exact saved Regression Case v2 requested for this successor was not found."
    );
  }

  let savedEntry: SavedRegressionEntryV2;
  let entries: SavedRegressionEntryV2[];
  if (existingIndex >= 0) {
    const existing = current.entries[existingIndex];
    if (!existing) throw new Error("Saved Regression Case v2 disappeared during append.");
    const previous = existing.results.at(-1);
    if (!previous || result.previousResultDigest !== previous.resultDigest) {
      throw new Error("Rerun Result v3 does not continue the saved regression lineage.");
    }
    if (existing.results.some(({ resultDigest }) => resultDigest === result.resultDigest)) {
      throw new Error("This Result v3 is already present in the saved regression lineage.");
    }
    if (existing.results.length >= MY_TESTS_V2_MAX_RESULTS_PER_CASE) {
      throw new Error(
        `A Regression Case v2 may retain at most ${MY_TESTS_V2_MAX_RESULTS_PER_CASE} linked results.`
      );
    }
    savedEntry = await createEntry(existing.case, [...existing.results, result]);
    entries = current.entries.map((entry, index) => (index === existingIndex ? savedEntry : entry));
  } else {
    if (current.entries.length >= MY_TESTS_V2_MAX_CASES) {
      throw new Error(`My Tests v2 already contains its maximum ${MY_TESTS_V2_MAX_CASES} cases.`);
    }
    const regressionCase = await createRegressionCaseV2(result, input.createdAt);
    savedEntry = await createEntry(regressionCase, [result]);
    entries = [savedEntry, ...current.entries];
  }

  const saved = await writeMyTestsV2(input.storage, entries);
  const retained = saved.entries.find(
    ({ case: candidate }) => candidate.regressionCaseDigest === savedEntry.case.regressionCaseDigest
  );
  if (!retained) throw new Error("Saved Regression Case v2 was not retained after verification.");
  return retained;
}

export async function saveRegressionResultAcrossFreshContextV2(input: {
  readonly storage: Storage;
  readonly result: ByoaDemoResultV3;
  readonly predecessorCaseDigest?: string | null;
  readonly createdAt: string;
}): Promise<{
  readonly entry: SavedRegressionEntryV2;
  readonly disposition: "new-case" | "appended" | "independent-linked-successor";
}> {
  const predecessorCaseDigest = input.predecessorCaseDigest ?? null;
  if (predecessorCaseDigest === null) {
    return Object.freeze({
      entry: await saveRegressionResultV2({
        storage: input.storage,
        result: input.result,
        createdAt: input.createdAt
      }),
      disposition: "new-case" as const
    });
  }

  const current = await readMyTestsV2(input.storage);
  const predecessorPresent = current.entries.some(
    ({ case: saved }) => saved.regressionCaseDigest === predecessorCaseDigest
  );
  if (predecessorPresent) {
    return Object.freeze({
      entry: await saveRegressionResultV2({
        storage: input.storage,
        result: input.result,
        existingCaseDigest: predecessorCaseDigest,
        createdAt: input.createdAt
      }),
      disposition: "appended" as const
    });
  }
  if (input.result.previousResultDigest === null) {
    throw new Error(
      "A missing predecessor case can be preserved as an independent successor only when Result v3 names its previous result digest."
    );
  }
  return Object.freeze({
    entry: await saveRegressionResultV2({
      storage: input.storage,
      result: input.result,
      createdAt: input.createdAt
    }),
    disposition: "independent-linked-successor" as const
  });
}

/** Clears exactly the Result v3 regression-store key and nothing else. */
export function clearMyTestsV2(storage: Storage): void {
  storage.removeItem(MY_TESTS_V2_STORAGE_KEY);
}

export async function removeMyTestV2(
  storage: Storage,
  regressionCaseDigest: string
): Promise<MyTestsV2> {
  sha256Schema.parse(regressionCaseDigest);
  const current = await readMyTestsV2(storage);
  const retained = current.entries.filter(
    ({ case: saved }) => saved.regressionCaseDigest !== regressionCaseDigest
  );
  if (retained.length === current.entries.length) {
    throw new Error("The exact Regression Case v2 requested for removal was not found.");
  }
  return writeMyTestsV2(storage, retained);
}

function assertNoHandoffSecretKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoHandoffSecretKeys(child, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "token" ||
      normalized === "handofftoken" ||
      normalized === "handoffurl" ||
      normalized === "capability"
    ) {
      throw new Error(`Export rejected a transient handoff secret at ${path}.${key}.`);
    }
    assertNoHandoffSecretKeys(child, `${path}.${key}`);
  }
}

export async function resultV3ExportJson(value: unknown): Promise<string> {
  const result = await verifyByoaDemoResultV3(value);
  assertNoHandoffSecretKeys(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function regressionEntryV2ExportJson(
  storage: Storage,
  regressionCaseDigest: string
): Promise<string> {
  sha256Schema.parse(regressionCaseDigest);
  const stored = await readMyTestsV2(storage);
  const entry = stored.entries.find(
    ({ case: candidate }) => candidate.regressionCaseDigest === regressionCaseDigest
  );
  if (!entry) throw new Error("The exact Regression Case v2 requested for export was not found.");
  assertNoHandoffSecretKeys(entry);
  return `${JSON.stringify(entry, null, 2)}\n`;
}

export function latestRegressionResultV2(entry: SavedRegressionEntryV2): ByoaDemoResultV3 {
  const result = entry.results.at(-1);
  if (!result) throw new Error("Saved Regression Case v2 has no linked result.");
  return result;
}
