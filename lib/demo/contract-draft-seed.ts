import { parseByoaContract, type ByoaContractV2 } from "@/lib/demo/contract-v2";

export const CONTRACT_DRAFT_SEED_STORAGE_KEY = "thurstone:byoa-contract-seed@1" as const;

export function writeContractDraftSeed(storage: Storage, contract: ByoaContractV2): void {
  storage.setItem(CONTRACT_DRAFT_SEED_STORAGE_KEY, JSON.stringify(parseByoaContract(contract)));
}

export function readContractDraftSeed(storage: Storage): ByoaContractV2 | null {
  const encoded = storage.getItem(CONTRACT_DRAFT_SEED_STORAGE_KEY);
  if (encoded === null) return null;
  return parseByoaContract(JSON.parse(encoded) as unknown);
}

export function clearContractDraftSeed(storage: Storage): void {
  storage.removeItem(CONTRACT_DRAFT_SEED_STORAGE_KEY);
}
