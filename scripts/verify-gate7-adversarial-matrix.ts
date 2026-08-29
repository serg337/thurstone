import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE7_ADVERSARIAL_MATRIX_VERSION = "toolproof-gate7-adversarial-matrix@1.0.0" as const;

type FailureClass =
  | "authorization_rejected"
  | "binding_rejected"
  | "canceled"
  | "domain_idempotent_replay"
  | "domain_partial_failure"
  | "infrastructure_failure"
  | "model_output_invalid"
  | "provider_refusal"
  | "quota_rejected"
  | "runtime_unsupported"
  | "schema_rejected";

type SpendAccounting = "known_no_provider_call" | "not_applicable" | "uncertain_after_dispatch";

interface SourceAssertion {
  readonly file: string;
  readonly anchors: readonly string[];
}

interface AdversarialCase {
  readonly id: string;
  readonly contractThreat: string;
  readonly failureClass: FailureClass;
  readonly expectedDisposition: string;
  readonly semanticAccounting: "excluded_from_model_scores";
  readonly spendAccounting: SpendAccounting;
  readonly sourceAssertion: SourceAssertion;
}

const caseDefinition = (value: Omit<AdversarialCase, "semanticAccounting">): AdversarialCase =>
  Object.freeze({
    ...value,
    semanticAccounting: "excluded_from_model_scores" as const,
    sourceAssertion: Object.freeze({
      ...value.sourceAssertion,
      anchors: Object.freeze([...value.sourceAssertion.anchors])
    })
  });

export const GATE7_ADVERSARIAL_MATRIX: readonly AdversarialCase[] = Object.freeze([
  caseDefinition({
    id: "forged_token",
    contractThreat: "A caller changes a signed authorization token.",
    failureClass: "authorization_rejected",
    expectedDisposition: "invalid_signature before admission",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/probe-token.test.ts",
      anchors: ["rejects tampering, expiry, and weak secrets", 'code: "invalid_signature"']
    }
  }),
  caseDefinition({
    id: "replayed_token",
    contractThreat: "A previously granted single-use authorization is presented again.",
    failureClass: "authorization_rejected",
    expectedDisposition: "ambiguous existing grant rejected; never redispatched",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/probe-ledger.test.ts",
      anchors: [
        "authorizes a provider call only on explicit GRANTED_NEW",
        'code: "AMBIGUOUS_GRANT"'
      ]
    }
  }),
  caseDefinition({
    id: "expired_token",
    contractThreat: "A short-lived authorization is used after its expiry.",
    failureClass: "authorization_rejected",
    expectedDisposition: "expired_token before admission",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/probe-token.test.ts",
      anchors: ["rejects tampering, expiry, and weak secrets", 'code: "expired_token"']
    }
  }),
  caseDefinition({
    id: "modified_case_id",
    contractThreat: "An attempt substitutes a different frozen case identity.",
    failureClass: "binding_rejected",
    expectedDisposition: "ATTEMPT_RUNNER_CASE_MISMATCH",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/scored-run-store.test.ts",
      anchors: [
        "rejects wrong-case attempts, owner conflicts, tampering, and a second infrastructure failure",
        'code: "ATTEMPT_RUNNER_CASE_MISMATCH"'
      ]
    }
  }),
  caseDefinition({
    id: "modified_manifest_hash",
    contractThreat: "The live manifest changes between decision and native admission.",
    failureClass: "binding_rejected",
    expectedDisposition: "boundary_drift with zero native dispatches",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/probe-client-runner.test.ts",
      anchors: [
        "fails closed on manifest drift after the decision and records zero native calls",
        'terminalStatus: "boundary_drift"',
        "expect(harness.executeOnce).not.toHaveBeenCalled()"
      ]
    }
  }),
  caseDefinition({
    id: "duplicate_mutation",
    contractThreat: "Two concurrent mutations reuse one operation identity.",
    failureClass: "domain_idempotent_replay",
    expectedDisposition: "one effect and one replayed receipt",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/checkout-session.test.ts",
      anchors: [
        "serializes concurrent duplicates so exactly one effect is applied",
        "toEqual([false, true])",
        "state.revision).toBe(1)"
      ]
    }
  }),
  caseDefinition({
    id: "invalid_arguments",
    contractThreat: "Malformed, accessor-bearing, or undeclared tool arguments are supplied.",
    failureClass: "schema_rejected",
    expectedDisposition: "rejected before native dispatch or state change",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/webmcp-runtime.test.ts",
      anchors: [
        "rejects non-JSON, cyclic, sparse, accessor, and exotic input before native dispatch",
        "expect(execute).toHaveBeenCalledOnce()"
      ]
    }
  }),
  caseDefinition({
    id: "oversized_arguments",
    contractThreat: "A caller exceeds declared or streamed request-body limits.",
    failureClass: "schema_rejected",
    expectedDisposition: "HTTP 413 body_too_large",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/probe-http.test.ts",
      anchors: [
        "rejects declared oversized bodies and otherwise stays disabled",
        "enforces the active boundary and reads a body using its actual streamed bytes",
        'code: "body_too_large", status: 413'
      ]
    }
  }),
  caseDefinition({
    id: "stale_fixture_or_version",
    contractThreat: "The fixed fixture identity or version is replaced.",
    failureClass: "binding_rejected",
    expectedDisposition: "strict fixture synopsis parse failure",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/gate7-adversarial-matrix.test.ts",
      anchors: [
        "rejects stale fixture identity/version and pins durable admission ceilings",
        'fixtureVersion: "checkout-fixture@stale"',
        'fixtureId: "checkout-seed-stale"'
      ]
    }
  }),
  caseDefinition({
    id: "concurrent_trial",
    contractThreat: "A second provider trial starts while the one-call lease is held.",
    failureClass: "authorization_rejected",
    expectedDisposition: "CONCURRENCY_LIMIT before provider dispatch",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/gate7-adversarial-matrix.test.ts",
      anchors: [
        "rejects stale fixture identity/version and pins durable admission ceilings",
        'return {0, "CONCURRENCY_LIMIT"}'
      ]
    }
  }),
  caseDefinition({
    id: "duplicate_tab",
    contractThreat: "Two browser documents contend for the same durable run owner.",
    failureClass: "authorization_rejected",
    expectedDisposition: "RUN_INDEX_CONFLICT",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/probe-run-index.test.ts",
      anchors: [
        "fails closed on conflicts, malformed identities, and non-monotonic state",
        'code: "RUN_INDEX_CONFLICT"'
      ]
    }
  }),
  caseDefinition({
    id: "interrupted_request",
    contractThreat: "The upstream connection fails after dispatch.",
    failureClass: "infrastructure_failure",
    expectedDisposition: "provider_dispatch_uncertain; no semantic model outcome",
    spendAccounting: "uncertain_after_dispatch",
    sourceAssertion: {
      file: "tests/unit/probe-openai.test.ts",
      anchors: [
        "classifies HTTP, network, and oversized-response failures as uncertain after dispatch",
        'code: "provider_dispatch_uncertain"',
        'dispatch: "after_dispatch_uncertain"'
      ]
    }
  }),
  caseDefinition({
    id: "timeout",
    contractThreat: "Provider delivery exceeds the fixed timeout.",
    failureClass: "infrastructure_failure",
    expectedDisposition: "provider_dispatch_uncertain and exactly one fetch",
    spendAccounting: "uncertain_after_dispatch",
    sourceAssertion: {
      file: "tests/unit/probe-openai.test.ts",
      anchors: [
        "keeps the timeout active through provider delivery and never retries",
        'code: "provider_dispatch_uncertain"',
        "expect(fetchImplementation).toHaveBeenCalledTimes(1)"
      ]
    }
  }),
  caseDefinition({
    id: "cancellation",
    contractThreat: "Consumer cancellation reaches native execution.",
    failureClass: "canceled",
    expectedDisposition: "execution_canceled with no retry",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/webmcp-runtime.test.ts",
      anchors: [
        "propagates the exact AbortSignal and reports cancellation without retry",
        'expectRuntimeCode(error, "execution_canceled")'
      ]
    }
  }),
  caseDefinition({
    id: "reset_failure",
    contractThreat: "Reset evidence is stale or reset completion is disrupted.",
    failureClass: "infrastructure_failure",
    expectedDisposition: "invalid reset receipt; Lab remains unverified",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/checkout-reset.test.ts",
      anchors: [
        "rejects a reset whose post-commit subscriber failed",
        'expect(receipt.status).toBe("invalid")',
        '"reset_session_halted"'
      ]
    }
  }),
  caseDefinition({
    id: "registration_failure",
    contractThreat: "One staged Site Tool registration fails partway through a catalog transition.",
    failureClass: "infrastructure_failure",
    expectedDisposition: "atomic rollback to the prior verified catalog",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/integration/registry-manager.test.ts",
      anchors: [
        "rolls back every staged registration after a partial failure and never reports mixed readiness",
        'phase: "ready", generation: 1',
        "Synthetic registration failure"
      ]
    }
  }),
  caseDefinition({
    id: "partial_mutation",
    contractThreat: "A view/subscriber failure occurs after the domain mutation commits.",
    failureClass: "domain_partial_failure",
    expectedDisposition: "committed effect retained, trace partial, session halted",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/checkout-session.test.ts",
      anchors: [
        "preserves a post-commit mutation, marks it partial, and halts after subscriber failure",
        'commitDisposition: "partial"',
        'code: "session_halted"'
      ]
    }
  }),
  caseDefinition({
    id: "upstream_refusal",
    contractThreat: "The model provider returns an explicit refusal.",
    failureClass: "provider_refusal",
    expectedDisposition: "provider_refusal retained as a known non-decision",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/probe-openai.test.ts",
      anchors: [
        "preserves known refusal, incomplete, and malformed decisions as failures",
        'decisionError).toBe("provider_refusal")',
        "expect(refused.decision).toBeNull()"
      ]
    }
  }),
  caseDefinition({
    id: "malformed_model_output",
    contractThreat: "The provider returns output outside the frozen decision schema.",
    failureClass: "model_output_invalid",
    expectedDisposition: "invalid_structured_decision retained as a failed decision",
    spendAccounting: "not_applicable",
    sourceAssertion: {
      file: "tests/unit/probe-openai.test.ts",
      anchors: [
        "preserves known refusal, incomplete, and malformed decisions as failures",
        'decisionError).toBe("invalid_structured_decision")',
        "expect(malformed.decision).toBeNull()"
      ]
    }
  }),
  caseDefinition({
    id: "unsupported_runtime",
    contractThreat: "Consumer discovery/execution APIs are unavailable.",
    failureClass: "runtime_unsupported",
    expectedDisposition: "provider-ready only; execution stays unverified",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/readiness.test.ts",
      anchors: [
        "keeps provider readiness independent when consumer APIs are unavailable",
        'consumerDiscovery: "unavailable"',
        'consumerExecution: "unverified"'
      ]
    }
  }),
  caseDefinition({
    id: "depleted_quota",
    contractThreat: "A call would exceed a purpose, lifetime-call, or spend ceiling.",
    failureClass: "quota_rejected",
    expectedDisposition: "PURPOSE_CALL_LIMIT, GLOBAL_CALL_LIMIT, or SPEND_LIMIT before dispatch",
    spendAccounting: "known_no_provider_call",
    sourceAssertion: {
      file: "tests/unit/gate7-adversarial-matrix.test.ts",
      anchors: [
        "rejects stale fixture identity/version and pins durable admission ceilings",
        'return {0, "GLOBAL_CALL_LIMIT"}',
        'return {0, "PURPOSE_CALL_LIMIT"}',
        'return {0, "SPEND_LIMIT"}'
      ]
    }
  })
]);

const REQUIRED_CASE_IDS = Object.freeze([
  "forged_token",
  "replayed_token",
  "expired_token",
  "modified_case_id",
  "modified_manifest_hash",
  "duplicate_mutation",
  "invalid_arguments",
  "oversized_arguments",
  "stale_fixture_or_version",
  "concurrent_trial",
  "duplicate_tab",
  "interrupted_request",
  "timeout",
  "cancellation",
  "reset_failure",
  "registration_failure",
  "partial_mutation",
  "upstream_refusal",
  "malformed_model_output",
  "unsupported_runtime",
  "depleted_quota"
]);

const CLASSIFICATION_ASSERTION: SourceAssertion = Object.freeze({
  file: "tests/unit/gate2-attempt-lineage.test.ts",
  anchors: Object.freeze([
    "keeps the authentic semantic failure and invalid infrastructure attempt separate",
    'disposition: "terminal-invalid-infrastructure"',
    "retainedSemanticRowCount: 0",
    "semanticOutcomeInspected: false"
  ])
});

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function resolveGate7RepositoryRoot(cwd = process.cwd()): string {
  const root = resolve(cwd);
  const packageDocument = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    name?: unknown;
  };
  assert(packageDocument.name === "toolproof", "gate7_matrix_wrong_repository");
  return root;
}

function verifySourceAssertion(repositoryRoot: string, assertion: SourceAssertion): void {
  assert(
    assertion.file.startsWith("tests/") && !assertion.file.includes(".."),
    `gate7_matrix_unsafe_source:${assertion.file}`
  );
  const source = readFileSync(resolve(repositoryRoot, assertion.file), "utf8");
  for (const anchor of assertion.anchors) {
    assert(source.includes(anchor), `gate7_matrix_anchor_missing:${assertion.file}:${anchor}`);
  }
}

export function verifyGate7AdversarialSourceCoverage(repositoryRoot: string): void {
  const ids = GATE7_ADVERSARIAL_MATRIX.map(({ id }) => id);
  assert(
    JSON.stringify(ids) === JSON.stringify(REQUIRED_CASE_IDS),
    "gate7_matrix_required_case_set_drift"
  );
  assert(new Set(ids).size === ids.length, "gate7_matrix_duplicate_case");

  for (const entry of GATE7_ADVERSARIAL_MATRIX) {
    assert(
      entry.semanticAccounting === "excluded_from_model_scores",
      `gate7_matrix_semantic_accounting_drift:${entry.id}`
    );
    assert(
      !entry.failureClass.includes("uncertain"),
      `gate7_matrix_infrastructure_mislabeled_as_model_uncertainty:${entry.id}`
    );
    verifySourceAssertion(repositoryRoot, entry.sourceAssertion);
  }

  const infrastructureIds = [
    "interrupted_request",
    "timeout",
    "reset_failure",
    "registration_failure"
  ];
  for (const id of infrastructureIds) {
    assert(
      GATE7_ADVERSARIAL_MATRIX.find((entry) => entry.id === id)?.failureClass ===
        "infrastructure_failure",
      `gate7_matrix_infrastructure_classification_drift:${id}`
    );
  }
  assert(
    GATE7_ADVERSARIAL_MATRIX.find(({ id }) => id === "upstream_refusal")?.failureClass ===
      "provider_refusal",
    "gate7_matrix_refusal_classification_drift"
  );
  assert(
    GATE7_ADVERSARIAL_MATRIX.find(({ id }) => id === "malformed_model_output")?.failureClass ===
      "model_output_invalid",
    "gate7_matrix_malformed_output_classification_drift"
  );
  verifySourceAssertion(repositoryRoot, CLASSIFICATION_ASSERTION);
}

const focusedTestFiles = (): readonly string[] =>
  Object.freeze(
    [
      ...GATE7_ADVERSARIAL_MATRIX.map(({ sourceAssertion }) => sourceAssertion.file),
      CLASSIFICATION_ASSERTION.file
    ]
      .filter((file, index, files) => files.indexOf(file) === index)
      .sort()
  );

export function buildGate7AdversarialEvidence(repositoryRoot: string): Readonly<{
  version: typeof GATE7_ADVERSARIAL_MATRIX_VERSION;
  status: "verified";
  scope: "current-source-set";
  modelSemanticOutcomesRecorded: 0;
  providerCallsMade: 0;
  coverageCount: number;
  classificationInvariant: string;
  verificationCommand: string;
  sourceSetDigest: string;
  sourceFiles: readonly Readonly<{ path: string; sha256: string }>[];
  coverage: readonly Readonly<Omit<AdversarialCase, "sourceAssertion"> & { testFile: string }>[];
}> {
  verifyGate7AdversarialSourceCoverage(repositoryRoot);
  const sourceFiles = focusedTestFiles().map((path) => ({
    path,
    sha256: sha256(readFileSync(resolve(repositoryRoot, path)))
  }));
  const sourceSetDigest = sha256(
    `${GATE7_ADVERSARIAL_MATRIX_VERSION}\n${sourceFiles
      .map(({ path, sha256: digest }) => `${path}\0${digest}`)
      .join("\n")}`
  );
  const testFiles = focusedTestFiles();
  const verificationCommand = `npx vitest run ${testFiles.join(" ")}`;
  return Object.freeze({
    version: GATE7_ADVERSARIAL_MATRIX_VERSION,
    status: "verified" as const,
    scope: "current-source-set" as const,
    modelSemanticOutcomesRecorded: 0 as const,
    providerCallsMade: 0 as const,
    coverageCount: GATE7_ADVERSARIAL_MATRIX.length,
    classificationInvariant:
      "Infrastructure, interruption, timeout, cancellation, runtime, quota, refusal, and malformed-output outcomes are excluded from semantic model scores and retain distinct failure classes; after-dispatch uncertainty refers only to conservative spend settlement.",
    verificationCommand,
    sourceSetDigest,
    sourceFiles: Object.freeze(sourceFiles.map((sourceFile) => Object.freeze(sourceFile))),
    coverage: Object.freeze(
      GATE7_ADVERSARIAL_MATRIX.map(({ sourceAssertion, ...entry }) =>
        Object.freeze({ ...entry, testFile: sourceAssertion.file })
      )
    )
  });
}

export function verifyTrackedGate7AdversarialEvidence(repositoryRoot: string): void {
  const expected = `${JSON.stringify(buildGate7AdversarialEvidence(repositoryRoot), null, 2)}\n`;
  const evidencePath = resolve(repositoryRoot, "evidence/gate7/adversarial-matrix.json");
  const retained = readFileSync(evidencePath, "utf8");
  assert(retained === expected, "gate7_matrix_retained_evidence_drift");
}

function runFocusedTests(repositoryRoot: string): void {
  const testFiles = focusedTestFiles();
  const result = spawnSync("npx", ["vitest", "run", ...testFiles], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, CI: "1" }
  });
  assert(result.status === 0, `gate7_matrix_focused_tests_failed:${result.status ?? "signal"}`);
}

function main(): void {
  const repositoryRoot = resolveGate7RepositoryRoot();
  const argumentsSet = new Set(process.argv.slice(2));
  const allowedArguments = new Set(["--check", "--print-evidence", "--run-tests"]);
  for (const argument of argumentsSet) {
    assert(allowedArguments.has(argument), `gate7_matrix_unknown_argument:${argument}`);
  }
  assert(
    !(argumentsSet.has("--check") && argumentsSet.has("--print-evidence")),
    "gate7_matrix_conflicting_arguments"
  );

  if (argumentsSet.has("--run-tests")) runFocusedTests(repositoryRoot);
  if (argumentsSet.has("--print-evidence")) {
    process.stdout.write(
      `${JSON.stringify(buildGate7AdversarialEvidence(repositoryRoot), null, 2)}\n`
    );
    return;
  }
  verifyTrackedGate7AdversarialEvidence(repositoryRoot);
  process.stdout.write(
    `Gate 7 adversarial matrix verified: ${GATE7_ADVERSARIAL_MATRIX.length}/${REQUIRED_CASE_IDS.length} required cases; zero provider calls.\n`
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) main();
