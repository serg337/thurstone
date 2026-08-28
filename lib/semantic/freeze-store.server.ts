import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import type { Gate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  finalizeGate3HumanFreeze,
  verifyGate3HumanReviewPackage,
  type Gate3FrozenProtocol
} from "@/lib/semantic/human-freeze.server";

export const GATE3_FREEZE_STORE_VERSION = "toolproof-gate3-freeze-store@1.0.0";

export interface Gate3FreezeRedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export interface Gate3FreezeKeyspace {
  readonly namespace: string;
}

export function createGate3FreezeKeyspace(
  namespace = "tp:{webmcp26}:semantic-freeze:gate3"
): Gate3FreezeKeyspace {
  if (!/^tp:\{webmcp26\}:semantic-freeze:gate3(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new Gate3FreezeStoreError("INVALID_NAMESPACE");
  }
  return Object.freeze({ namespace });
}

export const PRODUCTION_GATE3_FREEZE_KEYSPACE = createGate3FreezeKeyspace();

export class Gate3FreezeStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate3FreezeStoreError";
  }
}

const PUT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1
    or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "review_package_hash") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "frozen_protocol_hash") ~= ARGV[3]
    or redis.call("HGET", KEYS[1], "payload_digest") ~= ARGV[4]
  then return {0, "GATE3_FREEZE_CONFLICT"} end
  return {2, "EXISTING", redis.call("HGET", KEYS[1], "stored_at_ms")}
end
local now = redis.call("TIME")
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call("HSET", KEYS[1], "version", ARGV[1], "status", "frozen",
  "review_package_hash", ARGV[2], "frozen_protocol_hash", ARGV[3],
  "payload_digest", ARGV[4], "token", ARGV[5], "stored_at_ms", now_ms)
return {1, "STORED", now_ms}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {2, "MISSING"} end
if redis.call("PTTL", KEYS[1]) ~= -1
  or redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "status") ~= "frozen"
  or redis.call("HGET", KEYS[1], "frozen_protocol_hash") ~= ARGV[2]
then return {0, "GATE3_FREEZE_MISMATCH"} end
return {1, "FOUND", redis.call("HGET", KEYS[1], "review_package_hash"),
  redis.call("HGET", KEYS[1], "payload_digest"), redis.call("HGET", KEYS[1], "token"),
  redis.call("HGET", KEYS[1], "stored_at_ms")}
`;

export const GATE3_FREEZE_STORE_SCRIPTS = Object.freeze({ put: PUT_SCRIPT, read: READ_SCRIPT });

function key(keyspace: Gate3FreezeKeyspace, frozenProtocolHash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(frozenProtocolHash)) {
    throw new Gate3FreezeStoreError("INVALID_FROZEN_PROTOCOL_HASH");
  }
  return `${keyspace.namespace}:${frozenProtocolHash}`;
}

function reply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) throw new Gate3FreezeStoreError("INVALID_REPLY");
  if (Number(value[0]) === 0) throw new Gate3FreezeStoreError(String(value[1] ?? "DENIED"));
  return value;
}

async function verifiedPayload(input: {
  readonly reviewPackage: unknown;
  readonly frozenProtocol: unknown;
}) {
  const reviewPackage = await verifyGate3HumanReviewPackage(input.reviewPackage);
  if (
    !input.frozenProtocol ||
    typeof input.frozenProtocol !== "object" ||
    Array.isArray(input.frozenProtocol)
  ) {
    throw new Gate3FreezeStoreError("GATE3_FROZEN_PROTOCOL_INVALID");
  }
  const supplied = input.frozenProtocol as Gate3FrozenProtocol;
  const frozenProtocol = await finalizeGate3HumanFreeze({
    reviewPackage,
    humanReviewReceipt: supplied.humanReviewReceipt,
    authoringTermination: supplied.authoringTermination
  });
  if (canonicalJson(supplied) !== canonicalJson(frozenProtocol)) {
    throw new Gate3FreezeStoreError("GATE3_FROZEN_PROTOCOL_MISMATCH");
  }
  return Object.freeze({ reviewPackage, frozenProtocol });
}

export interface Gate3FreezeStoreReceipt {
  readonly disposition: "new" | "existing" | "recovered";
  readonly reviewPackage: Gate3HumanReviewPackage;
  readonly frozenProtocol: Gate3FrozenProtocol;
  readonly payloadDigest: string;
  readonly storedAtMs: number;
}

export async function putGate3Freeze(
  redis: Gate3FreezeRedisClient,
  input: {
    readonly reviewPackage: unknown;
    readonly frozenProtocol: unknown;
    readonly artifactSecret: string;
  },
  keyspace: Gate3FreezeKeyspace = PRODUCTION_GATE3_FREEZE_KEYSPACE
): Promise<Gate3FreezeStoreReceipt> {
  const payload = await verifiedPayload(input);
  const payloadDigest = await canonicalSha256(payload);
  const token = sealProbeArtifact("gate3_freeze", payload, input.artifactSecret);
  const result = reply(
    await redis.eval(
      PUT_SCRIPT,
      [key(keyspace, payload.frozenProtocol.frozenProtocolHash)],
      [
        GATE3_FREEZE_STORE_VERSION,
        payload.reviewPackage.packageHash,
        payload.frozenProtocol.frozenProtocolHash,
        payloadDigest,
        token
      ]
    )
  );
  const status = String(result[1]);
  if (status !== "STORED" && status !== "EXISTING") {
    throw new Gate3FreezeStoreError("INVALID_REPLY");
  }
  return Object.freeze({
    disposition: status === "STORED" ? "new" : "existing",
    ...payload,
    payloadDigest,
    storedAtMs: Number(result[2])
  });
}

export async function readGate3Freeze(
  redis: Gate3FreezeRedisClient,
  input: {
    readonly frozenProtocolHash: string;
    readonly artifactSecret: string;
  },
  keyspace: Gate3FreezeKeyspace = PRODUCTION_GATE3_FREEZE_KEYSPACE
): Promise<Gate3FreezeStoreReceipt | null> {
  const result = reply(
    await redis.evalRo(
      READ_SCRIPT,
      [key(keyspace, input.frozenProtocolHash)],
      [GATE3_FREEZE_STORE_VERSION, input.frozenProtocolHash]
    )
  );
  if (String(result[1]) === "MISSING") return null;
  const reviewPackageHash = String(result[2] ?? "");
  const payloadDigest = String(result[3] ?? "");
  const token = String(result[4] ?? "");
  let opened: unknown;
  try {
    opened = openProbeArtifact("gate3_freeze", token, input.artifactSecret);
  } catch {
    throw new Gate3FreezeStoreError("GATE3_FREEZE_ARTIFACT_INVALID");
  }
  const payload = await verifiedPayload(
    opened as { readonly reviewPackage: unknown; readonly frozenProtocol: unknown }
  );
  if (
    payload.reviewPackage.packageHash !== reviewPackageHash ||
    payload.frozenProtocol.frozenProtocolHash !== input.frozenProtocolHash ||
    (await canonicalSha256(payload)) !== payloadDigest
  ) {
    throw new Gate3FreezeStoreError("GATE3_FREEZE_ARTIFACT_MISMATCH");
  }
  return Object.freeze({
    disposition: "recovered",
    ...payload,
    payloadDigest,
    storedAtMs: Number(result[5])
  });
}
