import { describe, expect, it, vi } from "vitest";

import { cartGet, checkoutRequest, createCheckoutFixture } from "@/lib/domain/checkout";
import { canonicalSha256 } from "@/lib/evidence/digest";
import { checkoutEffectDiff } from "@/lib/evidence/operation-trace";
import { checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import {
  createRegistryReadinessReceipt,
  type CreateRegistryReadinessOptions,
  type RegistryReadinessReceipt
} from "@/lib/webmcp/readiness";
import type { RuntimeCompatibilityReceipt } from "@/lib/webmcp/runtime";

const EXPECTED_INITIAL_TOOL_NAMES = [
  "cart_get",
  "cart_update",
  "checkout_request",
  "order_review"
] as const;

const EXPECTED_PENDING_TOOL_NAMES = [
  "cart_get",
  "cart_update",
  "checkout_cancel",
  "checkout_request",
  "order_review"
] as const;

function providerContext(overrides: Partial<WebMCP.ModelContext> = {}): WebMCP.ModelContext {
  return {
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => []),
    ontoolchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    ...overrides
  } as unknown as WebMCP.ModelContext;
}

function discoveredTools(
  state = createCheckoutFixture(),
  overrides: Readonly<Record<string, Partial<WebMCP.RegisteredTool>>> = {}
): WebMCP.RegisteredTool[] {
  return checkoutToolContractSnapshot(state).manifest.map((metadata) => ({
    ...metadata,
    window,
    origin: window.location.origin,
    ...overrides[metadata.name]
  })) as WebMCP.RegisteredTool[];
}

async function readiness(
  tools: readonly WebMCP.RegisteredTool[],
  options: Partial<CreateRegistryReadinessOptions> = {}
): Promise<RegistryReadinessReceipt> {
  const state = options.state ?? createCheckoutFixture();
  return createRegistryReadinessReceipt(
    providerContext({ getTools: vi.fn(async () => [...tools]) }),
    {
      state,
      appCommit: "commit-a",
      registrationGeneration: 1,
      checkedAt: "2026-08-26T10:00:00.000Z",
      ...options
    }
  );
}

async function compatibilityReceipt(
  receipt: RegistryReadinessReceipt,
  argumentMode: "object" | "json-string" = "object"
): Promise<RuntimeCompatibilityReceipt> {
  const calibrationState = createCheckoutFixture();
  const canonicalResult = cartGet(calibrationState);
  return {
    status: "compatibility-verified",
    argumentMode,
    toolName: "cart_get",
    nativeCallCount: 1,
    coercionCount: argumentMode === "json-string" ? 1 : 0,
    rawResult: JSON.stringify(canonicalResult),
    canonicalResult,
    resultDigest: await canonicalSha256(canonicalResult),
    handlerTraceId: "trace-compatibility-1",
    effectDigest: await canonicalSha256(checkoutEffectDiff(calibrationState, calibrationState)),
    stateBeforeDigest: receipt.stateHash,
    stateAfterDigest: receipt.stateHash,
    manifestHashBefore: receipt.manifestHash,
    manifestHashAfter: receipt.manifestHash,
    registrationGeneration: 7
  };
}

describe("registry readiness receipt", () => {
  it("keeps provider readiness independent when consumer APIs are unavailable", async () => {
    const context = providerContext();
    Reflect.deleteProperty(context, "getTools");

    const receipt = await createRegistryReadinessReceipt(context, {
      state: createCheckoutFixture(),
      appCommit: "commit-a",
      registrationGeneration: 1,
      checkedAt: "2026-08-26T10:00:00.000Z"
    });

    expect(receipt).toMatchObject({
      status: "provider-ready",
      providerRegistration: "ready",
      consumerDiscovery: "unavailable",
      consumerExecution: "unverified",
      compatibilityBinding: "unverified",
      registeredToolNames: EXPECTED_INITIAL_TOOL_NAMES,
      visibleToolNames: [],
      rejectedToolNames: [],
      argumentMode: "unverified",
      compatibilityReceipt: null,
      runtimeCatalog: null,
      mismatches: []
    });
    expect(receipt.manifest.tools).toHaveLength(4);
  });

  it("requires the exact initial four and exposes the actual discovered tool objects", async () => {
    const tools = discoveredTools();
    const getTools = vi.fn(async () => [...tools]);
    const receipt = await createRegistryReadinessReceipt(providerContext({ getTools }), {
      state: createCheckoutFixture(),
      appCommit: "commit-a",
      registrationGeneration: 7
    });

    expect(getTools).toHaveBeenCalledOnce();
    expect(getTools).toHaveBeenCalledWith({ fromOrigins: [window.location.origin] });
    expect(receipt).toMatchObject({
      status: "consumer-discovered",
      consumerDiscovery: "verified",
      consumerExecution: "unverified",
      registeredToolNames: EXPECTED_INITIAL_TOOL_NAMES,
      visibleToolNames: EXPECTED_INITIAL_TOOL_NAMES,
      argumentMode: "unverified",
      compatibilityReceipt: null,
      mismatches: []
    });
    expect(receipt.runtimeCatalog).toMatchObject({
      generation: 7,
      manifestHash: receipt.manifestHash
    });
    expect(receipt.runtimeCatalog?.tools).toEqual(
      [...tools].sort((a, b) => a.name.localeCompare(b.name))
    );
    for (const tool of receipt.runtimeCatalog?.tools ?? []) {
      expect(tools).toContain(tool);
    }
  });

  it("normalizes Chrome JSON-string schemas before exact descriptor comparison", async () => {
    const tools = discoveredTools().map((tool) => ({
      ...tool,
      inputSchema: JSON.stringify(tool.inputSchema) as unknown as object
    }));

    const receipt = await readiness(tools);

    expect(receipt).toMatchObject({
      status: "consumer-discovered",
      consumerDiscovery: "verified",
      mismatches: []
    });
    expect(receipt.runtimeCatalog?.tools).toEqual(tools);
    expect(receipt.manifest.tools.every(({ title }) => title.length > 0)).toBe(true);
  });

  it("rejects empty discovered titles and semantically drifted serialized schemas", async () => {
    const emptyTitle = await readiness(
      discoveredTools(createCheckoutFixture(), { cart_get: { title: "" } })
    );
    const driftedSchema = await readiness(
      discoveredTools(createCheckoutFixture(), {
        cart_get: { inputSchema: JSON.stringify({ type: "object" }) as unknown as object }
      })
    );

    expect(emptyTitle.mismatches).toContainEqual({
      code: "stale_descriptor",
      toolName: "cart_get",
      field: "title"
    });
    expect(driftedSchema.mismatches).toContainEqual({
      code: "stale_descriptor",
      toolName: "cart_get",
      field: "inputSchema"
    });
  });

  it("rejects malformed serialized discovered schemas", async () => {
    const tools = discoveredTools(createCheckoutFixture(), {
      cart_get: { inputSchema: "{" as unknown as object }
    });

    const receipt = await readiness(tools);

    expect(receipt).toMatchObject({
      status: "consumer-mismatch",
      consumerDiscovery: "mismatch",
      runtimeCatalog: null,
      mismatches: [{ code: "discovery_failed" }]
    });
  });

  it("switches to the exact pending five-tool catalog", async () => {
    const initial = createCheckoutFixture();
    const state = checkoutRequest(
      initial,
      {
        operationId: "checkout-request-0001"
      },
      "a".repeat(64)
    ).state;
    const receipt = await readiness(discoveredTools(state), { state });

    expect(receipt.status).toBe("consumer-discovered");
    expect(receipt.manifest.catalogState).toBe("pending");
    expect(receipt.registeredToolNames).toEqual(EXPECTED_PENDING_TOOL_NAMES);
    expect(receipt.visibleToolNames).toEqual(EXPECTED_PENDING_TOOL_NAMES);
    expect(receipt.manifest.tools.map(({ name }) => name)).toEqual(EXPECTED_PENDING_TOOL_NAMES);
  });

  it.each([
    ["missing", () => discoveredTools().slice(1), "missing_tool"],
    [
      "extra",
      () => [
        ...discoveredTools(),
        {
          ...discoveredTools()[0],
          name: "foreign_extra"
        } as WebMCP.RegisteredTool
      ],
      "extra_tool"
    ],
    ["duplicate", () => [...discoveredTools(), discoveredTools()[0]!], "duplicate_tool"]
  ])("rejects a %s same-document catalog", async (_label, makeTools, expectedCode) => {
    const receipt = await readiness(makeTools());

    expect(receipt.status).toBe("consumer-mismatch");
    expect(receipt.consumerDiscovery).toBe("mismatch");
    expect(receipt.runtimeCatalog).toBeNull();
    expect(receipt.mismatches).toContainEqual(expect.objectContaining({ code: expectedCode }));
  });

  it("rejects descriptors from another window or origin instead of silently accepting them", async () => {
    const tools = discoveredTools();
    const foreignWindow = { location: { origin: window.location.origin } } as unknown as Window;
    const foreignByWindow = { ...tools[0], window: foreignWindow } as WebMCP.RegisteredTool;
    const foreignByOrigin = {
      ...tools[1],
      origin: "https://foreign.example"
    } as WebMCP.RegisteredTool;
    const receipt = await readiness([foreignByWindow, foreignByOrigin, ...tools.slice(2)]);

    expect(receipt.status).toBe("consumer-mismatch");
    expect(receipt.rejectedToolNames).toEqual([foreignByWindow.name, foreignByOrigin.name].sort());
    expect(receipt.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "foreign_descriptor", field: "window" }),
        expect.objectContaining({ code: "foreign_descriptor", field: "origin" }),
        expect.objectContaining({ code: "missing_tool", toolName: foreignByWindow.name }),
        expect.objectContaining({ code: "missing_tool", toolName: foreignByOrigin.name })
      ])
    );
  });

  it.each([
    ["title", { title: "Stale title" }],
    ["description", { description: "Stale description" }],
    ["inputSchema", { inputSchema: { type: "object" } }],
    ["annotations", { annotations: {} }]
  ] satisfies readonly [string, Partial<WebMCP.RegisteredTool>][])(
    "rejects a stale %s descriptor",
    async (field, override) => {
      const receipt = await readiness(
        discoveredTools(createCheckoutFixture(), { cart_get: override })
      );

      expect(receipt.status).toBe("consumer-mismatch");
      expect(receipt.mismatches).toContainEqual({
        code: "stale_descriptor",
        toolName: "cart_get",
        field
      });
    }
  );

  it("normalizes missing annotation hints to false in the canonical manifest", async () => {
    const receipt = await readiness(discoveredTools());

    expect(receipt.manifest.tools.find(({ name }) => name === "cart_get")?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: false
    });
    expect(receipt.manifest.tools.find(({ name }) => name === "cart_update")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: false
    });
  });

  it("keeps registry and fixture hashes separate while excluding timestamps", async () => {
    const tools = discoveredTools();
    const first = await readiness([...tools].reverse(), {
      checkedAt: "2026-08-26T10:00:00.000Z"
    });
    const later = await readiness(tools, { checkedAt: "2026-08-27T11:00:00.000Z" });
    const anotherCommit = await readiness(tools, { appCommit: "commit-b" });
    const mutatedState = {
      ...createCheckoutFixture(),
      revision: 1
    };
    const anotherState = await readiness(discoveredTools(mutatedState), { state: mutatedState });

    expect(first.checkedAt).not.toBe(later.checkedAt);
    expect(first.manifestHash).toBe(later.manifestHash);
    expect(first.manifestHash).not.toBe(anotherCommit.manifestHash);
    expect(first.manifestHash).toBe(anotherState.manifestHash);
    expect(first.stateHash).not.toBe(anotherState.stateHash);
    expect(anotherState.fixtureRevision).toBe(1);
    expect(first.manifestHash).toBe(await canonicalSha256(first.manifest));
    expect(first.manifest.tools.map(({ name }) => name)).toEqual(EXPECTED_INITIAL_TOOL_NAMES);
    expect(first.manifest).toMatchObject({
      toolsetVersion: expect.any(String),
      domainVersion: expect.any(String),
      appCommit: "commit-a"
    });
    expect(first).toMatchObject({
      fixtureId: "checkout-seed-v1",
      fixtureRevision: 0,
      stateHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(first.manifest).not.toHaveProperty("stateHash");
    expect(first.manifest).not.toHaveProperty("fixtureRevision");
    expect(first.manifest.tools[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        title: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object),
        annotations: {
          readOnlyHint: expect.any(Boolean),
          untrustedContentHint: expect.any(Boolean)
        },
        handlerVersion: expect.any(String)
      })
    );
  });

  it("stays execution-unverified until an exact compatibility receipt is bound", async () => {
    const tools = discoveredTools();
    const discovered = await readiness(tools, { registrationGeneration: 7 });
    const supplied = await compatibilityReceipt(discovered, "json-string");
    const ready = await readiness(tools, {
      registrationGeneration: 7,
      compatibilityReceipt: supplied
    });

    expect(ready).toMatchObject({
      status: "consumer-ready",
      consumerDiscovery: "verified",
      consumerExecution: "verified",
      compatibilityBinding: "verified",
      argumentMode: "json-string",
      compatibilityReceipt: supplied,
      mismatches: []
    });
    expect(ready.compatibilityReceipt).toBe(supplied);
    expect(ready.runtimeCatalog).not.toBeNull();
    expect(ready.manifestHash).toBe(discovered.manifestHash);
  });

  it("keeps the initial calibration bound across a later pending catalog generation", async () => {
    const initialTools = discoveredTools();
    const initial = await readiness(initialTools, { registrationGeneration: 7 });
    const supplied = await compatibilityReceipt(initial);
    const pendingState = checkoutRequest(
      createCheckoutFixture(),
      { operationId: "checkout-request-0002" },
      "b".repeat(64)
    ).state;
    const pending = await readiness(discoveredTools(pendingState), {
      state: pendingState,
      registrationGeneration: 8,
      compatibilityReceipt: supplied
    });

    expect(pending.status).toBe("consumer-ready");
    expect(pending.consumerExecution).toBe("verified");
    expect(pending.compatibilityReceipt).toBe(supplied);
    expect(pending.manifestHash).not.toBe(initial.manifestHash);
    expect(pending.runtimeCatalog).toMatchObject({
      generation: 8,
      manifestHash: pending.manifestHash
    });
    expect(pending.runtimeCatalog?.tools.map(({ name }) => name)).toEqual(
      EXPECTED_PENDING_TOOL_NAMES
    );
  });

  it("does not put compatibility mode into the manifest hash", async () => {
    const tools = discoveredTools();
    const discovered = await readiness(tools, { registrationGeneration: 7 });
    const objectReady = await readiness(tools, {
      registrationGeneration: 7,
      compatibilityReceipt: await compatibilityReceipt(discovered, "object")
    });
    const stringReady = await readiness(tools, {
      registrationGeneration: 7,
      compatibilityReceipt: await compatibilityReceipt(discovered, "json-string")
    });

    expect(objectReady.argumentMode).toBe("object");
    expect(stringReady.argumentMode).toBe("json-string");
    expect(objectReady.manifestHash).toBe(stringReady.manifestHash);
  });

  it.each([
    ["state", { stateAfterDigest: "wrong" }],
    ["manifest", { manifestHashBefore: "wrong" }],
    ["generation", { registrationGeneration: 8 }],
    ["effect", { effectDigest: "unexpected-effect" }],
    ["digest", { resultDigest: "wrong" }],
    ["canonical result", { canonicalResult: { ok: true, lines: [] } }],
    ["raw result", { rawResult: JSON.stringify({ ok: true, lines: [] }) }]
  ] satisfies readonly [string, Partial<RuntimeCompatibilityReceipt>][])(
    "rejects a compatibility receipt with a mismatched %s binding",
    async (_label, override) => {
      const tools = discoveredTools();
      const discovered = await readiness(tools, { registrationGeneration: 7 });
      const supplied = { ...(await compatibilityReceipt(discovered)), ...override };
      const receipt = await readiness(tools, {
        registrationGeneration: 7,
        compatibilityReceipt: supplied
      });

      expect(receipt).toMatchObject({
        status: "consumer-mismatch",
        consumerDiscovery: "verified",
        consumerExecution: "unverified",
        compatibilityBinding: "mismatch",
        argumentMode: "unverified",
        compatibilityReceipt: null
      });
      expect(receipt.mismatches).toContainEqual({
        code: "compatibility_mismatch",
        toolName: "cart_get",
        field: "receipt"
      });
    }
  );

  it("rejects malformed runtime compatibility fields without losing the receipt", async () => {
    const tools = discoveredTools();
    const discovered = await readiness(tools, { registrationGeneration: 7 });
    const malformed = {
      ...(await compatibilityReceipt(discovered)),
      argumentMode: "invalid-mode"
    } as unknown as RuntimeCompatibilityReceipt;
    const receipt = await readiness(tools, {
      registrationGeneration: 7,
      compatibilityReceipt: malformed
    });

    expect(receipt.status).toBe("consumer-mismatch");
    expect(receipt.providerRegistration).toBe("ready");
    expect(receipt.consumerExecution).toBe("unverified");
    expect(receipt.mismatches).toContainEqual({
      code: "compatibility_mismatch",
      toolName: "cart_get",
      field: "receipt"
    });
  });

  it("preserves provider truth when consumer discovery throws", async () => {
    const receipt = await createRegistryReadinessReceipt(
      providerContext({
        getTools: vi.fn(async () => {
          throw new Error("consumer unavailable");
        })
      }),
      {
        state: createCheckoutFixture(),
        appCommit: "commit-a",
        registrationGeneration: 1
      }
    );

    expect(receipt.providerRegistration).toBe("ready");
    expect(receipt.status).toBe("consumer-mismatch");
    expect(receipt.consumerDiscovery).toBe("mismatch");
    expect(receipt.mismatches).toEqual([{ code: "discovery_failed" }]);
  });

  it("preserves provider truth when consumer discovery resolves malformed data", async () => {
    const receipt = await createRegistryReadinessReceipt(
      providerContext({
        getTools: vi.fn(async () => null as unknown as WebMCP.RegisteredTool[])
      }),
      {
        state: createCheckoutFixture(),
        appCommit: "commit-a",
        registrationGeneration: 1
      }
    );

    expect(receipt.providerRegistration).toBe("ready");
    expect(receipt.status).toBe("consumer-mismatch");
    expect(receipt.mismatches).toEqual([{ code: "discovery_failed" }]);
  });

  it("rejects empty commit and invalid generation bindings", async () => {
    const context = providerContext();
    Reflect.deleteProperty(context, "getTools");
    const state = createCheckoutFixture();

    await expect(
      createRegistryReadinessReceipt(context, {
        state,
        appCommit: " ",
        registrationGeneration: 1
      })
    ).rejects.toThrow("App commit must not be empty");
    await expect(
      createRegistryReadinessReceipt(context, {
        state,
        appCommit: "commit-a",
        registrationGeneration: 0
      })
    ).rejects.toThrow("Registration generation must be a positive safe integer");
  });
});
