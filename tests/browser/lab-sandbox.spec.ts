import { createHash } from "node:crypto";

import { expect, test, type Download, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { canonicalize } from "json-canonicalize";

const pageErrors = new WeakMap<Page, string[]>();
const hydrationWarnings = new WeakMap<Page, string[]>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
      }> = [];
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
          const active = this.active.get(selected.name)?.tool;
          if (!active) throw new Error(`Emulated tool is not active: ${selected.name}`);
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
          if (proveVisibleBeforeSettlement) {
            delayNextDigest = true;
            releaseDigest = undefined;
          }
          let handlerSettled = false;
          const handler = Promise.resolve(
            mode === "json-string"
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
              inputType
            });
            releaseDigest?.();
          }
          const result = await handler;
          if (!proveVisibleBeforeSettlement) {
            observations.push({
              toolName: selected.name,
              bodyText: document.body.textContent ?? "",
              handlerSettled,
              inputType
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 15));
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
  await expect(mug.getByText("Current × 3", { exact: true })).toBeVisible();
  await expect(mug.getByLabel("Stoneware mug quantity")).toHaveValue("3");

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

test("quantity editor resynchronizes from persistent state after a route remount", async ({
  page
}) => {
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
    .toBe(3);

  await page.evaluate(() => {
    const owner = window as typeof window & {
      next?: { readonly router?: { push(href: string): void } };
    };
    if (!owner.next?.router) throw new Error("Next.js app router is unavailable.");
    owner.next.router.push("/lab?remount=1");
  });
  await expect(page).toHaveURL(/\/lab\?remount=1$/u);
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();
  await expect(mug.getByText("Current × 3", { exact: true })).toBeVisible();
  await expect(quantityEditor).toHaveValue("3");
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

  await page.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/results$/u);
  await page.evaluate(() => {
    const owner = window as typeof window & {
      next?: { readonly router?: { push(href: string): void } };
    };
    if (!owner.next?.router) throw new Error("Next.js app router is unavailable.");
    owner.next.router.push("/lab?proof-remount=1");
  });
  await expect(page).toHaveURL(/\/lab\?proof-remount=1$/u);
  await expect(page.getByText("consumer-ready", { exact: true })).toBeVisible();

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
  await expect(page.getByText(/Simulated checkout pending human approval/iu)).toBeHidden();
  await page.getByRole("button", { name: "Native cart_get cancellation probe" }).click();
  await expect(nativeReceipt).toContainText('"code": "execution_canceled"');
  await expect(nativeReceipt).toContainText('"nativeCallMade": true');
  await page.getByRole("button", { name: "Hard reset fixture" }).click();
  const resetArticle = page.locator("article").filter({ hasText: "Reset verification receipt" });
  await expect(resetArticle).toContainText('"status": "verified"');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Gate 1 proof JSON" }).click();
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
        archives: Array<{ traces: unknown[] }>;
        resetTraces: unknown[];
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
      status: "canceled",
      stateBeforeDigest: expect.any(String),
      stateAfterDigest: expect.any(String),
      effectDigest: expect.any(String)
    }
  });
  expect(bundle.evidence.traceLedger.totalTraceCount).toBeGreaterThanOrEqual(10);
  expect(bundle.evidence.traceLedger.archives).toHaveLength(1);
  expect(bundle.evidence.traceLedger.resetTraces).toHaveLength(1);
  expect(bundle.evidence.currentReceipts.verifiedReset.status).toBe("verified");
  expect(text).not.toMatch(/"(?:window|execute|signal|controller|cookie)"\s*:/u);
  expect(text).not.toMatch(/\/Users\/|\/home\/|\/mnt\/|\/Volumes\//u);
  expect(download.suggestedFilename()).toMatch(
    /^toolproof-gate1-native-[A-Za-z0-9_-]{1,12}-\d{8}T\d{6}Z\.json$/u
  );
  await expect(page.getByRole("status")).toContainText(bundle.evidenceDigest);
  const exportViolations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(exportViolations).toEqual([]);
  expect(await overflowingElements(page)).toEqual([]);
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
