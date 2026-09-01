import {
  BYOA_FRESH_CONTEXT_V2_HEADER,
  BYOA_FRESH_CONTEXT_V2_STORAGE_KEY,
  BYOA_HANDOFF_CONTROL_V2_VERSION,
  byoaFreshContextIdV2Schema
} from "@/lib/demo/agent-handoff-v2";
import { canonicalJson } from "@/lib/evidence/digest";

interface StoredFreshContextV2 {
  readonly tokenDigest: string;
  readonly freshContextId: string;
}

const digestPattern = /^[a-f0-9]{64}$/u;

async function tokenDigest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseStored(value: string | null): StoredFreshContextV2 | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const digest = String(parsed.tokenDigest ?? "");
    const freshContextId = byoaFreshContextIdV2Schema.parse(parsed.freshContextId);
    if (!digestPattern.test(digest)) return null;
    return Object.freeze({ tokenDigest: digest, freshContextId });
  } catch {
    return null;
  }
}

export async function freshContextForByoaHandoffV2(
  storage: Storage,
  token: string
): Promise<string> {
  const digest = await tokenDigest(token);
  const stored = parseStored(storage.getItem(BYOA_FRESH_CONTEXT_V2_STORAGE_KEY));
  if (stored?.tokenDigest === digest) return stored.freshContextId;
  const freshContextId = byoaFreshContextIdV2Schema.parse(`fresh_${crypto.randomUUID()}`);
  storage.setItem(
    BYOA_FRESH_CONTEXT_V2_STORAGE_KEY,
    canonicalJson({ tokenDigest: digest, freshContextId })
  );
  return freshContextId;
}

export function readFreshContextForByoaHandoffV2(storage: Storage): string {
  const stored = parseStored(storage.getItem(BYOA_FRESH_CONTEXT_V2_STORAGE_KEY));
  if (!stored) throw new Error("The fresh-agent context binding is missing.");
  return stored.freshContextId;
}

export function byoaHandoffV2ContextHeaders(freshContextId: string): Record<string, string> {
  return { [BYOA_FRESH_CONTEXT_V2_HEADER]: byoaFreshContextIdV2Schema.parse(freshContextId) };
}

export async function controlByoaHandoffV2(input: {
  readonly action: "start" | "settle" | "unavailable" | "timeout";
  readonly runId: string;
  readonly contractDigest: string;
  readonly freshContextId: string;
}): Promise<{
  readonly state: string;
  readonly serverTimeMs: number;
  readonly startedAtMs: number | null;
}> {
  const response = await fetch("/api/demo/handoff/control", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Thurstone-Request": "byoa-handoff",
      ...byoaHandoffV2ContextHeaders(input.freshContextId)
    },
    body: JSON.stringify({
      version: BYOA_HANDOFF_CONTROL_V2_VERSION,
      action: input.action,
      runId: input.runId,
      contractDigest: input.contractDigest
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`The atomic handoff ${input.action} transition was denied.`);
  const value = (await response.json()) as Record<string, unknown>;
  const serverTimeMs = Number(value.serverTimeMs);
  const startedAtMs = value.startedAtMs === null ? null : Number(value.startedAtMs);
  if (
    value.ok !== true ||
    typeof value.state !== "string" ||
    !Number.isSafeInteger(serverTimeMs) ||
    (startedAtMs !== null && !Number.isSafeInteger(startedAtMs))
  ) {
    throw new Error("The atomic handoff control response was invalid.");
  }
  return Object.freeze({ state: value.state, serverTimeMs, startedAtMs });
}
