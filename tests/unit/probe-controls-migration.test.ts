import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

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

async function runOperator(environment: NodeJS.ProcessEnv, mode = "migrate-policy") {
  return execFileAsync(
    process.execPath,
    [tsxCli, "--tsconfig", "tsconfig.operator.json", operator, mode],
    { cwd: process.cwd(), env: environment }
  );
}

describe("Probe policy migration operator boundary", () => {
  it("requires exact Production/project/commit/guard context before discovery", async () => {
    await expect(runOperator(cleanEnvironment())).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V03_MIGRATION_CONTEXT_REQUIRED"')
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
      stderr: expect.stringContaining('"error":"PRODUCTION_V03_MIGRATION_CONFIRMATION_REQUIRED"')
    });
  });

  it("keeps the read-only preflight context-bound and mutually exclusive", async () => {
    await expect(runOperator(cleanEnvironment(), "preflight-policy-v03")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V03_MIGRATION_CONTEXT_REQUIRED"')
    });

    const ambiguous = cleanEnvironment();
    ambiguous.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT = "1";
    ambiguous.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM = "0".repeat(64);
    await expect(runOperator(ambiguous, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"AMBIGUOUS_OPERATOR_INTENT"')
    });

    const invalid = cleanEnvironment();
    invalid.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT = "yes";
    await expect(runOperator(invalid, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"INVALID_V03_MIGRATION_PREFLIGHT_INTENT"')
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

  it("rejects the retired migration intent instead of replaying v0.1 -> v0.2", async () => {
    const environment = cleanEnvironment();
    environment.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM = "retired";
    await expect(runOperator(environment, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"LEGACY_MIGRATION_INTENT_REJECTED"')
    });
  });
});
