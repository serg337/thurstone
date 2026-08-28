import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import type { RepairProviderKnownReceipt } from "@/lib/repair/provider.server";

export const REPAIR_STORE_VERSION = "toolproof-repair-store@1.0.0";

export interface RepairRedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const PUT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "baseline_evidence_digest") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "payload_digest") ~= ARGV[3]
  then return {0, "REPAIR_STORE_CONFLICT"} end
  return {2, "EXISTING", redis.call("HGET", KEYS[1], "stored_at_ms")}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[1], "version", ARGV[1], "baseline_evidence_digest", ARGV[2],
  "payload_digest", ARGV[3], "token", ARGV[4], "stored_at_ms", now_ms)
return {1, "STORED", now_ms}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "baseline_evidence_digest") ~= ARGV[2]
then return {0, "REPAIR_STORE_MISMATCH"} end
return {1, "FOUND", redis.call("HGET", KEYS[1], "payload_digest"),
  redis.call("HGET", KEYS[1], "token"), redis.call("HGET", KEYS[1], "stored_at_ms")}
`;

export const REPAIR_STORE_SCRIPTS = Object.freeze({ put: PUT_SCRIPT, read: READ_SCRIPT });

function key(baselineEvidenceDigest: string): string {
  if (!/^[a-f0-9]{64}$/u.test(baselineEvidenceDigest)) throw new Error("repair_digest_invalid");
  return `tp:{webmcp26}:repair-builder:${baselineEvidenceDigest}`;
}

function reply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("repair_store_reply_invalid");
  if (Number(value[0]) === 0) throw new Error(String(value[1] ?? "repair_store_denied"));
  return value;
}

export async function putRepairProviderReceipt(
  redis: RepairRedisClient,
  input: {
    readonly baselineEvidenceDigest: string;
    readonly receipt: RepairProviderKnownReceipt;
    readonly artifactSecret: string;
  }
): Promise<"new" | "existing"> {
  if (input.receipt.repairBuilderReceipt.baselineEvidenceDigest !== input.baselineEvidenceDigest) {
    throw new Error("repair_store_receipt_mismatch");
  }
  const payloadDigest = await canonicalSha256(input.receipt);
  const result = reply(
    await redis.eval(
      PUT_SCRIPT,
      [key(input.baselineEvidenceDigest)],
      [
        REPAIR_STORE_VERSION,
        input.baselineEvidenceDigest,
        payloadDigest,
        sealProbeArtifact("repair_receipt", input.receipt, input.artifactSecret)
      ]
    )
  );
  return Number(result[0]) === 1 ? "new" : "existing";
}

export async function readRepairProviderReceipt(
  redis: RepairRedisClient,
  input: { readonly baselineEvidenceDigest: string; readonly artifactSecret: string }
): Promise<RepairProviderKnownReceipt | null> {
  const result = reply(
    await redis.evalRo(
      READ_SCRIPT,
      [key(input.baselineEvidenceDigest)],
      [REPAIR_STORE_VERSION, input.baselineEvidenceDigest]
    )
  );
  if (String(result[1]) === "MISSING") return null;
  let receipt: RepairProviderKnownReceipt;
  try {
    receipt = openProbeArtifact(
      "repair_receipt",
      String(result[3] ?? ""),
      input.artifactSecret
    ) as RepairProviderKnownReceipt;
  } catch {
    throw new Error("repair_store_artifact_invalid");
  }
  if (
    receipt.repairBuilderReceipt.baselineEvidenceDigest !== input.baselineEvidenceDigest ||
    (await canonicalSha256(receipt)) !== String(result[2] ?? "") ||
    canonicalJson(receipt).length > 1_900_000
  ) {
    throw new Error("repair_store_artifact_mismatch");
  }
  return receipt;
}
