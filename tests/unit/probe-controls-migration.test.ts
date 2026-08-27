import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { canonicalJson } from "@/lib/evidence/digest";
import {
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_VERSION
} from "@/lib/probe/policy-migration-contract";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const operator = resolve(process.cwd(), "scripts/probe-controls.ts");

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("TOOLPROOF_PROBE_") ||
      key.startsWith("TOOLPROOF_GUARD_") ||
      key === "TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID" ||
      key === "VERCEL" ||
      key === "VERCEL_ENV" ||
      key === "VERCEL_PROJECT_ID" ||
      key === "VERCEL_GIT_COMMIT_SHA" ||
      key === "UPSTASH_REDIS_REST_URL" ||
      key === "UPSTASH_REDIS_REST_TOKEN" ||
      key === "KV_REST_API_URL" ||
      key === "KV_REST_API_TOKEN"
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function canonicalPriorReceipt(): string {
  const value = {
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: PROBE_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
    guardInstanceId: "guard_operator_0123456789abcdef",
    initializedCommit: "f".repeat(40),
    previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
    knownCalls: [
      [0, "jti_operator_000000000000", 1, 2_752_200, "1", "2", "3"],
      [1, "jti_operator_111111111111", 2, 2_745_600, "4", "5", "6"],
      [2, "jti_operator_222222222222", 3, 2_862_200, "7", "8", "9"],
      [3, "jti_operator_333333333333", 4, 3_000_800, "a", "b", "c"]
    ].map(([ordinal, jti, dispatchSequence, actualNanoUsd, response, settlement, usage]) => ({
      ordinal,
      jti,
      dispatchSequence,
      actualNanoUsd,
      providerResponseHash: String(response).repeat(64),
      settlementDigest: String(settlement).repeat(64),
      usageHash: String(usage).repeat(64)
    }))
  };
  return Buffer.from(canonicalJson(value), "utf8").toString("base64url");
}

async function runOperator(environment: NodeJS.ProcessEnv, mode = "migrate-policy") {
  return execFileAsync(
    process.execPath,
    [tsxCli, "--tsconfig", "tsconfig.operator.json", operator, mode],
    { cwd: process.cwd(), env: environment }
  );
}

describe("Probe policy migration operator boundary", () => {
  it("requires a bounded canonical prior-attempt receipt before any durable-store access", async () => {
    await expect(runOperator(cleanEnvironment())).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"MIGRATION_RECEIPT_REQUIRED"')
    });
    const environment = cleanEnvironment();
    environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT = Buffer.from(
      '{"not":"canonical", "space":true}',
      "utf8"
    ).toString("base64url");
    await expect(runOperator(environment)).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"MIGRATION_RECEIPT_NOT_CANONICAL"')
    });
  });

  it("requires exact Production/project/commit/guard context before confirmation or Redis", async () => {
    const environment = cleanEnvironment();
    environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT = canonicalPriorReceipt();
    await expect(runOperator(environment)).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_MIGRATION_CONTEXT_REQUIRED"')
    });
  });

  it("requires the full transition confirmation before constructing a Redis client", async () => {
    const environment = cleanEnvironment();
    const commit = "e".repeat(40);
    const projectId = `prj_${"p".repeat(24)}`;
    environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT = canonicalPriorReceipt();
    environment.VERCEL = "1";
    environment.VERCEL_ENV = "production";
    environment.VERCEL_PROJECT_ID = projectId;
    environment.TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID = projectId;
    environment.VERCEL_GIT_COMMIT_SHA = commit;
    environment.TOOLPROOF_PROBE_APPROVED_COMMIT = commit;
    environment.TOOLPROOF_GUARD_INSTANCE_ID = "guard_operator_0123456789abcdef";
    environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT = "f".repeat(40);
    await expect(runOperator(environment)).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_MIGRATION_CONFIRMATION_REQUIRED"')
    });
  });

  it("rejects ambiguous bootstrap operator intents before selecting any mutation", async () => {
    const environment = cleanEnvironment();
    environment.TOOLPROOF_PROBE_INIT_CONFIRM = "configured";
    environment.TOOLPROOF_PROBE_REAP_CONFIRM = "configured";
    await expect(runOperator(environment, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"AMBIGUOUS_OPERATOR_INTENT"')
    });
  });
});
