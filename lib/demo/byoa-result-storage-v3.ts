import { canonicalJson } from "@/lib/evidence/digest";
import { verifyByoaDemoResultV3, type ByoaDemoResultV3 } from "@/lib/demo/result-v3";

export const BYOA_RESULT_V3_STORAGE_KEY = "thurstone:byoa-result@3" as const;
export const BYOA_RESULT_V3_MAX_BYTES = 256 * 1024;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function writeByoaResultV3(storage: Storage, value: unknown): Promise<void> {
  const verified = await verifyByoaDemoResultV3(value);
  const encoded = canonicalJson(verified);
  if (encodedBytes(encoded) > BYOA_RESULT_V3_MAX_BYTES) {
    throw new Error("BYOA Result v3 exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_RESULT_V3_STORAGE_KEY, encoded);
}

export async function readByoaResultV3(storage: Storage): Promise<ByoaDemoResultV3 | null> {
  const encoded = storage.getItem(BYOA_RESULT_V3_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_RESULT_V3_MAX_BYTES) {
    throw new Error("Stored BYOA Result v3 exceeds the allowed size.");
  }
  return verifyByoaDemoResultV3(JSON.parse(encoded) as unknown);
}

export function clearByoaResultV3(storage: Storage): void {
  storage.removeItem(BYOA_RESULT_V3_STORAGE_KEY);
}
