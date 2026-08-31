import { verifyByoaDemoResult, type ByoaDemoResultV2 } from "@/lib/demo/result-v2";

export const BYOA_RESULT_STORAGE_KEY = "thurstone:byoa-result@2" as const;
export const BYOA_RESULT_MAX_BYTES = 192 * 1024;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function writeByoaResult(storage: Storage, value: ByoaDemoResultV2): Promise<void> {
  const verified = await verifyByoaDemoResult(value);
  const encoded = JSON.stringify(verified);
  if (encodedBytes(encoded) > BYOA_RESULT_MAX_BYTES) {
    throw new Error("BYOA result exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(BYOA_RESULT_STORAGE_KEY, encoded);
}

export async function readByoaResult(storage: Storage): Promise<ByoaDemoResultV2 | null> {
  const encoded = storage.getItem(BYOA_RESULT_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > BYOA_RESULT_MAX_BYTES) {
    throw new Error("Stored BYOA result exceeds the allowed size.");
  }
  return verifyByoaDemoResult(JSON.parse(encoded) as unknown);
}

export function clearByoaResult(storage: Storage): void {
  storage.removeItem(BYOA_RESULT_STORAGE_KEY);
}
