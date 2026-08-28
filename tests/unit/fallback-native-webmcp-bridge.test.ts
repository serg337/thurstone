import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { FallbackNativeWebMcpBridge } from "@/lib/fallback/native-webmcp-bridge";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import type { Page, WebMCPTool, WebMCPToolCall, WebMCPToolCallResult } from "puppeteer-core";

class FakeWebMcp extends EventEmitter {
  constructor(readonly toolList: WebMCPTool[]) {
    super();
  }

  tools() {
    return this.toolList;
  }
}

interface Harness {
  readonly page: Page;
  readonly webmcp: FakeWebMcp;
  readonly frame: { url(): string };
  readonly tool: WebMCPTool & { execute: ReturnType<typeof vi.fn> };
  readonly manifest: ProbeLiveManifest;
}

function manifest(): ProbeLiveManifest {
  return {
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: "a".repeat(64),
    tools: [
      {
        name: "cart_get",
        title: "Read cart lines",
        description: "Return current cart line-item identities and quantities.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      }
    ]
  };
}

function harness(
  options: {
    readonly output?: unknown;
    readonly execute?: (input: object) => Promise<WebMCPToolCallResult>;
    readonly frameUrl?: string;
    readonly annotations?: { readOnly?: boolean; untrustedContent?: boolean; autosubmit?: boolean };
  } = {}
): Harness {
  const frame = { url: () => options.frameUrl ?? "https://toolproof-rust.vercel.app/lab" };
  const webmcp = new FakeWebMcp([]);
  const tool = {
    name: "cart_get",
    description: "Return current cart line-item identities and quantities.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: options.annotations ?? { readOnly: true, untrustedContent: false },
    frame,
    formElement: Promise.resolve(undefined),
    execute: vi.fn(async (input: object = {}) => {
      if (options.execute) return options.execute(input);
      const call = { id: "invocation_fixture", tool, input } as WebMCPToolCall;
      webmcp.emit("toolinvoked", call);
      const result = {
        id: call.id,
        call,
        status: "Completed",
        output: options.output
      } as WebMCPToolCallResult;
      webmcp.emit("toolresponded", result);
      return result;
    })
  } as unknown as Harness["tool"];
  webmcp.toolList.push(tool);
  const page = {
    url: () => "https://toolproof-rust.vercel.app/lab",
    mainFrame: () => frame,
    webmcp
  } as unknown as Page;
  return { page, webmcp, frame, tool, manifest: manifest() };
}

async function discover(source: Harness) {
  return FallbackNativeWebMcpBridge.discover({
    page: source.page,
    targetOrigin: "https://toolproof-rust.vercel.app/",
    expectedManifest: source.manifest,
    readinessManifestHash: source.manifest.manifestHash,
    registrationGeneration: 3
  });
}

describe("pinned native Puppeteer WebMCP bridge", () => {
  it("binds the exact top-frame live catalog without exposing native handles", async () => {
    const source = harness();
    const bridge = await discover(source);
    expect(bridge.liveManifest).toEqual(source.manifest);
    expect(bridge.catalog).toMatchObject({
      targetOrigin: "https://toolproof-rust.vercel.app",
      pageUrl: "https://toolproof-rust.vercel.app/lab",
      manifestHash: source.manifest.manifestHash,
      registrationGeneration: 3,
      toolNames: ["cart_get"],
      upstreamCommit: "bcb6e93939d7fcf05747ccde913ed77a688e3b94",
      puppeteerCore: "25.4.0"
    });
    expect(bridge.catalog.catalogDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(bridge.catalog)).not.toMatch(/frame|execute|expected/iu);
    bridge.dispose();
  });

  it("rejects duplicate, foreign-frame, descriptor-drifted, autosubmit, or declarative catalogs", async () => {
    const duplicate = harness();
    duplicate.webmcp.toolList.push(duplicate.tool);
    await expect(discover(duplicate)).rejects.toMatchObject({ code: "native_catalog_mismatch" });

    const foreign = harness({ frameUrl: "https://foreign.example/lab" });
    await expect(discover(foreign)).rejects.toMatchObject({ code: "native_catalog_mismatch" });

    const drifted = harness();
    drifted.tool.description = "Changed";
    await expect(discover(drifted)).rejects.toMatchObject({ code: "native_catalog_mismatch" });

    const autosubmit = harness({ annotations: { readOnly: true, autosubmit: true } });
    await expect(discover(autosubmit)).rejects.toMatchObject({ code: "native_catalog_mismatch" });

    const form = harness();
    Object.defineProperty(form.tool, "formElement", {
      value: Promise.resolve({}),
      enumerable: true
    });
    await expect(discover(form)).rejects.toMatchObject({ code: "native_catalog_mismatch" });
  });

  it("calls one exact retained tool identity and preserves false, null, and string output", async () => {
    for (const output of [false, null, "raw-string-result"]) {
      const source = harness({ output });
      const bridge = await discover(source);
      const receipt = await bridge.executeOnce({
        toolName: "cart_get",
        arguments: {},
        manifestHash: source.manifest.manifestHash,
        registrationGeneration: 3,
        timeoutMs: 1_000,
        terminateTrial: vi.fn(async () => undefined)
      });
      expect(source.tool.execute).toHaveBeenCalledTimes(1);
      expect(source.tool.execute).toHaveBeenCalledWith({});
      expect(receipt).toMatchObject({
        toolName: "cart_get",
        nativeCallCount: 1,
        allowanceConsumed: true,
        outcome: "Completed",
        arguments: { bytes: "{}" }
      });
      expect(receipt.rawResult).toMatchObject({ output });
      expect(receipt.invokedEvents).toHaveLength(1);
      expect(receipt.respondedEvents).toHaveLength(1);
      await expect(
        bridge.executeOnce({
          toolName: "cart_get",
          arguments: {},
          manifestHash: source.manifest.manifestHash,
          registrationGeneration: 3,
          timeoutMs: 1_000,
          terminateTrial: vi.fn(async () => undefined)
        })
      ).rejects.toMatchObject({
        code: "native_allowance_consumed"
      });
      bridge.dispose();
    }
  });

  it("fails before dispatch on catalog drift, unknown tools, or accessor arguments", async () => {
    const drift = harness();
    const driftBridge = await discover(drift);
    drift.webmcp.emit("toolsremoved", { tools: [drift.tool] });
    await expect(
      driftBridge.executeOnce({
        toolName: "cart_get",
        arguments: {},
        manifestHash: drift.manifest.manifestHash,
        registrationGeneration: 3,
        timeoutMs: 1_000,
        terminateTrial: vi.fn(async () => undefined)
      })
    ).rejects.toMatchObject({ code: "native_catalog_drift" });
    expect(drift.tool.execute).not.toHaveBeenCalled();

    const replaced = harness();
    const replacedBridge = await discover(replaced);
    const replacement = { ...replaced.tool } as unknown as WebMCPTool;
    replaced.webmcp.toolList.splice(0, 1, replacement);
    await expect(replacedBridge.verifyStillCurrent()).rejects.toMatchObject({
      code: "native_catalog_drift"
    });
    expect(replaced.tool.execute).not.toHaveBeenCalled();

    const unknown = harness();
    const unknownBridge = await discover(unknown);
    await expect(
      unknownBridge.executeOnce({
        toolName: "missing",
        arguments: {},
        manifestHash: unknown.manifest.manifestHash,
        registrationGeneration: 3,
        timeoutMs: 1_000,
        terminateTrial: vi.fn(async () => undefined)
      })
    ).rejects.toMatchObject({ code: "native_tool_not_registered" });
    expect(unknown.tool.execute).not.toHaveBeenCalled();

    const accessor = harness();
    const accessorBridge = await discover(accessor);
    const argumentsValue = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        throw new Error("must not run");
      }
    });
    await expect(
      accessorBridge.executeOnce({
        toolName: "cart_get",
        arguments: argumentsValue,
        manifestHash: accessor.manifest.manifestHash,
        registrationGeneration: 3,
        timeoutMs: 1_000,
        terminateTrial: vi.fn(async () => undefined)
      })
    ).rejects.toMatchObject({ code: "invalid_native_arguments" });
    expect(accessor.tool.execute).not.toHaveBeenCalled();
  });

  it("records throws, evidence mismatch, and timeout without retrying", async () => {
    const rejected = harness({
      execute: async () => {
        throw new Error("handler failed");
      }
    });
    const rejectedReceipt = await (
      await discover(rejected)
    ).executeOnce({
      toolName: "cart_get",
      arguments: {},
      manifestHash: rejected.manifest.manifestHash,
      registrationGeneration: 3,
      timeoutMs: 1_000,
      terminateTrial: vi.fn(async () => undefined)
    });
    expect(rejectedReceipt.outcome).toBe("Thrown");
    expect(rejected.tool.execute).toHaveBeenCalledTimes(1);

    const mismatch = harness({
      execute: async (input) => ({
        id: "missing-events",
        call: { id: "missing-events", tool: mismatch.tool, input } as WebMCPToolCall,
        status: "Completed",
        output: true
      })
    });
    const mismatchReceipt = await (
      await discover(mismatch)
    ).executeOnce({
      toolName: "cart_get",
      arguments: {},
      manifestHash: mismatch.manifest.manifestHash,
      registrationGeneration: 3,
      timeoutMs: 1_000,
      terminateTrial: vi.fn(async () => undefined)
    });
    expect(mismatchReceipt.outcome).toBe("EvidenceMismatch");
    expect(mismatch.tool.execute).toHaveBeenCalledTimes(1);

    const timeout = harness({ execute: async () => await new Promise(() => {}) });
    const terminateTrial = vi.fn(async () => undefined);
    const timeoutReceipt = await (
      await discover(timeout)
    ).executeOnce({
      toolName: "cart_get",
      arguments: {},
      manifestHash: timeout.manifest.manifestHash,
      registrationGeneration: 3,
      timeoutMs: 1,
      terminateTrial
    });
    expect(timeoutReceipt.outcome).toBe("TimedOut");
    expect(timeout.tool.execute).toHaveBeenCalledTimes(1);
    expect(terminateTrial).toHaveBeenCalledExactlyOnceWith("native_timeout");
  });
});

// Compile-time pin: Puppeteer 25.4.0 exposes execute(input?) only. No AbortSignal overload exists.
const executePinnedTool = (tool: WebMCPTool, input: object) => tool.execute(input);
void executePinnedTool;
