import "server-only";

import {
  buildGate3HumanReviewPackage,
  type Gate3BuildSourceBindings,
  type Gate3HumanReviewPackage
} from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_SUCCESSOR_LINEAGE_ENV,
  decodeGate3SuccessorLineageBase64Url,
  gate3SuccessorLineageSchema
} from "@/lib/semantic/gate3-successor-lineage.server";
import { semanticSourceBindingSchema } from "@/lib/semantic/protocol-freeze.server";
import { z } from "zod";

export const GATE3_SOURCE_BINDING_ENV = "TOOLPROOF_GATE3_SOURCE_BINDING_B64";
export { GATE3_SUCCESSOR_LINEAGE_ENV };

const configuredBindingSchema = z
  .object({
    source: semanticSourceBindingSchema,
    canonicalizerSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    successorLineage: gate3SuccessorLineageSchema.optional()
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
  if (source.length < 1 || source.length > 16_384 || !/^[A-Za-z0-9_-]+$/u.test(source)) {
    throw new TypeError("gate3_source_binding_encoding_invalid");
  }
  const bytes = Buffer.from(source, "base64url");
  if (bytes.byteLength < 1 || bytes.byteLength > 12_288 || bytes.toString("base64url") !== source) {
    throw new TypeError("gate3_source_binding_size_invalid");
  }
  const parsed = configuredBindingSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (parsed.successorLineage) {
    return {
      source: parsed.source,
      canonicalizerSourceSha256: parsed.canonicalizerSourceSha256,
      successorLineage: parsed.successorLineage
    };
  }
  return {
    source: parsed.source,
    canonicalizerSourceSha256: parsed.canonicalizerSourceSha256
  };
}

export async function configuredGate3ReviewPackage(
  environment: EnvironmentLike = process.env
): Promise<Gate3ReviewPackageConfiguration> {
  const configured = environment[GATE3_SOURCE_BINDING_ENV]?.trim();
  const configuredSuccessor = environment[GATE3_SUCCESSOR_LINEAGE_ENV]?.trim();
  if (!configured) {
    if (configuredSuccessor) {
      return Object.freeze({
        status: "invalid",
        reviewPackage: null,
        issue: "gate3_successor_source_binding_missing"
      });
    }
    return Object.freeze({ status: "missing", reviewPackage: null, issue: null });
  }
  try {
    const bindings = parseBinding(configured);
    if (bindings.successorLineage && configuredSuccessor) {
      throw new TypeError("gate3_successor_lineage_duplicate");
    }
    if (bindings.source.repositoryCommit !== activeCommit(environment)) {
      throw new TypeError("gate3_source_binding_commit_mismatch");
    }
    return Object.freeze({
      status: "ready",
      reviewPackage: await buildGate3HumanReviewPackage({
        ...bindings,
        ...(!bindings.successorLineage && configuredSuccessor
          ? { successorLineage: await decodeGate3SuccessorLineageBase64Url(configuredSuccessor) }
          : {})
      }),
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
