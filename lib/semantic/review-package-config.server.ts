import "server-only";

import {
  buildGate3HumanReviewPackage,
  type Gate3BuildSourceBindings,
  type Gate3HumanReviewPackage
} from "@/lib/semantic/checkout-candidate.server";
import { semanticSourceBindingSchema } from "@/lib/semantic/protocol-freeze.server";
import { z } from "zod";

export const GATE3_SOURCE_BINDING_ENV = "TOOLPROOF_GATE3_SOURCE_BINDING_B64";

const configuredBindingSchema = z
  .object({
    source: semanticSourceBindingSchema,
    canonicalizerSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

export interface Gate3ReviewPackageConfiguration {
  readonly status: "ready" | "missing" | "invalid";
  readonly reviewPackage: Gate3HumanReviewPackage | null;
  readonly issue: string | null;
}

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

function activeCommit(environment: EnvironmentLike): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const override = environment.TOOLPROOF_COMMIT_SHA?.trim();
  if (vercel && override && vercel !== override) {
    throw new TypeError("gate3_source_binding_commit_override_mismatch");
  }
  return vercel ?? override ?? "unversioned";
}

function parseBinding(source: string): Gate3BuildSourceBindings {
  if (source.length < 1 || source.length > 4_096 || !/^[A-Za-z0-9_-]+$/u.test(source)) {
    throw new TypeError("gate3_source_binding_encoding_invalid");
  }
  const bytes = Buffer.from(source, "base64url");
  if (bytes.byteLength < 1 || bytes.byteLength > 3_072) {
    throw new TypeError("gate3_source_binding_size_invalid");
  }
  return configuredBindingSchema.parse(JSON.parse(bytes.toString("utf8")));
}

export async function configuredGate3ReviewPackage(
  environment: EnvironmentLike = process.env
): Promise<Gate3ReviewPackageConfiguration> {
  const configured = environment[GATE3_SOURCE_BINDING_ENV]?.trim();
  if (!configured) {
    return Object.freeze({ status: "missing", reviewPackage: null, issue: null });
  }
  try {
    const bindings = parseBinding(configured);
    if (bindings.source.repositoryCommit !== activeCommit(environment)) {
      throw new TypeError("gate3_source_binding_commit_mismatch");
    }
    return Object.freeze({
      status: "ready",
      reviewPackage: await buildGate3HumanReviewPackage(bindings),
      issue: null
    });
  } catch (error) {
    return Object.freeze({
      status: "invalid",
      reviewPackage: null,
      issue: error instanceof Error ? error.message : "gate3_source_binding_invalid"
    });
  }
}
