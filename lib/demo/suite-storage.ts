import { z } from "zod";

import {
  THURSTONE_CONTRACT_SUITE_VERSION,
  thurstoneContractSuiteDigest,
  thurstoneContractSuiteSchema,
  verifyThurstoneContractSuite,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import { canonicalJson } from "@/lib/evidence/digest";

export const THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION =
  "thurstone-contract-suite-storage@1" as const;
export const THURSTONE_SUITE_STORAGE_KEY = "thurstone:contract-suite@1" as const;
export const THURSTONE_SUITE_STORAGE_MAX_BYTES = 192 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const suiteIdSchema = z
  .string()
  .regex(/^suite_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

export const thurstoneSuiteStorageEnvelopeSchema = z
  .object({
    version: z.literal(THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION),
    suiteVersion: z.literal(THURSTONE_CONTRACT_SUITE_VERSION),
    suiteId: suiteIdSchema,
    catalogDigest: sha256Schema,
    suiteDigest: sha256Schema,
    suite: thurstoneContractSuiteSchema
  })
  .strict();

export type ThurstoneSuiteStorageEnvelopeV1 = z.infer<typeof thurstoneSuiteStorageEnvelopeSchema>;

export interface ThurstoneSuiteStorageIdentity {
  readonly suiteId: ThurstoneContractSuiteV1["suiteId"];
  readonly catalogDigest: ThurstoneContractSuiteV1["catalogDigest"];
}

export type ThurstoneSuiteStorageRejectionReason =
  | "oversized"
  | "malformed_json"
  | "unsupported_version"
  | "invalid_envelope"
  | "identity_mismatch"
  | "digest_mismatch";

export type ThurstoneSuiteStorageRecoveryResult =
  | Readonly<{ status: "empty" }>
  | Readonly<{
      status: "restored";
      suite: ThurstoneContractSuiteV1;
      identity: ThurstoneSuiteStorageIdentity;
      suiteDigest: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: ThurstoneSuiteStorageRejectionReason;
      recovery: "clear_contract_suite_state";
    }>;

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function rejected(
  reason: ThurstoneSuiteStorageRejectionReason
): ThurstoneSuiteStorageRecoveryResult {
  return Object.freeze({
    status: "rejected" as const,
    reason,
    recovery: "clear_contract_suite_state" as const
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Saves one prospective suite into the caller's current-tab session storage.
 *
 * This module deliberately accepts an injected Storage object so it can be tested without a
 * browser. Callers must pass `window.sessionStorage`; this module never reads or writes
 * localStorage and never touches the existing single-contract keys.
 */
export async function saveThurstoneContractSuite(
  storage: Storage,
  value: ThurstoneContractSuiteV1
): Promise<ThurstoneSuiteStorageIdentity & { readonly suiteDigest: string }> {
  const suite = await verifyThurstoneContractSuite(value);
  const suiteDigest = await thurstoneContractSuiteDigest(suite);
  const envelope = thurstoneSuiteStorageEnvelopeSchema.parse({
    version: THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION,
    suiteVersion: THURSTONE_CONTRACT_SUITE_VERSION,
    suiteId: suite.suiteId,
    catalogDigest: suite.catalogDigest,
    suiteDigest,
    suite
  });
  const encoded = canonicalJson(envelope);
  if (encodedBytes(encoded) > THURSTONE_SUITE_STORAGE_MAX_BYTES) {
    throw new Error("Contract suite exceeds the tab-scoped storage boundary.");
  }
  storage.setItem(THURSTONE_SUITE_STORAGE_KEY, encoded);
  return Object.freeze({
    suiteId: suite.suiteId,
    catalogDigest: suite.catalogDigest,
    suiteDigest
  });
}

/**
 * Recovers a suite only when its strict envelope, duplicated identities, and digest all agree.
 * Invalid bytes are left in place so the UI can offer the exact key-scoped clear action.
 */
export async function loadThurstoneContractSuite(
  storage: Storage,
  expectedIdentity?: ThurstoneSuiteStorageIdentity
): Promise<ThurstoneSuiteStorageRecoveryResult> {
  const encoded = storage.getItem(THURSTONE_SUITE_STORAGE_KEY);
  if (encoded === null) return Object.freeze({ status: "empty" as const });
  if (encodedBytes(encoded) > THURSTONE_SUITE_STORAGE_MAX_BYTES) {
    return rejected("oversized");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded) as unknown;
  } catch {
    return rejected("malformed_json");
  }

  if (
    isRecord(decoded) &&
    "version" in decoded &&
    decoded.version !== THURSTONE_SUITE_STORAGE_ENVELOPE_VERSION
  ) {
    return rejected("unsupported_version");
  }

  const parsedEnvelope = thurstoneSuiteStorageEnvelopeSchema.safeParse(decoded);
  if (!parsedEnvelope.success) return rejected("invalid_envelope");

  const envelope: ThurstoneSuiteStorageEnvelopeV1 = parsedEnvelope.data;
  let suite: ThurstoneContractSuiteV1;
  try {
    suite = await verifyThurstoneContractSuite(envelope.suite);
  } catch {
    return rejected("identity_mismatch");
  }
  if (
    envelope.suiteVersion !== suite.version ||
    envelope.suiteId !== suite.suiteId ||
    envelope.catalogDigest !== suite.catalogDigest ||
    (expectedIdentity !== undefined &&
      (expectedIdentity.suiteId !== suite.suiteId ||
        expectedIdentity.catalogDigest !== suite.catalogDigest))
  ) {
    return rejected("identity_mismatch");
  }

  const suiteDigest = await thurstoneContractSuiteDigest(suite);
  if (suiteDigest !== envelope.suiteDigest) return rejected("digest_mismatch");

  return Object.freeze({
    status: "restored" as const,
    suite,
    identity: Object.freeze({ suiteId: suite.suiteId, catalogDigest: suite.catalogDigest }),
    suiteDigest
  });
}

/** Clears only the prospective suite envelope for this tab. */
export function clearThurstoneContractSuite(storage: Storage): void {
  storage.removeItem(THURSTONE_SUITE_STORAGE_KEY);
}
