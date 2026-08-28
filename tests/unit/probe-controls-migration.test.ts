import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V05_MIGRATED_POLICY_HASH,
  PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH
} from "@/lib/probe/policy-v05-migration-contract";
import { PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v05-migration.server";
import { probeContinuationScriptHash } from "@/lib/probe/continuation-store";

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

async function runOperator(environment: NodeJS.ProcessEnv, mode = "migrate-policy-v05") {
  return execFileAsync(
    process.execPath,
    [tsxCli, "--tsconfig", "tsconfig.operator.json", operator, mode],
    { cwd: process.cwd(), env: environment }
  );
}

describe("Probe policy migration operator boundary", () => {
  it("reports the exact v0.5 fallback identities without a durable-store dependency", async () => {
    const result = await runOperator(cleanEnvironment(), "hashes");
    const continuationHash = await probeContinuationScriptHash();
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      mode: "hashes",
      policyHash: PROBE_V05_MIGRATED_POLICY_HASH,
      scriptHash: PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
      runnerHash: PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH,
      continuationHash,
      migrationProgramHash: PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH
    });
  });

  it("keeps real-store v0.5 migration checks isolated in random namespaces", async () => {
    const source = await readFile(operator, "utf8");
    expect(source).toContain("PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate");
    expect(source).toContain("policyV05MigrationVerified: true");
    expect(source).toContain("policyV05MigrationReplayVerified: true");
    expect(source).toContain("policyV05MigrationConflictRejected: true");
    expect(source).toContain("policyV05MigrationTamperRejected: true");
    expect(source).toContain("policyV05IssuedAuthorizationPreserved: true");
    expect(source).toContain("policyV05IssuedAuthorizationTamperRejected: true");
    expect(source).toContain("policyV05AuthorizationInventoryRaceRejected: true");
    expect(source).toContain("policyV05AckAnchorVerified: true");
    expect(source).toContain("policyV05EncryptedDataAbsent: true");
    expect(source).toContain("policyV05KnownRecordsVerified: 13");
    expect(source).toContain("migrationReceiptHash: migration.receiptHash");
    expect(source).toContain("authorizationInventory: migration.authorizationInventory");
    expect(source).toContain("migration_v05_${testId}");
    expect(source).toContain("migration_v05_tamper_${testId}");
    expect(source).toContain("migration_v05_issued_tamper_${testId}");
    expect(source).toContain("migration_v05_inventory_race_${testId}");
  });

  it("requires exact Production/project/commit/guard context before discovery", async () => {
    await expect(runOperator(cleanEnvironment())).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V05_MIGRATION_CONTEXT_REQUIRED"')
    });
  });

  it("rejects every stale activation binding before v0.5 source discovery", async () => {
    for (const key of [
      "TOOLPROOF_PROBE_ACTIVATION_MODE",
      "TOOLPROOF_PROBE_ACTIVATION_HASH",
      "TOOLPROOF_PROBE_ACTIVATION_SECRET",
      "TOOLPROOF_PROBE_OPERATOR_CAPABILITY_HASH",
      "TOOLPROOF_PROBE_ACTIVE_COMMIT",
      "TOOLPROOF_PROBE_ACTIVE_POLICY_HASH",
      "TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH",
      "TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH",
      "TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH",
      "TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH"
    ]) {
      const environment = cleanEnvironment();
      const commit = "e".repeat(40);
      const projectId = `prj_${"p".repeat(24)}`;
      Object.assign(environment, {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: projectId,
        TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID: projectId,
        VERCEL_GIT_COMMIT_SHA: commit,
        TOOLPROOF_PROBE_APPROVED_COMMIT: commit,
        TOOLPROOF_GUARD_INSTANCE_ID: "guard_operator_0123456789abcdef",
        TOOLPROOF_GUARD_INITIALIZED_COMMIT: "f".repeat(40),
        [key]: "configured"
      });
      await expect(runOperator(environment, "preflight-policy-v05")).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"PRODUCTION_V05_MIGRATION_CONTEXT_REQUIRED"')
      });
    }
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
      stderr: expect.stringContaining('"error":"PRODUCTION_V05_MIGRATION_CONFIRMATION_REQUIRED"')
    });
  });

  it("keeps the read-only preflight context-bound and mutually exclusive", async () => {
    await expect(runOperator(cleanEnvironment(), "preflight-policy-v05")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"PRODUCTION_V05_MIGRATION_CONTEXT_REQUIRED"')
    });

    const ambiguous = cleanEnvironment();
    ambiguous.TOOLPROOF_PROBE_POLICY_V05_MIGRATION_PREFLIGHT = "1";
    ambiguous.TOOLPROOF_PROBE_POLICY_V05_MIGRATION_CONFIRM = "0".repeat(64);
    await expect(runOperator(ambiguous, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"AMBIGUOUS_OPERATOR_INTENT"')
    });

    const invalid = cleanEnvironment();
    invalid.TOOLPROOF_PROBE_POLICY_V05_MIGRATION_PREFLIGHT = "yes";
    await expect(runOperator(invalid, "bootstrap")).rejects.toMatchObject({
      stderr: expect.stringContaining('"error":"INVALID_V05_MIGRATION_PREFLIGHT_INTENT"')
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

  it("rejects old init/reap/v0.4 intents even with an explicit v0.5 mode", async () => {
    for (const [mode, key] of [
      ["preflight-policy-v05", "TOOLPROOF_PROBE_INIT_CONFIRM"],
      ["preflight-policy-v05", "TOOLPROOF_PROBE_POLICY_V04_MIGRATION_PREFLIGHT"],
      ["migrate-policy-v05", "TOOLPROOF_PROBE_REAP_CONFIRM"],
      ["migrate-policy-v05", "TOOLPROOF_PROBE_POLICY_V04_MIGRATION_CONFIRM"]
    ] as const) {
      const environment = cleanEnvironment();
      environment[key] = "configured";
      await expect(runOperator(environment, mode)).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"AMBIGUOUS_OPERATOR_INTENT"')
      });
    }
  });

  it("rejects every retired generic/v0.3/v0.4 intent before durable-store discovery", async () => {
    for (const [key, value] of [
      ["TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM", "retired"],
      ["TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT", "1"],
      ["TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM", "0".repeat(64)],
      ["TOOLPROOF_PROBE_POLICY_V04_MIGRATION_PREFLIGHT", "1"],
      ["TOOLPROOF_PROBE_POLICY_V04_MIGRATION_CONFIRM", "0".repeat(64)]
    ] as const) {
      const environment = cleanEnvironment();
      environment[key] = value;
      await expect(runOperator(environment, "bootstrap")).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"RETIRED_PRE_V05_MIGRATION_INTENT_REJECTED"')
      });
    }
    for (const mode of [
      "preflight-policy-v03",
      "migrate-policy",
      "migrate-policy-v03",
      "preflight-policy-v04",
      "migrate-policy-v04"
    ]) {
      await expect(runOperator(cleanEnvironment(), mode)).rejects.toMatchObject({
        stderr: expect.stringContaining('"error":"RETIRED_PRE_V05_MIGRATION_INTENT_REJECTED"')
      });
    }
  });
});
