import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import {
  parseByoaContractV3,
  verifyByoaContractV3,
  type ByoaContractV3,
  type ByoaContractV3ExpectedLineage
} from "@/lib/demo/contract-v3";
import {
  agentVisibleRunProjectionV2,
  createCompiledByoaSessionV2,
  transitionByoaSessionV2,
  type ByoaAgentSessionV2
} from "@/lib/demo/agent-session-v2";
import type { AgentVisibleRunProjectionV2 } from "@/lib/demo/agent-projection";
import {
  REGRESSION_RERUN_LINK_V2_VERSION,
  type RegressionRerunLinkV2
} from "@/lib/demo/regression-link-v2";
import { verifyByoaDemoResultV3, type ByoaDemoResultV3 } from "@/lib/demo/result-v3";

function expectedLineage(contract: ByoaContractV3): ByoaContractV3ExpectedLineage {
  return Object.freeze({
    suiteId: contract.suiteId,
    suiteDigest: contract.suiteDigest,
    caseId: contract.caseId,
    catalogDigest: contract.catalogDigest
  });
}

function nextTimestamp(after: string, offset = 1): string {
  return new Date(Date.parse(after) + offset).toISOString();
}

export async function createLinkedByoaContractV3(input: {
  readonly source: ByoaContractV3;
  readonly contractId: string;
  readonly buildCommit: string;
  readonly createdAt: string;
}): Promise<ByoaContractV3> {
  const source = await verifyByoaContractV3(input.source, expectedLineage(input.source));
  const successor = parseByoaContractV3({
    ...source,
    contractId: input.contractId,
    buildCommit: input.buildCommit,
    createdAt: input.createdAt
  });
  return verifyByoaContractV3(successor, expectedLineage(source));
}

export interface PreparedRegressionRerunV2 {
  readonly session: ByoaAgentSessionV2;
  readonly projection: AgentVisibleRunProjectionV2;
  readonly regressionLink: RegressionRerunLinkV2;
}

export async function prepareRegressionRerunV2(input: {
  readonly sourceResult: ByoaDemoResultV3;
  readonly regressionCaseDigest: string | null;
  readonly contractId: string;
  readonly runId: string;
  readonly buildCommit: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}): Promise<PreparedRegressionRerunV2> {
  const sourceResult = await verifyByoaDemoResultV3(input.sourceResult);
  if (
    (sourceResult.verdict === "pass" || sourceResult.verdict === "issue") &&
    input.regressionCaseDigest === null
  ) {
    throw new Error("PASS or ISSUE reruns require their verified Regression Case v2 digest.");
  }
  if (
    (sourceResult.verdict === "incomplete" || sourceResult.verdict === "unavailable") &&
    input.regressionCaseDigest !== null
  ) {
    throw new Error("INCOMPLETE or UNAVAILABLE reruns cannot claim a verified regression case.");
  }
  const contract = await createLinkedByoaContractV3({
    source: sourceResult.contract,
    contractId: input.contractId,
    buildCommit: input.buildCommit,
    createdAt: input.createdAt
  });
  const regressionLink = Object.freeze({
    version: REGRESSION_RERUN_LINK_V2_VERSION,
    previousResultDigest: sourceResult.resultDigest,
    regressionCaseDigest: input.regressionCaseDigest
  });
  const compiled = await createCompiledByoaSessionV2({
    runId: input.runId,
    contract,
    lineage: expectedLineage(contract),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    regressionLink
  });
  const session = transitionByoaSessionV2(compiled, "HANDOFF_ISSUED", {
    at: nextTimestamp(input.createdAt),
    reasonCode: "regression_rerun_handoff_issued"
  });
  return Object.freeze({
    session,
    projection: agentVisibleRunProjectionV2(session),
    regressionLink
  });
}

/** Reconstructs a new one-case editable suite; the original Contract v3 remains immutable. */
export async function createEditableSuiteCopyFromResultV3(input: {
  readonly sourceResult: ByoaDemoResultV3;
  readonly suiteId: string;
  readonly caseId: string;
  readonly createdAt: string;
}): Promise<ThurstoneContractSuiteV1> {
  const source = await verifyByoaDemoResultV3(input.sourceResult);
  const baseName = source.contract.title.trim();
  const suiteName = `${baseName.slice(0, 73).trimEnd()} copy`;
  let suite = await createThurstoneContractSuite({
    suiteId: input.suiteId,
    name: suiteName,
    catalogSnapshot: source.contract.catalogSnapshot,
    createdAt: input.createdAt
  });
  suite = addContractSuiteCase(
    suite,
    {
      name: source.contract.title,
      request: source.contract.request,
      expectedTool: source.contract.expectedTool,
      argumentPredicate: source.contract.argumentPredicate,
      allowedEffects: source.contract.allowedEffects,
      forbiddenEffects: source.contract.forbiddenEffects,
      replayPolicy: source.contract.replayPolicy,
      approvalClass: source.contract.approvalClass
    },
    { caseId: input.caseId, updatedAt: nextTimestamp(suite.updatedAt) }
  );
  return selectContractSuiteCase(suite, input.caseId, {
    updatedAt: nextTimestamp(suite.updatedAt)
  });
}
