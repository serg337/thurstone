/*
 * Copyright 2026 Google LLC
 * Modifications Copyright 2026 Sergio Valencia
 * SPDX-License-Identifier: Apache-2.0
 *
 * Derived from the native Page.webmcp pattern in GoogleChromeLabs/webmcp-tools
 * webmcp-evals/src/evaluator/browser.ts at commit
 * bcb6e93939d7fcf05747ccde913ed77a688e3b94 (source SHA-256
 * d70f9ab511ecb5ab70f21000f12a56030f49e96c3cbb27557248a55ff7657bca).
 * ToolProof modifications add strict catalog binding, single-call admission, raw evidence,
 * descriptor-safe capture, and fail-closed drift/event correlation.
 */

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { normalizeJsonSafe } from "@/lib/evidence/operation-trace";
import { probeLiveManifestSchema, type ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import type { ProbeClientJsonValue } from "@/lib/probe/client-runner";
import type {
  Page,
  WebMCPTool,
  WebMCPToolCall,
  WebMCPToolCallResult,
  WebMCPToolsAddedEvent,
  WebMCPToolsRemovedEvent
} from "puppeteer-core";
import { z } from "zod";

export const FALLBACK_NATIVE_BRIDGE_VERSION = "toolproof-fallback-native-bridge@1.0.0";

const argumentsSchema = z.record(z.string(), z.json());
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export class FallbackNativeBridgeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FallbackNativeBridgeError";
  }
}

export interface FallbackNativeCatalogReceipt {
  readonly version: typeof FALLBACK_NATIVE_BRIDGE_VERSION;
  readonly targetOrigin: string;
  readonly pageUrl: string;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly toolNames: readonly string[];
  readonly catalogDigest: string;
  readonly upstreamCommit: "bcb6e93939d7fcf05747ccde913ed77a688e3b94";
  readonly puppeteerCore: "25.4.0";
}

export interface FallbackNativeExecutionReceipt {
  readonly version: typeof FALLBACK_NATIVE_BRIDGE_VERSION;
  readonly toolName: string;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly allowanceConsumed: true;
  readonly nativeCallCount: 1;
  readonly arguments: {
    readonly value: Readonly<Record<string, ProbeClientJsonValue>>;
    readonly bytes: string;
    readonly sha256: string;
  };
  readonly outcome: "Completed" | "Canceled" | "Error" | "Thrown" | "TimedOut" | "EvidenceMismatch";
  readonly rawResult: ReturnType<typeof normalizeJsonSafe> | null;
  readonly invokedEvents: readonly ReturnType<typeof normalizeJsonSafe>[];
  readonly respondedEvents: readonly ReturnType<typeof normalizeJsonSafe>[];
  readonly error: ReturnType<typeof normalizeJsonSafe> | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

function exactOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FallbackNativeBridgeError("invalid_target_origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    throw new FallbackNativeBridgeError("invalid_target_origin");
  }
  return parsed.origin;
}

function jsonArguments(value: Readonly<Record<string, unknown>>) {
  const snapshot = strictJsonValue(value, { nodes: 0, stack: new WeakSet() }, 0);
  const parsed = argumentsSchema.safeParse(snapshot);
  if (!parsed.success) throw new FallbackNativeBridgeError("invalid_native_arguments");
  const bytes = canonicalJson(parsed.data);
  return { value: parsed.data, bytes };
}

interface StrictJsonState {
  nodes: number;
  readonly stack: WeakSet<object>;
}

function strictJsonValue(
  value: unknown,
  state: StrictJsonState,
  depth: number
): ProbeClientJsonValue {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 24) {
    throw new FallbackNativeBridgeError("invalid_native_arguments");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 100_000) throw new FallbackNativeBridgeError("invalid_native_arguments");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FallbackNativeBridgeError("invalid_native_arguments");
    return value;
  }
  if (typeof value !== "object" || state.stack.has(value)) {
    throw new FallbackNativeBridgeError("invalid_native_arguments");
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value) && prototype !== Array.prototype) ||
    (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new FallbackNativeBridgeError("invalid_native_arguments");
  }
  state.stack.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))
        )
      ) {
        throw new FallbackNativeBridgeError("invalid_native_arguments");
      }
      const output: ProbeClientJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new FallbackNativeBridgeError("invalid_native_arguments");
        }
        output.push(strictJsonValue(descriptor.value, state, depth + 1));
      }
      return output;
    }
    const output: Record<string, ProbeClientJsonValue> = Object.create(null) as Record<
      string,
      ProbeClientJsonValue
    >;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 256 || keys.some((key) => typeof key !== "string")) {
      throw new FallbackNativeBridgeError("invalid_native_arguments");
    }
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new FallbackNativeBridgeError("invalid_native_arguments");
      }
      output[key] = strictJsonValue(descriptor.value, state, depth + 1);
    }
    return output;
  } finally {
    state.stack.delete(value);
  }
}

function annotationProjection(tool: WebMCPTool) {
  return {
    readOnlyHint: tool.annotations?.readOnly === true,
    untrustedContentHint: tool.annotations?.untrustedContent === true
  };
}

function toolMismatch(tool: WebMCPTool, expected: ProbeLiveManifest["tools"][number]): boolean {
  return (
    tool.name !== expected.name ||
    tool.description !== expected.description ||
    tool.inputSchema === undefined ||
    canonicalJson(tool.inputSchema) !== canonicalJson(expected.inputSchema) ||
    canonicalJson(annotationProjection(tool)) !== canonicalJson(expected.annotations) ||
    tool.annotations?.autosubmit === true
  );
}

function eventMatches(
  call: WebMCPToolCall,
  tool: WebMCPTool,
  inputBytes: string,
  resultId?: string
): boolean {
  return (
    call.tool === tool &&
    (resultId === undefined || call.id === resultId) &&
    canonicalJson(strictJsonValue(call.input, { nodes: 0, stack: new WeakSet() }, 0)) === inputBytes
  );
}

function resultEvidenceMatches(
  result: WebMCPToolCallResult,
  tool: WebMCPTool,
  inputBytes: string,
  invoked: readonly WebMCPToolCall[],
  responded: readonly WebMCPToolCallResult[]
): boolean {
  try {
    if (
      invoked.length !== 1 ||
      responded.length !== 1 ||
      !result.call ||
      responded[0] !== result ||
      result.id !== responded[0].id
    ) {
      return false;
    }
    return (
      eventMatches(invoked[0]!, tool, inputBytes, result.id) &&
      eventMatches(result.call, tool, inputBytes, result.id)
    );
  } catch {
    return false;
  }
}

function callEvidence(call: WebMCPToolCall) {
  return normalizeJsonSafe({
    id: call.id,
    toolName: call.tool.name,
    input: normalizeJsonSafe(call.input)
  });
}

function responseEvidence(result: WebMCPToolCallResult) {
  return normalizeJsonSafe({
    id: result.id,
    status: result.status,
    call: result.call ? callEvidence(result.call) : null,
    outputPresent: Object.hasOwn(result, "output"),
    output: Object.hasOwn(result, "output") ? normalizeJsonSafe(result.output) : null,
    errorText: result.errorText ?? null,
    exception: result.exception === undefined ? null : normalizeJsonSafe(result.exception)
  });
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

export class FallbackNativeWebMcpBridge {
  readonly catalog: FallbackNativeCatalogReceipt;
  readonly liveManifest: ProbeLiveManifest;

  #page: Page;
  #handles: ReadonlyMap<string, WebMCPTool>;
  #consumed = false;
  #drifted = false;
  #onToolsAdded: (event: WebMCPToolsAddedEvent) => void;
  #onToolsRemoved: (event: WebMCPToolsRemovedEvent) => void;

  private constructor(input: {
    page: Page;
    handles: ReadonlyMap<string, WebMCPTool>;
    liveManifest: ProbeLiveManifest;
    catalog: FallbackNativeCatalogReceipt;
  }) {
    this.#page = input.page;
    this.#handles = input.handles;
    this.liveManifest = input.liveManifest;
    this.catalog = input.catalog;
    this.#onToolsAdded = () => {
      this.#drifted = true;
    };
    this.#onToolsRemoved = () => {
      this.#drifted = true;
    };
    this.#page.webmcp.on("toolsadded", this.#onToolsAdded);
    this.#page.webmcp.on("toolsremoved", this.#onToolsRemoved);
  }

  static async discover(input: {
    readonly page: Page;
    readonly targetOrigin: string;
    readonly expectedManifest: ProbeLiveManifest;
    readonly readinessManifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<FallbackNativeWebMcpBridge> {
    const targetOrigin = exactOrigin(input.targetOrigin);
    const expected = probeLiveManifestSchema.parse(input.expectedManifest);
    if (
      input.readinessManifestHash !== expected.manifestHash ||
      !SHA256_PATTERN.test(input.readinessManifestHash) ||
      !Number.isSafeInteger(input.registrationGeneration) ||
      input.registrationGeneration < 1
    ) {
      throw new FallbackNativeBridgeError("invalid_readiness_binding");
    }
    const pageUrl = input.page.url();
    if (new URL(pageUrl).origin !== targetOrigin) {
      throw new FallbackNativeBridgeError("target_origin_mismatch");
    }
    const discovered = input.page.webmcp.tools();
    const expectedByName = new Map(expected.tools.map((tool) => [tool.name, tool]));
    if (
      discovered.length !== expected.tools.length ||
      new Set(discovered.map(({ name }) => name)).size !== discovered.length
    ) {
      throw new FallbackNativeBridgeError("native_catalog_mismatch");
    }
    const handles = new Map<string, WebMCPTool>();
    for (const tool of discovered) {
      const expectedTool = expectedByName.get(tool.name);
      if (
        !expectedTool ||
        tool.frame !== input.page.mainFrame() ||
        new URL(tool.frame.url()).origin !== targetOrigin ||
        toolMismatch(tool, expectedTool) ||
        (await tool.formElement) !== undefined
      ) {
        throw new FallbackNativeBridgeError("native_catalog_mismatch");
      }
      handles.set(tool.name, tool);
    }
    const toolNames = Object.freeze(
      [...handles.keys()].sort((left, right) => left.localeCompare(right))
    );
    const catalog = Object.freeze({
      version: FALLBACK_NATIVE_BRIDGE_VERSION,
      targetOrigin,
      pageUrl,
      manifestHash: expected.manifestHash,
      registrationGeneration: input.registrationGeneration,
      toolNames,
      catalogDigest: await canonicalSha256({
        manifest: expected,
        targetOrigin,
        pageUrl,
        registrationGeneration: input.registrationGeneration
      }),
      upstreamCommit: "bcb6e93939d7fcf05747ccde913ed77a688e3b94" as const,
      puppeteerCore: "25.4.0" as const
    });
    return new FallbackNativeWebMcpBridge({
      page: input.page,
      handles,
      liveManifest: expected,
      catalog
    });
  }

  async executeOnce(input: {
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
    readonly timeoutMs: number;
    readonly terminateTrial: (reason: "native_timeout") => Promise<void>;
    readonly nowMs?: () => number;
  }): Promise<FallbackNativeExecutionReceipt> {
    if (this.#consumed) throw new FallbackNativeBridgeError("native_allowance_consumed");
    if (
      this.#drifted ||
      input.manifestHash !== this.catalog.manifestHash ||
      input.registrationGeneration !== this.catalog.registrationGeneration
    ) {
      throw new FallbackNativeBridgeError("native_catalog_drift");
    }
    const tool = this.#handles.get(input.toolName);
    if (!tool) throw new FallbackNativeBridgeError("native_tool_not_registered");
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30_000) {
      throw new FallbackNativeBridgeError("invalid_native_timeout");
    }
    const argumentsEvidence = jsonArguments(input.arguments);
    this.#consumed = true;
    const invoked: WebMCPToolCall[] = [];
    const responded: WebMCPToolCallResult[] = [];
    const onInvoked = (event: WebMCPToolCall) => invoked.push(event);
    const onResponded = (event: WebMCPToolCallResult) => responded.push(event);
    this.#page.webmcp.on("toolinvoked", onInvoked);
    this.#page.webmcp.on("toolresponded", onResponded);
    const nowMs = input.nowMs ?? Date.now;
    const startedMs = nowMs();
    let result: WebMCPToolCallResult | null = null;
    let thrown: unknown = null;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new FallbackNativeBridgeError("native_timeout")),
          input.timeoutMs
        );
      });
      result = await Promise.race([tool.execute(argumentsEvidence.value), timeoutPromise]);
    } catch (error) {
      if (error instanceof FallbackNativeBridgeError && error.code === "native_timeout") {
        timedOut = true;
        await input.terminateTrial("native_timeout");
      } else {
        thrown = error;
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.#page.webmcp.off("toolinvoked", onInvoked);
      this.#page.webmcp.off("toolresponded", onResponded);
    }
    const completedMs = nowMs();
    const correlated =
      result !== null &&
      resultEvidenceMatches(result, tool, argumentsEvidence.bytes, invoked, responded);
    const outcome = timedOut
      ? "TimedOut"
      : thrown !== null
        ? "Thrown"
        : !correlated
          ? "EvidenceMismatch"
          : result!.status;
    return Object.freeze({
      version: FALLBACK_NATIVE_BRIDGE_VERSION,
      toolName: input.toolName,
      manifestHash: input.manifestHash,
      registrationGeneration: input.registrationGeneration,
      allowanceConsumed: true as const,
      nativeCallCount: 1 as const,
      arguments: Object.freeze({
        value: argumentsEvidence.value,
        bytes: argumentsEvidence.bytes,
        sha256: await sha256Hex(argumentsEvidence.bytes)
      }),
      outcome: outcome as FallbackNativeExecutionReceipt["outcome"],
      rawResult: result === null ? null : responseEvidence(result),
      invokedEvents: Object.freeze(invoked.map(callEvidence)),
      respondedEvents: Object.freeze(responded.map(responseEvidence)),
      error: thrown === null && !timedOut ? null : normalizeJsonSafe(thrown ?? "native_timeout"),
      startedAt: iso(startedMs),
      completedAt: iso(completedMs),
      durationMs: Math.max(0, completedMs - startedMs)
    });
  }

  async verifyStillCurrent(): Promise<FallbackNativeCatalogReceipt> {
    if (this.#drifted) throw new FallbackNativeBridgeError("native_catalog_drift");
    const current = this.#page.webmcp.tools();
    if (current.length !== this.#handles.size) {
      throw new FallbackNativeBridgeError("native_catalog_drift");
    }
    const expectedByName = new Map(this.liveManifest.tools.map((tool) => [tool.name, tool]));
    for (const tool of current) {
      const retained = this.#handles.get(tool.name);
      const expected = expectedByName.get(tool.name);
      if (
        retained !== tool ||
        !expected ||
        tool.frame !== this.#page.mainFrame() ||
        new URL(tool.frame.url()).origin !== this.catalog.targetOrigin ||
        toolMismatch(tool, expected) ||
        (await tool.formElement) !== undefined
      ) {
        throw new FallbackNativeBridgeError("native_catalog_drift");
      }
    }
    return this.catalog;
  }

  dispose(): void {
    this.#page.webmcp.off("toolsadded", this.#onToolsAdded);
    this.#page.webmcp.off("toolsremoved", this.#onToolsRemoved);
  }
}
