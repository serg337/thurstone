import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ControlledMismatchV3 } from "@/components/demo/controlled-mismatch-v3";
import {
  CONTROLLED_MISMATCH_LABEL,
  runControlledMismatchV3
} from "@/lib/demo/controlled-mismatch-v3";
import { WebMcpRegistryManager } from "@/lib/webmcp/registry-manager";
import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

const BUILD_COMMIT = "a".repeat(40);

class EmulatedJsonStringConsumer extends EventTarget {
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
    this.active.set(tool.name, { tool, ...(options?.signal ? { signal: options.signal } : {}) });
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
    if (!registration) throw new Error(`Emulated tool is not active: ${selected.name}`);
    const semanticInput = JSON.parse(String(input)) as Record<string, unknown>;
    const result = await Reflect.apply(
      registration.tool.execute,
      registration.tool,
      options?.signal ? [semanticInput, { signal: options.signal }] : [semanticInput]
    );
    return JSON.stringify(result);
  }
}

afterEach(() => cleanup());

describe("ControlledMismatchV3", () => {
  it("runs one wrong real tool through the JSON-string consumer and evaluates a separate ISSUE", async () => {
    const emulator = new EmulatedJsonStringConsumer();
    const context = emulator as unknown as RuntimeModelContext;
    const registryManager = new WebMcpRegistryManager();
    const run = await runControlledMismatchV3({
      context,
      buildCommit: BUILD_COMMIT,
      startedAt: "2026-09-01T10:00:00.000Z",
      registryManager
    });

    expect(run.result.verdict).toBe("issue");
    expect(run.result.launchMode).toBe("controlled-example");
    expect(run.result.evidenceTier).toBe("deterministic-controlled-example");
    expect(run.result.includedInReferenceScore).toBe(false);
    expect(run.result.selectedExpectedTool).toBe("checkout_request");
    expect(run.result.observedTool).toBe("order_review");
    expect(run.rawConsumerResult).toContain('"ok":true');
    expect(run.result.trustedStateBefore.value).toEqual(run.result.trustedStateAfter.value);
    expect(run.result.ledgerDiff.eventCountDelta).toBe(1);
    expect(run.result.ledgerDiff.stateTransitionCount).toBe(0);
    expect(
      run.result.assertions.filter(({ passed }) => !passed).map(({ assertionId }) => assertionId)
    ).toEqual(
      expect.arrayContaining([
        "selection.expected-tool-v3",
        "arguments.contract-predicate-v3",
        "effects.required-state-v3"
      ])
    );
    expect(emulator.active.size).toBe(0);
  });

  it("labels the explicit supplemental action and keeps it separate from scores", () => {
    render(createElement(ControlledMismatchV3, { buildCommit: BUILD_COMMIT }));
    expect(screen.getByText(CONTROLLED_MISMATCH_LABEL)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run controlled mismatch" })).toBeVisible();
    expect(
      screen.getByText(/separate from your live result and every reference score/iu)
    ).toBeVisible();
    expect(screen.getByText(/Thurstone did not change the behavior/iu)).toBeVisible();
  });
});
