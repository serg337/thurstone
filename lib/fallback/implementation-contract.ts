import { canonicalSha256 } from "@/lib/evidence/digest";

export const FALLBACK_IMPLEMENTATION_CONTRACT_VERSION =
  "toolproof-fallback-implementation-contract@1.1.0";
export const FALLBACK_IMPLEMENTATION = "googlechromelabs-webmcp-tools-adapter@1.1.0";
export const FALLBACK_LAB_PAGE_ADAPTER_VERSION = "toolproof-fallback-lab-page-adapter@1.1.0";
export const FALLBACK_TRIAL_EVIDENCE_VERSION = "toolproof-fallback-trial-evidence@1.1.0";
export const FALLBACK_NATIVE_BRIDGE_VERSION = "toolproof-fallback-native-bridge@1.1.0";
export const FALLBACK_TRIAL_RUNNER_VERSION = "toolproof-fallback-trial-runner@1.1.0";
export const FALLBACK_BROWSER_RUNTIME_VERSION = "toolproof-fallback-browser-runtime@1.0.0";

export interface FallbackRunnerImplementationManifest {
  readonly version: string;
  readonly implementation: string;
  readonly labPageAdapterVersion: string;
  readonly trialEvidenceVersion: string;
  readonly nativeBridgeVersion: string;
  readonly trialRunnerVersion: string;
  readonly browserRuntimeVersion: string;
}

export const FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST = Object.freeze({
  version: FALLBACK_IMPLEMENTATION_CONTRACT_VERSION,
  implementation: FALLBACK_IMPLEMENTATION,
  labPageAdapterVersion: FALLBACK_LAB_PAGE_ADAPTER_VERSION,
  trialEvidenceVersion: FALLBACK_TRIAL_EVIDENCE_VERSION,
  nativeBridgeVersion: FALLBACK_NATIVE_BRIDGE_VERSION,
  trialRunnerVersion: FALLBACK_TRIAL_RUNNER_VERSION,
  browserRuntimeVersion: FALLBACK_BROWSER_RUNTIME_VERSION
});

export function fallbackRunnerImplementationHash(
  manifest: FallbackRunnerImplementationManifest = FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST
): Promise<string> {
  return canonicalSha256(manifest);
}
