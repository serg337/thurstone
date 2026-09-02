"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  ContractSuiteBuilder,
  type ContractSuiteArmSelection,
  type ContractSuiteBuilderPreflight
} from "@/components/demo/contract-suite-builder";
import { BrowserEntryGuide } from "@/components/demo/browser-entry-guide";
import { FixtureInspector } from "@/components/demo/fixture-inspector";
import { OwnerDemoProgress } from "@/components/demo/owner-demo-progress";
import { ReferenceToolCatalog } from "@/components/demo/reference-tool-catalog";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  createThurstoneContractSuite,
  newThurstoneContractSuiteId,
  selectContractSuiteCase,
  setContractSuiteProcessEndingTool,
  updateContractSuiteCatalog,
  verifyThurstoneContractSuite,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import {
  BYOA_CONTINUOUS_JOURNEY_VERSION,
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  byoaHandoffPrepareRequestV2Schema,
  byoaHandoffPrepareResponseV2Schema
} from "@/lib/demo/agent-handoff-v2";
import { writeByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import {
  agentVisibleRunProjectionV2,
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  writeByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import { writeAgentVisibleRunProjectionV2 } from "@/lib/demo/agent-projection";
import {
  clearThurstoneContractSuite,
  loadThurstoneContractSuite,
  saveThurstoneContractSuite
} from "@/lib/demo/suite-storage";
import {
  acquireThurstoneSuiteTabLease,
  type LockManagerLike,
  type ThurstoneSuiteTabLeaseResult
} from "@/lib/demo/suite-tab-lease";
import { createCheckoutFixture } from "@/lib/domain/checkout";
import { canonicalJson } from "@/lib/evidence/digest";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const APP_COMMIT_SAFE = /^[a-f0-9]{40}$/u.test(APP_COMMIT) ? APP_COMMIT : "0".repeat(40);
const BUILD_COMMIT_READY = /^[a-f0-9]{40}$/u.test(APP_COMMIT) && !/^0{40}$/u.test(APP_COMMIT);
const HANDOFF_TTL_MS = 10 * 60 * 1000;

const PENDING_PREFLIGHT: ContractSuiteBuilderPreflight = Object.freeze({
  buildCommit: APP_COMMIT_SAFE,
  cleanFixture: "pending",
  catalog: "pending",
  answerKeyIsolation: "pending"
});

type OwnerStage = 1 | 2 | 3;

function nextTimestamp(suite: ThurstoneContractSuiteV1): string {
  return new Date(Math.max(Date.now(), Date.parse(suite.updatedAt) + 1)).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Demo could not continue safely.";
}

async function measureOwnerPreflight(
  value: ThurstoneContractSuiteV1
): Promise<ContractSuiteBuilderPreflight> {
  try {
    const suite = await verifyThurstoneContractSuite(value);
    const fixture = createCheckoutFixture();
    const cleanFixture =
      fixture.fixtureId === suite.catalogSnapshot.fixtureId &&
      fixture.revision === 0 &&
      fixture.pendingCheckout === null &&
      fixture.lines.length === 2 &&
      fixture.lines.find(({ itemId }) => itemId === "field-notebook")?.quantity === 1 &&
      fixture.lines.find(({ itemId }) => itemId === "stoneware-mug")?.quantity === 2;
    const selectedCase = suite.cases.find(({ caseId }) => caseId === suite.selectedCaseId);
    if (selectedCase === undefined) {
      return Object.freeze({
        buildCommit: APP_COMMIT_SAFE,
        cleanFixture: cleanFixture ? "ready" : "blocked",
        catalog: BUILD_COMMIT_READY ? "ready" : "blocked",
        answerKeyIsolation: "pending"
      });
    }

    const created = new Date();
    const createdAt = created.toISOString();
    const lineage = await expectedLineageForThurstoneSuite(suite);
    const contract = await createByoaContractV3({
      contractId: `byoa_${globalThis.crypto.randomUUID()}`,
      suite,
      buildCommit: APP_COMMIT_SAFE,
      createdAt
    });
    const session = await createCompiledByoaSessionV2({
      runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
      contract,
      lineage,
      createdAt,
      expiresAt: new Date(created.getTime() + HANDOFF_TTL_MS).toISOString()
    });
    const projectionBytes = canonicalJson(agentVisibleRunProjectionV2(session));
    const answerKeyWithheld = [
      "expectedTool",
      "argumentPredicate",
      "allowedEffects",
      "forbiddenEffects",
      "replayPolicy",
      "approvalClass",
      "suiteDigest",
      "caseDigest",
      "contractDigest"
    ].every((field) => !projectionBytes.includes(`\"${field}\"`));
    return Object.freeze({
      buildCommit: APP_COMMIT_SAFE,
      cleanFixture: cleanFixture ? "ready" : "blocked",
      catalog: BUILD_COMMIT_READY ? "ready" : "blocked",
      answerKeyIsolation: answerKeyWithheld ? "ready" : "blocked"
    });
  } catch {
    return Object.freeze({
      buildCommit: APP_COMMIT_SAFE,
      cleanFixture: "blocked",
      catalog: "blocked",
      answerKeyIsolation: "blocked"
    });
  }
}

function StageOne() {
  return (
    <div className="owner-step" data-step="understand">
      <p className="eyebrow">Stage 1 · Understand the semantic boundary</p>
      <h2 id="owner-demo-title">You are the website owner preparing a WebMCP release.</h2>
      <p>
        Your website already exposes WebMCP tools. Each tool may work correctly when called on its
        own, but an agent still has to decide which one matches what a shopper asked. Thurstone
        tests that decision and verifies what the website actually changed.
      </p>
      <h3 className="owner-boundary-heading">Two shopper prompts. Two intended outcomes.</h3>
      <p className="owner-boundary-caption">
        These sentences are examples of what a shopper might ask their own agent. Thurstone checks
        whether the agent chooses the matching WebMCP tool and whether the website produces the
        intended result.
      </p>
      <div className="owner-boundary-example">
        <article>
          <span>Shopper prompt to their agent · Review only</span>
          <strong>“Show me the complete order.”</strong>
          <dl>
            <div>
              <dt>Expected action</dt>
              <dd>
                <code>order_review</code>
              </dd>
            </div>
            <div>
              <dt>What the shopper should experience</dt>
              <dd>
                The shopper receives a complete priced order summary. Their cart and checkout state
                stay exactly as they were.
              </dd>
            </div>
          </dl>
        </article>
        <article>
          <span>Shopper prompt to their agent · Begin checkout</span>
          <strong>“Request checkout for this cart.”</strong>
          <dl>
            <div>
              <dt>Expected action</dt>
              <dd>
                <code>checkout_request</code>
              </dd>
            </div>
            <div>
              <dt>What the website should do</dt>
              <dd>
                The website prepares one simulated checkout request for the shopper to approve. No
                purchase or payment occurs.
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </div>
  );
}

export function OwnerDemoV2() {
  const [stage, setStage] = useState<OwnerStage>(1);
  const [suite, setSuite] = useState<ThurstoneContractSuiteV1>();
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [storageRejected, setStorageRejected] = useState(false);
  const [initialEditCaseId, setInitialEditCaseId] = useState<string>();
  const [initialRunMode, setInitialRunMode] = useState<"regression" | "continuous">("regression");
  const [measuredPreflight, setMeasuredPreflight] = useState<{
    readonly suiteKey: string;
    readonly value: ContractSuiteBuilderPreflight;
  }>();
  const leaseRef = useRef<
    Extract<ThurstoneSuiteTabLeaseResult, { status: "acquired" }> | undefined
  >(undefined);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    let acquired: Extract<ThurstoneSuiteTabLeaseResult, { status: "acquired" }> | undefined;

    void (async () => {
      try {
        const restored = await loadThurstoneContractSuite(window.sessionStorage);
        if (!active) return;
        if (restored.status === "rejected") {
          setStorageRejected(true);
          setError(
            `This tab's saved contract suite failed closed (${restored.reason}). Clear only this ` +
              "suite draft to recover."
          );
          return;
        }
        const candidate =
          restored.status === "restored"
            ? restored.suite
            : await createThurstoneContractSuite({
                suiteId: newThurstoneContractSuiteId(),
                name: "Checkout meaning contract",
                catalogSnapshot: createThurstoneDemoCatalogSnapshot({ selectedToolNames: [] }),
                createdAt: new Date().toISOString()
              });
        const locks = "locks" in navigator ? (navigator.locks as unknown as LockManagerLike) : null;
        const lease = await acquireThurstoneSuiteTabLease(locks, candidate.suiteId);
        if (!active) {
          if (lease.status === "acquired") lease.release();
          return;
        }
        if (lease.status !== "acquired") {
          setError(
            lease.status === "conflict"
              ? "This suite is already open in another live tab. Return to that tab or close it before continuing."
              : "This browser cannot prove tab-isolated suite ownership. Use the supported current Chrome or ChatGPT Browser surface."
          );
          return;
        }
        acquired = lease;
        leaseRef.current = lease;
        setSuite(candidate);
        if (restored.status === "empty") {
          await saveThurstoneContractSuite(window.sessionStorage, candidate);
        }
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active) setInitializing(false);
      }
    })();

    return () => {
      active = false;
      acquired?.release();
      if (leaseRef.current === acquired) leaseRef.current = undefined;
    };
  }, []);

  const referencedToolNames = useMemo(
    () => [...new Set(suite?.cases.map(({ expectedTool }) => expectedTool) ?? [])],
    [suite]
  );

  const suitePreflightKey = suite
    ? `${suite.updatedAt}:${suite.catalogDigest}:${suite.selectedCaseId ?? "none"}`
    : "unavailable";
  const preflight =
    measuredPreflight?.suiteKey === suitePreflightKey ? measuredPreflight.value : PENDING_PREFLIGHT;

  useEffect(() => {
    if (!suite) return;
    let active = true;
    const suiteKey = `${suite.updatedAt}:${suite.catalogDigest}:${suite.selectedCaseId ?? "none"}`;
    void measureOwnerPreflight(suite).then((value) => {
      if (active) setMeasuredPreflight({ suiteKey, value });
    });
    return () => {
      active = false;
    };
  }, [suite]);

  useEffect(() => {
    if (!suite || suite.catalogSnapshot.tools.length === 0) return;
    const continuation = new URLSearchParams(window.location.search).get("contract-run");
    if (
      continuation !== "continue" &&
      continuation !== "complete" &&
      continuation !== "edit" &&
      continuation !== "rerun"
    )
      return;
    const requestedCaseId = new URLSearchParams(window.location.search).get("case");
    const editCaseId =
      continuation === "edit" &&
      requestedCaseId !== null &&
      suite.cases.some(({ caseId }) => caseId === requestedCaseId)
        ? requestedCaseId
        : undefined;
    queueMicrotask(() => {
      if (editCaseId !== undefined) setInitialEditCaseId(editCaseId);
      if (continuation === "edit" || continuation === "rerun") {
        setInitialRunMode("continuous");
      }
      setStage(3);
    });
    window.history.replaceState(null, "", "/demo");
  }, [suite]);

  function enqueueSuiteSave(next: ThurstoneContractSuiteV1): Promise<void> {
    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveThurstoneContractSuite(window.sessionStorage, next))
      .then(() => undefined);
    saveQueueRef.current = queued;
    return queued;
  }

  function applySuite(next: ThurstoneContractSuiteV1) {
    setSuite(next);
    setError(undefined);
    void enqueueSuiteSave(next).catch((caught: unknown) => setError(errorMessage(caught)));
  }

  async function updateCatalog(nextCatalog: ThurstoneContractSuiteV1["catalogSnapshot"]) {
    if (!suite) throw new Error("The contract suite is not ready.");
    const next = await updateContractSuiteCatalog(suite, nextCatalog, {
      updatedAt: nextTimestamp(suite)
    });
    applySuite(next);
  }

  async function updateProcessEndingTool(
    toolName: ThurstoneContractSuiteV1["catalogSnapshot"]["tools"][number]["name"],
    processEnding: boolean
  ) {
    if (!suite) throw new Error("The contract suite is not ready.");
    applySuite(
      setContractSuiteProcessEndingTool(suite, toolName, processEnding, {
        updatedAt: nextTimestamp(suite)
      })
    );
  }

  async function prepareHandoff(selection: ContractSuiteArmSelection) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const measured = await measureOwnerPreflight(selection.suite);
      if (
        measured.cleanFixture !== "ready" ||
        measured.catalog !== "ready" ||
        measured.answerKeyIsolation !== "ready"
      ) {
        throw new Error(
          "The selected case cannot arm until fixture, catalog/build, and answer-key isolation checks are ready."
        );
      }
      const created = new Date();
      const expiresAt = new Date(created.getTime() + HANDOFF_TTL_MS).toISOString();
      const issuedSteps = [];
      const handoffCases = selection.orderedCases;
      for (const [index, testCase] of handoffCases.entries()) {
        const selectedSuite = selectContractSuiteCase(selection.suite, testCase.caseId, {
          updatedAt: new Date(created.getTime() + index + 1).toISOString()
        });
        const lineage = await expectedLineageForThurstoneSuite(selectedSuite);
        const stepCreatedAt = new Date(created.getTime() + index * 2).toISOString();
        const contract = await createByoaContractV3({
          contractId: `byoa_${globalThis.crypto.randomUUID()}`,
          suite: selectedSuite,
          buildCommit: APP_COMMIT_SAFE,
          createdAt: stepCreatedAt
        });
        const compiled = await createCompiledByoaSessionV2({
          runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
          contract,
          lineage,
          createdAt: stepCreatedAt,
          expiresAt
        });
        issuedSteps.push(
          transitionByoaSessionV2(compiled, "HANDOFF_ISSUED", {
            at: new Date(created.getTime() + index * 2 + 1).toISOString(),
            reasonCode:
              selection.mode === "continuous"
                ? "owner_issued_continuous_journey"
                : "owner_issued_regression_batch"
          })
        );
      }
      const issued = issuedSteps[0];
      if (issued === undefined) throw new Error("The contract run contains no requests.");
      const projection = agentVisibleRunProjectionV2(issued);
      await enqueueSuiteSave(selection.suite);
      writeByoaAgentSessionV2(window.sessionStorage, issued);
      writeAgentVisibleRunProjectionV2(window.sessionStorage, projection);

      const prepareBody = byoaHandoffPrepareRequestV2Schema.parse({
        version: BYOA_HANDOFF_PREPARE_V2_VERSION,
        session: issued,
        projection,
        ...(issuedSteps.length > 1
          ? {
              journey: {
                version: BYOA_CONTINUOUS_JOURNEY_VERSION,
                journeyId: `journey_${globalThis.crypto.randomUUID()}`,
                mode: selection.mode,
                processEndingToolNames:
                  selection.mode === "continuous" ? selection.suite.processEndingToolNames : [],
                steps: issuedSteps
              }
            }
          : {})
      });
      const response = await fetch("/api/demo/handoff/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff",
          "X-Thurstone-Origin": window.location.origin
        },
        body: JSON.stringify(prepareBody),
        cache: "no-store"
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          `The fresh-agent handoff could not be prepared${detail?.error ? ` (${detail.error})` : ""}.`
        );
      }
      const prepared = byoaHandoffPrepareResponseV2Schema.parse(await response.json());
      writeByoaHandoffUrl(window.sessionStorage, prepared.handoffUrl);
      window.location.replace("/demo/run#handoff-source-v2");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (initializing) {
    return (
      <section className="owner-demo owner-demo-v2" aria-busy="true">
        <p>Restoring this tab&apos;s contract workspace…</p>
      </section>
    );
  }

  if (!suite) {
    return (
      <section className="owner-demo owner-demo-v2" aria-labelledby="owner-recovery-title">
        <h2 id="owner-recovery-title">The contract workspace stopped safely.</h2>
        {error ? <p role="alert">{error}</p> : null}
        {storageRejected ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              clearThurstoneContractSuite(window.sessionStorage);
              window.location.reload();
            }}
          >
            Clear only this invalid suite draft
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="owner-demo owner-demo-v2" aria-labelledby="owner-demo-title">
      <OwnerDemoProgress
        current={stage}
        availableStages={suite.catalogSnapshot.tools.length > 0 ? [1, 2, 3] : [1, 2]}
        onNavigate={setStage}
      />
      {error && stage !== 3 ? (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="owner-workspace-layout">
        <aside className="owner-guidance-rail" aria-label="Demo guidance">
          <BrowserEntryGuide />
          <FixtureInspector />
        </aside>

        <div className="owner-workspace-main">
          {stage === 1 ? (
            <div className="owner-demo-stage">
              <StageOne />
              <div className="owner-demo-actions">
                <button className="button button-primary" type="button" onClick={() => setStage(2)}>
                  Choose the test catalog
                </button>
              </div>
            </div>
          ) : null}

          {stage === 2 ? (
            <div className="owner-demo-stage owner-demo-stage-wide">
              <ReferenceToolCatalog
                key={suite.catalogDigest}
                snapshot={suite.catalogSnapshot}
                referencedToolNames={referencedToolNames}
                processEndingToolNames={suite.processEndingToolNames}
                onChange={updateCatalog}
                onProcessEndingChange={updateProcessEndingTool}
              />
              <div className="owner-demo-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setStage(1)}
                >
                  Back
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={suite.catalogSnapshot.tools.length === 0}
                  title={
                    suite.catalogSnapshot.tools.length === 0
                      ? "Choose at least one real tool first."
                      : undefined
                  }
                  onClick={() => setStage(3)}
                >
                  Build the contract suite
                </button>
              </div>
            </div>
          ) : null}

          {stage === 3 ? (
            <div className="owner-demo-stage owner-demo-stage-wide">
              <ContractSuiteBuilder
                suite={suite}
                onChange={applySuite}
                onReviewArm={(selection) => void prepareHandoff(selection)}
                preflight={preflight}
                initialRunMode={initialRunMode}
                {...(initialEditCaseId ? { initialEditCaseId } : {})}
              />
              {error ? (
                <p className="workshop-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="owner-demo-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setStage(2)}
                >
                  Back to catalog
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
