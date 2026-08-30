import { createHash } from "node:crypto";

import { expect, test, type Download, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { canonicalize } from "json-canonicalize";

import {
  GATE1_AUTOMATED_PROOF_MIN_STEP_MS,
  GATE1_AUTOMATED_PROOF_SEQUENCE_VERSION,
  GATE1_AUTOMATED_PROOF_STEP_NAMES,
  verifyGate1ProofBundle,
  verifyGate1NativeProofSequence,
  type Gate1ProofBundle
} from "../../lib/evidence/gate1-proof-bundle";
import {
  INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  INVOCATION_INTEGRITY_AMENDMENT_PATH,
  INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
  INVOCATION_INTEGRITY_CASES,
  INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION,
  INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
  INVOCATION_INTEGRITY_FROZEN_CALLS,
  INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
  INVOCATION_INTEGRITY_RECEIPT_VERSION,
  INVOCATION_INTEGRITY_STATE_KEYSETS,
  verifyInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityReceipt,
  type InvocationIntegrityFailureInput,
  type InvocationIntegrityFailureReceipt,
  type InvocationIntegrityReceipt,
  type InvocationIntegrityStateEvidence,
  type InvocationIntegrityTranscript
} from "../../lib/invocation-integrity/contract";

const pageErrors = new WeakMap<Page, string[]>();
const hydrationWarnings = new WeakMap<Page, string[]>();
const INVOCATION_INTEGRITY_BROWSER_COMMIT = "e".repeat(40);
const INVOCATION_INTEGRITY_RUN_LOCK_VERSION = "thurstone-invocation-integrity-run-lock@1";
const INVOCATION_INTEGRITY_RUN_LOCK_KEY = `${INVOCATION_INTEGRITY_RUN_LOCK_VERSION}:${INVOCATION_INTEGRITY_BROWSER_COMMIT}`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emulatedStateEvidence(value: Record<string, unknown>): InvocationIntegrityStateEvidence {
  const pendingCheckout = value.pendingCheckout as Record<string, unknown> | null;
  return {
    value: value as unknown as InvocationIntegrityStateEvidence["value"],
    sha256: sha256(canonicalize(value)),
    keysets: {
      root: INVOCATION_INTEGRITY_STATE_KEYSETS.root,
      line: INVOCATION_INTEGRITY_STATE_KEYSETS.line,
      fulfillment: INVOCATION_INTEGRITY_STATE_KEYSETS.fulfillment,
      pendingCheckout: pendingCheckout ? INVOCATION_INTEGRITY_STATE_KEYSETS.pendingCheckout : []
    }
  };
}

async function emulatedInvocationIntegrityReceipt(
  transcript: InvocationIntegrityTranscript
): Promise<InvocationIntegrityReceipt> {
  const timestamp = "2026-08-29T15:00:00.000Z";
  const firstMeasuredCall = transcript.calls[0];
  const lastMeasuredCall = transcript.calls.at(-1);
  if (!firstMeasuredCall || !lastMeasuredCall) {
    throw new Error("emulated_invocation_integrity_transcript_empty");
  }
  const initialTrustedState = firstMeasuredCall.trace.stateBefore.value;
  const finalTrustedState = lastMeasuredCall.trace.stateAfter.value;
  const frozenState = (reference: "initial" | "final") =>
    reference === "initial" ? initialTrustedState : finalTrustedState;
  const frozenStateSha256 = (reference: "initial" | "final") =>
    reference === "initial"
      ? INVOCATION_INTEGRITY_INITIAL_STATE_SHA256
      : INVOCATION_INTEGRITY_FINAL_STATE_SHA256;
  const rows = await Promise.all(
    INVOCATION_INTEGRITY_CASES.map(async (contractCase) => {
      const calls = transcript.calls.filter(({ caseId }) => caseId === contractCase.caseId);
      const first = calls[0];
      const last = calls.at(-1);
      if (!first || !last || calls.length !== contractCase.invocations.length) {
        throw new Error("emulated_invocation_integrity_call_cardinality_mismatch");
      }
      const stateBefore = first.trace.stateBefore.value as Record<string, unknown>;
      const stateAfter = last.trace.stateAfter.value as Record<string, unknown>;
      const rowCore = {
        caseId: contractCase.caseId,
        title: contractCase.title,
        toolName: contractCase.toolName,
        exactInvocations: contractCase.invocations,
        expectedOutcome: contractCase.expectedResults,
        actualOutcome: calls.map(({ receipt }) => receipt.canonicalResult),
        trustedStateBefore: emulatedStateEvidence(stateBefore),
        trustedStateAfter: emulatedStateEvidence(stateAfter),
        domainOperationLedgerDiff: {
          before: contractCase.preconditions.operationLedgerCount,
          after: contractCase.postconditions.operationLedgerCount,
          delta:
            contractCase.postconditions.operationLedgerCount -
            contractCase.preconditions.operationLedgerCount
        },
        tombstoneDiff: {
          before: contractCase.preconditions.tombstoneCount,
          after: contractCase.postconditions.tombstoneCount,
          delta:
            contractCase.postconditions.tombstoneCount - contractCase.preconditions.tombstoneCount
        },
        auditTraceDiff: {
          before: contractCase.preconditions.auditTraceCount,
          after: contractCase.postconditions.auditTraceCount,
          delta:
            contractCase.postconditions.auditTraceCount - contractCase.preconditions.auditTraceCount
        },
        subscriberCommitCount: contractCase.postconditions.subscriberCommitCount,
        assertions: [
          "source_fixed_invocation",
          "native_webmcp_trace_binding",
          "exact_expected_outcome",
          "trusted_state_keysets",
          "trusted_state_hashes",
          "domain_operation_ledger_diff",
          "audit_trace_diff",
          "subscriber_commit_count",
          "no_unmodeled_state",
          ...(contractCase.caseId === "II-03" ? ["one_commit_then_replay_no_op"] : [])
        ].map((assertionId) => ({ assertionId, passed: true as const })),
        browserObservationDigests: calls.map((call) => sha256(canonicalize(call))),
        trustedObservationDigests: INVOCATION_INTEGRITY_FROZEN_CALLS.filter(
          ({ caseId }) => caseId === contractCase.caseId
        ).map((frozen) =>
          sha256(
            canonicalize({
              caseId: frozen.caseId,
              callIndex: frozen.callIndex,
              toolName: frozen.toolName,
              input: frozen.payload,
              result: frozen.result,
              trace: {
                outcome: frozen.trace.status,
                commitDisposition: frozen.trace.commitDisposition,
                effectApplied: frozen.trace.effectApplied,
                operationId: frozen.trace.operationId,
                rawInput: frozen.payload,
                canonicalInput: frozen.trace.canonicalInput,
                canonicalCommand: frozen.trace.canonicalCommand,
                stateBefore: frozenState(frozen.before.state),
                stateAfter: frozenState(frozen.after.state)
              },
              before: {
                state: frozenState(frozen.before.state),
                stateSha256: frozenStateSha256(frozen.before.state),
                operationLedgerCount: frozen.before.operationLedgerCount,
                tombstoneCount: frozen.before.tombstoneCount,
                auditTraceCount: frozen.before.auditTraceCount,
                subscriberCommitCount: frozen.before.subscriberCommitCount
              },
              after: {
                state: frozenState(frozen.after.state),
                stateSha256: frozenStateSha256(frozen.after.state),
                operationLedgerCount: frozen.after.operationLedgerCount,
                tombstoneCount: frozen.after.tombstoneCount,
                auditTraceCount: frozen.after.auditTraceCount,
                subscriberCommitCount: frozen.after.subscriberCommitCount
              }
            })
          )
        ),
        buildSha: transcript.runtime.appCommit,
        timestamp: last.trace.observedAt,
        passed: true as const
      };
      return { ...rowCore, rowDigest: sha256(canonicalize(rowCore)) };
    })
  );
  const receiptCore = {
    receiptVersion: INVOCATION_INTEGRITY_RECEIPT_VERSION,
    status: "verified" as const,
    amendment: {
      path: INVOCATION_INTEGRITY_AMENDMENT_PATH,
      commit: INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
      sha256: INVOCATION_INTEGRITY_AMENDMENT_SHA256
    },
    buildSha: transcript.runtime.appCommit,
    initialManifestHash: transcript.runtime.initialManifestHash,
    pendingManifestHash: transcript.runtime.pendingManifestHash,
    trustedStateSource: "source-fixed-server-replay" as const,
    browserEvidenceBoundary: INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
    measuredTranscript: transcript,
    measuredTranscriptDigest: sha256(canonicalize(transcript)),
    modelCallCount: 0 as const,
    includedInSemanticDenominator: false as const,
    rows,
    score: { earned: 3 as const, possible: 3 as const, label: "3/3" as const },
    finalStateSha256: INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
    completedAt: timestamp
  };
  return verifyInvocationIntegrityReceipt({
    ...receiptCore,
    receiptDigest: sha256(canonicalize(receiptCore))
  });
}

async function installEmulatedInvocationIntegrityVerifier(page: Page): Promise<void> {
  await page.route("**/api/invocation-integrity/verify", async (route) => {
    const transcript = JSON.parse(
      route.request().postData() ?? "null"
    ) as InvocationIntegrityTranscript;
    const receipt = await emulatedInvocationIntegrityReceipt(transcript);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(receipt)
    });
  });
  await page.route("**/api/invocation-integrity/failure", async (route) => {
    const input = JSON.parse(
      route.request().postData() ?? "null"
    ) as InvocationIntegrityFailureInput;
    const earned =
      input.completedCalls.length === 0 ? 0 : input.completedCalls.length === 1 ? 1 : 2;
    const receiptCore = {
      receiptVersion: INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION,
      status: "failed" as const,
      buildSha: input.runtime.appCommit,
      origin: input.runtime.origin,
      browserEvidenceBoundary: INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
      runtime: input.runtime,
      preflight: input.preflight,
      preflightDigest: sha256(canonicalize(input.preflight)),
      completedCalls: input.completedCalls,
      completedCallsDigest: sha256(canonicalize(input.completedCalls)),
      error: input.error,
      terminalInspection: input.terminalInspection,
      terminalInspectionDigest: sha256(canonicalize(input.terminalInspection)),
      score: {
        earned: earned as 0 | 1 | 2,
        possible: 3 as const,
        label: `${earned}/3` as "0/3" | "1/3" | "2/3"
      },
      claimPosition: "forbidden" as const,
      claimAllowed: false as const,
      modelCallCount: 0 as const,
      includedInSemanticDenominator: false as const,
      failedAt: input.failedAt
    };
    const receipt: InvocationIntegrityFailureReceipt =
      await verifyInvocationIntegrityFailureReceipt({
        ...receiptCore,
        receiptDigest: sha256(canonicalize(receiptCore))
      });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(receipt)
    });
  });
}

async function executeExternalNativeCall(
  page: Page,
  toolName: string,
  input: Readonly<Record<string, unknown>>
): Promise<void> {
  await page.evaluate(
    async ({ toolName, input }) => {
      const context = document.modelContext as WebMCP.ModelContext & {
        getTools(): Promise<WebMCP.RegisteredTool[]>;
        executeTool(tool: WebMCP.RegisteredTool, input: object | string): Promise<string | null>;
      };
      const tools = await context.getTools();
      const tool = tools.find(({ name }) => name === toolName);
      if (!tool) throw new Error(`Missing external contamination tool: ${toolName}`);
      await context.executeTool(tool, input);
    },
    { toolName, input }
  );
}

function createJudgeProjection(
  manifestHash: string,
  decision: Readonly<Record<string, unknown>> = {
    kind: "call",
    tool: "cart_get",
    arguments: {}
  }
) {
  const core = {
    version: "toolproof-judge-demo-public-receipt@1.0.0",
    lane: "signed-out-fixed-read-only-judge-demo",
    evidenceClass: "non-scored-model-selection",
    sourceFixed: true,
    arbitraryPromptAccepted: false,
    globalProviderCall: 1,
    nativeExecutionIncluded: false,
    replayPolicy: "archived-decision-may-be-executed-locally-without-model-call",
    appCommit: "e".repeat(40),
    evidenceAppCommit: "e".repeat(40),
    caseId: "judge_multi_quantity_lines_v1",
    naturalLanguageRequest: "Which current cart lines have a quantity greater than one?",
    fixtureHash: "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457",
    manifestHash,
    evidenceManifestHash: manifestHash,
    envelopeHash: "1".repeat(64),
    runnerHash: "2".repeat(64),
    provider: "OpenAI",
    model: "gpt-5.6-terra",
    providerResponseHash: "3".repeat(64),
    requestBodyHash: "4".repeat(64),
    usageHash: "5".repeat(64),
    usage: {
      inputTokens: 800,
      outputTokens: 40,
      totalTokens: 840,
      accountedNanoUsd: 3_000_000,
      costBasis: "frozen-list-price-plus-10pct-uplift"
    },
    decision,
    decisionError: null,
    responseStatus: "completed",
    capturedAt: "2026-08-29T12:00:00.000Z",
    presentationBinding: null
  } as const;
  return { ...core, receiptDigest: sha256(canonicalize(core)) };
}

function resealDownloadedBundle(bundle: Gate1ProofBundle): void {
  const mutable = bundle as unknown as {
    evidenceDigest: string;
    bundleDigest: string;
    evidence: {
      journal: {
        headHash: string | null;
        events: Array<{
          eventHash: string;
          previousEventHash: string | null;
          [key: string]: unknown;
        }>;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  let previousEventHash: string | null = null;
  for (const event of mutable.evidence.journal.events) {
    event.previousEventHash = previousEventHash;
    const content = Object.fromEntries(
      Object.entries(event).filter(([key]) => key !== "eventHash")
    );
    event.eventHash = sha256(`toolproof-gate1-journal-event@1\n${canonicalize(content)}`);
    previousEventHash = event.eventHash;
  }
  mutable.evidence.journal.headHash = previousEventHash;
  mutable.evidenceDigest = sha256(`toolproof-gate1-evidence@1\n${canonicalize(mutable.evidence)}`);
  const unsigned = Object.fromEntries(
    Object.entries(mutable).filter(([key]) => key !== "bundleDigest")
  );
  mutable.bundleDigest = sha256(`toolproof-gate1-bundle@1\n${canonicalize(unsigned)}`);
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  let value = "";
  for await (const chunk of stream) value += chunk.toString();
  return value;
}

async function overflowingElements(page: Page): Promise<readonly unknown[]> {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: (element.textContent ?? "").trim().slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth
        };
      });
  });
}

async function installEmulatedConsumer(page: Page, mode: "object" | "json-string"): Promise<void> {
  await page.addInitScript(
    ({ mode }) => {
      const observations: Array<{
        readonly toolName: string;
        readonly bodyText: string;
        readonly handlerSettled: boolean;
        readonly inputType: string;
        readonly invocationIntegrityRunLockState: string | null;
      }> = [];
      const failToolName = sessionStorage.getItem("__toolProofTestFailAutomatedTool");
      sessionStorage.removeItem("__toolProofTestFailAutomatedTool");
      const nativeBehavior = {
        completeCanceledCartGetBeforeReject: false,
        failToolName,
        failureConsumed: false
      };
      const invocationIntegrityRunLockState = (): string | null => {
        const key = Object.keys(localStorage).find((candidate) =>
          candidate.startsWith("thurstone-invocation-integrity-run-lock@1:")
        );
        if (!key) return null;
        try {
          const marker = JSON.parse(localStorage.getItem(key) ?? "null") as {
            readonly state?: unknown;
          } | null;
          return typeof marker?.state === "string" ? marker.state : "invalid";
        } catch {
          return "invalid";
        }
      };
      let delayNextDigest = false;
      let releaseDigest: (() => void) | undefined;
      const subtle = globalThis.crypto?.subtle;
      if (subtle) {
        const nativeDigest = subtle.digest.bind(subtle);
        Object.defineProperty(subtle, "digest", {
          configurable: true,
          value: async (
            algorithm: AlgorithmIdentifier,
            data: BufferSource
          ): Promise<ArrayBuffer> => {
            const result = await nativeDigest(algorithm, data);
            const bytes =
              data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            if (delayNextDigest && new TextDecoder().decode(bytes).includes("native_update_0001")) {
              delayNextDigest = false;
              await new Promise<void>((resolve) => {
                releaseDigest = resolve;
              });
            }
            return result;
          }
        });
      }
      Object.defineProperty(window, "__toolProofNativeObservations", {
        value: observations,
        configurable: false,
        enumerable: false,
        writable: false
      });
      Object.defineProperty(window, "__toolProofNativeBehavior", {
        value: nativeBehavior,
        configurable: false,
        enumerable: false,
        writable: false
      });

      class EmulatedModelContext extends EventTarget {
        readonly active = new Map<
          string,
          { readonly tool: WebMCP.ModelContextTool; readonly signal?: AbortSignal }
        >();
        ontoolchange: ((this: WebMCP.ModelContext, event: Event) => unknown) | null = null;

        async registerTool(
          tool: WebMCP.ModelContextTool,
          options?: WebMCP.ModelContextRegisterToolOptions
        ): Promise<void> {
          if (this.active.has(tool.name)) throw new Error(`Duplicate emulated tool: ${tool.name}`);
          this.active.set(tool.name, {
            tool,
            ...(options?.signal ? { signal: options.signal } : {})
          });
          options?.signal?.addEventListener(
            "abort",
            () => {
              if (this.active.get(tool.name)?.signal === options.signal) {
                this.active.delete(tool.name);
                this.dispatchEvent(new Event("toolchange"));
              }
            },
            { once: true }
          );
          this.dispatchEvent(new Event("toolchange"));
        }

        async getTools(): Promise<WebMCP.RegisteredTool[]> {
          return [...this.active.values()].map(({ tool }) => ({
            name: tool.name,
            title: tool.title ?? tool.name,
            description: tool.description,
            ...(tool.inputSchema
              ? {
                  inputSchema:
                    mode === "json-string"
                      ? (JSON.stringify(tool.inputSchema) as unknown as object)
                      : structuredClone(tool.inputSchema)
                }
              : {}),
            window,
            origin: window.location.origin,
            ...(tool.annotations ? { annotations: structuredClone(tool.annotations) } : {})
          }));
        }

        async executeTool(
          selected: WebMCP.RegisteredTool,
          input: object | string,
          options?: { readonly signal?: AbortSignal }
        ): Promise<string | null> {
          const activeRegistration = this.active.get(selected.name);
          const active = activeRegistration?.tool;
          if (!active) throw new Error(`Emulated tool is not active: ${selected.name}`);
          if (nativeBehavior.failToolName === selected.name && !nativeBehavior.failureConsumed) {
            nativeBehavior.failureConsumed = true;
            throw new Error(`Synthetic automated failure for ${selected.name}.`);
          }
          const inputType = typeof input;
          const semanticInput =
            mode === "json-string"
              ? (JSON.parse(String(input)) as Record<string, unknown>)
              : typeof input === "string"
                ? (() => {
                    throw new Error("This harness emulates object argument mode.");
                  })()
                : (input as Record<string, unknown>);
          const proveVisibleBeforeSettlement =
            selected.name === "cart_update" && semanticInput.operationId === "native_update_0001";
          const completeCanceledCartGetBeforeReject =
            selected.name === "cart_get" &&
            options?.signal !== undefined &&
            nativeBehavior.completeCanceledCartGetBeforeReject;
          if (proveVisibleBeforeSettlement) {
            delayNextDigest = true;
            releaseDigest = undefined;
          }
          let handlerSettled = false;
          const handler = Promise.resolve(
            completeCanceledCartGetBeforeReject
              ? Reflect.apply(active.execute, active, [semanticInput])
              : mode === "json-string"
                ? Reflect.apply(
                    active.execute,
                    active,
                    options?.signal ? [semanticInput, { signal: options.signal }] : [semanticInput]
                  )
                : active.execute(
                    semanticInput,
                    options?.signal
                      ? { signal: options.signal }
                      : { signal: new AbortController().signal }
                  )
          ).finally(() => {
            handlerSettled = true;
          });
          if (proveVisibleBeforeSettlement) {
            for (let attempt = 0; attempt < 60; attempt += 1) {
              if (
                (document.body.textContent ?? "").includes("checkout-seed-v1 · r1") &&
                releaseDigest
              ) {
                break;
              }
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }
            observations.push({
              toolName: selected.name,
              bodyText: document.body.textContent ?? "",
              handlerSettled,
              inputType,
              invocationIntegrityRunLockState: invocationIntegrityRunLockState()
            });
            releaseDigest?.();
          }
          const result = await handler;
          if (!proveVisibleBeforeSettlement) {
            observations.push({
              toolName: selected.name,
              bodyText: document.body.textContent ?? "",
              handlerSettled,
              inputType,
              invocationIntegrityRunLockState: invocationIntegrityRunLockState()
            });
          }
          if (completeCanceledCartGetBeforeReject && options.signal?.aborted) {
            throw options.signal.reason ?? new DOMException("Canceled", "AbortError");
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
          if (activeRegistration.signal?.aborted) {
            throw new Error("The selected registration retired before consumer result delivery.");
          }
          return JSON.stringify(result);
        }
      }

      Object.defineProperty(document, "modelContext", {
        value: new EmulatedModelContext(),
        configurable: false,
        enumerable: false,
        writable: false
      });
    },
    { mode }
  );
}

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  pageErrors.set(page, errors);
  hydrationWarnings.set(page, warnings);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      (message.type() === "warning" || message.type() === "error") &&
      /hydration|hydrated|did not match/iu.test(message.text())
    ) {
      warnings.push(message.text());
    }
  });
  const mode = testInfo.title.includes("JSON-string") ? "json-string" : "object";
  await installEmulatedConsumer(page, mode);
  await page.goto("/lab");
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await expect(page.getByText(`Argument mode: ${mode}`, { exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
  expect(hydrationWarnings.get(page)).toEqual([]);
});

test("normal UI shares deterministic state, pending policy, and verified reset", async ({
  page
}) => {
  await page.getByRole("button", { name: "Review order in UI" }).click();
  await expect(page.locator(".receipt-line pre")).toContainText('"totalCents": 7300');

  const mug = page.getByRole("listitem").filter({ hasText: "Stoneware mug" });
  await mug.getByLabel("Stoneware mug quantity").fill("3");
  await mug.getByRole("button", { name: "Set" }).click();
  await expect(page.getByText("checkout-seed-v1 · r1", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/u);
  await page.goBack();
  await expect(page).toHaveURL(/\/lab$/u);
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();
  await expect(mug.getByText("Current × 2", { exact: true })).toBeVisible();
  await expect(mug.getByLabel("Stoneware mug quantity")).toHaveValue("2");

  await page.getByRole("button", { name: "Request simulated checkout" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeVisible();
  await expect(page.locator(".runtime-receipt").first()).toContainText("checkout_cancel");

  await page.getByRole("button", { name: "Cancel simulated checkout" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeHidden();
  await expect(page.locator(".runtime-receipt").first()).not.toContainText("checkout_cancel");

  await page.getByRole("button", { name: "Hard reset fixture" }).click();
  const resetArticle = page.locator("article").filter({ hasText: "Reset verification receipt" });
  await expect(resetArticle).toContainText('"status": "verified"');
  await expect(resetArticle).toContainText('"currentTrajectoryCount": 0');
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/u);
  await page.goBack();
  await expect(page).toHaveURL(/\/lab$/u);
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await expect(page.locator(".runtime-receipt").first()).toContainText("cart_get");

  await page.reload();
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
});

test("cross-surface navigation destroys Lab state and opens a clean document", async ({ page }) => {
  const mug = page.getByRole("listitem").filter({ hasText: "Stoneware mug" });
  const quantityEditor = mug.getByLabel("Stoneware mug quantity");

  await quantityEditor.fill("3");
  await mug.getByRole("button", { name: "Set" }).click();
  await expect(page.getByText("checkout-seed-v1 · r1", { exact: true })).toBeVisible();
  await expect(quantityEditor).toHaveValue("3");

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/u);
  await expect(quantityEditor).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const owner = window as typeof window & {
          __toolProofLabEnvironment?: {
            readonly store: {
              getSnapshot(): {
                readonly state: {
                  readonly lines: readonly {
                    readonly itemId: string;
                    readonly quantity: number;
                  }[];
                };
              };
            };
          };
        };
        return owner.__toolProofLabEnvironment?.store
          .getSnapshot()
          .state.lines.find(({ itemId }) => itemId === "stoneware-mug")?.quantity;
      })
    )
    .toBeUndefined();

  await page.getByRole("link", { name: "Lab", exact: true }).click();
  await expect(page).toHaveURL(/\/lab$/u);
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await expect(mug.getByText("Current × 2", { exact: true })).toBeVisible();
  await expect(quantityEditor).toHaveValue("2");
});

test("emulated consumer exercises the exact native boundary and observes state before resolution", async ({
  page
}) => {
  await page.getByRole("button", { name: "Native cart_get", exact: true }).click();
  await page.getByRole("button", { name: "Native order_review" }).click();
  await page.getByLabel("cart_update operationId").fill("short");
  await page.getByRole("button", { name: "Native cart_update" }).click();
  const nativeReceipt = page.locator("article").filter({ hasText: "Native adapter receipt" });
  await expect(nativeReceipt).toContainText('"code": "invalid_operation_id"');
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();

  await page.getByLabel("cart_update operationId").fill("native_update_0001");
  await page.getByRole("button", { name: "Native cart_update" }).click();

  await expect(nativeReceipt).toContainText('"toolName": "cart_update"');
  await expect(page.getByText("checkout-seed-v1 · r1", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const records = (
          window as typeof window & {
            __toolProofNativeObservations: Array<{
              readonly toolName: string;
              readonly bodyText: string;
              readonly handlerSettled: boolean;
              readonly inputType: string;
            }>;
          }
        ).__toolProofNativeObservations;
        return records.filter(({ toolName }) => toolName === "cart_update").at(-1) ?? null;
      })
    )
    .toMatchObject({
      bodyText: expect.stringContaining("checkout-seed-v1 · r1"),
      handlerSettled: false
    });

  await page.getByRole("button", { name: "Replay last native mutation" }).click();
  await expect(nativeReceipt).toContainText('"replayed": true');
  await expect(page.getByText("checkout-seed-v1 · r1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeVisible();
  await expect(page.locator(".runtime-receipt").first()).toContainText("checkout_cancel");

  await page.getByLabel("checkout_request operationId").fill("native_request_002");
  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(nativeReceipt).toContainText('"code": "already_pending"');
  await expect(page.getByText("checkout-seed-v1 · r2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Native checkout_cancel" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeHidden();
  await expect(page.getByText("checkout-seed-v1 · r3", { exact: true })).toBeVisible();
  await expect(nativeReceipt).toContainText('"toolName": "checkout_cancel"');

  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeVisible();
  await expect(page.getByText("checkout-seed-v1 · r4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hard reset fixture" }).click();
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(page.getByText("checkout-seed-v1 · r1", { exact: true })).toBeVisible();
  await expect(nativeReceipt).toContainText('"replayed": false');
});

test("JSON-string emulated consumer serializes once and supports omitted handler context", async ({
  page
}) => {
  await page.getByRole("button", { name: "Native cart_get", exact: true }).click();
  await page.getByRole("button", { name: "Native order_review" }).click();

  const nativeReceipt = page.locator("article").filter({ hasText: "Native adapter receipt" });
  await expect(nativeReceipt).toContainText('"argumentMode": "json-string"');
  await expect(nativeReceipt).toContainText('"toolName": "order_review"');
  const wireTypes = await page.evaluate(() =>
    (
      window as typeof window & {
        __toolProofNativeObservations: Array<{
          readonly toolName: string;
          readonly inputType: string;
        }>;
      }
    ).__toolProofNativeObservations.map(({ toolName, inputType }) => ({ toolName, inputType }))
  );
  expect(wireTypes.filter(({ toolName }) => toolName === "cart_get").at(-1)).toEqual({
    toolName: "cart_get",
    inputType: "string"
  });
  expect(wireTypes.filter(({ toolName }) => toolName === "order_review").at(-1)).toEqual({
    toolName: "order_review",
    inputType: "string"
  });

  await page.getByRole("button", { name: "Native cart_get cancellation probe" }).click();
  await expect(nativeReceipt).toContainText('"code": "execution_canceled"');
  await expect(nativeReceipt).toContainText('"nativeCallMade": true');
  const traceText = await page
    .locator("article")
    .filter({ hasText: "Latest native handler trace" })
    .locator("pre")
    .textContent();
  const canceledTrace = JSON.parse(traceText ?? "null") as {
    status: string;
    stateBefore: { sha256: string };
    stateAfter: { sha256: string };
    effect: { stateChanged: boolean };
  };
  expect(canceledTrace.status).toBe("canceled");
  expect(canceledTrace.stateAfter.sha256).toBe(canceledTrace.stateBefore.sha256);
  expect(canceledTrace.effect.stateChanged).toBe(false);
});

test("fixed judge lane accepts no prompt and binds the sealed decision to native cart_get", async ({
  page
}) => {
  const manifestHash = await page.evaluate(() =>
    (
      window as typeof window & {
        __toolProofLabEnvironment: { readonly binding: { getRegistryHash(): string } };
      }
    ).__toolProofLabEnvironment.binding.getRegistryHash()
  );
  const projection = createJudgeProjection(manifestHash);
  const postedBodies: unknown[] = [];
  let sealed = false;
  await page.route("**/api/judge-demo**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      postedBodies.push(request.postDataJSON());
      const wasSealed = sealed;
      sealed = true;
      await route.fulfill({
        status: wasSealed ? 200 : 201,
        contentType: "application/json",
        body: JSON.stringify({
          version: "toolproof-judge-demo-api@1.0.0",
          lane: "signed-out-fixed-read-only-judge-demo",
          status: wasSealed ? "archived" : "fresh",
          inferencePerformed: !wasSealed,
          projection
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-judge-demo-api@1.0.0",
        lane: "signed-out-fixed-read-only-judge-demo",
        status: sealed ? "sealed" : "available",
        sourceFixed: true,
        arbitraryPromptAccepted: false,
        remainingModelCalls: sealed ? 0 : 1,
        inferencePerformed: false,
        reason: sealed ? "The decision is sealed." : "One decision remains.",
        projection: sealed ? projection : null
      })
    });
  });

  await page.getByRole("button", { name: "Refresh judge status" }).click();
  await expect(page.getByText("available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run bounded model decision + native cart_get" }).click();
  const proof = page.locator("article").filter({ hasText: "Current browser judge proof" });
  await expect(proof).toContainText('"evidenceClass": "non-scored-judge-path"');
  await expect(proof).toContainText('"toolName": "cart_get"');
  await expect(proof).toContainText('"readinessStatus": "consumer-ready"');
  await expect(proof).toContainText('"haltFree": true');
  const modelEvidence = page
    .locator("article")
    .filter({ hasText: "Sealed model-selection evidence" });
  await expect(modelEvidence).toContainText('"inferencePerformedByThisRequest": true');
  expect(postedBodies).toEqual([{ intent: "run-fixed-read-only-judge-demo" }]);
  expect(JSON.stringify(postedBodies)).not.toContain("items and quantities");
  await expect(page.getByText("sealed", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Replay sealed decision through native cart_get" })
    .click();
  await expect(modelEvidence).toContainText('"inferencePerformedByThisRequest": false');
  expect(postedBodies).toEqual([
    { intent: "run-fixed-read-only-judge-demo" },
    { intent: "run-fixed-read-only-judge-demo" }
  ]);
});

test("judge lane preserves a sealed no-call outcome without fabricating native proof", async ({
  page
}) => {
  const manifestHash = await page.evaluate(() =>
    (
      window as typeof window & {
        __toolProofLabEnvironment: { readonly binding: { getRegistryHash(): string } };
      }
    ).__toolProofLabEnvironment.binding.getRegistryHash()
  );
  const projection = createJudgeProjection(manifestHash, {
    kind: "abstain",
    reason: "I will not select a tool."
  });
  let sealed = false;
  await page.route("**/api/judge-demo**", async (route) => {
    if (route.request().method() === "POST") {
      sealed = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          version: "toolproof-judge-demo-api@1.0.0",
          lane: "signed-out-fixed-read-only-judge-demo",
          status: "fresh",
          inferencePerformed: true,
          projection
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-judge-demo-api@1.0.0",
        lane: "signed-out-fixed-read-only-judge-demo",
        status: sealed ? "sealed" : "available",
        sourceFixed: true,
        arbitraryPromptAccepted: false,
        remainingModelCalls: sealed ? 0 : 1,
        inferencePerformed: false,
        reason: sealed ? "The decision is sealed." : "One decision remains.",
        projection: sealed ? projection : null
      })
    });
  });
  const nativeCountBefore = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __toolProofNativeObservations: readonly { readonly toolName: string }[];
        }
      ).__toolProofNativeObservations.length
  );

  await page.getByRole("button", { name: "Refresh judge status" }).click();
  await page.getByRole("button", { name: "Run bounded model decision + native cart_get" }).click();
  const modelEvidence = page
    .locator("article")
    .filter({ hasText: "Sealed model-selection evidence" });
  await expect(modelEvidence).toContainText('"kind": "abstain"');
  await expect(modelEvidence).toContainText('"inferencePerformedByThisRequest": true');
  await expect(
    page.locator("article").filter({ hasText: "Current browser judge proof" })
  ).toHaveCount(0);
  await expect(page.locator(".error-text[role='alert']")).toHaveCount(0);
  await expect(page.getByText(/will not fabricate or repeatedly retry/iu)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sealed model decision has no native replay" })
  ).toBeDisabled();
  const nativeCountAfter = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __toolProofNativeObservations: readonly { readonly toolName: string }[];
        }
      ).__toolProofNativeObservations.length
  );
  expect(nativeCountAfter).toBe(nativeCountBefore);
  await expect(page.getByText("sealed", { exact: true })).toBeVisible();
});

test("halted revision-zero Lab cannot consume the one judge allocation", async ({ page }) => {
  let postCount = 0;
  await page.route("**/api/judge-demo**", async (route) => {
    if (route.request().method() === "POST") postCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-judge-demo-api@1.0.0",
        lane: "signed-out-fixed-read-only-judge-demo",
        status: "available",
        sourceFixed: true,
        arbitraryPromptAccepted: false,
        remainingModelCalls: 1,
        inferencePerformed: false,
        reason: "One decision remains.",
        projection: null
      })
    });
  });
  const snapshot = await page.evaluate(async () => {
    const store = (
      window as typeof window & {
        __toolProofLabEnvironment: {
          readonly store: {
            subscribe(listener: () => void): () => void;
            cartUpdate(input: Record<string, unknown>): Promise<unknown>;
            hardReset(): Promise<unknown>;
            getSnapshot(): {
              readonly state: { readonly revision: number };
              readonly haltedReason: { readonly code: string } | null;
            };
          };
        };
      }
    ).__toolProofLabEnvironment.store;
    store.subscribe(() => {
      throw new Error("synthetic halted-r0 view failure");
    });
    await store.cartUpdate({
      operationId: "halted_revision_zero_0001",
      operation: "set_quantity",
      itemId: "stoneware-mug",
      quantity: 3
    });
    await store.hardReset();
    return store.getSnapshot();
  });
  expect(snapshot).toMatchObject({
    state: { revision: 0 },
    haltedReason: { code: "subscriber_failure" }
  });
  await expect(page.getByText(/Session halted after subscriber_failure/iu)).toBeVisible();
  await page.getByRole("button", { name: "Refresh judge status" }).click();
  const runButton = page.getByRole("button", {
    name: "Run bounded model decision + native cart_get"
  });
  await expect(runButton).toBeDisabled();
  await runButton.click({ force: true });
  expect(postCount).toBe(0);
});

test("JSON-string one download preserves the complete Gate 1 journal and trace history", async ({
  page
}) => {
  const nativeReceipt = page.locator("article").filter({ hasText: "Native adapter receipt" });

  await page.getByRole("button", { name: "Native cart_get", exact: true }).click();
  await expect(nativeReceipt).toContainText('"toolName": "cart_get"');
  await page.getByRole("button", { name: "Native order_review" }).click();
  await expect(nativeReceipt).toContainText('"toolName": "order_review"');

  await page.getByLabel("cart_update operationId").fill("short");
  await page.getByRole("button", { name: "Native cart_update" }).click();
  await expect(nativeReceipt).toContainText('"code": "invalid_operation_id"');
  await page.getByLabel("cart_update operationId").fill("bundle_update_0001");
  await page.getByRole("button", { name: "Native cart_update" }).click();
  await expect(nativeReceipt).toContainText('"replayed": false');
  await page.getByRole("button", { name: "Replay last native mutation" }).click();
  await expect(nativeReceipt).toContainText('"replayed": true');

  await page.getByRole("button", { name: "Hard reset fixture" }).click();
  const resetArticle = page.locator("article").filter({ hasText: "Reset verification receipt" });
  await expect(resetArticle).toContainText('"status": "verified"');

  await page.getByLabel("checkout_request operationId").fill("bundle_request_0001");
  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeVisible();
  await expect(page.locator(".runtime-receipt").first()).toContainText("checkout_cancel");
  await page.getByRole("button", { name: "Replay last native mutation" }).click();
  await expect(nativeReceipt).toContainText('"replayed": true');
  await page.getByLabel("checkout_request operationId").fill("bundle_request_0002");
  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(nativeReceipt).toContainText('"code": "already_pending"');

  await page.getByLabel("checkout_cancel operationId").fill("bundle_cancel_0001");
  await page.getByRole("button", { name: "Native checkout_cancel" }).click();
  await expect(nativeReceipt).toContainText('"toolName": "checkout_cancel"');
  await expect(nativeReceipt).toContainText('"code": "checkout_canceled"');
  await expect(nativeReceipt).toContainText('"nativeCallCount": 1');
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeHidden();
  await page.evaluate(() => {
    (
      window as typeof window & {
        __toolProofNativeBehavior: { completeCanceledCartGetBeforeReject: boolean };
      }
    ).__toolProofNativeBehavior.completeCanceledCartGetBeforeReject = true;
  });
  await page.getByRole("button", { name: "Native cart_get cancellation probe" }).click();
  await expect(nativeReceipt).toContainText('"code": "execution_canceled"');
  await expect(nativeReceipt).toContainText('"nativeCallMade": true');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current diagnostic JSON" }).click();
  const download = await downloadPromise;
  const text = await downloadText(download);
  const bundle = JSON.parse(text) as {
    bundleVersion: string;
    exportedAt: string;
    evidenceDigest: string;
    bundleDigest: string;
    evidence: {
      classification: Record<string, unknown>;
      provenance: { appCommit: string };
      journal: {
        eventCount: number;
        headHash: string;
        events: Array<{
          sequence: number;
          kind: string;
          previousEventHash: string | null;
          eventHash: string;
          payload: Record<string, unknown>;
        }>;
      };
      traceLedger: {
        totalTraceCount: number;
        archives: Array<{ traces: Array<Record<string, unknown>> }>;
        resetTraces: Array<Record<string, unknown>>;
        current: Array<Record<string, unknown>>;
      };
      currentReceipts: { verifiedReset: { status: string } };
    };
  };

  expect(bundle.bundleVersion).toBe("toolproof-gate1-native-proof@1");
  expect(bundle.evidence.classification).toMatchObject({
    evidenceClass: "native-plumbing",
    modelSelectionEvidence: false,
    semanticScoringEvidence: false,
    directChatGPTEvidence: false,
    gate1CompletionClaim: false,
    externalAttestation: false,
    applicationPayloadsSyntheticOnly: true
  });
  expect(bundle.evidenceDigest).toBe(
    sha256(`toolproof-gate1-evidence@1\n${canonicalize(bundle.evidence)}`)
  );
  const { bundleDigest, ...unsignedBundle } = bundle;
  expect(bundleDigest).toBe(sha256(`toolproof-gate1-bundle@1\n${canonicalize(unsignedBundle)}`));

  let previousEventHash: string | null = null;
  for (const [index, event] of bundle.evidence.journal.events.entries()) {
    expect(event.sequence).toBe(index + 1);
    expect(event.previousEventHash).toBe(previousEventHash);
    const { eventHash, ...content } = event;
    expect(eventHash).toBe(sha256(`toolproof-gate1-journal-event@1\n${canonicalize(content)}`));
    previousEventHash = eventHash;
  }
  expect(bundle.evidence.journal.headHash).toBe(previousEventHash);
  expect(bundle.evidence.journal.eventCount).toBe(bundle.evidence.journal.events.length);

  const kinds = bundle.evidence.journal.events.map(({ kind }) => kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "capabilities",
      "registry_status",
      "readiness_receipt",
      "native_attempt_started",
      "native_attempt_finished",
      "domain_reset_receipt",
      "reset_verification_receipt"
    ])
  );
  const readinessStates = bundle.evidence.journal.events
    .filter(({ kind }) => kind === "readiness_receipt")
    .map(({ payload }) => (payload.manifest as { catalogState: string }).catalogState);
  expect(new Set(readinessStates)).toEqual(new Set(["initial", "pending"]));
  expect(
    bundle.evidence.journal.events
      .filter(({ kind }) => kind === "registry_status")
      .some(({ payload }) => (payload.toolNames as string[]).includes("checkout_cancel"))
  ).toBe(true);
  expect(
    bundle.evidence.journal.events
      .filter(({ kind }) => kind === "native_attempt_started")
      .some(
        ({ payload }) =>
          (payload.input as { operationId?: string }).operationId === "bundle_update_0001"
      )
  ).toBe(true);
  expect(
    bundle.evidence.journal.events.filter(({ kind }) => kind === "native_attempt_finished").length
  ).toBeGreaterThanOrEqual(10);
  const cancellationFinish = bundle.evidence.journal.events
    .filter(({ kind }) => kind === "native_attempt_finished")
    .find(
      ({ payload }) =>
        payload.outcome === "error" &&
        (payload.error as { code?: string }).code === "execution_canceled"
    );
  expect(cancellationFinish?.payload.error).toMatchObject({ nativeCallMade: true });
  expect(cancellationFinish?.payload.traceObservation).toMatchObject({
    lastTrace: {
      toolName: "cart_get",
      status: "completed",
      stateBeforeDigest: expect.any(String),
      stateAfterDigest: expect.any(String),
      effectDigest: expect.any(String)
    }
  });
  const cancellationTraceId = (
    cancellationFinish?.payload.traceObservation as {
      lastTrace?: { eventId?: string };
    }
  )?.lastTrace?.eventId;
  const cancellationTrace = [
    ...bundle.evidence.traceLedger.archives.flatMap(({ traces }) => traces),
    ...bundle.evidence.traceLedger.resetTraces,
    ...bundle.evidence.traceLedger.current
  ].find(({ eventId }) => eventId === cancellationTraceId);
  expect(cancellationTrace).toMatchObject({
    toolName: "cart_get",
    operationId: null,
    status: "completed",
    commitDisposition: "none",
    cancellationObservedAfterCommit: false,
    cancellationObservedAfterCompletion: false,
    rawArguments: { value: {} },
    canonicalArguments: { value: {} },
    rawResult: { value: { ok: true } },
    canonicalResult: { value: { ok: true } },
    error: { value: null },
    effect: { stateChanged: false }
  });
  expect((cancellationTrace?.stateBefore as { sha256?: string } | undefined)?.sha256).toBe(
    (cancellationTrace?.stateAfter as { sha256?: string } | undefined)?.sha256
  );
  expect(bundle.evidence.traceLedger.totalTraceCount).toBeGreaterThanOrEqual(10);
  expect(bundle.evidence.traceLedger.archives).toHaveLength(1);
  expect(bundle.evidence.traceLedger.resetTraces).toHaveLength(1);
  expect(bundle.evidence.currentReceipts.verifiedReset.status).toBe("verified");
  await expect(
    verifyGate1NativeProofSequence(bundle as unknown as Gate1ProofBundle)
  ).resolves.toMatchObject({
    status: "gate1-native-sequence-complete",
    attemptCount: 10,
    cancellationTraceStatus: "completed"
  });

  const notReachedCancellation = structuredClone(bundle) as unknown as Gate1ProofBundle;
  const notReachedMutable = notReachedCancellation as unknown as {
    evidence: {
      journal: {
        events: Array<{
          kind: string;
          payload: {
            executionId?: string;
            error?: { code?: string };
            traceCount?: number;
            stateHash?: string;
            traceObservation?: {
              handlerTraceCount: number;
              stateHash: string;
              lastTrace: Record<string, unknown> | null;
            };
          };
        }>;
      };
      inspection: { currentTraceCount: number };
      traceLedger: {
        totalTraceCount: number;
        archives: Array<{ traces: Array<Record<string, unknown>> }>;
        resetTraces: Array<Record<string, unknown>>;
        current: Array<Record<string, unknown>>;
      };
    };
  };
  const notReachedFinish = notReachedMutable.evidence.journal.events.find(
    ({ kind, payload }) =>
      kind === "native_attempt_finished" && payload.error?.code === "execution_canceled"
  );
  const notReachedStart = notReachedMutable.evidence.journal.events.find(
    ({ kind, payload }) =>
      kind === "native_attempt_started" &&
      payload.executionId === notReachedFinish?.payload.executionId
  );
  const reachedTraceId = notReachedFinish?.payload.traceObservation?.lastTrace?.eventId;
  const mutableTraceCollections = [
    ...notReachedMutable.evidence.traceLedger.archives.map(({ traces }) => traces),
    notReachedMutable.evidence.traceLedger.resetTraces,
    notReachedMutable.evidence.traceLedger.current
  ];
  const allNotReachedTraces = mutableTraceCollections.flat();
  const reachedTrace = allNotReachedTraces.find(({ eventId }) => eventId === reachedTraceId) as
    { sequence: number } | undefined;
  const previousTrace = allNotReachedTraces.find(
    ({ sequence }) => sequence === (reachedTrace?.sequence ?? 0) - 1
  ) as
    | {
        eventId: string;
        source: string;
        toolName: string;
        status: string;
        registryHash: string;
        canonicalResult: { sha256: string } | null;
        effect: unknown;
        stateBefore: { sha256: string };
        stateAfter: { sha256: string };
      }
    | undefined;
  expect(notReachedFinish).toBeDefined();
  expect(notReachedStart).toBeDefined();
  expect(reachedTrace).toBeDefined();
  expect(previousTrace).toBeDefined();
  if (!notReachedFinish || !notReachedStart || !reachedTrace || !previousTrace) {
    throw new Error("Synthetic not-reached cancellation fixture is incomplete.");
  }
  for (const traces of mutableTraceCollections) {
    const index = traces.findIndex(({ eventId }) => eventId === reachedTraceId);
    if (index >= 0) traces.splice(index, 1);
  }
  notReachedMutable.evidence.traceLedger.totalTraceCount -= 1;
  notReachedMutable.evidence.inspection.currentTraceCount -= 1;
  notReachedFinish.payload.traceObservation = {
    handlerTraceCount: notReachedStart.payload.traceCount as number,
    stateHash: notReachedStart.payload.stateHash as string,
    lastTrace: {
      eventId: previousTrace.eventId,
      source: previousTrace.source,
      toolName: previousTrace.toolName,
      status: previousTrace.status,
      registryHash: previousTrace.registryHash,
      resultDigest: previousTrace.canonicalResult?.sha256 ?? null,
      effectDigest: sha256(canonicalize(previousTrace.effect)),
      stateBeforeDigest: previousTrace.stateBefore.sha256,
      stateAfterDigest: previousTrace.stateAfter.sha256
    }
  };
  resealDownloadedBundle(notReachedCancellation);
  await expect(verifyGate1ProofBundle(notReachedCancellation)).resolves.toMatchObject({
    status: "internally-consistent"
  });
  await expect(verifyGate1NativeProofSequence(notReachedCancellation)).resolves.toMatchObject({
    status: "gate1-native-sequence-complete",
    cancellationTraceStatus: "not-reached"
  });

  const lostCancelReceipt = structuredClone(bundle) as unknown as Gate1ProofBundle;
  const lostCancelMutable = lostCancelReceipt as unknown as {
    evidence: {
      journal: {
        events: Array<{
          kind: string;
          payload: {
            executionId?: string;
            toolName?: string;
            outcome?: string;
            receipt?: {
              handlerTraceId: string;
              effectDigest: string;
            };
          };
        }>;
      };
      traceLedger: {
        archives: Array<{ traces: Array<Record<string, unknown>> }>;
        resetTraces: Array<Record<string, unknown>>;
        current: Array<Record<string, unknown>>;
      };
    };
  };
  const lostFinish = lostCancelMutable.evidence.journal.events.find(
    ({ kind, payload }) =>
      kind === "native_attempt_finished" && payload.toolName === "checkout_cancel"
  );
  const lostReceipt = lostFinish?.payload.receipt;
  const lostTrace = [
    ...lostCancelMutable.evidence.traceLedger.archives.flatMap(({ traces }) => traces),
    ...lostCancelMutable.evidence.traceLedger.resetTraces,
    ...lostCancelMutable.evidence.traceLedger.current
  ].find(({ eventId }) => eventId === lostReceipt?.handlerTraceId) as
    | {
        eventId: string;
        source: string;
        toolName: string;
        status: string;
        registryHash: string;
        sequence: number;
        canonicalResult: { sha256: string };
        stateBefore: { sha256: string };
        stateAfter: { sha256: string };
      }
    | undefined;
  expect(lostFinish).toBeDefined();
  expect(lostReceipt).toBeDefined();
  expect(lostTrace).toBeDefined();
  if (!lostFinish || !lostReceipt || !lostTrace) {
    throw new Error("Synthetic checkout_cancel receipt-loss fixture is incomplete.");
  }
  lostFinish.payload = {
    executionId: lostFinish.payload.executionId,
    toolName: "checkout_cancel",
    outcome: "error",
    error: {
      name: "WebMcpRuntimeError",
      message: "Native execution failed.",
      code: "native_execution_failure",
      nativeCallMade: true,
      rawResult: null
    },
    traceObservation: {
      handlerTraceCount: lostTrace.sequence,
      stateHash: lostTrace.stateAfter.sha256,
      lastTrace: {
        eventId: lostTrace.eventId,
        source: lostTrace.source,
        toolName: lostTrace.toolName,
        status: lostTrace.status,
        registryHash: lostTrace.registryHash,
        resultDigest: lostTrace.canonicalResult.sha256,
        effectDigest: lostReceipt.effectDigest,
        stateBeforeDigest: lostTrace.stateBefore.sha256,
        stateAfterDigest: lostTrace.stateAfter.sha256
      }
    },
    observationError: null
  } as unknown as typeof lostFinish.payload;
  resealDownloadedBundle(lostCancelReceipt);
  await expect(verifyGate1ProofBundle(lostCancelReceipt)).resolves.toMatchObject({
    status: "internally-consistent"
  });
  await expect(verifyGate1NativeProofSequence(lostCancelReceipt)).rejects.toThrow(
    "checkout_cancel attempt 9 did not return an adapter receipt"
  );

  expect(text).not.toMatch(/"(?:window|execute|signal|controller|cookie)"\s*:/u);
  expect(text).not.toMatch(/\/Users\/|\/home\/|\/mnt\/|\/Volumes\//u);
  expect(download.suggestedFilename()).toMatch(
    /^toolproof-gate1-native-[A-Za-z0-9_-]{1,12}-\d{8}T\d{6}Z\.json$/u
  );
  await expect(page.getByText(new RegExp(bundle.evidenceDigest, "u"))).toBeVisible();
  const exportViolations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(exportViolations).toEqual([]);
  expect(await overflowingElements(page)).toEqual([]);
});

test("JSON-string one button reloads clean, runs the exact proof, and requests one download", async ({
  page
}) => {
  await page.getByRole("button", { name: "Native cart_get", exact: true }).click();
  const oldSessionId = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __toolProofLabEnvironment: { store: { getSnapshot(): { sessionId: string } } };
        }
      ).__toolProofLabEnvironment.store.getSnapshot().sessionId
  );
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Run clean Gate 1 proof and download" }).click();
  const download = await downloadPromise;
  const text = await downloadText(download);
  const bundle = JSON.parse(text) as Gate1ProofBundle;

  await expect(verifyGate1ProofBundle(bundle)).resolves.toMatchObject({
    status: "internally-consistent",
    nativeAttemptCount: 10
  });
  const strictVerification = await verifyGate1NativeProofSequence(bundle);
  expect(strictVerification).toMatchObject({
    status: "gate1-native-sequence-complete",
    attemptCount: 10
  });
  expect(["canceled", "completed"]).toContain(strictVerification.cancellationTraceStatus);
  expect(bundle.evidence.provenance.sessionId).not.toBe(oldSessionId);
  expect(downloadCount).toBe(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("toolproof:gate1-auto-request@1"))
  ).toBeNull();

  const automationEvents = bundle.evidence.journal.events as Array<{
    sequence: number;
    recordedAt: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;
  const automatedStart = automationEvents.filter(
    ({ kind }) => kind === "automated_sequence_started"
  );
  const automatedSteps = automationEvents.filter(({ kind }) => kind === "automated_sequence_step");
  const automatedFinish = automationEvents.filter(
    ({ kind }) => kind === "automated_sequence_finished"
  );
  expect(automatedStart).toHaveLength(1);
  expect(automatedSteps).toHaveLength(GATE1_AUTOMATED_PROOF_STEP_NAMES.length);
  expect(automatedFinish).toHaveLength(1);
  expect(automatedStart[0]!.payload).toMatchObject({
    sequenceVersion: GATE1_AUTOMATED_PROOF_SEQUENCE_VERSION,
    navigation: "reload",
    stepCount: GATE1_AUTOMATED_PROOF_STEP_NAMES.length
  });
  expect(automatedSteps.map(({ payload }) => payload.stepName)).toEqual([
    ...GATE1_AUTOMATED_PROOF_STEP_NAMES
  ]);
  expect(automatedSteps.map(({ payload }) => payload.stepIndex)).toEqual(
    GATE1_AUTOMATED_PROOF_STEP_NAMES.map((_name, index) => index + 1)
  );
  expect(
    automatedSteps.every(
      ({ payload }) =>
        payload.status === "completed" &&
        typeof payload.durationMs === "number" &&
        payload.durationMs >= GATE1_AUTOMATED_PROOF_MIN_STEP_MS
    )
  ).toBe(true);
  expect(automatedFinish[0]!.payload).toMatchObject({
    status: "verified",
    completedSteps: GATE1_AUTOMATED_PROOF_STEP_NAMES.length,
    nativeAttemptCount: 10,
    verificationStatus: "gate1-native-sequence-complete"
  });
  const tamperedTiming = structuredClone(bundle) as unknown as Gate1ProofBundle;
  const tamperedTimingEvents = tamperedTiming.evidence.journal.events as Array<{
    kind: string;
    payload: { stepIndex?: number; durationMs?: number };
  }>;
  tamperedTimingEvents.find(({ kind }) => kind === "automated_sequence_step")!.payload.durationMs =
    0;
  resealDownloadedBundle(tamperedTiming);
  await expect(verifyGate1ProofBundle(tamperedTiming)).resolves.toMatchObject({
    status: "internally-consistent"
  });
  await expect(verifyGate1NativeProofSequence(tamperedTiming)).rejects.toThrow(
    "automated step 1 metadata is invalid"
  );
  for (const [field, value] of [
    ["startedAt", bundle.exportedAt],
    ["completedAt", automatedStart[0]!.payload.startedAt as string]
  ] as const) {
    const tamperedBoundary = structuredClone(bundle) as unknown as Gate1ProofBundle;
    const firstStep = (
      tamperedBoundary.evidence.journal.events as Array<{
        kind: string;
        payload: { startedAt?: string; completedAt?: string };
      }>
    ).find(({ kind }) => kind === "automated_sequence_step")!.payload;
    firstStep[field] = value;
    resealDownloadedBundle(tamperedBoundary);
    await expect(verifyGate1ProofBundle(tamperedBoundary)).resolves.toMatchObject({
      status: "internally-consistent"
    });
    await expect(verifyGate1NativeProofSequence(tamperedBoundary)).rejects.toThrow(
      "automated step 1 timestamps are out of order"
    );
  }
  for (let index = 1; index < automationEvents.length; index += 1) {
    expect(Date.parse(automationEvents[index]!.recordedAt)).toBeGreaterThanOrEqual(
      Date.parse(automationEvents[index - 1]!.recordedAt)
    );
  }
  await expect(page.getByText(/Verified proof download requested/u)).toBeVisible();
  const retryButton = page.getByRole("button", { name: "Download verified proof again" });
  await expect(retryButton).toBeVisible();
  expect(await overflowingElements(page)).toEqual([]);
  const retryPromise = page.waitForEvent("download");
  await retryButton.click();
  const retryDownload = await retryPromise;
  expect(await downloadText(retryDownload)).toBe(text);
  expect(retryDownload.suggestedFilename()).toBe(download.suggestedFilename());
  expect(downloadCount).toBe(2);
  await page.reload();
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(downloadCount).toBe(2);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofLabEnvironment: {
              proofJournal: { snapshot(): { entries: Array<{ kind: string }> } };
            };
          }
        ).__toolProofLabEnvironment.proofJournal
          .snapshot()
          .entries.filter(({ kind }) => kind === "native_attempt_started").length
    )
  ).toBe(0);
});

test("JSON-string automated proof stops on the first native failure without downloading", async ({
  page
}) => {
  await page.evaluate(() =>
    sessionStorage.setItem("__toolProofTestFailAutomatedTool", "order_review")
  );
  let downloadCount = 0;
  page.on("download", () => {
    downloadCount += 1;
  });
  await page.getByRole("button", { name: "Run clean Gate 1 proof and download" }).click();
  await expect(page.getByText(/Proof run stopped at order_review/u)).toBeVisible();
  await page.waitForTimeout(300);
  expect(downloadCount).toBe(0);
  const failure = await page.evaluate(() => {
    const environment = (
      window as typeof window & {
        __toolProofLabEnvironment: {
          proofJournal: {
            snapshot(): {
              entries: Array<{ kind: string; payload: Record<string, unknown> }>;
            };
          };
        };
      }
    ).__toolProofLabEnvironment;
    const entries = environment.proofJournal.snapshot().entries;
    return {
      nativeStarts: entries.filter(({ kind }) => kind === "native_attempt_started").length,
      resets: entries.filter(({ kind }) => kind === "domain_reset_receipt").length,
      finish: entries.find(({ kind }) => kind === "automated_sequence_finished")?.payload,
      marker: sessionStorage.getItem("toolproof:gate1-auto-request@1")
    };
  });
  expect(failure.nativeStarts).toBe(2);
  expect(failure.resets).toBe(0);
  expect(failure.finish).toMatchObject({ status: "failed", failedStep: "order_review" });
  expect(failure.marker).toBeNull();
  await expect(page.getByRole("button", { name: "Restart clean Gate 1 proof run" })).toBeEnabled();
  expect(await overflowingElements(page)).toEqual([]);
});

test("malformed automated proof markers are consumed without native execution", async ({
  page
}) => {
  await page.evaluate(() =>
    sessionStorage.setItem("toolproof:gate1-auto-request@1", JSON.stringify({ version: "wrong" }))
  );
  await page.reload();
  await expect(page.getByText(/one-shot proof request was rejected/u)).toBeVisible();
  const result = await page.evaluate(() => {
    const entries = (
      window as typeof window & {
        __toolProofLabEnvironment: {
          proofJournal: { snapshot(): { entries: Array<{ kind: string }> } };
        };
      }
    ).__toolProofLabEnvironment.proofJournal.snapshot().entries;
    return {
      marker: sessionStorage.getItem("toolproof:gate1-auto-request@1"),
      nativeStarts: entries.filter(({ kind }) => kind === "native_attempt_started").length
    };
  });
  expect(result).toEqual({ marker: null, nativeStarts: 0 });
});

test("full reload starts a new proof document instead of mixing prior evidence", async ({
  page
}) => {
  await page.getByRole("button", { name: "Native cart_get", exact: true }).click();
  const before = await page.evaluate(() => {
    const environment = (
      window as typeof window & {
        __toolProofLabEnvironment: {
          store: { getSnapshot(): { sessionId: string } };
          proofJournal: {
            snapshot(): { eventCount: number; entries: readonly { kind: string }[] };
          };
        };
      }
    ).__toolProofLabEnvironment;
    return {
      sessionId: environment.store.getSnapshot().sessionId,
      eventCount: environment.proofJournal.snapshot().eventCount
    };
  });
  expect(before.eventCount).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  const after = await page.evaluate(() => {
    const environment = (
      window as typeof window & {
        __toolProofLabEnvironment: {
          store: { getSnapshot(): { sessionId: string } };
          proofJournal: {
            snapshot(): { eventCount: number; entries: readonly { kind: string }[] };
          };
        };
      }
    ).__toolProofLabEnvironment;
    const journal = environment.proofJournal.snapshot();
    return {
      sessionId: environment.store.getSnapshot().sessionId,
      eventCount: journal.eventCount,
      nativeStarts: journal.entries.filter(({ kind }) => kind === "native_attempt_started").length
    };
  });
  expect(after.sessionId).not.toBe(before.sessionId);
  expect(after.nativeStarts).toBe(0);
  expect(after.eventCount).toBeLessThan(before.eventCount);
});

test("consumer-ready pending and reset states remain accessible without horizontal overflow", async ({
  page
}) => {
  await page.getByRole("button", { name: "Native checkout_request" }).click();
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeVisible();

  const pendingViolations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(pendingViolations).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);

  await page.getByRole("button", { name: "Hard reset fixture" }).click();
  await expect(page.getByText("checkout-seed-v1 · r0", { exact: true })).toBeVisible();
  const resetViolations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(resetViolations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});

test("Gate 8.5 runs one fixed provider-free native sequence and downloads one complete JSON", async ({
  page
}) => {
  const outbound: string[] = [];
  const verifierBodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    outbound.push(request.url());
    if (request.url().endsWith("/api/invocation-integrity/verify")) {
      verifierBodies.push(JSON.parse(request.postData() ?? "null") as Record<string, unknown>);
    }
  });

  await installEmulatedInvocationIntegrityVerifier(page);
  await page.goto("/invocation-integrity");
  await expect(
    page.getByRole("heading", {
      name: "Fixed browser-native calls, checked by a source-fixed verifier."
    })
  ).toBeVisible();
  await expect(page.getByText("Zero model calls. Zero server durable-store writes.")).toBeVisible();
  await expect(
    page.getByText(/The one-run guard uses an exclusive browser LockManager claim/iu)
  ).toBeVisible();
  await expect(page.getByText(/using another browser or profile can bypass it/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: /clear|reset.*run/iu })).toHaveCount(0);
  await expect(page.getByText("getTools + executeTool ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
  expect(await page.locator("input, textarea, select").count()).toBe(0);

  const runButton = page.getByRole("button", { name: "Run fixed native sequence once" });
  await runButton.click();
  await expect(page.getByText("3/3 verified separately", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Verified separately ·/u)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();

  const terminalRunLock = await page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }, INVOCATION_INTEGRITY_RUN_LOCK_KEY);
  expect(terminalRunLock).toMatchObject({
    version: INVOCATION_INTEGRITY_RUN_LOCK_VERSION,
    appCommit: INVOCATION_INTEGRITY_BROWSER_COMMIT,
    origin: new URL(page.url()).origin,
    claimId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    ),
    state: "terminal",
    terminalPhase: "verified",
    artifact: {
      status: "verified",
      buildSha: INVOCATION_INTEGRITY_BROWSER_COMMIT,
      score: { earned: 3, possible: 3, label: "3/3" }
    }
  });

  expect(verifierBodies).toHaveLength(1);
  const transcript = verifierBodies[0] as unknown as {
    runtime: {
      argumentMode: string;
      initialCatalog: string[];
      pendingCatalog: string[];
    };
    preflight: {
      initialDescriptors: Array<{ name: string; origin: string; inputSchema: unknown }>;
      pendingDescriptors: Array<{ name: string; origin: string; inputSchema: unknown }>;
      compatibility: { trace: { toolName: string } };
      reset: { verifiedReceipt: { status: string }; trace: { toolName: string } };
      caseTraceOffset: number;
      postReset: {
        inspection: { currentOperationCount: number; retainedTombstoneCount: number };
        trajectory: { currentTraceCount: number; totalTraceCount: number };
      };
    };
    calls: Array<{
      caseId: string;
      callIndex: number;
      receipt: { toolName: string };
      trace: { toolName: string; sequence: number };
    }>;
  };
  expect(transcript.runtime).toMatchObject({
    argumentMode: "object",
    initialCatalog: ["cart_get", "cart_update", "checkout_request", "order_review"],
    pendingCatalog: [
      "cart_get",
      "cart_update",
      "checkout_cancel",
      "checkout_request",
      "order_review"
    ]
  });
  expect(transcript.preflight.initialDescriptors.map(({ name }) => name)).toEqual([
    "cart_get",
    "cart_update",
    "checkout_request",
    "order_review"
  ]);
  expect(transcript.preflight.pendingDescriptors.map(({ name }) => name)).toEqual([
    "cart_get",
    "cart_update",
    "checkout_cancel",
    "checkout_request",
    "order_review"
  ]);
  expect(
    transcript.preflight.initialDescriptors.every(
      ({ origin }) => origin === new URL(page.url()).origin
    )
  ).toBe(true);
  expect(transcript.preflight.initialDescriptors[1]?.inputSchema).toMatchObject({
    properties: { itemId: { pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } }
  });
  expect(transcript.preflight).toMatchObject({
    compatibility: { trace: { toolName: "cart_get" } },
    reset: { verifiedReceipt: { status: "verified" }, trace: { toolName: "fixture_reset" } },
    caseTraceOffset: 2,
    postReset: {
      inspection: { currentOperationCount: 0, retainedTombstoneCount: 0 },
      trajectory: { currentTraceCount: 0, totalTraceCount: 2 }
    }
  });
  expect(transcript.calls.map(({ caseId, callIndex }) => [caseId, callIndex])).toEqual([
    ["II-01", 1],
    ["II-02", 1],
    ["II-03", 1],
    ["II-03", 2]
  ]);
  expect(transcript.calls.map(({ receipt }) => receipt.toolName)).toEqual([
    "checkout_request",
    "cart_update",
    "checkout_request",
    "checkout_request"
  ]);
  expect(transcript.calls.map(({ trace }) => trace.toolName)).toEqual([
    "checkout_request",
    "cart_update",
    "checkout_request",
    "checkout_request"
  ]);
  expect(transcript.calls.some(({ trace }) => trace.toolName === "cart_get")).toBe(false);
  expect(transcript.calls.some(({ trace }) => trace.toolName === "fixture_reset")).toBe(false);
  expect(transcript.calls.map(({ trace }) => trace.sequence)).toEqual([3, 4, 5, 6]);

  const observations = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __toolProofNativeObservations: Array<{
            toolName: string;
            inputType: string;
            invocationIntegrityRunLockState: string | null;
          }>;
        }
      ).__toolProofNativeObservations
  );
  expect(observations.map(({ toolName }) => toolName)).toEqual([
    "cart_get",
    "checkout_request",
    "cart_update",
    "checkout_request",
    "checkout_request"
  ]);
  expect(observations.map(({ inputType }) => inputType)).toEqual([
    "object",
    "object",
    "object",
    "object",
    "object"
  ]);
  expect(
    observations.map(({ invocationIntegrityRunLockState }) => invocationIntegrityRunLockState)
  ).toEqual([null, "in-progress", "in-progress", "in-progress", "in-progress"]);

  expect(
    outbound.filter((url) => /(?:openai|\/api\/(?:probe|scored|repair|judge-demo)\/)/iu.test(url))
  ).toEqual([]);
  expect(outbound.filter((url) => url.endsWith("/api/invocation-integrity/verify"))).toHaveLength(
    1
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const download = await downloadPromise;
  const artifact = JSON.parse(await downloadText(download)) as InvocationIntegrityReceipt;
  expect(download.suggestedFilename()).toMatch(
    /^thurstone-invocation-integrity-[a-f0-9]{12}\.json$/u
  );
  expect(artifact).toMatchObject({
    status: "verified",
    browserEvidenceBoundary: INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
    modelCallCount: 0,
    includedInSemanticDenominator: false,
    score: { earned: 3, possible: 3, label: "3/3" }
  });
  expect(artifact.measuredTranscript.calls).toHaveLength(4);
  expect(artifact.measuredTranscript.preflight.initialDescriptors).toHaveLength(4);
  expect(artifact.measuredTranscript.preflight.pendingDescriptors).toHaveLength(5);
  expect(artifact.measuredTranscript.preflight).toMatchObject({
    reset: { verifiedReceipt: { status: "verified" } },
    caseTraceOffset: 2,
    postReset: { trajectory: { totalTraceCount: 2 } }
  });
  await expect(verifyInvocationIntegrityReceipt(artifact)).resolves.toEqual(artifact);
  await expect(page.getByRole("button", { name: "Complete JSON downloaded" })).toBeDisabled();

  await page.reload();
  await expect(page.getByText("3/3 verified separately", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(verifierBodies).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofNativeObservations: Array<{ toolName: string }>;
          }
        ).__toolProofNativeObservations
    )
  ).toEqual([]);

  const recoveredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const recoveredArtifact = JSON.parse(
    await downloadText(await recoveredDownloadPromise)
  ) as InvocationIntegrityReceipt;
  expect(recoveredArtifact).toEqual(artifact);

  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(violations).toEqual([]);
  expect(await overflowingElements(page)).toEqual([]);
});

test("Gate 8.5 browser run lock fails closed across reload and scopes itself to one build", async ({
  page
}) => {
  const staleCommit = "d".repeat(40);
  const origin = new URL(page.url()).origin;
  const staleClaimId = "00000000-0000-4000-8000-000000000001";
  await page.evaluate(
    ({ key, version, appCommit, origin, claimId }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version,
          appCommit,
          origin,
          claimId,
          state: "terminal",
          terminalPhase: "failed",
          startedAt: "2026-08-29T14:00:00.000Z",
          completedAt: "2026-08-29T14:01:00.000Z",
          artifact: { status: "stale-build-record" }
        })
      );
    },
    {
      key: `${INVOCATION_INTEGRITY_RUN_LOCK_VERSION}:${staleCommit}`,
      version: INVOCATION_INTEGRITY_RUN_LOCK_VERSION,
      appCommit: staleCommit,
      origin,
      claimId: staleClaimId
    }
  );

  await page.goto("/invocation-integrity");
  await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), INVOCATION_INTEGRITY_RUN_LOCK_KEY)
  ).toBeNull();

  const startedAt = "2026-08-29T15:00:00.000Z";
  const claimId = "00000000-0000-4000-8000-000000000002";
  await page.evaluate(
    ({ key, version, appCommit, origin, claimId, startedAt }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ version, appCommit, origin, claimId, state: "in-progress", startedAt })
      );
    },
    {
      key: INVOCATION_INTEGRITY_RUN_LOCK_KEY,
      version: INVOCATION_INTEGRITY_RUN_LOCK_VERSION,
      appCommit: INVOCATION_INTEGRITY_BROWSER_COMMIT,
      origin,
      claimId,
      startedAt
    }
  );
  await page.reload();

  await expect(page.getByText("Failed closed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/started for this build but did not save terminal evidence/iu)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofNativeObservations: Array<{ toolName: string }>;
          }
        ).__toolProofNativeObservations
    )
  ).toEqual([]);

  const terminalMarker = await page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  }, INVOCATION_INTEGRITY_RUN_LOCK_KEY);
  expect(terminalMarker).toMatchObject({
    version: INVOCATION_INTEGRITY_RUN_LOCK_VERSION,
    appCommit: INVOCATION_INTEGRITY_BROWSER_COMMIT,
    origin,
    claimId,
    state: "terminal",
    terminalPhase: "failed",
    startedAt,
    artifact: {
      status: "failed-interrupted-browser-run",
      buildSha: INVOCATION_INTEGRITY_BROWSER_COMMIT,
      claimAllowed: false
    }
  });

  const firstDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const firstArtifact = JSON.parse(await downloadText(await firstDownloadPromise)) as Record<
    string,
    unknown
  >;
  expect(firstArtifact).toMatchObject({
    status: "failed-interrupted-browser-run",
    buildSha: INVOCATION_INTEGRITY_BROWSER_COMMIT,
    claimAllowed: false,
    modelCallCount: 0,
    includedInSemanticDenominator: false
  });

  await page.reload();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  const recoveredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const recoveredArtifact = JSON.parse(
    await downloadText(await recoveredDownloadPromise)
  ) as Record<string, unknown>;
  expect(recoveredArtifact).toEqual(firstArtifact);
});

test("Gate 8.5 admits only one concurrent same-profile tab", async ({ page, context }) => {
  const secondPage = await context.newPage();
  try {
    await installEmulatedConsumer(secondPage, "object");
    await secondPage.goto("/lab");
    await expect(secondPage.getByText("consumer-ready", { exact: true })).toBeVisible();
    await installEmulatedInvocationIntegrityVerifier(page);
    await installEmulatedInvocationIntegrityVerifier(secondPage);

    await Promise.all([
      page.goto("/invocation-integrity"),
      secondPage.goto("/invocation-integrity")
    ]);
    await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
    await expect(secondPage.getByText("Fixed sequence ready", { exact: true })).toBeVisible();

    await Promise.all([
      page.getByRole("button", { name: "Run fixed native sequence once" }).click(),
      secondPage.getByRole("button", { name: "Run fixed native sequence once" }).click()
    ]);
    await expect
      .poll(async () => {
        const verified = await Promise.all(
          [page, secondPage].map((candidate) =>
            candidate.getByText("3/3 verified separately", { exact: true }).isVisible()
          )
        );
        const blocked = await Promise.all(
          [page, secondPage].map((candidate) =>
            candidate.getByText("Blocked · live run owns this build", { exact: true }).isVisible()
          )
        );
        return {
          verified: verified.filter(Boolean).length,
          blocked: blocked.filter(Boolean).length
        };
      })
      .toEqual({ verified: 1, blocked: 1 });

    const nativeCallCounts = await Promise.all(
      [page, secondPage].map((candidate) =>
        candidate.evaluate(
          () =>
            (
              window as typeof window & {
                __toolProofNativeObservations: Array<{ toolName: string }>;
              }
            ).__toolProofNativeObservations.length
        )
      )
    );
    expect(nativeCallCounts.sort((left, right) => left - right)).toEqual([1, 5]);

    const retained = await page.evaluate((key) => {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as Record<string, unknown>) : null;
    }, INVOCATION_INTEGRITY_RUN_LOCK_KEY);
    expect(retained).toMatchObject({
      version: INVOCATION_INTEGRITY_RUN_LOCK_VERSION,
      appCommit: INVOCATION_INTEGRITY_BROWSER_COMMIT,
      origin: new URL(page.url()).origin,
      claimId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      ),
      state: "terminal",
      terminalPhase: "verified",
      artifact: { status: "verified", score: { label: "3/3" } }
    });
  } finally {
    await secondPage.close();
  }
});

test("Gate 8.5 restoring tab cannot steal a live owner claim", async ({ page, context }) => {
  const secondPage = await context.newPage();
  let releaseVerifier: (() => void) | undefined;
  let markVerifierReached: (() => void) | undefined;
  const verifierReached = new Promise<void>((resolve) => {
    markVerifierReached = resolve;
  });
  const verifierRelease = new Promise<void>((resolve) => {
    releaseVerifier = resolve;
  });
  let firstVerifierRequests = 0;
  let secondVerifierRequests = 0;
  try {
    await installEmulatedConsumer(secondPage, "object");
    await secondPage.goto("/lab");
    await expect(secondPage.getByText("consumer-ready", { exact: true })).toBeVisible();
    await page.route("**/api/invocation-integrity/verify", async (route) => {
      firstVerifierRequests += 1;
      const transcript = JSON.parse(
        route.request().postData() ?? "null"
      ) as InvocationIntegrityTranscript;
      const receipt = await emulatedInvocationIntegrityReceipt(transcript);
      markVerifierReached?.();
      await verifierRelease;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(receipt)
      });
    });
    secondPage.on("request", (request) => {
      if (request.url().endsWith("/api/invocation-integrity/verify")) {
        secondVerifierRequests += 1;
      }
    });

    await page.goto("/invocation-integrity");
    await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Run fixed native sequence once" }).click();
    await verifierReached;

    const inProgressRaw = await page.evaluate(
      (key) => localStorage.getItem(key),
      INVOCATION_INTEGRITY_RUN_LOCK_KEY
    );
    expect(inProgressRaw).not.toBeNull();
    expect(JSON.parse(inProgressRaw ?? "null")).toMatchObject({
      state: "in-progress",
      appCommit: INVOCATION_INTEGRITY_BROWSER_COMMIT,
      origin: new URL(page.url()).origin,
      claimId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
    });

    await secondPage.goto("/invocation-integrity");
    await expect(secondPage.getByText("Live run owns this build", { exact: true })).toBeVisible();
    await expect(
      secondPage.getByText("Blocked · live run owns this build", { exact: true })
    ).toBeVisible();
    await expect(secondPage.getByText(/This tab made no native or verifier calls/iu)).toBeVisible();
    expect(
      await secondPage.evaluate(
        () =>
          (
            window as typeof window & {
              __toolProofNativeObservations: Array<{ toolName: string }>;
            }
          ).__toolProofNativeObservations
      )
    ).toEqual([]);
    expect(secondVerifierRequests).toBe(0);
    expect(
      await secondPage.evaluate(
        (key) => localStorage.getItem(key),
        INVOCATION_INTEGRITY_RUN_LOCK_KEY
      )
    ).toBe(inProgressRaw);

    releaseVerifier?.();
    await expect(page.getByText("3/3 verified separately", { exact: true })).toBeVisible();
    expect(firstVerifierRequests).toBe(1);
    const terminalRaw = await page.evaluate(
      (key) => localStorage.getItem(key),
      INVOCATION_INTEGRITY_RUN_LOCK_KEY
    );
    expect(terminalRaw).not.toBe(inProgressRaw);
    const terminal = JSON.parse(terminalRaw ?? "null") as {
      artifact: InvocationIntegrityReceipt;
      state: string;
      terminalPhase: string;
    };
    expect(terminal).toMatchObject({
      state: "terminal",
      terminalPhase: "verified",
      artifact: { status: "verified", score: { label: "3/3" } }
    });

    await secondPage.reload();
    await expect(secondPage.getByText("3/3 verified separately", { exact: true })).toBeVisible();
    await expect(
      secondPage.getByRole("button", { name: "Fixed native run consumed" })
    ).toBeDisabled();
    expect(secondVerifierRequests).toBe(0);
    expect(
      await secondPage.evaluate(
        () =>
          (
            window as typeof window & {
              __toolProofNativeObservations: Array<{ toolName: string }>;
            }
          ).__toolProofNativeObservations
      )
    ).toEqual([]);
    const restoredRaw = await secondPage.evaluate(
      (key) => localStorage.getItem(key),
      INVOCATION_INTEGRITY_RUN_LOCK_KEY
    );
    expect(restoredRaw).toBe(terminalRaw);
    expect(JSON.parse(restoredRaw ?? "null").artifact).toEqual(terminal.artifact);
  } finally {
    releaseVerifier?.();
    await secondPage.close();
  }
});

test("Gate 8.5 blocks without overwriting a malformed retained marker", async ({ page }) => {
  const malformed = '{"state":"in-progress"';
  await page.evaluate(({ key, malformed }) => localStorage.setItem(key, malformed), {
    key: INVOCATION_INTEGRITY_RUN_LOCK_KEY,
    malformed
  });
  await page.goto("/invocation-integrity");

  await expect(page.getByText("Failed closed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/one-run record for this build is invalid; execution remains blocked/iu)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), INVOCATION_INTEGRITY_RUN_LOCK_KEY)
  ).toBe(malformed);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofNativeObservations: Array<{ toolName: string }>;
          }
        ).__toolProofNativeObservations
    )
  ).toEqual([]);
});

test("Gate 8.5 fails closed when the browser LockManager is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined
    });
  });
  await page.goto("/invocation-integrity");

  await expect(page.getByText("Failed closed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/browser LockManager or local one-run storage is unavailable/iu)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), INVOCATION_INTEGRITY_RUN_LOCK_KEY)
  ).toBeNull();
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofNativeObservations: Array<{ toolName: string }>;
          }
        ).__toolProofNativeObservations
    )
  ).toEqual([]);
});

test("JSON-string Gate 8.5 preserves the fixed sequence and adapter argument mode", async ({
  page
}) => {
  const verifierBodies: Array<{ runtime?: { argumentMode?: string } }> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/invocation-integrity/verify")) {
      verifierBodies.push(
        JSON.parse(request.postData() ?? "null") as {
          runtime?: { argumentMode?: string };
        }
      );
    }
  });
  await installEmulatedInvocationIntegrityVerifier(page);
  await page.goto("/invocation-integrity");
  await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run fixed native sequence once" }).click();
  await expect(page.getByText("3/3 verified separately", { exact: true })).toBeVisible();
  expect(verifierBodies).toHaveLength(1);
  expect(verifierBodies[0]?.runtime?.argumentMode).toBe("json-string");
  const observations = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __toolProofNativeObservations: Array<{ toolName: string; inputType: string }>;
        }
      ).__toolProofNativeObservations
  );
  expect(observations.map(({ toolName }) => toolName)).toEqual([
    "cart_get",
    "checkout_request",
    "cart_update",
    "checkout_request",
    "checkout_request"
  ]);
  expect(observations.map(({ inputType }) => inputType)).toEqual([
    "object",
    "string",
    "string",
    "string",
    "string"
  ]);
});

for (const contamination of [
  { label: "read trace", toolName: "cart_get", input: {}, operationCount: 0, tombstoneCount: 0 },
  {
    label: "terminal no-op",
    toolName: "cart_update",
    input: {
      operationId: "contamination_noop_0001",
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: 1
    },
    operationCount: 1,
    tombstoneCount: 1
  }
] as const) {
  test(`Gate 8.5 rejects intervening ${contamination.label} before II dispatch`, async ({
    page
  }) => {
    let verifierRequestCount = 0;
    page.on("request", (request) => {
      if (/\/api\/invocation-integrity\/(?:verify|failure)$/u.test(request.url())) {
        verifierRequestCount += 1;
      }
    });
    await page.goto("/invocation-integrity");
    await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
    await executeExternalNativeCall(page, contamination.toolName, contamination.input);
    await page.getByRole("button", { name: "Run fixed native sequence once" }).click();
    await expect(
      page.getByText("invocation_integrity_run_admission_contaminated", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
    expect(verifierRequestCount).toBe(0);
    const observations = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __toolProofNativeObservations: Array<{ toolName: string }>;
          }
        ).__toolProofNativeObservations
    );
    expect(observations.map(({ toolName }) => toolName)).toEqual([
      "cart_get",
      contamination.toolName
    ]);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download complete JSON" }).click();
    const artifact = JSON.parse(await downloadText(await downloadPromise)) as {
      status: string;
      claimAllowed: boolean;
      artifactDigest: string;
      terminalInspection: {
        currentOperationCount: number;
        retainedTombstoneCount: number;
        currentTraceCount: number;
      };
    };
    expect(artifact).toMatchObject({
      status: "failed-before-II-dispatch",
      claimAllowed: false,
      terminalInspection: {
        currentOperationCount: contamination.operationCount,
        retainedTombstoneCount: contamination.tombstoneCount,
        currentTraceCount: 2
      }
    });
    expect(artifact.artifactDigest).toMatch(/^[a-f0-9]{64}$/u);
  });
}

test("Gate 8.5 captures a native error and permanently blocks rerun after dispatch", async ({
  page
}) => {
  await page.evaluate(() =>
    sessionStorage.setItem("__toolProofTestFailAutomatedTool", "checkout_request")
  );
  let successVerifierRequestCount = 0;
  let failureVerifierRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/invocation-integrity/verify")) {
      successVerifierRequestCount += 1;
    }
    if (request.url().endsWith("/api/invocation-integrity/failure")) {
      failureVerifierRequestCount += 1;
    }
  });
  await installEmulatedInvocationIntegrityVerifier(page);
  await page.goto("/invocation-integrity");
  await expect(page.getByText("Fixed sequence ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run fixed native sequence once" }).click();
  await expect(
    page.getByText("Failed closed · no rerun after dispatch", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("0/3 · claim forbidden", { exact: true })).toBeVisible();
  await expect(page.getByText("Native execution failed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(successVerifierRequestCount).toBe(0);
  expect(failureVerifierRequestCount).toBe(1);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const artifact = JSON.parse(
    await downloadText(await downloadPromise)
  ) as InvocationIntegrityFailureReceipt;
  expect(artifact).toMatchObject({
    status: "failed",
    score: { earned: 0, possible: 3, label: "0/3" },
    claimPosition: "forbidden",
    claimAllowed: false,
    completedCalls: [],
    error: {
      stage: "native",
      code: "native_execution_failure",
      nativeCallMade: true,
      rawResultSha256: null
    },
    preflight: {
      pendingDescriptors: null,
      reset: { verifiedReceipt: { status: "verified" } },
      caseTraceOffset: 2
    },
    terminalInspection: { currentTraceCount: 0, totalTraceCount: 2, lastTraceEventId: null }
  });
  await expect(verifyInvocationIntegrityFailureReceipt(artifact)).resolves.toEqual(artifact);
  await expect(page.getByRole("button", { name: "Complete JSON downloaded" })).toBeDisabled();

  await page.reload();
  await expect(
    page.getByText("Failed closed · no rerun after dispatch", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("0/3 · claim forbidden", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fixed native run consumed" })).toBeDisabled();
  expect(successVerifierRequestCount).toBe(0);
  expect(failureVerifierRequestCount).toBe(1);
  const recoveredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete JSON" }).click();
  const recoveredArtifact = JSON.parse(
    await downloadText(await recoveredDownloadPromise)
  ) as InvocationIntegrityFailureReceipt;
  expect(recoveredArtifact).toEqual(artifact);
});
