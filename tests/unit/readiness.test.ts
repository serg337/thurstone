import { describe, expect, it, vi } from "vitest";

import { CART_GET_METADATA } from "@/lib/webmcp/cart-get-tool";
import { createRegistryReadinessReceipt } from "@/lib/webmcp/readiness";

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

describe("registry readiness receipt", () => {
  it("keeps provider registration separate when consumer discovery is unavailable", async () => {
    const context = providerContext();
    Reflect.deleteProperty(context, "getTools");

    await expect(createRegistryReadinessReceipt(context)).resolves.toMatchObject({
      status: "provider-ready",
      providerRegistration: "ready",
      consumerDiscovery: "unavailable",
      consumerExecution: "unverified",
      registeredToolNames: ["cart_get"],
      visibleToolNames: []
    });
  });

  it("reports discovery without claiming execution verification", async () => {
    const context = providerContext({
      getTools: vi.fn(async () => [
        {
          ...CART_GET_METADATA,
          title: CART_GET_METADATA.title,
          origin: "https://example.test",
          window
        }
      ])
    });

    await expect(createRegistryReadinessReceipt(context)).resolves.toMatchObject({
      status: "consumer-discovered",
      consumerDiscovery: "verified",
      consumerExecution: "unverified",
      visibleToolNames: ["cart_get"]
    });
  });

  it("fails the consumer catalog comparison when the expected tool is absent", async () => {
    const context = providerContext();

    await expect(createRegistryReadinessReceipt(context)).resolves.toMatchObject({
      status: "consumer-mismatch",
      consumerDiscovery: "mismatch",
      consumerExecution: "unverified",
      visibleToolNames: []
    });
  });
});
