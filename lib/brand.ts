export const PRODUCT_NAME = "Thurstone" as const;
export const PRODUCT_BYLINE = "Thurstone by Invarra — created by Sergio Valencia." as const;
export const PRODUCT_ORIGIN = "https://thurstone.invarra.ai" as const;

/**
 * The challenge evidence was captured before the product rename. Stable `toolproof-*` and
 * `TOOLPROOF_*` identifiers remain legacy protocol namespaces so sealed receipts, deployment
 * configuration, and stored evidence continue to verify.
 */
export const LEGACY_PROTOCOL_NAMESPACE = "toolproof" as const;
