import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { canonicalJson } from "@/lib/evidence/digest";
import { verifyGate2FallbackCalibrationBundleServer } from "@/lib/evidence/gate2-fallback-calibration-verifier.server";
import {
  ToolProofFallbackLabPageAdapter,
  type FallbackResetEvidence,
  type FallbackTrialEvidence
} from "@/lib/fallback/lab-page-adapter.server";
import {
  createPinnedFallbackLaunchPlan,
  launchPinnedFallbackTrial
} from "@/lib/fallback/pinned-browser-runtime.server";
import {
  ToolProofFallbackSameOriginServerAdapter,
  armAndStartFallbackBrowserSession,
  fallbackRecoveryCookie,
  installFallbackRecoveryCookie,
  recoverFallbackBrowserSession,
  type FallbackBrowserSessionState
} from "@/lib/fallback/same-origin-server-adapter.server";
import { FALLBACK_UPSTREAM_PIN, fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import { runPinnedFallbackTrial } from "@/lib/fallback/trial-runner";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { fallbackProbeCompleteResponseSchema } from "@/lib/probe/service-contract";

const DEFAULT_EXECUTABLE = "/var/tmp/toolproof-cft-151.0.7922.47/chrome-linux64/chrome";
const MAX_DOCUMENTS = 12;

function nextLaunchId(): string {
  return `launch_${randomUUID()}`;
}

function nextDocumentId(): string {
  return `document_${randomBytes(16).toString("base64url")}`;
}

async function readHiddenLine(prompt: string, maximumCharacters: number): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("fallback_interactive_tty_required");
  }
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("fallback_interactive_cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (/^[A-Za-z0-9_-]$/u.test(character) && value.length < maximumCharacters) {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

function rawSha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeEvidence(receipt: unknown, buildCommit: string) {
  const directory = path.resolve(process.cwd(), ".toolproof-local/evidence/gate2");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const filename = `toolproof-gate2-fallback-${buildCommit.slice(0, 12)}-${stamp}.json`;
  const filePath = path.join(directory, filename);
  const bytes = `${canonicalJson(receipt)}\n`;
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(bytes, { encoding: "utf8" });
    await file.sync();
  } finally {
    await file.close();
  }
  return Object.freeze({ filePath, rawSha256: rawSha256(bytes), bytes: Buffer.byteLength(bytes) });
}

async function main(): Promise<void> {
  const runnerHash = await fallbackRunnerContractHash();
  if (process.env.TOOLPROOF_FALLBACK_EXECUTION_CONFIRM !== runnerHash) {
    throw new Error("fallback_execution_confirmation_missing");
  }
  const launchPlan = await createPinnedFallbackLaunchPlan({
    executablePath: process.env.TOOLPROOF_FALLBACK_CHROME_PATH?.trim() || DEFAULT_EXECUTABLE,
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    targetOrigin: `${PROBE_PRODUCTION_ORIGIN}/`
  });

  let capability = await readHiddenLine("One-time ToolProof operator capability: ", 43);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) throw new Error("invalid_operator_capability");
  let recoveryCookie: string | null = null;
  let buildCommit: string | null = null;
  const launchId = nextLaunchId();
  const documentId = nextDocumentId();
  let knownContinuation: string | null = null;
  let terminal = false;
  let consecutiveFailures = 0;

  for (let documentNumber = 0; documentNumber < MAX_DOCUMENTS && !terminal; documentNumber += 1) {
    const trial = await launchPinnedFallbackTrial(launchPlan);
    let handedToRunner = false;
    try {
      let session: FallbackBrowserSessionState;
      if (recoveryCookie === null) {
        session = await armAndStartFallbackBrowserSession({
          page: trial.page,
          capability,
          launchId,
          documentId
        });
        capability = "";
        recoveryCookie = await fallbackRecoveryCookie(trial.page, launchPlan.targetOrigin);
        buildCommit = session.buildCommit;
        knownContinuation = session.continuation;
      } else {
        await installFallbackRecoveryCookie(trial.page, recoveryCookie, launchPlan.targetOrigin);
        session = await recoverFallbackBrowserSession({
          page: trial.page,
          documentId,
          ...(buildCommit ? { expectedBuildCommit: buildCommit } : {})
        });
      }
      if (session.path === "/results") {
        terminal = true;
        continue;
      }
      if (knownContinuation !== null && session.continuation !== knownContinuation) {
        knownContinuation = session.continuation;
        consecutiveFailures = 0;
        continue;
      }
      const serverAdapter = new ToolProofFallbackSameOriginServerAdapter<
        FallbackResetEvidence,
        FallbackTrialEvidence
      >(trial.page, session);
      handedToRunner = true;
      const result = await runPinnedFallbackTrial({
        launchPlan,
        pageAdapter: new ToolProofFallbackLabPageAdapter(),
        serverAdapter,
        launchTrial: async () => trial
      });
      const seal = fallbackProbeCompleteResponseSchema.parse(result.seal);
      knownContinuation = serverAdapter.sessionState().continuation;
      consecutiveFailures = 0;
      terminal = seal.terminal;
      process.stdout.write(
        `${JSON.stringify({ status: "sealed", completedCount: seal.completedCount, terminal })}\n`
      );
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) throw error;
      process.stderr.write(
        `${JSON.stringify({ status: "recovering_same_opaque_trial", providerRetryAuthorized: false })}\n`
      );
    } finally {
      if (!handedToRunner) await trial.close();
    }
  }
  if (!terminal || recoveryCookie === null || buildCommit === null) {
    throw new Error("fallback_calibration_did_not_reach_terminal_evidence");
  }

  const revealTrial = await launchPinnedFallbackTrial(launchPlan);
  try {
    await installFallbackRecoveryCookie(revealTrial.page, recoveryCookie, launchPlan.targetOrigin);
    const session = await recoverFallbackBrowserSession({
      page: revealTrial.page,
      documentId,
      expectedBuildCommit: buildCommit
    });
    if (session.path !== "/results") throw new Error("fallback_terminal_recovery_missing");
    const adapter = new ToolProofFallbackSameOriginServerAdapter<
      FallbackResetEvidence,
      FallbackTrialEvidence
    >(revealTrial.page, session);
    const receipt = await adapter.reveal();
    await verifyGate2FallbackCalibrationBundleServer(receipt);
    const file = await writeEvidence(receipt, buildCommit);
    const publicReceipt = receipt as {
      readonly evidenceDigest?: unknown;
      readonly passedCount?: unknown;
    };
    process.stdout.write(
      `${JSON.stringify({
        status: "verified_evidence_saved",
        file: file.filePath,
        bytes: file.bytes,
        rawSha256: file.rawSha256,
        evidenceDigest: publicReceipt.evidenceDigest,
        passedCount: publicReceipt.passedCount
      })}\n`
    );

    const interfaceInstance = createInterface({ input: process.stdin, output: process.stderr });
    try {
      while (true) {
        const answer = await interfaceInstance.question(
          'After human approval, type "ACK" to delete encrypted recovery data: '
        );
        if (answer.trim() === "ACK") break;
      }
    } finally {
      interfaceInstance.close();
    }
    await adapter.acknowledge();
    process.stdout.write(`${JSON.stringify({ status: "terminal_evidence_acknowledged" })}\n`);
  } finally {
    await revealTrial.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "fallback_calibration_failed"
    })}\n`
  );
  process.exitCode = 1;
});
