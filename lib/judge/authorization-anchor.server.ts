import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import { probeTokenClaimsSchema } from "@/lib/probe/token";
import { z } from "zod";

export const JUDGE_DEMO_AUTHORIZATION_ANCHOR_VERSION =
  "toolproof-judge-demo-authorization-anchor@1.0.0";
export const JUDGE_DEMO_AUTHORIZATION_ARTIFACT_VERSION =
  "toolproof-judge-demo-authorization-artifact@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const judgeDemoAuthorizationArtifactSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_AUTHORIZATION_ARTIFACT_VERSION),
    activationHash: sha256,
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    envelopeHash: sha256,
    claims: probeTokenClaimsSchema,
    claimsHash: sha256,
    actorHash: sha256,
    subjectHash: sha256,
    anchoredAt: z.string().datetime({ offset: true })
  })
  .strict();

export type JudgeDemoAuthorizationArtifact = z.infer<typeof judgeDemoAuthorizationArtifactSchema>;

export interface JudgeDemoAuthorizationKeyspace {
  readonly key: string;
}

export function createJudgeDemoAuthorizationKeyspace(
  namespace = "tp:{webmcp26}:judge-demo"
): JudgeDemoAuthorizationKeyspace {
  if (!/^tp:\{webmcp26\}:judge-demo(?::[a-z0-9_-]{1,64})*$/u.test(namespace)) {
    throw new Error("judge_demo_authorization_namespace_invalid");
  }
  return Object.freeze({ key: `${namespace}:authorization-anchor` });
}

export const PRODUCTION_JUDGE_DEMO_AUTHORIZATION_KEYSPACE = createJudgeDemoAuthorizationKeyspace();

export interface JudgeDemoAuthorizationRedis {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  evalRo(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const CAPTURE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "ANCHOR_NOT_PERMANENT"} end
  if redis.call("HGET", KEYS[1], "version") ~= ARGV[1]
    or redis.call("HGET", KEYS[1], "activation_hash") ~= ARGV[2]
    or redis.call("HGET", KEYS[1], "app_commit") ~= ARGV[3]
    or redis.call("HGET", KEYS[1], "envelope_hash") ~= ARGV[4]
  then return {0, "ANCHOR_CONFLICT"} end
  return {2, "ANCHOR_EXISTING"}
end
redis.call("HSET", KEYS[1],
  "version", ARGV[1],
  "activation_hash", ARGV[2],
  "app_commit", ARGV[3],
  "envelope_hash", ARGV[4],
  "artifact_digest", ARGV[5],
  "sealed_artifact", ARGV[6]
)
redis.call("PERSIST", KEYS[1])
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "ANCHOR_NOT_PERMANENT"} end
return {1, "ANCHOR_CAPTURED"}
`;

const READ_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) ~= 1 then return {0, "EMPTY"} end
if redis.call("PTTL", KEYS[1]) ~= -1 then return {0, "ANCHOR_NOT_PERMANENT"} end
return {1,
  redis.call("HGET", KEYS[1], "version"),
  redis.call("HGET", KEYS[1], "activation_hash"),
  redis.call("HGET", KEYS[1], "app_commit"),
  redis.call("HGET", KEYS[1], "envelope_hash"),
  redis.call("HGET", KEYS[1], "artifact_digest"),
  redis.call("HGET", KEYS[1], "sealed_artifact")}
`;

export const JUDGE_DEMO_AUTHORIZATION_SCRIPTS = Object.freeze({
  capture: CAPTURE_SCRIPT,
  read: READ_SCRIPT
});

function successfulReply(value: unknown): unknown[] {
  if (!Array.isArray(value) || Number(value[0]) === 0) {
    throw new Error(Array.isArray(value) && value[1] ? String(value[1]) : "anchor_reply_invalid");
  }
  return value;
}

export async function readJudgeDemoAuthorizationAnchor(
  redis: JudgeDemoAuthorizationRedis,
  input: {
    readonly artifactSecret: string;
    readonly keyspace?: JudgeDemoAuthorizationKeyspace;
  }
): Promise<JudgeDemoAuthorizationArtifact | null> {
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_AUTHORIZATION_KEYSPACE;
  const raw = await redis.evalRo(READ_SCRIPT, [keyspace.key], []);
  if (Array.isArray(raw) && Number(raw[0]) === 0 && raw[1] === "EMPTY") return null;
  const reply = successfulReply(raw);
  if (reply[1] !== JUDGE_DEMO_AUTHORIZATION_ANCHOR_VERSION) {
    throw new Error("judge_demo_authorization_version_mismatch");
  }
  const artifact = judgeDemoAuthorizationArtifactSchema.parse(
    openProbeArtifact("judge_demo_authorization", String(reply[6]), input.artifactSecret)
  );
  if (
    artifact.activationHash !== String(reply[2]) ||
    artifact.appCommit !== String(reply[3]) ||
    artifact.envelopeHash !== String(reply[4]) ||
    (await canonicalSha256(artifact)) !== String(reply[5])
  ) {
    throw new Error("judge_demo_authorization_artifact_mismatch");
  }
  return Object.freeze(JSON.parse(canonicalJson(artifact)) as JudgeDemoAuthorizationArtifact);
}

export async function captureJudgeDemoAuthorizationAnchor(
  redis: JudgeDemoAuthorizationRedis,
  input: {
    readonly artifact: JudgeDemoAuthorizationArtifact;
    readonly artifactSecret: string;
    readonly keyspace?: JudgeDemoAuthorizationKeyspace;
  }
): Promise<JudgeDemoAuthorizationArtifact> {
  const artifact = judgeDemoAuthorizationArtifactSchema.parse(input.artifact);
  const artifactDigest = await canonicalSha256(artifact);
  const keyspace = input.keyspace ?? PRODUCTION_JUDGE_DEMO_AUTHORIZATION_KEYSPACE;
  successfulReply(
    await redis.eval(
      CAPTURE_SCRIPT,
      [keyspace.key],
      [
        JUDGE_DEMO_AUTHORIZATION_ANCHOR_VERSION,
        artifact.activationHash,
        artifact.appCommit,
        artifact.envelopeHash,
        artifactDigest,
        sealProbeArtifact("judge_demo_authorization", artifact, input.artifactSecret)
      ]
    )
  );
  const anchored = await readJudgeDemoAuthorizationAnchor(redis, {
    artifactSecret: input.artifactSecret,
    keyspace
  });
  if (!anchored) throw new Error("judge_demo_authorization_anchor_missing");
  return anchored;
}
