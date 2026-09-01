import {
  BYOA_CONTRACT_VERSION,
  byoaContractDigest,
  parseByoaContract,
  verifyByoaContract,
  type ByoaContractV2
} from "@/lib/demo/contract-v2";
import {
  BYOA_CONTRACT_V3_VERSION,
  byoaContractV3Digest,
  parseByoaContractV3,
  verifyByoaContractV3,
  type ByoaContractV3,
  type ByoaContractV3ExpectedLineage
} from "@/lib/demo/contract-v3";

export type SupportedByoaContract = ByoaContractV2 | ByoaContractV3;

function contractVersion(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, "version")
    : undefined;
}

export function parseSupportedByoaContract(value: unknown): SupportedByoaContract {
  const version = contractVersion(value);
  if (version === BYOA_CONTRACT_VERSION) return parseByoaContract(value);
  if (version === BYOA_CONTRACT_V3_VERSION) return parseByoaContractV3(value);
  throw new Error("Unsupported Thurstone BYOA contract version.");
}

export async function verifySupportedByoaContract(
  value: unknown,
  v3ExpectedLineage?: ByoaContractV3ExpectedLineage
): Promise<SupportedByoaContract> {
  const version = contractVersion(value);
  if (version === BYOA_CONTRACT_VERSION) return verifyByoaContract(value);
  if (version === BYOA_CONTRACT_V3_VERSION) {
    if (v3ExpectedLineage === undefined) {
      throw new Error("Contract v3 verification requires independently derived suite lineage.");
    }
    return verifyByoaContractV3(value, v3ExpectedLineage);
  }
  throw new Error("Unsupported Thurstone BYOA contract version.");
}

export async function supportedByoaContractDigest(
  value: unknown,
  v3ExpectedLineage?: ByoaContractV3ExpectedLineage
): Promise<string> {
  const parsed = parseSupportedByoaContract(value);
  if (parsed.version === BYOA_CONTRACT_VERSION) return byoaContractDigest(parsed);
  if (v3ExpectedLineage === undefined) {
    throw new Error("Contract v3 digest requires independently derived suite lineage.");
  }
  return byoaContractV3Digest(parsed, v3ExpectedLineage);
}
