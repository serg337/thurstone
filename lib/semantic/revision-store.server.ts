import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import type { Gate5RevisionFreeze } from "@/lib/semantic/revision-freeze.server";

export const GATE5_REVISION_STORE_VERSION = "toolproof-gate5-revision-store@1.0.0";

export interface Gate5RevisionRedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const PUT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "revision_freeze_hash") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "payload_digest") ~= ARGV[3]
  then return {0, "GATE5_REVISION_CONFLICT"} end
  return {2, "EXISTING", redis.call("HGET", KEYS[1], "stored_at_ms")}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[1], "version", ARGV[1], "status", "frozen",
  "revision_freeze_hash", ARGV[2], "payload_digest", ARGV[3], "token", ARGV[4],
  "stored_at_ms", now_ms)
return {1, "STORED", now_ms}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "revision_freeze_hash") ~= ARGV[2]
then return {0, "GATE5_REVISION_MISMATCH"} end
return {1, "FOUND", redis.call("HGET", KEYS[1], "payload_digest"),
  redis.call("HGET", KEYS[1], "token"), redis.call("HGET", KEYS[1], "stored_at_ms")}
`;

export const GATE5_REVISION_STORE_SCRIPTS = Object.freeze({ put: PUT_SCRIPT, read: READ_SCRIPT });

function key(hash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("gate5_revision_hash_invalid");
  return `tp:{webmcp26}:semantic-freeze:gate5:${hash}`;
}

function parseReply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("gate5_revision_reply_invalid");
  if (Number(value[0]) === 0) throw new Error(String(value[1] ?? "gate5_revision_denied"));
  return value;
}

async function verifyDigest(value: Gate5RevisionFreeze): Promise<void> {
  const { revisionFreezeHash, ...payload } = value;
  if ((await canonicalSha256(payload)) !== revisionFreezeHash) {
    throw new Error("gate5_revision_digest_invalid");
  }
}

export async function putGate5RevisionFreeze(
  redis: Gate5RevisionRedisClient,
  input: { readonly revision: Gate5RevisionFreeze; readonly artifactSecret: string }
): Promise<"new" | "existing"> {
  await verifyDigest(input.revision);
  const payloadDigest = await canonicalSha256(input.revision);
  const result = parseReply(
    await redis.eval(
      PUT_SCRIPT,
      [key(input.revision.revisionFreezeHash)],
      [
        GATE5_REVISION_STORE_VERSION,
        input.revision.revisionFreezeHash,
        payloadDigest,
        sealProbeArtifact("gate5_revision", input.revision, input.artifactSecret)
      ]
    )
  );
  return Number(result[0]) === 1 ? "new" : "existing";
}

export async function readGate5RevisionFreeze(
  redis: Gate5RevisionRedisClient,
  input: { readonly revisionFreezeHash: string; readonly artifactSecret: string }
): Promise<Gate5RevisionFreeze | null> {
  const result = parseReply(
    await redis.evalRo(
      READ_SCRIPT,
      [key(input.revisionFreezeHash)],
      [GATE5_REVISION_STORE_VERSION, input.revisionFreezeHash]
    )
  );
  if (String(result[1]) === "MISSING") return null;
  let revision: Gate5RevisionFreeze;
  try {
    revision = openProbeArtifact(
      "gate5_revision",
      String(result[3] ?? ""),
      input.artifactSecret
    ) as Gate5RevisionFreeze;
  } catch {
    throw new Error("gate5_revision_artifact_invalid");
  }
  await verifyDigest(revision);
  if (
    revision.revisionFreezeHash !== input.revisionFreezeHash ||
    (await canonicalSha256(revision)) !== String(result[2] ?? "")
  ) {
    throw new Error("gate5_revision_artifact_mismatch");
  }
  return Object.freeze(JSON.parse(canonicalJson(revision)) as Gate5RevisionFreeze);
}
