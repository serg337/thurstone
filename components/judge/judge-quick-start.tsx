"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/judge/judge-quick-start.module.css";
import {
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  BYOA_HANDOFF_REVOKE_V2_VERSION,
  BYOA_HANDOFF_STATUS_V2_VERSION,
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaHandoffPrepareRequestV2Schema,
  byoaHandoffPrepareResponseV2Schema,
  byoaHandoffStatusResponseV2Schema,
  clearRemoteByoaSessionV2,
  type ByoaOwnerResultSummaryV1
} from "@/lib/demo/agent-handoff-v2";
import { clearByoaHandoffUrl, writeByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import {
  clearAgentVisibleRunProjectionV2,
  writeAgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  agentVisibleRunProjectionV2,
  clearByoaAgentSessionV2,
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  writeByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import { clearByoaResultV3 } from "@/lib/demo/byoa-result-storage-v3";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import {
  clearJudgeQuickStartSource,
  createJudgeQuickStartSuite,
  JUDGE_QUICK_START_REQUEST,
  readJudgeQuickStartSource,
  writeJudgeQuickStartSource,
  type JudgeQuickStartSource
} from "@/lib/demo/judge-quick-start";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const HELP_AFTER_MS = 60 * 1000;

type QuickStatus = ReturnType<typeof byoaHandoffStatusResponseV2Schema.parse>;

function isRealCommit(value: string): boolean {
  return /^[a-f0-9]{40}$/u.test(value) && !/^0{40}$/u.test(value);
}

function commandFor(handoffUrl: string): string {
  return [
    `@Browser Open ${handoffUrl}`,
    "This is my authorized Thurstone judge quick test in the website owner's test environment.",
    `My exact request is: ${JUDGE_QUICK_START_REQUEST}`,
    "Use the live WebMCP catalog to carry out that request once.",
    "I authorize only this exact test-environment quantity change. Do not act on production data or external systems."
  ].join("\n");
}

function clearQuickRunStorage(storage: Storage): void {
  clearJudgeQuickStartSource(storage);
  clearByoaAgentSessionV2(storage);
  clearAgentVisibleRunProjectionV2(storage);
  clearByoaResultV3(storage);
  clearRemoteByoaSessionV2(storage);
  clearByoaHandoffUrl(storage);
  storage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
}

function mugQuantity(summary: ByoaOwnerResultSummaryV1["trustedStateAfter"]): number | null {
  return summary.lines.find(({ itemId }) => itemId === "stoneware-mug")?.quantity ?? null;
}

function readableArguments(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value === null ? "No native arguments" : JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  if (record.itemId === "stoneware-mug" && record.quantity === 3) {
    return "Stoneware mug → quantity 3; unique operation ID supplied";
  }
  return JSON.stringify(value);
}

function statusMessage(status: QuickStatus | undefined): string {
  if (!status || status.state === "ISSUED") return "Awaiting a fresh agent";
  if (status.state === "CLAIMED" || status.state === "RECEIVED") return "Agent connected";
  if (status.state === "STARTED") return "Live catalog ready";
  if (status.state === "SETTLED") return "Verifying the result";
  if (status.state === "TIMED_OUT") return "No native action detected";
  if (status.state === "UNAVAILABLE") return "Supported consumer unavailable";
  return "Test stopped";
}

export function JudgeQuickStart() {
  const [source, setSource] = useState<JudgeQuickStartSource>();
  const [status, setStatus] = useState<QuickStatus>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string>();
  const failureCountRef = useRef(0);

  useEffect(() => {
    const stored = readJudgeQuickStartSource(window.sessionStorage);
    if (stored && Date.parse(stored.expiresAt) > Date.now()) {
      queueMicrotask(() => setSource(stored));
    } else if (stored) clearQuickRunStorage(window.sessionStorage);
  }, []);

  useEffect(() => {
    if (!source || status?.ownerSummary) return;
    const delay = Math.max(0, Date.parse(source.createdAt) + HELP_AFTER_MS - Date.now());
    const timer = window.setTimeout(() => setShowHelp(true), delay);
    return () => window.clearTimeout(timer);
  }, [source, status?.ownerSummary]);

  useEffect(() => {
    if (!source || status?.ownerSummary || error) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/demo/handoff/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Thurstone-Request": "byoa-handoff",
            "X-Thurstone-Origin": window.location.origin
          },
          body: JSON.stringify({
            version: BYOA_HANDOFF_STATUS_V2_VERSION,
            runId: source.runId,
            contractDigest: source.contractDigest,
            token: new URL(source.handoffUrl).hash.slice(1)
          }),
          cache: "no-store"
        });
        if (response.ok) {
          failureCountRef.current = 0;
          const next = byoaHandoffStatusResponseV2Schema.parse(await response.json());
          if (!disposed) setStatus(next);
          if (next.claimFailure) {
            if (!disposed) {
              setError(
                `The fresh-agent handoff was not accepted (${next.claimFailure.reason.replaceAll("_", " ")}).`
              );
            }
            return;
          }
          if (next.state === "REVOKED") {
            if (!disposed) setError("This quick test was revoked before an agent used it.");
            return;
          }
          if (next.ownerSummary) return;
        } else {
          failureCountRef.current += 1;
          if (failureCountRef.current >= 3) {
            if (!disposed) setError("Thurstone could not read this test after three attempts.");
            return;
          }
        }
      } catch {
        failureCountRef.current += 1;
        if (failureCountRef.current >= 3) {
          if (!disposed) setError("Thurstone could not reach the live test after three attempts.");
          return;
        }
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), 1_500);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [error, source, status?.ownerSummary]);

  const command = useMemo(() => (source ? commandFor(source.handoffUrl) : ""), [source]);

  async function arm() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    setShowHelp(false);
    setCopied(false);
    try {
      if (!isRealCommit(APP_COMMIT)) throw new Error("The deployed build identity is unavailable.");
      clearQuickRunStorage(window.sessionStorage);
      const created = new Date();
      const createdAt = created.toISOString();
      const expiresAt = new Date(created.getTime() + HANDOFF_TTL_MS).toISOString();
      const { suite } = await createJudgeQuickStartSuite({
        suiteId: `suite_${globalThis.crypto.randomUUID()}`,
        caseId: `case_${globalThis.crypto.randomUUID()}`,
        createdAt
      });
      const lineage = await expectedLineageForThurstoneSuite(suite);
      const contract = await createByoaContractV3({
        contractId: `byoa_${globalThis.crypto.randomUUID()}`,
        suite,
        buildCommit: APP_COMMIT,
        createdAt: new Date(created.getTime() + 3).toISOString()
      });
      const compiled = await createCompiledByoaSessionV2({
        runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
        contract,
        lineage,
        createdAt: new Date(created.getTime() + 4).toISOString(),
        expiresAt
      });
      const issued = transitionByoaSessionV2(compiled, "HANDOFF_ISSUED", {
        at: new Date(created.getTime() + 5).toISOString(),
        reasonCode: "owner_issued_judge_quick_start"
      });
      const projection = agentVisibleRunProjectionV2(issued);
      const body = byoaHandoffPrepareRequestV2Schema.parse({
        version: BYOA_HANDOFF_PREPARE_V2_VERSION,
        session: issued,
        projection
      });
      const response = await fetch("/api/demo/handoff/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff",
          "X-Thurstone-Origin": window.location.origin
        },
        body: JSON.stringify(body),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The quick test could not be armed safely.");
      const prepared = byoaHandoffPrepareResponseV2Schema.parse(await response.json());
      const nextSource = {
        version: "thurstone-judge-quick-start@1" as const,
        runId: issued.runId,
        contractDigest: issued.contractDigest,
        handoffUrl: prepared.handoffUrl,
        expiresAt: prepared.expiresAt,
        createdAt
      };
      writeByoaAgentSessionV2(window.sessionStorage, issued);
      writeAgentVisibleRunProjectionV2(window.sessionStorage, projection);
      writeByoaHandoffUrl(window.sessionStorage, prepared.handoffUrl);
      writeJudgeQuickStartSource(window.sessionStorage, nextSource);
      window.history.replaceState(null, "", "/judge#armed");
      setSource(nextSource);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The quick test could not be armed.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      if (source && status?.state === "ISSUED") {
        await fetch("/api/demo/handoff/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Thurstone-Request": "byoa-handoff"
          },
          body: JSON.stringify({
            version: BYOA_HANDOFF_REVOKE_V2_VERSION,
            token: new URL(source.handoffUrl).hash.slice(1)
          }),
          cache: "no-store"
        }).catch(() => undefined);
      }
    } finally {
      clearQuickRunStorage(window.sessionStorage);
      window.history.replaceState(null, "", "/judge");
      failureCountRef.current = 0;
      setSource(undefined);
      setStatus(undefined);
      setError(undefined);
      setShowHelp(false);
      setCopied(false);
      setBusy(false);
    }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  const summary = status?.ownerSummary;
  const before = summary?.trustedStateBefore;
  const after = summary?.trustedStateAfter;
  const verdictTitle =
    status?.verdict === "pass"
      ? "Contract passed."
      : status?.verdict === "issue"
        ? "Thurstone found an issue."
        : "Test not completed.";

  return (
    <section className={styles.root} aria-labelledby="judge-quick-title">
      <header className={styles.hero}>
        <p className="eyebrow">Judge quick start · about one minute</p>
        <h1 id="judge-quick-title">See one real WebMCP contract reach a verdict.</h1>
        <p>
          Nothing to author. Thurstone has preloaded one visible cart change so you can watch an
          independent agent act and see the site effect verified.
        </p>
        <div className={styles.environmentNote}>
          Build here in any browser. Run the copied command in a fresh GPT-5.6 Sol or Terra chat
          using ChatGPT Desktop&apos;s built-in Browser—not the Chrome side panel.
        </div>
      </header>

      <div className={styles.flow}>
        <section className={styles.contract} aria-labelledby="quick-contract-title">
          <div className={styles.sectionHeading}>
            <span>1</span>
            <div>
              <p className="eyebrow">Preloaded owner contract</p>
              <h2 id="quick-contract-title">Set the mug quantity to three.</h2>
            </div>
          </div>
          <blockquote>“{JUDGE_QUICK_START_REQUEST}”</blockquote>
          <dl className={styles.contractGrid}>
            <div>
              <dt>Expected tool</dt>
              <dd>
                <code>cart_update</code>
              </dd>
            </div>
            <div>
              <dt>Expected arguments</dt>
              <dd>Stoneware mug · quantity 3 · unique operation ID</dd>
            </div>
            <div>
              <dt>Expected site effect</dt>
              <dd>Mug 2 → 3 · revision 0 → 1 · one ledger transition</dd>
            </div>
            <div>
              <dt>Must not happen</dt>
              <dd>No other cart change, checkout, duplicate transition, or unmodeled change</dd>
            </div>
          </dl>
          <p className={styles.isolation}>
            You see the answer here. The fresh agent receives only the request and live four-tool
            catalog.
          </p>
          {!source ? (
            <button className="button button-primary" type="button" disabled={busy} onClick={arm}>
              {busy ? "Arming clean test…" : "Arm quick test"}
            </button>
          ) : null}
        </section>

        {source && !summary && !error ? (
          <section className={styles.handoff} aria-labelledby="quick-handoff-title">
            <div className={styles.sectionHeading}>
              <span>2</span>
              <div>
                <p className="eyebrow">Fresh-agent handoff</p>
                <h2 id="quick-handoff-title">Your test is armed.</h2>
              </div>
            </div>
            <p className={styles.armedConfirmation} role="status">
              Armed. Clean revision 0. Awaiting one agent action.
            </p>
            <ol className={styles.instructions}>
              <li>Open a fresh GPT-5.6 Sol or Terra Work or Codex chat in ChatGPT Desktop.</li>
              <li>Paste the command below and send it.</li>
              <li>Keep this page open; the verdict appears here automatically.</li>
            </ol>
            <div className={styles.actions}>
              <button className="button button-primary" type="button" onClick={copyCommand}>
                {copied ? "Command copied" : "Copy exact ChatGPT command"}
              </button>
              <button className="button button-secondary" type="button" onClick={reset}>
                Reset quick test
              </button>
            </div>
            <details className={styles.commandPreview}>
              <summary>Preview the exact command</summary>
              <pre>{command}</pre>
            </details>
            <div className={styles.liveStatus} data-state={status?.state ?? "ISSUED"}>
              <span aria-hidden="true" />
              <div>
                <strong>{statusMessage(status)}</strong>
                <p>Thurstone is watching the native action and site-owned state.</p>
              </div>
            </div>
            {showHelp ? (
              <aside className={styles.help} role="status">
                <strong>No action yet?</strong>
                <p>
                  Confirm you used a fresh ChatGPT Desktop chat with its built-in Browser. The
                  Chrome side panel cannot run this Site Tools test.
                </p>
                <button className="button button-secondary" type="button" onClick={reset}>
                  Re-arm a clean test
                </button>
              </aside>
            ) : null}
          </section>
        ) : null}

        {summary ? (
          <section
            className={styles.verdict}
            data-verdict={status?.verdict}
            aria-labelledby="quick-verdict-title"
          >
            <div className={styles.sectionHeading}>
              <span>3</span>
              <div>
                <p className="eyebrow">Live verified result</p>
                <h2 id="quick-verdict-title">{verdictTitle}</h2>
              </div>
            </div>
            <p className={styles.resultExplanation}>{summary.resultExplanation}</p>
            <div className={styles.verdictGrid}>
              <article>
                <span>Expected</span>
                <strong>
                  <code>cart_update</code>
                </strong>
                <p>Stoneware mug → quantity 3</p>
              </article>
              <article>
                <span>Observed</span>
                <strong>
                  <code>{summary.observedTool ?? "no native action"}</code>
                </strong>
                <p>{readableArguments(summary.actualArguments)}</p>
              </article>
              <article>
                <span>Trusted state</span>
                <strong>
                  Mug {before ? mugQuantity(before) : 2} → {after ? mugQuantity(after) : "—"}
                </strong>
                <p>
                  {`Revision ${before?.revision ?? 0} → ${after?.revision ?? "—"}; checkout ${after?.pendingCheckoutStatus ?? "unchanged"}`}
                </p>
              </article>
              <article>
                <span>Ledger</span>
                <strong>{summary.ledger?.stateTransitionCount ?? 0} state transition</strong>
                <p>
                  {`${summary.ledger?.operationLedgerCountDelta ?? 0} operation entry · ${summary.ledger?.eventCountDelta ?? 0} native event`}
                </p>
              </article>
            </div>
            <div className={styles.assertions}>
              <strong>
                {summary.assertions?.passed ?? 0}/{summary.assertions?.total ?? 0} contract checks
                passed
              </strong>
              {summary.assertions?.failed.map((assertion) => (
                <p key={`${assertion.label}:${assertion.detail}`}>
                  <b>{assertion.label}:</b> {assertion.detail}
                </p>
              ))}
            </div>
            {summary.recommendedNextStep ? (
              <aside className={styles.nextStep}>
                <strong>What to investigate next</strong>
                <p>{summary.recommendedNextStep}</p>
              </aside>
            ) : null}
            <div className={styles.actions}>
              <button className="button button-primary" type="button" onClick={reset}>
                Run a fresh quick test
              </button>
              <a className="button button-secondary" href="/demo">
                Build your own contract
              </a>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className={styles.failure} role="alert">
            <p className="eyebrow">Test not completed</p>
            <h2>Thurstone could not produce a trustworthy verdict.</h2>
            <p>{error}</p>
            <button className="button button-primary" type="button" onClick={reset}>
              Re-arm a clean test
            </button>
          </section>
        ) : null}
      </div>

      <footer className={styles.more}>
        <div>
          <p className="eyebrow">Want to see a caught issue without running an agent?</p>
          <h2>Open a controlled native mismatch.</h2>
          <p>
            It is clearly labeled as a no-model example and explains every failed check visually.
          </p>
          <a className="button button-secondary" href="/demo/controlled">
            See a controlled caught issue
          </a>
        </div>
        <nav aria-label="Continue exploring Thurstone">
          <a href="/demo">Full contract builder</a>
          <a href="/results">Verified reference results</a>
          <a href="https://github.com/serg337/thurstone">Source repository</a>
        </nav>
      </footer>
    </section>
  );
}
