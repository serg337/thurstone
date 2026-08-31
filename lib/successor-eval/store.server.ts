import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import type { ScoredProviderKnownReceipt } from "@/lib/scored/openai-provider.server";

export const SUCCESSOR_EVAL_STORE_VERSION = "thurstone-successor-eval-store@1.0.0";

export interface SuccessorEvalRedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const PUT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "receipt_key") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "payload_digest") ~= ARGV[3]
  then return {0, "SUCCESSOR_EVAL_STORE_CONFLICT"} end
  return {2, "EXISTING"}
end
redis.call("HSET", KEYS[1], "version", ARGV[1], "receipt_key", ARGV[2],
  "payload_digest", ARGV[3], "token", ARGV[4])
return {1, "STORED"}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "receipt_key") ~= ARGV[2]
then return {0, "SUCCESSOR_EVAL_STORE_MISMATCH"} end
return {1, "FOUND", redis.call("HGET", KEYS[1], "payload_digest"),
  redis.call("HGET", KEYS[1], "token")}
`;

function reply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2)
    throw new Error("successor_eval_store_reply_invalid");
  if (Number(value[0]) === 0) throw new Error(String(value[1] ?? "successor_eval_store_denied"));
  return value;
}

async function storageKey(receiptKey: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/u.test(receiptKey)) throw new Error("successor_eval_receipt_key_invalid");
  return `tp:{webmcp26}:successor-eval:${await canonicalSha256(receiptKey)}`;
}

export async function putSuccessorProviderReceipt(
  redis: SuccessorEvalRedisClient,
  input: {
    readonly receiptKey: string;
    readonly receipt: ScoredProviderKnownReceipt;
    readonly artifactSecret: string;
  }
): Promise<"new" | "existing"> {
  const payloadDigest = await canonicalSha256(input.receipt);
  const result = reply(
    await redis.eval(
      PUT_SCRIPT,
      [await storageKey(input.receiptKey)],
      [
        SUCCESSOR_EVAL_STORE_VERSION,
        input.receiptKey,
        payloadDigest,
        sealProbeArtifact("successor_eval_receipt", input.receipt, input.artifactSecret)
      ]
    )
  );
  return Number(result[0]) === 1 ? "new" : "existing";
}

export async function readSuccessorProviderReceipt(
  redis: SuccessorEvalRedisClient,
  input: { readonly receiptKey: string; readonly artifactSecret: string }
): Promise<ScoredProviderKnownReceipt | null> {
  const result = reply(
    await redis.evalRo(
      READ_SCRIPT,
      [await storageKey(input.receiptKey)],
      [SUCCESSOR_EVAL_STORE_VERSION, input.receiptKey]
    )
  );
  if (String(result[1]) === "MISSING") return null;
  const receipt = openProbeArtifact(
    "successor_eval_receipt",
    String(result[3] ?? ""),
    input.artifactSecret
  ) as ScoredProviderKnownReceipt;
  if (
    (await canonicalSha256(receipt)) !== String(result[2] ?? "") ||
    canonicalJson(receipt).length > 1_900_000
  ) {
    throw new Error("successor_eval_store_artifact_mismatch");
  }
  return receipt;
}

export const SUCCESSOR_EVAL_STORE_SCRIPTS = Object.freeze({ put: PUT_SCRIPT, read: READ_SCRIPT });
