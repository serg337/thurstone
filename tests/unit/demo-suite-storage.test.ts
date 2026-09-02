import { describe, expect, it } from "vitest";

import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import { createThurstoneContractSuite } from "@/lib/demo/contract-suite";
import {
  THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION,
  THURSTONE_SUITE_STORAGE_KEY,
  THURSTONE_SUITE_STORAGE_MAX_BYTES,
  clearThurstoneContractSuite,
  loadThurstoneContractSuite,
  saveThurstoneContractSuite
} from "@/lib/demo/suite-storage";
import { canonicalJson } from "@/lib/evidence/digest";

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function suite() {
  return createThurstoneContractSuite({
    suiteId: "suite_11111111-1111-4111-8111-111111111111",
    name: "Checkout meaning",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot(),
    createdAt: "2026-09-01T08:00:00.000Z"
  });
}

function decodedEnvelope(storage: Storage): Record<string, unknown> {
  const encoded = storage.getItem(THURSTONE_SUITE_STORAGE_KEY);
  if (encoded === null) throw new Error("Expected stored suite envelope.");
  return JSON.parse(encoded) as Record<string, unknown>;
}

describe("Thurstone contract-suite session storage", () => {
  it("restores the exact suite after a same-tab refresh using deterministic JSON", async () => {
    const storage = new FakeStorage();
    const value = await suite();

    const identity = await saveThurstoneContractSuite(storage, value);
    const firstBytes = storage.getItem(THURSTONE_SUITE_STORAGE_KEY);
    await saveThurstoneContractSuite(storage, value);
    const secondBytes = storage.getItem(THURSTONE_SUITE_STORAGE_KEY);

    expect(secondBytes).toBe(firstBytes);
    expect(secondBytes).toBe(canonicalJson(JSON.parse(secondBytes ?? "null") as unknown));
    await expect(loadThurstoneContractSuite(storage, identity)).resolves.toEqual({
      status: "restored",
      suite: value,
      identity: { suiteId: value.suiteId, catalogDigest: value.catalogDigest },
      suiteDigest: identity.suiteDigest
    });
  });

  it("does not silently inherit a suite into a different tab-scoped store", async () => {
    const firstTab = new FakeStorage();
    const newTab = new FakeStorage();
    await saveThurstoneContractSuite(firstTab, await suite());

    await expect(loadThurstoneContractSuite(newTab)).resolves.toEqual({ status: "empty" });
  });

  it("fails closed with targeted recovery for malformed and oversized bytes", async () => {
    const storage = new FakeStorage();
    storage.setItem(THURSTONE_SUITE_STORAGE_KEY, "{");
    await expect(loadThurstoneContractSuite(storage)).resolves.toEqual({
      status: "rejected",
      reason: "malformed_json",
      recovery: "clear_contract_suite_state"
    });
    expect(storage.getItem(THURSTONE_SUITE_STORAGE_KEY)).toBe("{");

    storage.setItem(THURSTONE_SUITE_STORAGE_KEY, "x".repeat(THURSTONE_SUITE_STORAGE_MAX_BYTES + 1));
    await expect(loadThurstoneContractSuite(storage)).resolves.toEqual({
      status: "rejected",
      reason: "oversized",
      recovery: "clear_contract_suite_state"
    });
  });

  it("rejects unknown envelope fields and unsupported envelope versions", async () => {
    const storage = new FakeStorage();
    await saveThurstoneContractSuite(storage, await suite());
    storage.setItem(
      THURSTONE_SUITE_STORAGE_KEY,
      canonicalJson({ ...decodedEnvelope(storage), unexpected: true })
    );
    await expect(loadThurstoneContractSuite(storage)).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid_envelope"
    });

    const unsupported = decodedEnvelope(storage);
    delete unsupported.unexpected;
    storage.setItem(
      THURSTONE_SUITE_STORAGE_KEY,
      canonicalJson({ ...unsupported, version: "unknown-suite-storage@9" })
    );
    await expect(loadThurstoneContractSuite(storage)).resolves.toMatchObject({
      status: "rejected",
      reason: "unsupported_version"
    });
    expect(THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION).toBe("thurstone-contract-suite-storage@3");
  });

  it("rejects duplicated or caller-bound identity mismatches", async () => {
    const storage = new FakeStorage();
    const value = await suite();
    await saveThurstoneContractSuite(storage, value);
    storage.setItem(
      THURSTONE_SUITE_STORAGE_KEY,
      canonicalJson({
        ...decodedEnvelope(storage),
        suiteId: "suite_22222222-2222-4222-8222-222222222222"
      })
    );
    await expect(loadThurstoneContractSuite(storage)).resolves.toMatchObject({
      status: "rejected",
      reason: "identity_mismatch"
    });

    await saveThurstoneContractSuite(storage, value);
    await expect(
      loadThurstoneContractSuite(storage, {
        suiteId: "suite_33333333-3333-4333-8333-333333333333",
        catalogDigest: value.catalogDigest
      })
    ).resolves.toMatchObject({ status: "rejected", reason: "identity_mismatch" });
  });

  it("rejects a suite digest mismatch", async () => {
    const storage = new FakeStorage();
    await saveThurstoneContractSuite(storage, await suite());
    const envelope = decodedEnvelope(storage);
    const digest = String(envelope.suiteDigest);
    const changedDigest = `${digest.startsWith("0") ? "1" : "0"}${digest.slice(1)}`;
    storage.setItem(
      THURSTONE_SUITE_STORAGE_KEY,
      canonicalJson({ ...envelope, suiteDigest: changedDigest })
    );

    await expect(loadThurstoneContractSuite(storage)).resolves.toMatchObject({
      status: "rejected",
      reason: "digest_mismatch"
    });
  });

  it("saves and clears only its exact key", async () => {
    const storage = new FakeStorage();
    storage.setItem("thurstone:unrelated", "keep-me");
    storage.setItem("thurstone:byoa-session@1", "legacy-session");

    await saveThurstoneContractSuite(storage, await suite());
    expect(storage.getItem("thurstone:unrelated")).toBe("keep-me");
    expect(storage.getItem("thurstone:byoa-session@1")).toBe("legacy-session");

    clearThurstoneContractSuite(storage);
    expect(storage.getItem(THURSTONE_SUITE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("thurstone:unrelated")).toBe("keep-me");
    expect(storage.getItem("thurstone:byoa-session@1")).toBe("legacy-session");
  });
});
