import { expect, test, type BrowserContext, type Download, type Page } from "@playwright/test";

const BUILD_COMMIT = "e".repeat(40);
const REQUESTS = [
  "What items and quantities are currently in my cart?",
  "Please review my current order, including line prices, shipping cost, delivery timing, and the total.",
  "Set the Stoneware mug quantity in my cart to 3.",
  "I am ready to continue. Open the simulated checkout for this cart so it can remain pending for my approval."
] as const;
const TOOLS = ["cart_get", "order_review", "cart_update", "checkout_request"] as const;
const ARGUMENTS = [
  {},
  {},
  {
    operationId: "calibration_update_0001",
    operation: "set_quantity",
    itemId: "stoneware-mug",
    quantity: 3
  },
  { operationId: "calibration_request_001" }
] as const;

function continuation(ordinal: number): string {
  return `tpse1.browser_fixture_${ordinal}_${"x".repeat(48)}`;
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  let text = "";
  for await (const chunk of stream) text += chunk.toString();
  return text;
}

async function installConsumer(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
            ? { inputSchema: JSON.stringify(tool.inputSchema) as unknown as object }
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
        const registration = this.active.get(selected.name);
        if (!registration) throw new Error(`Inactive fixture tool: ${selected.name}`);
        const semanticInput = JSON.parse(String(input)) as Record<string, unknown>;
        const result = await Reflect.apply(
          registration.tool.execute,
          registration.tool,
          options?.signal ? [semanticInput, { signal: options.signal }] : [semanticInput]
        );
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (registration.signal?.aborted) {
          throw new Error("Fixture registration retired before native result delivery.");
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
  });
}

async function seedEvaluationSession(
  page: Page,
  context: BrowserContext,
  firstContinuation: string
): Promise<void> {
  await context.addCookies([
    {
      name: "toolproof_probe_session",
      value: "browser-fixture-session",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict"
    }
  ]);
  await page.addInitScript(
    ({ buildCommit, continuationToken }) => {
      if (location.pathname !== "/lab") return;
      if (sessionStorage.getItem("toolproof:probe-calibration-session@1")) return;
      sessionStorage.setItem(
        "toolproof:probe-calibration-session@1",
        JSON.stringify({
          version: 1,
          csrfToken: "browser_fixture_csrf_token_00000001",
          continuation: continuationToken,
          buildCommit,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
          path: "/lab"
        })
      );
    },
    { buildCommit: BUILD_COMMIT, continuationToken: firstContinuation }
  );
}

test("four-case fake-provider harness reloads fresh documents and reveals only terminal evidence", async ({
  page,
  context
}) => {
  test.skip(Boolean(process.env.TOOLPROOF_BASE_URL), "The fake-provider harness is local-only.");
  await installConsumer(page);
  await seedEvaluationSession(page, context, continuation(0));

  let ordinal = 0;
  const completedBodies: unknown[] = [];

  await page.route("**/api/probe/issue", async (route) => {
    const body = route.request().postDataJSON() as {
      continuation: string;
      fixture: unknown;
      liveManifest: unknown;
      initialBoundary: { status: string; currentTrajectoryCount: number };
    };
    expect(body.continuation).toBe(continuation(ordinal));
    expect(body.initialBoundary).toMatchObject({ status: "verified", currentTrajectoryCount: 0 });
    const caseId = `case_${String(ordinal).padStart(22, "0")}`;
    const trialId = `trial_${String(ordinal).padStart(22, "0")}`;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-probe-service@1.0.0",
        status: "issued",
        runId: `run_${"r".repeat(22)}`,
        caseId,
        trialId,
        authorization: {
          version: 1,
          probeToken: `probe_token_${"t".repeat(32)}_${ordinal}`,
          continuation: body.continuation,
          envelope: {
            version: "toolproof-probe-calibration-envelope@1.0.0",
            purpose: "calibration",
            buildCommit: BUILD_COMMIT,
            runId: `run_${"r".repeat(22)}`,
            caseId,
            trialId,
            naturalLanguageRequest: REQUESTS[ordinal],
            fixture: body.fixture,
            liveManifest: body.liveManifest,
            runner: {
              promptVersion: "toolproof-probe-runner-prompt@1.0.0",
              promptHash: "a".repeat(64),
              settingsVersion: "toolproof-probe-runner-settings@1.0.0",
              settingsHash: "b".repeat(64),
              decisionSchemaHash: "c".repeat(64)
            }
          }
        }
      })
    });
  });

  await page.route("**/api/probe/decide", async (route) => {
    const tool = TOOLS[ordinal];
    const args = ARGUMENTS[ordinal];
    const requestBody = route.request().postDataJSON() as {
      envelope: { naturalLanguageRequest: string };
    };
    expect(requestBody.envelope.naturalLanguageRequest).toBe(REQUESTS[ordinal]);
    for (const [index, priorRequest] of REQUESTS.entries()) {
      if (index < ordinal) expect(JSON.stringify(requestBody)).not.toContain(priorRequest);
    }
    expect(JSON.stringify(requestBody)).not.toMatch(
      /expectedTool|internalTruthId|calibration_truth_/u
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        context: {
          kind: "fresh-stateless",
          previousResponseId: null,
          providerRequestCount: 1
        },
        rawModelResponse: JSON.stringify({ id: `resp_browser_${ordinal}` }),
        providerReceipt: {
          version: 1,
          token: `provider_receipt_${"p".repeat(32)}_${ordinal}`,
          receipt: { responseId: `resp_browser_${ordinal}` }
        },
        decision: { kind: "call", tool, arguments: args }
      })
    });
  });

  await page.route("**/api/probe/native", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        status: "admitted",
        jti: `jti_${String(ordinal).padStart(22, "0")}`,
        inferencePerformed: false
      })
    });
  });

  await page.route("**/api/probe/complete", async (route) => {
    const body = route.request().postDataJSON() as {
      completion: {
        nativeDispatchCount: number;
        postResetBoundary: { status: string; currentTrajectoryCount: number };
        evidence: {
          capture: {
            decision: { tool: string };
            executionResult: {
              receipt: { toolName: string; nativeCallCount: number };
              trace: { source: string; status: string };
            };
          };
        };
      };
    };
    expect(JSON.stringify(body)).not.toMatch(/expectedTool|internalTruthId|calibration_truth_/u);
    const browserSurface = await page.evaluate(() => ({
      text: document.body.textContent ?? "",
      url: location.href,
      storage: Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index) ?? "";
          return [key, sessionStorage.getItem(key) ?? ""];
        })
      )
    }));
    expect(browserSurface.url).toMatch(/\/lab$/u);
    expect(browserSurface.text).not.toMatch(/expectedTool|internalTruthId|calibration_truth_/u);
    for (const requestText of REQUESTS) expect(browserSurface.text).not.toContain(requestText);
    expect(Object.keys(browserSurface.storage)).toEqual(["toolproof:probe-calibration-session@1"]);
    expect(Object.values(browserSurface.storage).join("\n")).not.toMatch(
      /expectedTool|internalTruthId|calibration_truth_/u
    );
    for (const requestText of REQUESTS) {
      expect(Object.values(browserSurface.storage).join("\n")).not.toContain(requestText);
    }
    expect(body.completion.nativeDispatchCount).toBe(1);
    expect(body.completion.postResetBoundary).toMatchObject({
      status: "verified",
      currentTrajectoryCount: 0
    });
    expect(body.completion.evidence.capture).toMatchObject({
      decision: { tool: TOOLS[ordinal] },
      executionResult: {
        receipt: { toolName: TOOLS[ordinal], nativeCallCount: 1 },
        trace: { source: "native", status: "completed" }
      }
    });
    completedBodies.push(body);
    const completed = ordinal + 1;
    const terminal = ordinal === 3;
    ordinal = completed;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      ...(terminal
        ? {
            headers: {
              "set-cookie": "toolproof_probe_results=terminal; Path=/; HttpOnly; SameSite=Strict"
            }
          }
        : {}),
      body: JSON.stringify({
        status: "sealed",
        continuation: continuation(completed),
        completedCount: completed,
        terminal
      })
    });
  });

  await page.route("**/api/probe/reveal", async (route) => {
    expect((route.request().postDataJSON() as { continuation: string }).continuation).toBe(
      continuation(4)
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-gate2-calibration-evidence@1.0.0",
        lane: "custom-probe-calibration",
        calibrationOnly: true,
        includedInBenchmark: false,
        appCommit: BUILD_COMMIT,
        caseCount: 4,
        passedCount: 4,
        evidenceDigest: "d".repeat(64),
        cases: TOOLS.map((tool, index) => ({
          ordinal: index,
          evaluation: { expectedTool: tool, observedTool: tool, passed: true, failures: [] }
        }))
      })
    });
  });

  const downloadPromise = page.waitForEvent("download");
  await page.goto("/lab");
  await expect(
    page.getByRole("heading", { name: "One fresh decision. No prior evidence." })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("calibration_truth_");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^toolproof-gate2-calibration-/u);
  const downloadedBundle = JSON.parse(await downloadText(download)) as {
    lane: string;
    caseCount: number;
    evidenceDigest: string;
  };
  expect(downloadedBundle).toMatchObject({
    lane: "custom-probe-calibration",
    caseCount: 4,
    evidenceDigest: "d".repeat(64)
  });
  await expect(page).toHaveURL(/\/results$/u);
  await expect(
    page.getByRole("heading", { name: "Four fresh-context trials sealed" })
  ).toBeVisible();
  await expect(page.getByText("4/4 verified", { exact: true })).toBeVisible();
  expect(completedBodies).toHaveLength(4);
  expect(ordinal).toBe(4);
});

test("an already-admitted recovered trial never dispatches the target again", async ({
  page,
  context
}) => {
  test.skip(Boolean(process.env.TOOLPROOF_BASE_URL), "The fake-provider harness is local-only.");
  await installConsumer(page);
  await seedEvaluationSession(page, context, continuation(0));
  const runId = `run_${"r".repeat(22)}`;
  const caseId = `case_${"2".repeat(22)}`;
  const trialId = `trial_${"2".repeat(22)}`;
  let decisionRequests = 0;
  let nativeAdmissions = 0;
  let completions = 0;

  await page.route("**/api/probe/issue", async (route) => {
    const body = route.request().postDataJSON() as { fixture: unknown; liveManifest: unknown };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-probe-service@1.0.0",
        status: "issued",
        runId,
        caseId,
        trialId,
        authorization: {
          version: 1,
          probeToken: `probe_token_${"t".repeat(32)}_recovery`,
          continuation: continuation(0),
          envelope: {
            version: "toolproof-probe-calibration-envelope@1.0.0",
            purpose: "calibration",
            buildCommit: BUILD_COMMIT,
            runId,
            caseId,
            trialId,
            naturalLanguageRequest: REQUESTS[2],
            fixture: body.fixture,
            liveManifest: body.liveManifest,
            runner: {
              promptVersion: "toolproof-probe-runner-prompt@1.0.0",
              promptHash: "a".repeat(64),
              settingsVersion: "toolproof-probe-runner-settings@1.0.0",
              settingsHash: "b".repeat(64),
              decisionSchemaHash: "c".repeat(64)
            }
          }
        }
      })
    });
  });
  await page.route("**/api/probe/decide", async (route) => {
    decisionRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        context: {
          kind: "fresh-stateless",
          previousResponseId: null,
          providerRequestCount: 1
        },
        rawModelResponse: JSON.stringify({ id: "resp_recovered" }),
        providerReceipt: {
          version: 1,
          token: `provider_receipt_${"p".repeat(32)}_recovery`,
          receipt: { responseId: "resp_recovered" }
        },
        decision: { kind: "call", tool: "cart_update", arguments: ARGUMENTS[2] }
      })
    });
  });
  await page.route("**/api/probe/native", async (route) => {
    nativeAdmissions += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "already-admitted",
        jti: `jti_${"2".repeat(22)}`,
        inferencePerformed: false
      })
    });
  });
  await page.route("**/api/probe/complete", async (route) => {
    completions += 1;
    const body = route.request().postDataJSON() as {
      completion: {
        terminalStatus: string;
        nativeDispatchCount: number;
        evidence: {
          capture: {
            executionResult: unknown;
            errors: { execution: { code?: string } };
          };
          currentTraces: unknown[];
        };
      };
    };
    expect(body.completion).toMatchObject({
      terminalStatus: "call_failed",
      nativeDispatchCount: 1,
      evidence: {
        capture: {
          executionResult: null,
          errors: { execution: { code: "native_allowance_already_consumed" } }
        },
        currentTraces: []
      }
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "set-cookie": "toolproof_probe_results=terminal; Path=/; HttpOnly; SameSite=Strict"
      },
      body: JSON.stringify({
        status: "sealed",
        continuation: continuation(4),
        completedCount: 4,
        terminal: true
      })
    });
  });
  await page.route("**/api/probe/reveal", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "toolproof-gate2-calibration-evidence@1.0.0",
        lane: "custom-probe-calibration",
        calibrationOnly: true,
        includedInBenchmark: false,
        appCommit: BUILD_COMMIT,
        caseCount: 4,
        passedCount: 0,
        evidenceDigest: "d".repeat(64),
        cases: Array.from({ length: 4 }, (_, ordinal) => ({
          ordinal,
          evaluation: { observedTool: null, passed: false, failures: ["recovered"] }
        }))
      })
    });
  });

  const downloadPromise = page.waitForEvent("download");
  await page.goto("/lab");
  await downloadPromise;
  await expect(page).toHaveURL(/\/results$/u);
  expect(decisionRequests).toBe(1);
  expect(nativeAdmissions).toBe(1);
  expect(completions).toBe(1);
});

test("a duplicate tab without the opaque marker stays locked and cannot open Results", async ({
  page,
  context
}) => {
  test.skip(Boolean(process.env.TOOLPROOF_BASE_URL), "The fake-provider harness is local-only.");
  await installConsumer(page);
  await context.addCookies([
    {
      name: "toolproof_probe_session",
      value: "browser-fixture-session",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict"
    }
  ]);
  await page.goto("/results");
  await expect(page).toHaveURL(/\/lab$/u);
  await expect(
    page.getByRole("heading", { name: "One fresh decision. No prior evidence." })
  ).toBeVisible();
  await expect(page.getByText(/probe_session_marker_missing/u)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Native cart_get", exact: true })).toHaveCount(0);
});

test("an unverifiable session cookie fails closed to a locked recovery surface", async ({
  page,
  context
}) => {
  test.skip(Boolean(process.env.TOOLPROOF_BASE_URL), "The fake-provider harness is local-only.");
  await context.addCookies([
    {
      name: "toolproof_probe_session",
      value: "invalid-browser-fixture-session",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict"
    }
  ]);
  await page.goto("/lab");
  await expect(
    page.getByRole("heading", { name: "The isolated session could not be verified." })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Native cart_get", exact: true })).toHaveCount(0);
});
