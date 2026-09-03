"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/judge/judge-quick-start.module.css";
import { clearByoaHandoffUrl, writeByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import {
  BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION,
  BYOA_CONTINUOUS_JOURNEY_VERSION,
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  BYOA_HANDOFF_REVOKE_V2_VERSION,
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaContinuousJourneyStatusResponseSchema,
  byoaHandoffPrepareRequestV2Schema,
  byoaHandoffPrepareResponseV2Schema,
  clearRemoteByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
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
import { selectContractSuiteCase } from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import {
  clearJudgeQuickStartSource,
  createJudgeQuickStartSuite,
  JUDGE_QUICK_START_REQUESTS,
  JUDGE_QUICK_START_RUNTIME_VARIANTS,
  readJudgeQuickStartSource,
  writeJudgeQuickStartSource,
  type JudgeQuickStartSource
} from "@/lib/demo/judge-quick-start";
import { clearOwnerJourneyReport, writeOwnerJourneyReport } from "@/lib/demo/owner-journey-report";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const HELP_AFTER_MS = 60 * 1000;

type QuickStatus = ReturnType<typeof byoaContinuousJourneyStatusResponseSchema.parse>;

function isRealCommit(value: string): boolean {
  return /^[a-f0-9]{40}$/u.test(value) && !/^0{40}$/u.test(value);
}

function nextTimestamp(after: string, offset: number): string {
  return new Date(Math.max(Date.now(), Date.parse(after) + offset)).toISOString();
}

function commandFor(source: JudgeQuickStartSource): string {
  const requests = source.steps.map(({ request }, index) => `${index + 1}. ${request}`).join("\n");
  return [
    `@Browser Open ${source.handoffUrl}`,
    "This is my authorized Thurstone Judge Quick Start in the website owner's test environment.",
    "Treat these as my exact requests, in order:",
    requests,
    "Thurstone receives, arms, and advances the cases automatically. Do not use a shell or visual click automation.",
    "Use only the native Site Tools exposed on the opened Thurstone page.",
    "Process one request at a time. Wait for Thurstone to verify and reveal the next request before continuing.",
    "Continue through all three cases even when one reports an issue. Thurstone resets the synthetic fixture between cases.",
    "I authorize only the exact test-environment cart changes these requests describe. Do not act on production data or external systems."
  ].join("\n");
}

function clearQuickRunStorage(storage: Storage, clearReport = true): void {
  clearJudgeQuickStartSource(storage);
  clearByoaAgentSessionV2(storage);
  clearAgentVisibleRunProjectionV2(storage);
  clearByoaResultV3(storage);
  clearRemoteByoaSessionV2(storage);
  clearByoaHandoffUrl(storage);
  storage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
  if (clearReport) clearOwnerJourneyReport(storage);
}

function statusMessage(status: QuickStatus | undefined): string {
  if (!status || status.state === "ISSUED") return "Awaiting a fresh agent";
  if (status.state === "CLAIMED" || status.state === "RECEIVED") return "Agent connected";
  if (status.state === "STARTED") return "Live catalog ready";
  if (status.state === "SETTLED") return "Verifying the current case";
  if (status.state === "TIMED_OUT") return "No native action detected";
  if (status.state === "UNAVAILABLE") return "Supported consumer unavailable";
  return "Preparing the next case";
}

export function JudgeQuickStart() {
  const [source, setSource] = useState<JudgeQuickStartSource>();
  const [status, setStatus] = useState<QuickStatus>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string>();
  const failureCountRef = useRef(0);
  const finalizingRef = useRef(false);

  useEffect(() => {
    const stored = readJudgeQuickStartSource(window.sessionStorage);
    if (stored && Date.parse(stored.expiresAt) > Date.now()) {
      queueMicrotask(() => setSource(stored));
    } else if (stored) clearQuickRunStorage(window.sessionStorage);
  }, []);

  useEffect(() => {
    if (!source || status?.complete) return;
    const delay = Math.max(0, Date.parse(source.createdAt) + HELP_AFTER_MS - Date.now());
    const timer = window.setTimeout(() => setShowHelp(true), delay);
    return () => window.clearTimeout(timer);
  }, [source, status?.complete]);

  useEffect(() => {
    if (!source || status?.complete || error) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/demo/journey/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Thurstone-Request": "byoa-handoff",
            "X-Thurstone-Origin": window.location.origin
          },
          body: JSON.stringify({
            version: BYOA_CONTINUOUS_JOURNEY_STATUS_VERSION,
            runId: source.runId,
            contractDigest: source.contractDigest,
            token: new URL(source.handoffUrl).hash.slice(1)
          }),
          cache: "no-store"
        });
        if (response.ok) {
          failureCountRef.current = 0;
          const next = byoaContinuousJourneyStatusResponseSchema.parse(await response.json());
          if (!disposed) setStatus(next);
          if (next.claimFailure) {
            if (!disposed) {
              setError(
                `The fresh-agent handoff was not accepted (${next.claimFailure.reason.replaceAll("_", " ")}).`
              );
            }
            return;
          }
          if (next.complete) return;
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
  }, [error, source, status?.complete]);

  useEffect(() => {
    if (!source || !status?.complete || finalizingRef.current) return;
    finalizingRef.current = true;
    void writeOwnerJourneyReport(window.sessionStorage, {
      mode: "regression",
      suiteId: source.suiteId,
      catalogDigest: source.catalogDigest,
      completedAt: new Date().toISOString(),
      total: source.steps.length,
      results: status.results,
      plannedCases: source.steps.map(({ caseId, request, expectedTool }) => ({
        caseId,
        request,
        expectedTool
      }))
    })
      .then(() => {
        clearQuickRunStorage(window.sessionStorage, false);
        window.location.replace("/results?judge=latest");
      })
      .catch(() => {
        finalizingRef.current = false;
        setError("The completed Judge Results report could not be verified.");
      });
  }, [source, status]);

  const command = useMemo(() => (source ? commandFor(source) : ""), [source]);

  async function arm() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    setShowHelp(false);
    setCopied(false);
    finalizingRef.current = false;
    try {
      if (!isRealCommit(APP_COMMIT)) throw new Error("The deployed build identity is unavailable.");
      clearQuickRunStorage(window.sessionStorage);
      const created = new Date();
      const createdAt = created.toISOString();
      const expiresAt = new Date(created.getTime() + HANDOFF_TTL_MS).toISOString();
      const suiteId = `suite_${globalThis.crypto.randomUUID()}`;
      const caseIds = [
        `case_${globalThis.crypto.randomUUID()}`,
        `case_${globalThis.crypto.randomUUID()}`,
        `case_${globalThis.crypto.randomUUID()}`
      ] as const;
      const { suite, cases } = await createJudgeQuickStartSuite({
        suiteId,
        caseIds,
        createdAt
      });
      const issuedSteps = [];
      for (const [index, testCase] of cases.entries()) {
        const runtimeVariant = JUDGE_QUICK_START_RUNTIME_VARIANTS[index]!;
        const selectedSuite =
          suite.selectedCaseId === testCase.caseId
            ? suite
            : selectContractSuiteCase(suite, testCase.caseId, {
                updatedAt: nextTimestamp(suite.updatedAt, index + 1)
              });
        const lineage = await expectedLineageForThurstoneSuite(selectedSuite);
        const stepCreatedAt = new Date(created.getTime() + 20 + index * 4).toISOString();
        const contract = await createByoaContractV3({
          contractId: `byoa_${globalThis.crypto.randomUUID()}`,
          suite: selectedSuite,
          buildCommit: APP_COMMIT,
          createdAt: stepCreatedAt,
          runtimeVariant
        });
        const compiled = await createCompiledByoaSessionV2({
          runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
          contract,
          lineage,
          createdAt: new Date(Date.parse(stepCreatedAt) + 1).toISOString(),
          expiresAt
        });
        issuedSteps.push(
          transitionByoaSessionV2(compiled, "HANDOFF_ISSUED", {
            at: new Date(Date.parse(stepCreatedAt) + 2).toISOString(),
            reasonCode: "owner_issued_judge_quick_start"
          })
        );
      }
      const issued = issuedSteps[0]!;
      const projection = agentVisibleRunProjectionV2(issued);
      const journeyId = `journey_${globalThis.crypto.randomUUID()}`;
      const body = byoaHandoffPrepareRequestV2Schema.parse({
        version: BYOA_HANDOFF_PREPARE_V2_VERSION,
        session: issued,
        projection,
        journey: {
          version: BYOA_CONTINUOUS_JOURNEY_VERSION,
          journeyId,
          mode: "regression",
          processEndingToolNames: [],
          steps: issuedSteps
        }
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
      if (!response.ok) throw new Error("The Judge Quick Start could not be armed safely.");
      const prepared = byoaHandoffPrepareResponseV2Schema.parse(await response.json());
      const automaticHandoffUrl = new URL(prepared.handoffUrl);
      automaticHandoffUrl.searchParams.set("auto", "judge");
      const nextSource = {
        version: "thurstone-judge-quick-start@2" as const,
        suiteId,
        catalogDigest: suite.catalogDigest,
        journeyId,
        runId: issued.runId,
        contractDigest: issued.contractDigest,
        steps: cases.map((testCase, index) => ({
          caseId: testCase.caseId,
          name: testCase.name,
          request: testCase.request,
          expectedTool: testCase.expectedTool as "cart_update" | "order_review",
          runtimeVariant: JUDGE_QUICK_START_RUNTIME_VARIANTS[index]!
        })),
        handoffUrl: automaticHandoffUrl.toString(),
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
      setError(caught instanceof Error ? caught.message : "The Judge Quick Start could not arm.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      if (source && (!status || (status.state === "ISSUED" && status.results.length === 0))) {
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
      finalizingRef.current = false;
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

  const completed = status?.results.length ?? 0;

  return (
    <section className={styles.root} aria-labelledby="judge-quick-title">
      <header className={`route-hero ${styles.hero}`}>
        <div>
          <p className="eyebrow">Judge Quick Start</p>
          <h1 id="judge-quick-title">Three tests. Both sides of the WebMCP contract.</h1>
          <p>
            Nothing to author. Run a healthy baseline, a disclosed site-side fault, and a real
            semantic collision—then inspect one complete Judge Results report.
          </p>
          <span className={styles.environmentNote}>
            Build here in any browser. Run the copied command in a fresh GPT-5.6 Sol or Terra chat
            using ChatGPT Desktop&apos;s built-in Browser—not the Chrome side panel.
          </span>
        </div>
      </header>

      <section className={`panel ${styles.contract}`} aria-labelledby="quick-contract-title">
        <div className={styles.sectionHeading}>
          <p className="eyebrow">Preloaded three-case contract</p>
          <h2 id="quick-contract-title">Know what each test is proving before you run it.</h2>
        </div>
        <div className={styles.caseGrid}>
          <article data-case="baseline">
            <span>Test 1 · Live agent baseline</span>
            <h3>Expected pass</h3>
            <blockquote>“{JUDGE_QUICK_START_REQUESTS.baseline}”</blockquote>
            <p>
              Normal handler. Expect <code>cart_update</code>, mug quantity 2 → 3, revision 0 → 1,
              and one ledger transition.
            </p>
          </article>
          <article data-case="planted">
            <span>Test 2 · Controlled planted site fault</span>
            <h3>Deterministic issue</h3>
            <blockquote>“{JUDGE_QUICK_START_REQUESTS.planted}”</blockquote>
            <p>
              The session-only demo handler deliberately reuses the current quantity and returns a
              successful no-op. Thurstone should catch the missing required effect.
            </p>
          </article>
          <article data-case="collision">
            <span>Test 3 · Live agent semantic stress test</span>
            <h3>Outcome not predetermined</h3>
            <blockquote>“{JUDGE_QUICK_START_REQUESTS.collision}”</blockquote>
            <p>
              <code>cart_get</code> deliberately overlaps with <code>order_review</code>. The real
              agent may preserve or miss the owner&apos;s intended boundary; Thurstone records what
              actually happens.
            </p>
          </article>
        </div>
        <p className={styles.isolation}>
          You see the expected behavior here. The fresh agent receives only each request and the
          live catalog—not the owner&apos;s answer key.
        </p>
        {!source ? (
          <button className="button button-primary" type="button" disabled={busy} onClick={arm}>
            {busy ? "Arming three clean cases…" : "Arm Judge Quick Start"}
          </button>
        ) : null}
      </section>

      {source && !error ? (
        <section className={`panel ${styles.handoff}`} aria-labelledby="quick-handoff-title">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">Fresh-agent handoff</p>
            <h2 id="quick-handoff-title">Run all three cases in one fresh agent chat.</h2>
          </div>
          <p className={styles.armedConfirmation} role="status">
            Armed. Three clean cases. {completed} of 3 results received.
          </p>
          <ol className={styles.instructions}>
            <li>Open a fresh GPT-5.6 Sol or Terra Work or Codex chat in ChatGPT Desktop.</li>
            <li>Paste the exact command below and send it.</li>
            <li>Keep this page open. Judge Results opens automatically when all cases finish.</li>
          </ol>
          <div className={styles.actions}>
            <button className="button button-primary" type="button" onClick={copyCommand}>
              {copied ? "Command copied" : "Copy exact ChatGPT command"}
            </button>
            <button className="button button-secondary" type="button" onClick={reset}>
              Reset Judge Quick Start
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
              <p>{completed} of 3 independently verified results received.</p>
            </div>
          </div>
          {showHelp ? (
            <aside className={styles.help} role="status">
              <strong>No new result yet?</strong>
              <p>
                Confirm the fresh chat is using ChatGPT Desktop&apos;s built-in Browser and continue
                in that same chat until all three requests finish.
              </p>
              <button className="button button-secondary" type="button" onClick={reset}>
                Re-arm three clean cases
              </button>
            </aside>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <section className={`panel ${styles.failure}`} role="alert">
          <p className="eyebrow">Test not completed</p>
          <h2>Thurstone could not produce a trustworthy Judge Results report.</h2>
          <p>{error}</p>
          <button className="button button-primary" type="button" onClick={reset}>
            Re-arm three clean cases
          </button>
        </section>
      ) : null}

      <footer className={styles.more}>
        <nav aria-label="Continue exploring Thurstone">
          <a href="/demo">Build your own contract</a>
          <a href="/demo/controlled">See the controlled no-model example</a>
          <a href="https://github.com/serg337/thurstone">Source repository</a>
        </nav>
      </footer>
    </section>
  );
}
