"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { ZodError } from "zod";

import styles from "@/components/demo/contract-suite-builder.module.css";
import {
  THURSTONE_CONTRACT_SUITE_MAX_CASES,
  ContractSuiteOperationError,
  addContractSuiteCase,
  editContractSuiteCase,
  newThurstoneContractCaseId,
  parseThurstoneContractSuite,
  removeContractSuiteCase,
  renameContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseArgumentPredicate,
  type ThurstoneContractCaseInput,
  type ThurstoneContractCaseV1,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import type { ThurstoneDemoSelectableToolName } from "@/lib/demo/catalog-snapshot";
import type { WorkshopEffectPredicate } from "@/lib/demo/contract";

type PreflightState = "ready" | "pending" | "blocked";

export interface ContractSuiteBuilderPreflight {
  readonly buildCommit?: string;
  readonly cleanFixture?: PreflightState;
  readonly catalog?: PreflightState;
  readonly answerKeyIsolation?: PreflightState;
}

export interface ContractSuiteArmSelection {
  readonly suite: ThurstoneContractSuiteV1;
  readonly selectedCase: ThurstoneContractCaseV1;
}

export interface ContractSuiteBuilderProps {
  readonly suite: ThurstoneContractSuiteV1;
  readonly onChange: (suite: ThurstoneContractSuiteV1) => void;
  readonly onReviewArm: (selection: ContractSuiteArmSelection) => void;
  readonly preflight?: ContractSuiteBuilderPreflight;
}

type EditorState = {
  readonly name: string;
  readonly request: string;
  readonly expectedTool: ThurstoneDemoSelectableToolName | "";
  readonly itemId: "field-notebook" | "stoneware-mug";
  readonly quantity: string;
};

const EMPTY_EDITOR: EditorState = Object.freeze({
  name: "",
  request: "",
  expectedTool: "",
  itemId: "stoneware-mug",
  quantity: "3"
});

const SEEDED_QUANTITY = Object.freeze({
  "field-notebook": 1,
  "stoneware-mug": 2
} as const);

function nextTimestamp(suite: ThurstoneContractSuiteV1, increment = 1): string {
  return new Date(Math.max(Date.now(), Date.parse(suite.updatedAt) + increment)).toISOString();
}

function errorMessage(error: unknown): string {
  if (error instanceof ContractSuiteOperationError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "The test case is invalid.";
  return error instanceof Error ? error.message : "The test case could not be updated.";
}

function policyForEditor(editor: EditorState): ThurstoneContractCaseInput {
  if (editor.expectedTool === "") {
    throw new Error("Choose what the agent should do before adding this test case.");
  }

  const common = { name: editor.name, request: editor.request } as const;
  if (editor.expectedTool === "cart_get" || editor.expectedTool === "order_review") {
    return {
      ...common,
      expectedTool: editor.expectedTool,
      argumentPredicate: { kind: "empty" },
      allowedEffects: [],
      forbiddenEffects: [
        { kind: "cart_mutation" },
        { kind: "pending_checkout" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "read_only",
      approvalClass: "read_only"
    };
  }

  if (editor.expectedTool === "cart_update") {
    const quantity = Number(editor.quantity);
    return {
      ...common,
      expectedTool: "cart_update",
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId: editor.itemId,
        quantity
      },
      allowedEffects: [{ kind: "cart_quantity", itemId: editor.itemId, quantity }],
      forbiddenEffects: [
        { kind: "pending_checkout" },
        { kind: "duplicate_transition" },
        { kind: "unmodeled_state" }
      ],
      replayPolicy: "exactly_once",
      approvalClass: "consequential"
    };
  }

  return {
    ...common,
    expectedTool: "checkout_request",
    argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
    allowedEffects: [{ kind: "pending_checkout" }],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once",
    approvalClass: "consequential"
  };
}

function editorFromCase(testCase: ThurstoneContractCaseV1): EditorState {
  const predicate = testCase.argumentPredicate;
  return {
    name: testCase.name,
    request: testCase.request,
    expectedTool: testCase.expectedTool,
    itemId: predicate.kind === "cart_update" ? predicate.itemId : "stoneware-mug",
    quantity: predicate.kind === "cart_update" ? String(predicate.quantity) : "3"
  };
}

function argumentSummary(predicate: ThurstoneContractCaseArgumentPredicate): string {
  if (predicate.kind === "empty") return "No arguments";
  if (predicate.kind === "checkout_request") return "Operation ID: valid and unique";
  return `Set ${predicate.itemId} to ${predicate.quantity}; operation ID: valid and unique`;
}

function effectSummary(effects: readonly WorkshopEffectPredicate[], allowed: boolean): string {
  if (effects.length === 0) return allowed ? "No state change" : "None";
  return effects
    .map((effect) => {
      if (effect.kind === "cart_quantity") {
        return `${effect.itemId} quantity becomes ${effect.quantity}`;
      }
      if (effect.kind === "pending_checkout") return "pending checkout";
      if (effect.kind === "cart_mutation") return "other cart mutation";
      if (effect.kind === "duplicate_transition") return "duplicate transition";
      return "unmodeled state change";
    })
    .join(", ");
}

function editorPolicySummary(editor: EditorState): {
  readonly arguments: string;
  readonly allowed: string;
  readonly prohibited: string;
  readonly replay: string;
} | null {
  if (editor.expectedTool === "") return null;
  const policy = policyForEditor(editor);
  return {
    arguments: argumentSummary(policy.argumentPredicate),
    allowed: effectSummary(policy.allowedEffects, true),
    prohibited: effectSummary(policy.forbiddenEffects, false),
    replay:
      policy.replayPolicy === "read_only"
        ? "Read-only policy"
        : "Exactly-once policy; replay is verified separately"
  };
}

function PreflightStatus({
  label,
  state
}: {
  readonly label: string;
  readonly state: PreflightState;
}) {
  return (
    <li data-state={state}>
      <span aria-hidden="true">{state === "ready" ? "✓" : state === "blocked" ? "!" : "…"}</span>
      <span>{label}</span>
      <strong>{state}</strong>
    </li>
  );
}

function ReviewArmDialog({
  selection,
  preflight,
  onCancel,
  onConfirm
}: {
  readonly selection: ContractSuiteArmSelection;
  readonly preflight: ContractSuiteBuilderPreflight | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { suite, selectedCase } = selection;
  const readyToArm =
    preflight?.cleanFixture === "ready" &&
    preflight.catalog === "ready" &&
    preflight.answerKeyIsolation === "ready";

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    focusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel]);

  return (
    <div className={styles.dialogBackdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.kicker}>Review one selected case</p>
            <h2 id={titleId}>Arm “{selectedCase.name}”</h2>
            <p id={descriptionId}>
              This live run admits one native call. It does not run the whole suite or measure
              replay.
            </p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            onClick={onCancel}
            aria-label="Close review"
          >
            ×
          </button>
        </div>

        <div className={styles.reviewColumns}>
          <section aria-labelledby={`${titleId}-owner`}>
            <p className={styles.ownerLabel}>Owner expects · hidden rubric</p>
            <h3 id={`${titleId}-owner`}>{selectedCase.name}</h3>
            <dl className={styles.summaryList}>
              <div>
                <dt>Tool</dt>
                <dd>
                  <code>{selectedCase.expectedTool}</code>
                </dd>
              </div>
              <div>
                <dt>Arguments</dt>
                <dd>{argumentSummary(selectedCase.argumentPredicate)}</dd>
              </div>
              <div>
                <dt>Allowed</dt>
                <dd>{effectSummary(selectedCase.allowedEffects, true)}</dd>
              </div>
              <div>
                <dt>Prohibited</dt>
                <dd>{effectSummary(selectedCase.forbiddenEffects, false)}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{selectedCase.replayPolicy.replaceAll("_", " ")}</dd>
              </div>
            </dl>
            <p className={styles.isolationNote}>
              These expectations remain on the owner side and are not included in the fresh-agent
              projection.
            </p>
          </section>

          <section aria-labelledby={`${titleId}-agent`}>
            <p className={styles.agentLabel}>Agent receives · no answer key</p>
            <h3 id={`${titleId}-agent`}>Request plus the exact catalog</h3>
            <blockquote>{selectedCase.request}</blockquote>
            <ul className={styles.agentCatalog}>
              {suite.catalogSnapshot.tools.map((tool) => (
                <li key={tool.name}>
                  <strong>{tool.title}</strong>
                  <code>{tool.name}</code>
                  <p>{tool.description}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <details className={styles.preflight}>
          <summary>Technical preflight</summary>
          <ul>
            <PreflightStatus
              label="Exact reference seed bound"
              state={preflight?.cleanFixture ?? "pending"}
            />
            <PreflightStatus
              label="Exact selected catalog and build"
              state={preflight?.catalog ?? "pending"}
            />
            <PreflightStatus
              label="Answer-key isolation"
              state={preflight?.answerKeyIsolation ?? "pending"}
            />
          </ul>
          <dl>
            <div>
              <dt>Fixture</dt>
              <dd>
                <code>{suite.catalogSnapshot.fixtureId}</code>
              </dd>
            </div>
            <div>
              <dt>Catalog</dt>
              <dd>
                <code>{suite.catalogDigest.slice(0, 16)}…</code>
              </dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>
                <code>{preflight?.buildCommit ?? "resolved when armed"}</code>
              </dd>
            </div>
          </dl>
        </details>

        <p className={styles.privacyNotice}>
          Only this synthetic selected case and catalog enter the expiring encrypted handoff. Do not
          include personal, customer, credential, payment, confidential, or secret data.
        </p>

        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} type="button" onClick={onCancel}>
            Keep editing
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={onConfirm}
            disabled={!readyToArm}
            title={readyToArm ? undefined : "All preflight checks must be ready before arm."}
          >
            Arm live test
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContractSuiteBuilder({
  suite,
  onChange,
  onReviewArm,
  preflight
}: ContractSuiteBuilderProps) {
  const strictSuite = useMemo(() => parseThurstoneContractSuite(suite), [suite]);
  const [suiteName, setSuiteName] = useState(strictSuite.name);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const caseNameRef = useRef<HTMLInputElement>(null);
  const suiteNameId = useId();
  const editorNameId = useId();
  const requestId = useId();
  const expectedToolId = useId();
  const itemId = useId();
  const quantityId = useId();

  useEffect(() => {
    queueMicrotask(() => setSuiteName(strictSuite.name));
  }, [strictSuite.name]);

  const selectedCase = strictSuite.cases.find(
    ({ caseId }) => caseId === strictSuite.selectedCaseId
  );
  const editorPolicy = editorPolicySummary(editor);

  const closeReview = useCallback(() => setReviewOpen(false), []);

  function patchEditor(patch: Partial<EditorState>) {
    setEditor((current) => ({ ...current, ...patch }));
    setError(undefined);
  }

  function commitSuiteName() {
    const normalized = suiteName.trim();
    if (normalized === strictSuite.name) return;
    try {
      const next = renameContractSuite(strictSuite, normalized, {
        updatedAt: nextTimestamp(strictSuite)
      });
      onChange(next);
      setSuiteName(next.name);
      setAnnouncement(`Contract suite renamed to ${next.name}.`);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function handleSuiteNameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitSuiteName();
  }

  function clearEditor(message?: string) {
    setEditor(EMPTY_EDITOR);
    setEditingCaseId(null);
    if (message !== undefined) setAnnouncement(message);
  }

  function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    try {
      const input = policyForEditor(editor);
      if (editingCaseId !== null) {
        const next = editContractSuiteCase(strictSuite, editingCaseId, input, {
          updatedAt: nextTimestamp(strictSuite)
        });
        onChange(next);
        clearEditor(`Updated ${input.name}. The case remains in this contract suite.`);
      } else {
        const added = addContractSuiteCase(strictSuite, input, {
          caseId: newThurstoneContractCaseId(),
          updatedAt: nextTimestamp(strictSuite)
        });
        const next =
          strictSuite.cases.length === 0
            ? selectContractSuiteCase(added, added.cases[0]!.caseId, {
                updatedAt: nextTimestamp(added)
              })
            : added;
        onChange(next);
        clearEditor(`Added ${input.name}. The editor is ready for another representative request.`);
      }
      queueMicrotask(() => caseNameRef.current?.focus());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function beginEdit(testCase: ThurstoneContractCaseV1) {
    setEditingCaseId(testCase.caseId);
    setEditor(editorFromCase(testCase));
    setError(undefined);
    setAnnouncement(`Editing ${testCase.name}.`);
    queueMicrotask(() => caseNameRef.current?.focus());
  }

  function removeCase(testCase: ThurstoneContractCaseV1) {
    try {
      const wasSelected = strictSuite.selectedCaseId === testCase.caseId;
      const next = removeContractSuiteCase(strictSuite, testCase.caseId, {
        updatedAt: nextTimestamp(strictSuite)
      });
      onChange(next);
      if (editingCaseId === testCase.caseId) clearEditor();
      setError(undefined);
      setAnnouncement(
        next.cases.length === 0
          ? `Removed ${testCase.name}. This contract suite is now empty.`
          : wasSelected
            ? `Removed ${testCase.name}. Select another case before arming a live test.`
            : `Removed ${testCase.name}.`
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function selectCase(testCase: ThurstoneContractCaseV1) {
    try {
      const next = selectContractSuiteCase(strictSuite, testCase.caseId, {
        updatedAt: nextTimestamp(strictSuite)
      });
      onChange(next);
      setError(undefined);
      setAnnouncement(`${testCase.name} is selected for the next live test.`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function openReview() {
    if (selectedCase === undefined) {
      setError(
        strictSuite.cases.length === 0
          ? "Add at least one test case before review and arm."
          : "Select one test case before review and arm."
      );
      return;
    }
    setReviewOpen(true);
  }

  function confirmArm() {
    if (selectedCase === undefined) return;
    closeReview();
    onReviewArm({ suite: strictSuite, selectedCase });
  }

  return (
    <section className={styles.builder} aria-labelledby="contract-suite-builder-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Stage 3 · Build the contract suite</p>
          <h2 id="contract-suite-builder-title">
            Turn representative requests into repeatable tests.
          </h2>
          <p>
            You do not need every possible phrase. Start with examples that represent a meaning your
            WebMCP catalog must handle correctly, then add real incidents as regression cases later.
          </p>
        </div>
        <div
          className={styles.count}
          aria-label={`${strictSuite.cases.length} of ${THURSTONE_CONTRACT_SUITE_MAX_CASES} cases`}
        >
          <strong>{strictSuite.cases.length}</strong>
          <span>/ {THURSTONE_CONTRACT_SUITE_MAX_CASES} cases</span>
        </div>
      </header>

      <div className={styles.suiteName}>
        <label htmlFor={suiteNameId}>Contract-suite name</label>
        <input
          id={suiteNameId}
          value={suiteName}
          maxLength={80}
          onChange={(event) => setSuiteName(event.target.value)}
          onBlur={commitSuiteName}
          onKeyDown={handleSuiteNameKeyDown}
        />
        <small>
          Names this browser-local regression suite; press Enter or leave the field to save.
        </small>
      </div>

      <div className={styles.workspace}>
        <form className={styles.editor} onSubmit={submitCase} noValidate>
          <div className={styles.editorHeading}>
            <div>
              <p className={styles.kicker}>
                {editingCaseId === null ? "New test case" : "Edit test case"}
              </p>
              <h3>
                {editingCaseId === null
                  ? "Define one meaning boundary"
                  : "Update the selected case"}
              </h3>
            </div>
            {editingCaseId !== null ? (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => clearEditor("Edit canceled. Unsaved editor changes were cleared.")}
              >
                Cancel edit
              </button>
            ) : null}
          </div>

          <label htmlFor={editorNameId}>Test-case name</label>
          <input
            ref={caseNameRef}
            id={editorNameId}
            value={editor.name}
            maxLength={80}
            required
            placeholder="Explicit checkout"
            onChange={(event) => patchEditor({ name: event.target.value })}
          />

          <label htmlFor={requestId}>Representative user request</label>
          <textarea
            id={requestId}
            value={editor.request}
            maxLength={280}
            required
            rows={3}
            placeholder="I am ready—request checkout for this cart."
            onChange={(event) => patchEditor({ request: event.target.value })}
          />
          <small className={styles.fieldHelp}>
            Write one realistic example of the intent—not every sentence a user might say.
          </small>
          <small className={styles.privacyNotice}>
            Synthetic test data only. Do not enter personal, customer, credential, payment,
            confidential, or secret data.
          </small>

          <label htmlFor={expectedToolId}>What should the agent do?</label>
          <select
            id={expectedToolId}
            value={editor.expectedTool}
            required
            onChange={(event) =>
              patchEditor({ expectedTool: event.target.value as EditorState["expectedTool"] })
            }
          >
            <option value="">Choose a real WebMCP tool</option>
            {strictSuite.catalogSnapshot.tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.title} · {tool.name}
              </option>
            ))}
          </select>

          {editor.expectedTool === "cart_update" ? (
            <fieldset className={styles.arguments}>
              <legend>Expected arguments · from the live schema</legend>
              <div className={styles.argumentGrid}>
                <div>
                  <label htmlFor={itemId}>Cart item</label>
                  <select
                    id={itemId}
                    value={editor.itemId}
                    onChange={(event) =>
                      patchEditor({ itemId: event.target.value as EditorState["itemId"] })
                    }
                  >
                    <option value="field-notebook">Field notebook</option>
                    <option value="stoneware-mug">Stoneware mug</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={quantityId}>Quantity</label>
                  <input
                    id={quantityId}
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={editor.quantity}
                    onChange={(event) => patchEditor({ quantity: event.target.value })}
                  />
                </div>
              </div>
              <small>
                Seeded quantity: {SEEDED_QUANTITY[editor.itemId]}. Choose a different quantity.
                Thurstone will require a valid, unique operation ID at runtime.
              </small>
            </fieldset>
          ) : editor.expectedTool === "checkout_request" ? (
            <div className={styles.argumentsNote}>
              <strong>Expected argument</strong>
              <span>
                One operation ID that is valid and unique; no literal ID is frozen into the
                contract.
              </span>
            </div>
          ) : editor.expectedTool !== "" ? (
            <div className={styles.argumentsNote}>
              <strong>Expected arguments</strong>
              <span>None. This is a read-only call.</span>
            </div>
          ) : null}

          {editorPolicy !== null ? (
            <dl className={styles.policyPreview} aria-label="Contract rules derived from this tool">
              <div>
                <dt>Arguments</dt>
                <dd>{editorPolicy.arguments}</dd>
              </div>
              <div>
                <dt>Allowed effect</dt>
                <dd>{editorPolicy.allowed}</dd>
              </div>
              <div>
                <dt>Prohibited</dt>
                <dd>{editorPolicy.prohibited}</dd>
              </div>
              <div>
                <dt>Replay policy</dt>
                <dd>{editorPolicy.replay}</dd>
              </div>
              <div>
                <dt>Trusted state</dt>
                <dd>Independent reference-checkout ledger</dd>
              </div>
            </dl>
          ) : null}

          {error !== undefined ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.editorActions}>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={
                editingCaseId === null &&
                strictSuite.cases.length >= THURSTONE_CONTRACT_SUITE_MAX_CASES
              }
            >
              {editingCaseId === null ? "Add test case" : "Save changes"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                clearEditor("Unsaved case editor cleared. The suite and catalog were preserved.")
              }
            >
              Clear unsaved editor
            </button>
          </div>
        </form>

        <section className={styles.visualizer} aria-labelledby="contract-suite-cases-title">
          <div className={styles.visualizerHeading}>
            <div>
              <p className={styles.kicker}>Your contract</p>
              <h3 id="contract-suite-cases-title">Visible regression suite</h3>
            </div>
            <span>
              {strictSuite.cases.length === 1 ? "1 case" : `${strictSuite.cases.length} cases`}
            </span>
          </div>

          {strictSuite.cases.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No test cases yet.</strong>
              <p>
                Add a representative request and its expected real tool. The case will appear here.
              </p>
            </div>
          ) : (
            <ol className={styles.caseList}>
              {strictSuite.cases.map((testCase, index) => {
                const selected = strictSuite.selectedCaseId === testCase.caseId;
                return (
                  <li key={testCase.caseId}>
                    <article className={styles.caseCard} data-selected={selected}>
                      <header>
                        <span className={styles.ordinal}>{index + 1}</span>
                        <div>
                          <h4>{testCase.name}</h4>
                          <p>“{testCase.request}”</p>
                        </div>
                        {selected ? (
                          <strong className={styles.selectedBadge}>Live case</strong>
                        ) : null}
                      </header>
                      <dl className={styles.caseSummary}>
                        <div>
                          <dt>Expected action</dt>
                          <dd>
                            <code>{testCase.expectedTool}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Arguments</dt>
                          <dd>{argumentSummary(testCase.argumentPredicate)}</dd>
                        </div>
                        <div>
                          <dt>Allowed</dt>
                          <dd>{effectSummary(testCase.allowedEffects, true)}</dd>
                        </div>
                        <div>
                          <dt>Prohibited</dt>
                          <dd>{effectSummary(testCase.forbiddenEffects, false)}</dd>
                        </div>
                        <div>
                          <dt>Replay</dt>
                          <dd>{testCase.replayPolicy.replaceAll("_", " ")}</dd>
                        </div>
                      </dl>
                      <div className={styles.caseActions}>
                        <label>
                          <input
                            type="radio"
                            name={`live-case-${strictSuite.suiteId}`}
                            checked={selected}
                            onChange={() => selectCase(testCase)}
                          />
                          Select for live test
                        </label>
                        <button type="button" onClick={() => beginEdit(testCase)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => removeCase(testCase)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}

          <aside className={styles.executionBoundary}>
            <strong>One selected case enters each live run.</strong>
            <p>
              The suite is not run automatically. Every future rerun remains an independent result
              linked to its case.
            </p>
          </aside>
          <button
            className={styles.armButton}
            type="button"
            onClick={openReview}
            disabled={strictSuite.cases.length === 0 || selectedCase === undefined}
          >
            Review and arm selected case
          </button>
          {strictSuite.cases.length > 0 && selectedCase === undefined ? (
            <p className={styles.selectionHelp}>
              Select one remaining case before arming a live test.
            </p>
          ) : null}
        </section>
      </div>

      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {reviewOpen && selectedCase !== undefined ? (
        <ReviewArmDialog
          selection={{ suite: strictSuite, selectedCase }}
          preflight={preflight}
          onCancel={closeReview}
          onConfirm={confirmArm}
        />
      ) : null}
    </section>
  );
}
