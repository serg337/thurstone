import "server-only";

import { CHECKOUT_DOMAIN_VERSION, type CheckoutState } from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  probeLiveManifestSchema,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { CHECKOUT_TOOLSET_VERSION, checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";

/**
 * Produces the expectation-free manifest used at the model/native boundary while hashing the full
 * app/toolset/domain/handler identity verified by the Lab readiness contract.
 */
export async function createCheckoutLiveManifest(
  state: Pick<CheckoutState, "pendingCheckout">,
  appCommit: string
): Promise<ProbeLiveManifest> {
  if (!/^[a-f0-9]{40}$/u.test(appCommit)) {
    throw new TypeError("A live manifest requires an exact 40-character app commit.");
  }
  const contract = checkoutToolContractSnapshot(state);
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: JSON.parse(canonicalJson(inputSchema)) as Record<string, unknown>,
      annotations: {
        readOnlyHint: annotations.readOnlyHint ?? false,
        untrustedContentHint: annotations.untrustedContentHint ?? false
      }
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const readinessManifest = {
    catalogState: contract.catalogState,
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    appCommit,
    tools: tools.map((tool) => ({
      ...tool,
      handlerVersion: versions.get(tool.name)
    }))
  };
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: await canonicalSha256(readinessManifest),
    tools
  });
}
