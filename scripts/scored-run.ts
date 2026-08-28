import { createHash, randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { canonicalJson } from "@/lib/evidence/digest";
import { ToolProofFallbackLabPageAdapter } from "@/lib/fallback/lab-page-adapter.server";
import {
  createPinnedFallbackLaunchPlan,
  launchPinnedFallbackTrial
} from "@/lib/fallback/pinned-browser-runtime.server";
import { FALLBACK_UPSTREAM_PIN } from "@/lib/fallback/runner-contract";
import { runPinnedFallbackTrial } from "@/lib/fallback/trial-runner";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import {
  ToolProofScoredSameOriginServerAdapter,
  installScoredRecoveryCookie,
  recoverScoredBrowserSession,
  scoredRecoveryCookie,
  startScoredBrowserSession,
  type ScoredBrowserSessionState
} from "@/lib/scored/same-origin-server-adapter.server";
import {
  verifyGate3ScoredBundle,
  verifyGate3BaselineRevealBundle,
  type Gate3BaselineRevealBundle,
  type Gate3ScoredBundle
} from "@/lib/scored/service.server";
import {
  SCORED_LOCAL_RECOVERY_VERSION,
  deleteScoredLocalRecovery,
  loadScoredLocalRecovery,
  saveScoredLocalRecovery,
  type ScoredLocalRecoveryState
} from "@/lib/scored/local-recovery";

const DEFAULT_EXECUTABLE = "/var/tmp/toolproof-cft-151.0.7922.47/chrome-linux64/chrome";
const MAX_DOCUMENTS = 60;

function phaseArgument(): "baseline" | "revised" {
  const value = process.argv[2];
  if (value !== "baseline" && value !== "revised") {
    throw new Error("scored_phase_argument_required");
  }
  return value;
}

async function readHiddenLine(prompt: string, maximumCharacters: number): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("scored_interactive_tty_required");
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
          reject(new Error("scored_interactive_cancelled"));
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

function rawSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeEvidence(
  bundle: Gate3BaselineRevealBundle | Gate3ScoredBundle,
  phase: "baseline" | "revised"
) {
  const gate = phase === "baseline" ? "gate4" : "gate5";
  const directory = path.resolve(process.cwd(), `.toolproof-local/evidence/${gate}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  const filename = `toolproof-${phase}-${bundle.appCommit.slice(0, 12)}-${stamp}.json`;
  const filePath = path.join(directory, filename);
  const bytes = `${canonicalJson(bundle)}\n`;
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(bytes, { encoding: "utf8" });
    await file.sync();
  } finally {
    await file.close();
  }
  return Object.freeze({
    filePath,
    bytes: Buffer.byteLength(bytes),
    rawSha256: rawSha256(bytes)
  });
}

async function main(): Promise<void> {
  const phase = phaseArgument();
  const launchPlan = await createPinnedFallbackLaunchPlan({
    executablePath: process.env.TOOLPROOF_FALLBACK_CHROME_PATH?.trim() || DEFAULT_EXECUTABLE,
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    targetOrigin: `${PROBE_PRODUCTION_ORIGIN}/`
  });
  let localRecovery: ScoredLocalRecoveryState | null = await loadScoredLocalRecovery(phase);
  if (!localRecovery) {
    const capability = await readHiddenLine("One-time ToolProof scored capability: ", 43);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) {
      throw new Error("invalid_scored_operator_capability");
    }
    localRecovery = {
      version: SCORED_LOCAL_RECOVERY_VERSION,
      phase,
      launchId: `launch_${randomBytes(16).toString("base64url")}`,
      documentId: `document_${randomBytes(16).toString("base64url")}`,
      capability,
      recoveryCookie: null,
      buildCommit: null,
      frozenProtocolHash: null,
      reviewPackageHash: null
    };
    await saveScoredLocalRecovery(localRecovery);
  }
  const launchId = localRecovery.launchId;
  const documentId = localRecovery.documentId;
  let capability = localRecovery.capability ?? "";
  let recoveryCookie: string | null = localRecovery.recoveryCookie;
  let buildCommit: string | null = localRecovery.buildCommit;
  let terminal = false;
  let consecutiveRecoveryFailures = 0;

  for (let documentNumber = 0; documentNumber < MAX_DOCUMENTS && !terminal; documentNumber += 1) {
    const browser = await launchPinnedFallbackTrial(launchPlan);
    let handedToRunner = false;
    let adapter: ToolProofScoredSameOriginServerAdapter | null = null;
    try {
      let session: ScoredBrowserSessionState;
      if (recoveryCookie === null) {
        session = await startScoredBrowserSession({
          page: browser.page,
          capability,
          phase,
          launchId,
          documentId
        });
        capability = "";
        recoveryCookie = await scoredRecoveryCookie(browser.page, launchPlan.targetOrigin);
        buildCommit = session.buildCommit;
        localRecovery = {
          ...localRecovery,
          capability: null,
          recoveryCookie,
          buildCommit,
          frozenProtocolHash: session.frozenProtocolHash,
          reviewPackageHash: session.reviewPackageHash
        };
        await saveScoredLocalRecovery(localRecovery);
      } else {
        await installScoredRecoveryCookie(browser.page, recoveryCookie, launchPlan.targetOrigin);
        session = await recoverScoredBrowserSession({
          page: browser.page,
          documentId,
          ...(buildCommit ? { expectedBuildCommit: buildCommit } : {})
        });
      }
      if (session.path === "/results") {
        terminal = true;
        consecutiveRecoveryFailures = 0;
        continue;
      }
      adapter = new ToolProofScoredSameOriginServerAdapter(browser.page, session);
      handedToRunner = true;
      const result = await runPinnedFallbackTrial({
        launchPlan,
        pageAdapter: new ToolProofFallbackLabPageAdapter(),
        serverAdapter: adapter,
        launchTrial: async () => browser
      });
      const seal = result.seal as {
        readonly completedCount?: unknown;
        readonly remainingCount?: unknown;
        readonly terminal?: unknown;
      };
      process.stdout.write(
        `${JSON.stringify({
          status: "sealed",
          completedCount: seal.completedCount,
          remainingCount: seal.remainingCount,
          terminal: seal.terminal === true
        })}\n`
      );
      terminal = seal.terminal === true;
      consecutiveRecoveryFailures = 0;
    } catch (error) {
      let failureRecorded = false;
      if (adapter && recoveryCookie && buildCommit) {
        const authorization = adapter.currentAuthorization();
        const failureBrowser = await launchPinnedFallbackTrial(launchPlan);
        try {
          await installScoredRecoveryCookie(
            failureBrowser.page,
            recoveryCookie,
            launchPlan.targetOrigin
          );
          const recovered = await recoverScoredBrowserSession({
            page: failureBrowser.page,
            documentId,
            expectedBuildCommit: buildCommit
          });
          const failureAdapter = new ToolProofScoredSameOriginServerAdapter(
            failureBrowser.page,
            recovered
          );
          const receipt = (await failureAdapter.recordFailure(error, authorization)) as {
            readonly status?: unknown;
            readonly currentOrdinal?: unknown;
            readonly currentAttempt?: unknown;
            readonly terminal?: unknown;
          };
          failureRecorded = true;
          terminal = receipt.terminal === true;
          process.stderr.write(
            `${JSON.stringify({
              status: "scored_failure_recorded",
              runStatus: receipt.status,
              currentOrdinal: receipt.currentOrdinal,
              currentAttempt: receipt.currentAttempt,
              terminal
            })}\n`
          );
        } catch {
          // A completion response can be lost after the server already advanced. Recovery below
          // establishes the durable ordinal without writing a second failure.
        } finally {
          await failureBrowser.close();
        }
      }
      consecutiveRecoveryFailures = failureRecorded ? 0 : consecutiveRecoveryFailures + 1;
      if (consecutiveRecoveryFailures >= 2) throw error;
    } finally {
      if (!handedToRunner) await browser.close();
    }
  }
  if (!terminal || !recoveryCookie || !buildCommit) {
    throw new Error("scored_run_did_not_reach_terminal_evidence");
  }

  const revealBrowser = await launchPinnedFallbackTrial(launchPlan);
  try {
    await installScoredRecoveryCookie(revealBrowser.page, recoveryCookie, launchPlan.targetOrigin);
    const session = await recoverScoredBrowserSession({
      page: revealBrowser.page,
      documentId,
      expectedBuildCommit: buildCommit
    });
    if (session.path !== "/results") throw new Error("scored_terminal_recovery_missing");
    let adapter = new ToolProofScoredSameOriginServerAdapter(revealBrowser.page, session);
    const revealed = await adapter.reveal();
    const expectedBundle = {
      phase,
      appCommit: buildCommit,
      frozenProtocolHash: session.frozenProtocolHash,
      reviewPackageHash: session.reviewPackageHash
    } as const;
    const bundle =
      phase === "baseline"
        ? await verifyGate3BaselineRevealBundle(revealed, expectedBundle)
        : await verifyGate3ScoredBundle(revealed, expectedBundle);
    const file = await writeEvidence(bundle, phase);
    process.stdout.write(
      `${JSON.stringify({
        status: "verified_evidence_saved",
        phase,
        file: file.filePath,
        bytes: file.bytes,
        rawSha256: file.rawSha256,
        terminalEvidenceDigest:
          "terminalEvidenceDigest" in bundle
            ? bundle.terminalEvidenceDigest
            : bundle.evidenceDigest,
        ...(phase === "baseline" && "revealDigest" in bundle
          ? { revealDigest: bundle.revealDigest }
          : {}),
        completedCount: bundle.completedCount,
        attemptCount: bundle.attemptCount
      })}\n`
    );

    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
      while (true) {
        const answer = await prompt.question(
          'After human approval, type "ACK" to delete encrypted scored recovery data: '
        );
        if (answer.trim() === "ACK") break;
      }
    } finally {
      prompt.close();
    }
    const renewed = await recoverScoredBrowserSession({
      page: revealBrowser.page,
      documentId,
      expectedBuildCommit: buildCommit
    });
    if (renewed.path !== "/results") throw new Error("scored_ack_recovery_mismatch");
    adapter = new ToolProofScoredSameOriginServerAdapter(revealBrowser.page, renewed);
    const evidenceDigest =
      "terminalEvidenceDigest" in bundle ? bundle.terminalEvidenceDigest : bundle.evidenceDigest;
    try {
      await adapter.acknowledge(evidenceDigest);
    } catch {
      // The server may have committed ACK before its response was lost. Reinstall the still-local
      // recovery credential, renew without an active owner/data requirement, and verify the exact
      // acknowledged anchor+permanent-evidence pair once before deleting local recovery.
      await installScoredRecoveryCookie(
        revealBrowser.page,
        recoveryCookie,
        launchPlan.targetOrigin
      );
      const recoveredAck = await recoverScoredBrowserSession({
        page: revealBrowser.page,
        documentId,
        expectedBuildCommit: buildCommit
      });
      if (recoveredAck.path !== "/results") {
        throw new Error("scored_ack_response_loss_recovery_mismatch");
      }
      adapter = new ToolProofScoredSameOriginServerAdapter(revealBrowser.page, recoveredAck);
      await adapter.acknowledge(evidenceDigest);
    }
    await deleteScoredLocalRecovery(phase);
    process.stdout.write(
      `${JSON.stringify({ status: "terminal_evidence_acknowledged", phase })}\n`
    );
  } finally {
    await revealBrowser.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "scored_run_failed"
    })}\n`
  );
  process.exitCode = 1;
});
