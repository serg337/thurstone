import "server-only";

import {
  finalizeGate3HumanFreeze,
  type Gate3FrozenProtocol
} from "@/lib/semantic/human-freeze.server";
import { configuredGate3ReviewPackage } from "@/lib/semantic/review-package-config.server";
import { createProbeRedis } from "@/lib/probe/ledger";
import { readGate3Freeze } from "@/lib/semantic/freeze-store.server";

export const GATE3_HUMAN_REVIEW_RECEIPT_ENV = "TOOLPROOF_GATE3_HUMAN_REVIEW_RECEIPT_B64";
export const GATE3_AUTHORING_TERMINATION_ENV = "TOOLPROOF_GATE3_AUTHORING_TERMINATION_B64";
export const GATE3_FROZEN_PROTOCOL_HASH_ENV = "TOOLPROOF_GATE3_FROZEN_PROTOCOL_HASH";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface Gate3FrozenConfiguration {
  readonly status: "frozen" | "awaiting-human" | "invalid";
  readonly protocol: Gate3FrozenProtocol | null;
  readonly issue: string | null;
}

function decodeBoundedJson(value: string, label: string): unknown {
  if (value.length < 1 || value.length > 8_192 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`${label}_encoding_invalid`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength < 1 || bytes.byteLength > 6_144) {
    throw new TypeError(`${label}_size_invalid`);
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

export async function configuredGate3FrozenProtocol(
  environment: EnvironmentLike = process.env
): Promise<Gate3FrozenConfiguration> {
  const storedHash = environment[GATE3_FROZEN_PROTOCOL_HASH_ENV]?.trim();
  if (storedHash) {
    try {
      if (!/^[a-f0-9]{64}$/u.test(storedHash)) {
        throw new TypeError("gate3_stored_freeze_hash_invalid");
      }
      const artifactSecret = environment.TOOLPROOF_SIGNING_SECRET?.trim();
      if (!artifactSecret) throw new TypeError("gate3_stored_freeze_secret_missing");
      const stored = await readGate3Freeze(createProbeRedis(environment as NodeJS.ProcessEnv), {
        frozenProtocolHash: storedHash,
        artifactSecret
      });
      if (stored) {
        return Object.freeze({ status: "frozen", protocol: stored.frozenProtocol, issue: null });
      }
    } catch (error) {
      return Object.freeze({
        status: "invalid",
        protocol: null,
        issue: error instanceof Error ? error.message : "gate3_stored_freeze_invalid"
      });
    }
  }
  const review = await configuredGate3ReviewPackage(environment);
  if (!review.reviewPackage) {
    return Object.freeze({
      status: review.status === "invalid" ? "invalid" : "awaiting-human",
      protocol: null,
      issue: review.issue
    });
  }
  const human = environment[GATE3_HUMAN_REVIEW_RECEIPT_ENV]?.trim();
  const termination = environment[GATE3_AUTHORING_TERMINATION_ENV]?.trim();
  if (!human && !termination) {
    return Object.freeze({ status: "awaiting-human", protocol: null, issue: null });
  }
  if (!human || !termination) {
    return Object.freeze({
      status: "invalid",
      protocol: null,
      issue: "gate3_frozen_configuration_partial"
    });
  }
  try {
    return Object.freeze({
      status: "frozen",
      protocol: await finalizeGate3HumanFreeze({
        reviewPackage: review.reviewPackage,
        humanReviewReceipt: decodeBoundedJson(human, "gate3_human_review_receipt"),
        authoringTermination: decodeBoundedJson(termination, "gate3_authoring_termination")
      }),
      issue: null
    });
  } catch (error) {
    return Object.freeze({
      status: "invalid",
      protocol: null,
      issue: error instanceof Error ? error.message : "gate3_frozen_configuration_invalid"
    });
  }
}
