import { parseDemoResult, type ThurstoneDemoResultV1 } from "@/lib/demo/result";

export const DEMO_RESULT_STORAGE_KEY = "thurstone:demo-result@1" as const;
export const DEMO_RESULT_MAX_BYTES = 64 * 1024;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function writeDemoResult(storage: Storage, result: ThurstoneDemoResultV1): void {
  const encoded = JSON.stringify(parseDemoResult(result));
  if (encodedBytes(encoded) > DEMO_RESULT_MAX_BYTES) {
    throw new Error("Demo result exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(DEMO_RESULT_STORAGE_KEY, encoded);
}

export function readDemoResult(storage: Storage): ThurstoneDemoResultV1 | null {
  const encoded = storage.getItem(DEMO_RESULT_STORAGE_KEY);
  if (encoded === null) return null;
  if (encodedBytes(encoded) > DEMO_RESULT_MAX_BYTES) {
    throw new Error("Stored demo result exceeds the allowed size.");
  }
  return parseDemoResult(JSON.parse(encoded) as unknown);
}

export function clearDemoResult(storage: Storage): void {
  storage.removeItem(DEMO_RESULT_STORAGE_KEY);
}
