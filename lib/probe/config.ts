import "server-only";

import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MODEL,
  PROBE_POLICY_VERSION
} from "@/lib/probe/policy";
import { isValidProbeSigningSecret } from "@/lib/probe/signing-secret";

interface EnvironmentLike {
  readonly [key: string]: string | undefined;
}

export interface ProbeConfigurationStatus {
  readonly productionEnvironment: boolean;
  readonly providerCredentialConfigured: boolean;
  readonly durableStoreConfigured: boolean;
  readonly signingSecretConfigured: boolean;
  readonly guardInstanceConfigured: boolean;
  readonly guardInitializedCommitConfigured: boolean;
  readonly operationalControlsConfigured: boolean;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getProbeConfigurationStatus(
  environment: EnvironmentLike = process.env
): ProbeConfigurationStatus {
  const productionEnvironment = environment.VERCEL_ENV === "production";
  const providerCredentialConfigured = hasValue(environment.OPENAI_API_KEY);
  const durableStoreConfigured =
    hasValue(environment.UPSTASH_REDIS_REST_URL ?? environment.KV_REST_API_URL) &&
    hasValue(environment.UPSTASH_REDIS_REST_TOKEN ?? environment.KV_REST_API_TOKEN);
  const signingSecretConfigured = isValidProbeSigningSecret(environment.TOOLPROOF_SIGNING_SECRET);
  const guardInstanceConfigured = hasValue(environment.TOOLPROOF_GUARD_INSTANCE_ID);
  const guardInitializedCommitConfigured = /^[a-f0-9]{40}$/u.test(
    environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT ?? ""
  );

  return {
    productionEnvironment,
    providerCredentialConfigured,
    durableStoreConfigured,
    signingSecretConfigured,
    guardInstanceConfigured,
    guardInitializedCommitConfigured,
    operationalControlsConfigured:
      productionEnvironment &&
      providerCredentialConfigured &&
      durableStoreConfigured &&
      signingSecretConfigured &&
      guardInstanceConfigured &&
      guardInitializedCommitConfigured
  };
}

export function getPublicProbeStatus(environment: EnvironmentLike = process.env) {
  const configuration = getProbeConfigurationStatus(environment);

  return {
    status: "disabled" as const,
    provider: "OpenAI",
    model: PROBE_MODEL,
    policyVersion: PROBE_POLICY_VERSION,
    lifetimePolicy: {
      callLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD / 1_000_000_000,
      resetsWithProviderWindow: false
    },
    controls: {
      providerCredential: configuration.providerCredentialConfigured ? "configured" : "pending",
      durableStore: configuration.durableStoreConfigured ? "configured" : "pending",
      signedTokens: configuration.signingSecretConfigured ? "configured" : "pending",
      guardInstance: configuration.guardInstanceConfigured ? "configured" : "pending",
      guardCommit: configuration.guardInitializedCommitConfigured ? "configured" : "pending"
    },
    inferenceEnabled: false,
    reason: configuration.operationalControlsConfigured
      ? "Controls are configured but the immutable guard and frozen Probe lane are not verified."
      : "Inference is disabled until the lifetime guard and signed-token controls are configured and verified."
  };
}
