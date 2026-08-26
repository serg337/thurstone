export interface ModelContextConsumerCompatibility {
  readonly getTools?: WebMCP.ModelContext["getTools"];
  readonly executeTool?: (
    tool: WebMCP.RegisteredTool,
    input: object | string,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<string | null>;
}

export interface WebMcpCapabilities {
  readonly secureContext: boolean;
  readonly providerRegistration: boolean;
  readonly inPageDiscovery: boolean;
  readonly inPageExecution: boolean;
}

export function detectWebMcpCapabilities(): WebMcpCapabilities {
  const context = document.modelContext as
    (WebMCP.ModelContext & ModelContextConsumerCompatibility) | undefined;

  return {
    secureContext: globalThis.isSecureContext,
    providerRegistration: typeof context?.registerTool === "function",
    inPageDiscovery: typeof context?.getTools === "function",
    inPageExecution: typeof context?.executeTool === "function"
  };
}
