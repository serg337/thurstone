import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH } from "@/lib/probe/policy-v04-migration-contract";
import { PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v04-migration.server";

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

async function runOperator(environment: NodeJS.ProcessEnv, mode = "migrate-policy-v04") {
  return execFileAsync(
    process.execPath,
    [tsxCli, "--tsconfig", "tsconfig.operator.json", operator, mode],
    { cwd: process.cwd(), env: environment }
  );
}

describe("Probe policy migration operator boundary", () => {
  it("reports the exact v0.4 fallback identities without a durable-store dependency", async () => {
    const result = await runOperator(cleanEnvironment(), "hashes");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: "hashes",
      runnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
      migrationProgramHash: PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH
    });
  });

  it("keeps future real-store v0.4 migration checks isolated in random namespaces", async () => {
    const source = await readFile(operator, "utf8");
    expect(source).toContain("seedIntegrationV04Source");
    expect(source).toContain("PROBE_V04_POLICY_MIGRATION_SCRIPTS.migrate");
    expect(source).toContain("policyV04MigrationVerified: true");
    expect(source).toContain("policyV04MigrationReplayVerified: true");
    expect(source).toContain("policyV04MigrationConflictRejected: true");
    expect(source).toContain("policyV04MigrationTamperRejected: true");
    expect(source).toContain("migration_v04_${testId}");
    expect(source).toContain("migration_v04_tamper_${testId}");
  });

  it("requires exact Production/project/commit/guard context before discovery", async () => {
    await expect(runOperator(cleanEnvironment())).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V04_MIGRATION_CONTEXT_REQUIRED"')
    });
  });

  it("requires a bounded transition confirmation before constructing a Redis client", async () => {
    const environment = cleanEnvironment();
    const commit = "e".repeat(40);
    const projectId = `prj_${"p".repeat(24)}`;
    environment.VERCEL = "1";
    environment.VERCEL_ENV = "production";
    environment.VERCEL_PROJECT_ID = projectId;
    environment.TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID = projectId;
    environment.VERCEL_GIT_COMMIT_SHA = commit;
    environment.TOOLPROOF_PROBE_APPROVED_COMMIT = commit;
    environment.TOOLPROOF_GUARD_INSTANCE_ID = "guard_operator_0123456789abcdef";
    environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT = "f".repeat(40);
    await expect(runOperator(environment)).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V04_MIGRATION_CONFIRMATION_REQUIRED"')
    });
  });

  it("keeps the read-only preflight context-bound and mutually exclusive", async () => {
    await expect(runOperator(cleanEnvironment(), "preflight-policy-v04")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V04_MIGRATION_CONTEXT_REQUIRED"')
    });

    const ambiguous = cleanEnvironment();
    ambiguous.TOOLPROOF_PROBE_POLICY_V04_MIGRATION_PREFLIGHT = "1";
    ambiguous.TOOLPROOF_PROBE_POLICY_V04_MIGRATION_CONFIRM = "0".repeat(64);
    await expect(runOperator(ambiguous, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"AMBIGUOUS_OPERATOR_INTENT"')
    });

    const invalid = cleanEnvironment();
    invalid.TOOLPROOF_PROBE_POLICY_V04_MIGRATION_PREFLIGHT = "yes";
    await expect(runOperator(invalid, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"INVALID_V04_MIGRATION_PREFLIGHT_INTENT"')
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

  it("rejects every retired generic/v0.3 intent before durable-store discovery", async () => {
    for (const [key, value] of [
      ["TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM", "retired"],
      ["TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT", "1"],
      ["TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM", "0".repeat(64)]
    ] as const) {
      const environment = cleanEnvironment();
      environment[key] = value;
      await expect(runOperator(environment, "bootstrap")).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"RETIRED_V03_MIGRATION_INTENT_REJECTED"')
      });
    }
    for (const mode of ["preflight-policy-v03", "migrate-policy", "migrate-policy-v03"]) {
      await expect(runOperator(cleanEnvironment(), mode)).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"RETIRED_V03_MIGRATION_INTENT_REJECTED"')
      });
    }
  });
});
