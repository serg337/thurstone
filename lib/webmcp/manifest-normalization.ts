import { canonicalJson } from "@/lib/evidence/digest";

export function normalizeInputSchema(value: unknown): object | null {
  if (value === undefined || value === null) return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (cause) {
      throw new TypeError("Discovered inputSchema is not valid JSON.", { cause });
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Discovered inputSchema must encode a JSON object.");
  }
  return parsed;
}

export function canonicalInputSchema(value: unknown): string {
  return canonicalJson(normalizeInputSchema(value));
}
