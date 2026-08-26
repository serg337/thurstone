import { CHECKOUT_DOMAIN_VERSION } from "@/lib/domain/checkout";
import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  CART_GET_HANDLER_VERSION,
  CART_GET_METADATA,
  CART_GET_TOOL_NAME
} from "@/lib/webmcp/cart-get-tool";

export interface RegistryReadinessReceipt {
  readonly status: "provider-ready" | "consumer-discovered" | "consumer-mismatch";
  readonly providerRegistration: "ready";
  readonly consumerDiscovery: "unavailable" | "verified" | "mismatch";
  readonly consumerExecution: "unverified";
  readonly registeredToolNames: readonly string[];
  readonly visibleToolNames: readonly string[];
  readonly manifestHash: string;
  readonly argumentMode: "unverified";
  readonly checkedAt: string;
}

export async function createRegistryReadinessReceipt(
  context: WebMCP.ModelContext
): Promise<RegistryReadinessReceipt> {
  const canDiscover = typeof context.getTools === "function";
  const tools = canDiscover ? await context.getTools() : [];
  const cartTool = tools.find(({ name }) => name === CART_GET_TOOL_NAME);
  const consumerDiscovery = !canDiscover ? "unavailable" : cartTool ? "verified" : "mismatch";
  const manifest = canDiscover
    ? tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema ?? null,
        annotations: tool.annotations ?? null,
        handlerVersion: tool.name === CART_GET_TOOL_NAME ? CART_GET_HANDLER_VERSION : null,
        domainVersion: tool.name === CART_GET_TOOL_NAME ? CHECKOUT_DOMAIN_VERSION : null,
        appCommit: process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA ?? "unversioned",
        observation: "consumer-discovered"
      }))
    : [
        {
          ...CART_GET_METADATA,
          handlerVersion: CART_GET_HANDLER_VERSION,
          domainVersion: CHECKOUT_DOMAIN_VERSION,
          appCommit: process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA ?? "unversioned",
          observation: "provider-declared"
        }
      ];

  return {
    status: !canDiscover
      ? "provider-ready"
      : cartTool
        ? "consumer-discovered"
        : "consumer-mismatch",
    providerRegistration: "ready",
    consumerDiscovery,
    consumerExecution: "unverified",
    registeredToolNames: [CART_GET_TOOL_NAME],
    visibleToolNames: tools.map(({ name }) => name),
    manifestHash: await canonicalSha256(manifest),
    argumentMode: "unverified",
    checkedAt: new Date().toISOString()
  };
}
