import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { judgeDemoProjectionSchema, type JudgeDemoProjection } from "@/lib/judge/contract";
import { judgeDemoEnvelopeSchema } from "@/lib/judge/envelope";
import { judgeDemoProviderKnownReceiptSchema } from "@/lib/judge/openai-provider.server";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import { probeTokenClaimsSchema } from "@/lib/probe/token";
import { z } from "zod";

export const JUDGE_DEMO_STORE_VERSION = "toolproof-judge-demo-store@1.0.0";
export const JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION = "toolproof-judge-demo-receipt-artifact@1.0.0";
export const JUDGE_DEMO_UNCERTAIN_ARTIFACT_VERSION =
  "toolproof-judge-demo-uncertain-artifact@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const judgeDemoReceiptArtifactSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION),
    activationHash: sha256,
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    envelope: judgeDemoEnvelopeSchema,
    authorization: z
      .object({
        claims: probeTokenClaimsSchema,
        claimsHash: sha256
      })
      .strict(),
    providerReceipt: judgeDemoProviderKnownReceiptSchema,
    settlement: z
      .object({
        actualNanoUsd: z.number().int().nonnegative(),
        providerResponseHash: sha256,
        usageHash: sha256,
        settlementDigest: sha256
      })
      .strict(),
    capturedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type JudgeDemoReceiptArtifact = z.infer<typeof judgeDemoReceiptArtifactSchema>;

export const judgeDemoUncertainArtifactSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_UNCERTAIN_ARTIFACT_VERSION),
    activationHash: sha256,
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    envelopeHash: sha256,
    authorizationJti: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
    code: z.string().min(1).max(160),
    rawResponseBytes: z
      .string()
      .max(128 * 1_024)
      .nullable(),
    settlementDigest: sha256,
    capturedAt: z.string().datetime({ offset: true })
  })
  .strict();

export type JudgeDemoUncertainArtifact = z.infer<typeof judgeDemoUncertainArtifactSchema>;

export interface JudgeDemoStoreKeyspace {
  readonly key: string;
}

export function createJudgeDemoStoreKeyspace(
  namespace = "tp:{webmcp26}:judge-demo"
): JudgeDemoStoreKeyspace {
  if (!/^tp:\{webmcp26\}:judge-demo(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new JudgeDemoStoreError("judge_store_namespace_invalid");
  }
  return Object.freeze({ key: `${namespace}:permanent` });
}

export const PRODUCTION_JUDGE_DEMO_STORE_KEYSPACE = createJudgeDemoStoreKeyspace();

export interface JudgeDemoStoreRedis {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export class JudgeDemoStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "JudgeDemoStoreError";
  }
}

const CAPTURE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("HGET", KEYS[1], "version") == ARGV[1]
    and redis.call("HGET", KEYS[1], "app_commit") == ARGV[2]
    and redis.call("HGET", KEYS[1], "artifact_digest") == ARGV[3]
  then
    return {2, "CAPTURE_EXISTING"}
  end
  return {0, "CAPTURE_CONFLICT"}
end
redis.call("HSET", KEYS[1],
  "version", ARGV[1],
  "state", "captured",
  "app_commit", ARGV[2],
  "artifact_digest", ARGV[3],
  "sealed_artifact", ARGV[4],
  "projection_json", ARGV[5],
  "projection_digest", ARGV[6],
  "captured_at_ms", ARGV[7]
)
redis.call("PERSIST", KEYS[1])
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "PERMANENCE_FAILED"} end
return {1, "CAPTURED"}
`;

const SEAL_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "MISSING_CAPTURE"} end
if redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
  or redis.call("HGET", KEYS[1], "app_commit") ~= ARGV[2]
  or redis.call("HGET", KEYS[1], "artifact_digest") ~= ARGV[3]
then return {0, "CAPTURE_MISMATCH"} end
local state = redis.call("HGET", KEYS[1], "state")
if state == "sealed" then return {2, "SEALED_EXISTING"} end
if state ~= "captured" then return {0, "CAPTURE_NOT_SEALABLE"} end
redis.call("HSET", KEYS[1], "state", "sealed", "sealed_at_ms", ARGV[4])
redis.call("PERSIST", KEYS[1])
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "PERMANENCE_FAILED"} end
return {1, "SEALED"}
`;

const RECORD_UNCERTAIN_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("HGET", KEYS[1], "version") == ARGV[1]
    and redis.call("HGET", KEYS[1], "app_commit") == ARGV[2]
    and redis.call("HGET", KEYS[1], "artifact_digest") == ARGV[3]
    and redis.call("HGET", KEYS[1], "state") == "uncertain"
  then return {2, "UNCERTAIN_EXISTING"} end
  return {0, "UNCERTAIN_CONFLICT"}
end
redis.call("HSET", KEYS[1],
  "version", ARGV[1],
  "state", "uncertain",
  "app_commit", ARGV[2],
  "artifact_digest", ARGV[3],
  "sealed_artifact", ARGV[4],
  "captured_at_ms", ARGV[5]
)
redis.call("PERSIST", KEYS[1])
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "PERMANENCE_FAILED"} end
return {1, "UNCERTAIN_RECORDED"}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "EMPTY"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "NOT_PERMANENT"} end
return {1,
  redis.call("HGET", KEYS[1], "version"),
  redis.call("HGET", KEYS[1], "state"),
  redis.call("HGET", KEYS[1], "app_commit"),
  redis.call("HGET", KEYS[1], "artifact_digest"),
  redis.call("HGET", KEYS[1], "sealed_artifact"),
  redis.call("HGET", KEYS[1], "projection_json") or "",
  redis.call("HGET", KEYS[1], "projection_digest") or "",
  redis.call("HGET", KEYS[1], "captured_at_ms"),
  redis.call("HGET", KEYS[1], "sealed_at_ms") or ""
}
`;

export const JUDGE_DEMO_STORE_SCRIPTS = Object.freeze({
  capture: CAPTURE_SCRIPT,
  seal: SEAL_SCRIPT,
  recordUncertain: RECORD_UNCERTAIN_SCRIPT,
  read: READ_SCRIPT
});

function reply(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2)
    throw new JudgeDemoStoreError("judge_store_reply_invalid");
  if (Number(value[0]) === 0) throw new JudgeDemoStoreError(String(value[1]));
  return value;
}

export type JudgeDemoStoredRecord =
  | { readonly state: "empty" }
  | {
      readonly state: "captured" | "sealed";
      readonly appCommit: string;
      readonly artifactDigest: string;
      readonly artifact: JudgeDemoReceiptArtifact;
      readonly projection: JudgeDemoProjection;
    }
  | {
      readonly state: "uncertain";
      readonly appCommit: string;
      readonly artifactDigest: string;
      readonly artifact: JudgeDemoUncertainArtifact;
    };

export async function readJudgeDemoStore(
  redis: JudgeDemoStoreRedis,
  input: { readonly artifactSecret: string; readonly keyspace?: JudgeDemoStoreKeyspace }
): Promise<JudgeDemoStoredRecord> {
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_STORE_KEYSPACE;
  const raw = await redis.evalRo(READ_SCRIPT, [keyspace.key], []);
  if (Array.isArray(raw) && Number(raw[0]) === 0 && raw[1] === "EMPTY") {
    return Object.freeze({ state: "empty" });
  }
  const data = reply(raw);
  if (data[1] !== JUDGE_DEMO_STORE_VERSION) {
    throw new JudgeDemoStoreError("judge_store_version_mismatch");
  }
  const state = String(data[2]);
  const appCommit = String(data[3]);
  const artifactDigest = String(data[4]);
  const opened = openProbeArtifact("judge_demo_receipt", String(data[5]), input.artifactSecret);
  if (state === "uncertain") {
    const artifact = judgeDemoUncertainArtifactSchema.parse(opened);
    if ((await canonicalSha256(artifact)) !== artifactDigest || artifact.appCommit !== appCommit) {
      throw new JudgeDemoStoreError("judge_store_artifact_mismatch");
    }
    return Object.freeze({ state, appCommit, artifactDigest, artifact });
  }
  if (state !== "captured" && state !== "sealed") {
    throw new JudgeDemoStoreError("judge_store_state_invalid");
  }
  const artifact = judgeDemoReceiptArtifactSchema.parse(opened);
  let projectionValue: unknown;
  try {
    projectionValue = JSON.parse(String(data[6])) as unknown;
  } catch {
    throw new JudgeDemoStoreError("judge_store_projection_invalid");
  }
  const projection = judgeDemoProjectionSchema.parse(projectionValue);
  if (
    (await canonicalSha256(artifact)) !== artifactDigest ||
    (await canonicalSha256(projection)) !== String(data[7]) ||
    artifact.appCommit !== appCommit ||
    projection.appCommit !== appCommit ||
    artifact.envelope.envelopeHash !== projection.envelopeHash
  ) {
    throw new JudgeDemoStoreError("judge_store_artifact_mismatch");
  }
  return Object.freeze({ state, appCommit, artifactDigest, artifact, projection });
}

export async function captureJudgeDemoReceipt(
  redis: JudgeDemoStoreRedis,
  input: {
    readonly artifact: JudgeDemoReceiptArtifact;
    readonly projection: JudgeDemoProjection;
    readonly artifactSecret: string;
    readonly capturedAtMs: number;
    readonly keyspace?: JudgeDemoStoreKeyspace;
  }
): Promise<{ readonly disposition: "new" | "existing"; readonly artifactDigest: string }> {
  const artifact = judgeDemoReceiptArtifactSchema.parse(input.artifact);
  const projection = judgeDemoProjectionSchema.parse(input.projection);
  if (artifact.appCommit !== projection.appCommit) {
    throw new JudgeDemoStoreError("judge_store_projection_binding_mismatch");
  }
  const [artifactDigest, projectionDigest] = await Promise.all([
    canonicalSha256(artifact),
    canonicalSha256(projection)
  ]);
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_STORE_KEYSPACE;
  const result = reply(
    await redis.eval(
      CAPTURE_SCRIPT,
      [keyspace.key],
      [
        JUDGE_DEMO_STORE_VERSION,
        artifact.appCommit,
        artifactDigest,
        sealProbeArtifact("judge_demo_receipt", artifact, input.artifactSecret),
        canonicalJson(projection),
        projectionDigest,
        String(input.capturedAtMs)
      ]
    )
  );
  return Object.freeze({
    disposition: Number(result[0]) === 1 ? "new" : "existing",
    artifactDigest
  });
}

export async function sealJudgeDemoReceipt(
  redis: JudgeDemoStoreRedis,
  input: {
    readonly appCommit: string;
    readonly artifactDigest: string;
    readonly sealedAtMs: number;
    readonly keyspace?: JudgeDemoStoreKeyspace;
  }
): Promise<"new" | "existing"> {
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_STORE_KEYSPACE;
  const result = reply(
    await redis.eval(
      SEAL_SCRIPT,
      [keyspace.key],
      [JUDGE_DEMO_STORE_VERSION, input.appCommit, input.artifactDigest, String(input.sealedAtMs)]
    )
  );
  return Number(result[0]) === 1 ? "new" : "existing";
}

export async function recordJudgeDemoUncertain(
  redis: JudgeDemoStoreRedis,
  input: {
    readonly artifact: JudgeDemoUncertainArtifact;
    readonly artifactSecret: string;
    readonly capturedAtMs: number;
    readonly keyspace?: JudgeDemoStoreKeyspace;
  }
): Promise<"new" | "existing"> {
  const artifact = judgeDemoUncertainArtifactSchema.parse(input.artifact);
  const artifactDigest = await canonicalSha256(artifact);
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_STORE_KEYSPACE;
  const result = reply(
    await redis.eval(
      RECORD_UNCERTAIN_SCRIPT,
      [keyspace.key],
      [
        JUDGE_DEMO_STORE_VERSION,
        artifact.appCommit,
        artifactDigest,
        sealProbeArtifact("judge_demo_receipt", artifact, input.artifactSecret),
        String(input.capturedAtMs)
      ]
    )
  );
  return Number(result[0]) === 1 ? "new" : "existing";
}
