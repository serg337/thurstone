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
import { z, ZodError } from "zod";

import styles from "@/components/demo/contract-suite-builder.module.css";
import { ContinuousJourneyOrganizer } from "@/components/demo/continuous-journey-organizer";
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
import {
  canRunContinuousJourney,
  clearContractRunQueue,
  createContractRunQueue,
  queueRemainingCaseIds,
  readContractRunQueue,
  writeContractRunQueue,
  type ContractRunMode,
  type ContractRunQueue
} from "@/lib/demo/contract-run-queue";
import {
  continuousJourneyPlanStorageKey,
  createContinuousJourneyPlanDraft,
  reconcileContinuousJourneyPlanDraft,
  validateContinuousJourneyPlan,
  type ContinuousJourneyPlanDraft
} from "@/lib/demo/continuous-journey-plan";
import {
  defaultSchemaArgumentValues,
  schemaArgumentFields,
  type SchemaArgumentValue,
  type SchemaArgumentValues
} from "@/lib/demo/schema-argument-form";

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
  readonly mode: ContractRunMode;
  readonly orderedCases: readonly ThurstoneContractCaseV1[];
}

export interface ContractSuiteBuilderProps {
  readonly suite: ThurstoneContractSuiteV1;
  readonly onChange: (suite: ThurstoneContractSuiteV1) => void;
  readonly onReviewArm: (selection: ContractSuiteArmSelection) => void;
  readonly preflight?: ContractSuiteBuilderPreflight;
  readonly initialEditCaseId?: string;
  readonly initialRunMode?: ContractRunMode;
}

type EditorState = {
  readonly name: string;
  readonly expectedTool: ThurstoneDemoSelectableToolName | "";
  readonly requests: readonly RequestVariant[];
};

type RequestVariant = {
  readonly request: string;
  readonly arguments: SchemaArgumentValues;
};

const EMPTY_EDITOR: EditorState = Object.freeze({
  name: "",
  expectedTool: "",
  requests: [{ request: "", arguments: {} }]
});

const DEMO_STARTER_CASES: Readonly<Record<ThurstoneDemoSelectableToolName, EditorState>> =
  Object.freeze({
    cart_get: Object.freeze({
      name: "Read cart contents",
      expectedTool: "cart_get",
      requests: [{ request: "What is in my cart?", arguments: {} }]
    }),
    cart_update: Object.freeze({
      name: "Update cart quantity",
      expectedTool: "cart_update",
      requests: [
        {
          request: "Set the stoneware mug quantity to 3.",
          arguments: {
            operationId: "runtime-generated",
            operation: "set_quantity",
            itemId: "stoneware-mug",
            quantity: 3
          }
        }
      ]
    }),
    order_review: Object.freeze({
      name: "Review complete order",
      expectedTool: "order_review",
      requests: [{ request: "Show me the complete order.", arguments: {} }]
    }),
    checkout_request: Object.freeze({
      name: "Begin checkout",
      expectedTool: "checkout_request",
      requests: [
        {
          request: "I am ready—request checkout for this cart.",
          arguments: { operationId: "runtime-generated" }
        }
      ]
    })
  });

const editorDraftSchema = z
  .object({
    name: z.string().max(80),
    expectedTool: z.union([
      z.literal(""),
      z.enum(["cart_get", "cart_update", "order_review", "checkout_request"])
    ]),
    requests: z
      .array(
        z
          .object({
            request: z.string().max(280),
            arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          })
          .strict()
      )
      .min(1)
      .max(THURSTONE_CONTRACT_SUITE_MAX_CASES)
  })
  .strict();

const EDITOR_DRAFT_STORAGE_PREFIX = "thurstone:contract-case-draft@2:";
const DEMO_CART_ITEM_LABELS = Object.freeze([
  { itemId: "field-notebook", label: "Field notebook" },
  { itemId: "stoneware-mug", label: "Stoneware mug" }
] as const);

function nextTimestamp(suite: ThurstoneContractSuiteV1, increment = 1): string {
  return new Date(Math.max(Date.now(), Date.parse(suite.updatedAt) + increment)).toISOString();
}

function errorMessage(error: unknown): string {
  if (error instanceof ContractSuiteOperationError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "The test case is invalid.";
  return error instanceof Error ? error.message : "The test case could not be updated.";
}

function assertRequestMatchesDemoItem(request: string, itemId: string) {
  const normalized = request.toLocaleLowerCase("en-US");
  const mentioned = DEMO_CART_ITEM_LABELS.filter(({ label }) =>
    normalized.includes(label.toLocaleLowerCase("en-US"))
  );
  if (mentioned.length !== 1 || mentioned[0]?.itemId === itemId) return;
  const expected = DEMO_CART_ITEM_LABELS.find((item) => item.itemId === itemId);
  throw new Error(
    `This request mentions ${mentioned[0]?.label}, but its expected Item ID is ` +
      `${expected?.label ?? itemId}. Align the request and expected arguments before adding it.`
  );
}

function policyForEditor(editor: EditorState, variant: RequestVariant): ThurstoneContractCaseInput {
  if (editor.expectedTool === "") {
    throw new Error("Choose what the agent should do before adding this test case.");
  }

  const common = { name: editor.name, request: variant.request } as const;
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
    const itemId = String(variant.arguments.itemId ?? "");
    if (itemId !== "field-notebook" && itemId !== "stoneware-mug") {
      throw new Error("Choose a fixture-backed cart item for every cart_update request.");
    }
    const quantity = Number(variant.arguments.quantity);
    return {
      ...common,
      expectedTool: "cart_update",
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId,
        quantity
      },
      allowedEffects: [{ kind: "cart_quantity", itemId, quantity }],
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

function representativeRequests(editor: EditorState): readonly RequestVariant[] {
  const requests = editor.requests
    .map((variant) => ({ ...variant, request: variant.request.trim() }))
    .filter((variant) => variant.request.length > 0);
  if (requests.length === 0) throw new Error("Add at least one representative user request.");
  if (new Set(requests.map(({ request }) => request)).size !== requests.length) {
    throw new Error("Representative user requests must be unique within this test.");
  }
  return requests;
}

function editorFromCase(testCase: ThurstoneContractCaseV1): EditorState {
  const predicate = testCase.argumentPredicate;
  const argumentsValue =
    predicate.kind === "cart_update"
      ? {
          operationId: "runtime-generated",
          operation: "set_quantity",
          itemId: predicate.itemId,
          quantity: predicate.quantity
        }
      : predicate.kind === "checkout_request"
        ? { operationId: "runtime-generated" }
        : {};
  return {
    name: testCase.name,
    expectedTool: testCase.expectedTool,
    requests: [{ request: testCase.request, arguments: argumentsValue }]
  };
}

function argumentSummary(predicate: ThurstoneContractCaseArgumentPredicate): string {
  if (predicate.kind === "empty") return "No arguments";
  if (predicate.kind === "checkout_request") return "Generated automatically at runtime";
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
  const first = editor.requests[0] ?? { request: "", arguments: {} };
  const policy = policyForEditor(editor, first);
  return {
    arguments:
      editor.expectedTool === "cart_update"
        ? "Validated independently for every request"
        : argumentSummary(policy.argumentPredicate),
    allowed:
      editor.expectedTool === "cart_update"
        ? "Only the declared item quantity may change for each request"
        : effectSummary(policy.allowedEffects, true),
    prohibited: effectSummary(policy.forbiddenEffects, false),
    replay:
      policy.replayPolicy === "read_only"
        ? "Read-only policy"
        : "Exactly-once policy; replay is verified separately"
  };
}

function SchemaArgumentEditor({
  toolName,
  requestIndex,
  values,
  onChange
}: {
  readonly toolName: ThurstoneDemoSelectableToolName;
  readonly requestIndex: number;
  readonly values: SchemaArgumentValues;
  readonly onChange: (name: string, value: SchemaArgumentValue) => void;
}) {
  const fields = schemaArgumentFields(toolName).filter(
    (field) => field.kind !== "runtime" && field.kind !== "fixed"
  );
  if (fields.length === 0) return null;
  return (
    <fieldset className={styles.arguments}>
      <legend>Expected arguments · Request {requestIndex + 1}</legend>
      <div className={styles.schemaArgumentGrid}>
        {fields.map((field) => {
          const id = `schema-argument-${requestIndex}-${field.name}`;
          if (field.kind === "select") {
            return (
              <label htmlFor={id} key={field.name}>
                {field.label}
                <select
                  id={id}
                  required={field.required}
                  value={String(values[field.name] ?? field.options[0] ?? "")}
                  onChange={(event) => onChange(field.name, event.target.value)}
                >
                  {field.options.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {field.description ? <small>{field.description}</small> : null}
              </label>
            );
          }
          if (field.kind === "integer") {
            return (
              <label htmlFor={id} key={field.name}>
                {field.label}
                <input
                  id={id}
                  type="number"
                  required={field.required}
                  min={field.minimum ?? undefined}
                  max={field.maximum ?? undefined}
                  value={Number(values[field.name] ?? field.minimum ?? 0)}
                  onChange={(event) => onChange(field.name, Number(event.target.value))}
                />
                {field.description ? <small>{field.description}</small> : null}
              </label>
            );
          }
          if (field.kind === "boolean") {
            return (
              <label className={styles.booleanArgument} key={field.name}>
                <input
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(event) => onChange(field.name, event.target.checked)}
                />
                {field.label}
              </label>
            );
          }
          return (
            <label htmlFor={id} key={field.name}>
              {field.label}
              <input
                id={id}
                type="text"
                required={field.required}
                minLength={field.minLength ?? undefined}
                maxLength={field.maxLength ?? undefined}
                pattern={field.pattern ?? undefined}
                value={String(values[field.name] ?? "")}
                onChange={(event) => onChange(field.name, event.target.value)}
              />
              {field.description ? <small>{field.description}</small> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
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
  const { suite } = selection;
  const continuous = selection.mode === "continuous";
  const regressionBatch = !continuous && selection.orderedCases.length > 1;
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
            <p className={styles.kicker}>
              {continuous ? "Review continuous journey" : "Review regression suite"}
            </p>
            <h2 id={titleId}>
              {continuous
                ? `Arm ${selection.orderedCases.length}-step journey`
                : `Arm ${selection.orderedCases.length}-request suite`}
            </h2>
            <p id={descriptionId}>Confirm the run boundary, then arm it.</p>
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

        <dl className={styles.armSummary}>
          <div>
            <dt>Mode</dt>
            <dd>{continuous ? "Continuous journey" : "Regression suite"}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>
              {continuous
                ? "One agent · state carried forward · stop on first issue"
                : "One agent chat · clean state per case · continue after failures"}
            </dd>
          </div>
          <div>
            <dt>Answer key</dt>
            <dd>Withheld until verification</dd>
          </div>
        </dl>

        <section className={styles.armOrder} aria-labelledby={`${titleId}-order`}>
          <h3 id={`${titleId}-order`}>Run order</h3>
          <ol className={styles.armPlan}>
            {selection.orderedCases.map((testCase, index) => (
              <li key={testCase.caseId}>
                <strong>{index + 1}</strong>
                <code>{testCase.expectedTool}</code>
                <span>{testCase.request}</span>
              </li>
            ))}
          </ol>
        </section>

        <ul className={styles.armChecks} aria-label="Arming checks">
          <PreflightStatus label="Clean fixture" state={preflight?.cleanFixture ?? "pending"} />
          <PreflightStatus label="Catalog and build" state={preflight?.catalog ?? "pending"} />
          <PreflightStatus
            label="Answer-key isolation"
            state={preflight?.answerKeyIsolation ?? "pending"}
          />
        </ul>

        <details className={styles.preflight}>
          <summary>Technical identity</summary>
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
            {continuous
              ? "Arm continuous journey"
              : regressionBatch
                ? "Arm regression suite"
                : "Arm live test"}
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
  preflight,
  initialEditCaseId,
  initialRunMode = "regression"
}: ContractSuiteBuilderProps) {
  const strictSuite = useMemo(() => parseThurstoneContractSuite(suite), [suite]);
  const initialEditCase = strictSuite.cases.find(({ caseId }) => caseId === initialEditCaseId);
  const [suiteName, setSuiteName] = useState(strictSuite.name);
  const [editor, setEditor] = useState<EditorState>(() => {
    if (initialEditCase !== undefined) return editorFromCase(initialEditCase);
    const onlyTool =
      strictSuite.catalogSnapshot.tools.length === 1
        ? strictSuite.catalogSnapshot.tools[0]
        : undefined;
    return strictSuite.cases.length === 0 && onlyTool !== undefined
      ? DEMO_STARTER_CASES[onlyTool.name]
      : EMPTY_EDITOR;
  });
  const [editingCaseId, setEditingCaseId] = useState<string | null>(
    initialEditCase?.caseId ?? null
  );
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSelection, setReviewSelection] = useState<ContractSuiteArmSelection>();
  const [runQueue, setRunQueue] = useState<ContractRunQueue | null>(null);
  const [runMode, setRunMode] = useState<ContractRunMode>(initialRunMode);
  const [journeyPlan, setJourneyPlan] = useState<ContinuousJourneyPlanDraft>();
  const [editorVisible, setEditorVisible] = useState(
    initialEditCase !== undefined ||
      strictSuite.cases.length === 0 ||
      strictSuite.catalogSnapshot.tools.some(
        (tool) => !strictSuite.cases.some((testCase) => testCase.expectedTool === tool.name)
      )
  );
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"saving" | "saved">("saved");
  const caseNameRef = useRef<HTMLInputElement>(null);
  const suiteNameId = useId();
  const editorNameId = useId();
  const requestId = useId();

  useEffect(() => {
    queueMicrotask(() => setSuiteName(strictSuite.name));
  }, [strictSuite.name]);

  useEffect(() => {
    if (initialEditCaseId !== undefined) {
      queueMicrotask(() => {
        setDraftReady(true);
        setDraftStatus("saved");
      });
      return;
    }
    let restored: EditorState | undefined;
    try {
      const stored = window.sessionStorage.getItem(
        `${EDITOR_DRAFT_STORAGE_PREFIX}${strictSuite.suiteId}`
      );
      if (stored !== null) restored = editorDraftSchema.parse(JSON.parse(stored) as unknown);
    } catch {
      window.sessionStorage.removeItem(`${EDITOR_DRAFT_STORAGE_PREFIX}${strictSuite.suiteId}`);
    }
    queueMicrotask(() => {
      if (restored !== undefined) setEditor(restored);
      setDraftReady(true);
      setDraftStatus("saved");
    });
  }, [initialEditCaseId, strictSuite.suiteId]);

  useEffect(() => {
    const stored = readContractRunQueue(window.sessionStorage);
    const valid =
      stored !== null &&
      stored.suiteId === strictSuite.suiteId &&
      stored.catalogDigest === strictSuite.catalogDigest &&
      (stored.mode === "continuous" || stored.orderedCaseIds.length === strictSuite.cases.length) &&
      stored.orderedCaseIds.every((caseId) =>
        strictSuite.cases.some((testCase) => testCase.caseId === caseId)
      );
    if (stored !== null && !valid) clearContractRunQueue(window.sessionStorage);
    queueMicrotask(() => {
      setRunQueue(valid ? stored : null);
      if (valid && stored !== null) setRunMode(stored.mode);
    });
  }, [strictSuite]);

  useEffect(() => {
    if (!canRunContinuousJourney(strictSuite)) {
      queueMicrotask(() => setJourneyPlan(undefined));
      return;
    }
    const key = continuousJourneyPlanStorageKey(strictSuite.suiteId);
    let stored: unknown;
    try {
      const encoded = window.sessionStorage.getItem(key);
      if (encoded !== null) stored = JSON.parse(encoded) as unknown;
    } catch {
      window.sessionStorage.removeItem(key);
    }
    if (stored === undefined && runMode !== "continuous") {
      queueMicrotask(() => setJourneyPlan(undefined));
      return;
    }
    const next = reconcileContinuousJourneyPlanDraft(
      strictSuite,
      stored ?? createContinuousJourneyPlanDraft(strictSuite)
    );
    window.sessionStorage.setItem(key, JSON.stringify(next));
    queueMicrotask(() => setJourneyPlan(next));
  }, [runMode, strictSuite]);

  useEffect(() => {
    if (!draftReady || editingCaseId !== null) return;
    const timeout = window.setTimeout(() => {
      window.sessionStorage.setItem(
        `${EDITOR_DRAFT_STORAGE_PREFIX}${strictSuite.suiteId}`,
        JSON.stringify(editorDraftSchema.parse(editor))
      );
      setDraftStatus("saved");
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [draftReady, editingCaseId, editor, strictSuite.suiteId]);

  const remainingRunCaseIds = runQueue === null ? [] : queueRemainingCaseIds(runQueue);
  const journeyValidation =
    journeyPlan === undefined ? undefined : validateContinuousJourneyPlan(strictSuite, journeyPlan);
  const coveredToolNames = new Set(strictSuite.cases.map(({ expectedTool }) => expectedTool));
  const allSelectedToolsCovered = strictSuite.catalogSnapshot.tools.every((tool) =>
    coveredToolNames.has(tool.name)
  );
  const groupedCases = strictSuite.catalogSnapshot.tools
    .map((tool) => ({
      tool,
      cases: strictSuite.cases.filter((testCase) => testCase.expectedTool === tool.name)
    }))
    .filter((group) => group.cases.length > 0);
  const uncoveredTools = strictSuite.catalogSnapshot.tools.filter(
    (tool) => !coveredToolNames.has(tool.name)
  );
  const editorPolicy = editorPolicySummary(editor);

  const closeReview = useCallback(() => {
    setReviewOpen(false);
    setReviewSelection(undefined);
    setRunQueue((current) => {
      if (current === null || current.results.length > 0) return current;
      clearContractRunQueue(window.sessionStorage);
      return null;
    });
  }, []);

  function patchEditor(patch: Partial<EditorState>) {
    setEditor((current) => ({ ...current, ...patch }));
    if (editingCaseId === null) setDraftStatus("saving");
    setError(undefined);
  }

  function addRepresentativeRequest() {
    if (strictSuite.cases.length + editor.requests.length >= THURSTONE_CONTRACT_SUITE_MAX_CASES) {
      setError(
        `This Demo contract supports at most ${THURSTONE_CONTRACT_SUITE_MAX_CASES} request cases.`
      );
      return;
    }
    const argumentsValue =
      editor.requests[0]?.arguments ??
      (editor.expectedTool === "" ? {} : defaultSchemaArgumentValues(editor.expectedTool));
    patchEditor({
      requests: [...editor.requests, { request: "", arguments: { ...argumentsValue } }]
    });
  }

  function updateRequest(index: number, request: string) {
    patchEditor({
      requests: editor.requests.map((current, currentIndex) =>
        currentIndex === index ? { ...current, request } : current
      )
    });
  }

  function updateRequestArgument(index: number, name: string, value: SchemaArgumentValue) {
    patchEditor({
      requests: editor.requests.map((current, currentIndex) =>
        currentIndex === index
          ? { ...current, arguments: { ...current.arguments, [name]: value } }
          : current
      )
    });
  }

  function removeAdditionalRequest(index: number) {
    patchEditor({ requests: editor.requests.filter((_, currentIndex) => currentIndex !== index) });
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
    setDraftStatus("saving");
    if (message !== undefined) setAnnouncement(message);
  }

  function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    try {
      const requests = representativeRequests(editor);
      if (editor.expectedTool === "cart_update") {
        for (const request of requests) {
          assertRequestMatchesDemoItem(request.request, String(request.arguments.itemId ?? ""));
        }
      }
      if (editingCaseId !== null && requests.length !== 1) {
        throw new Error("Edit one representative request at a time.");
      }
      if (
        editingCaseId === null &&
        strictSuite.cases.length + requests.length > THURSTONE_CONTRACT_SUITE_MAX_CASES
      ) {
        throw new Error(
          `This Demo contract supports at most ${THURSTONE_CONTRACT_SUITE_MAX_CASES} request cases.`
        );
      }
      const input = policyForEditor(editor, requests[0]!);
      if (editingCaseId !== null) {
        const next = editContractSuiteCase(strictSuite, editingCaseId, input, {
          updatedAt: nextTimestamp(strictSuite)
        });
        onChange(next);
        const nextCovered = new Set(next.cases.map(({ expectedTool }) => expectedTool));
        setEditorVisible(!next.catalogSnapshot.tools.every((tool) => nextCovered.has(tool.name)));
        clearEditor(`Updated ${input.name}. The case remains in this contract suite.`);
      } else {
        let next = strictSuite;
        let firstAddedCaseId: string | undefined;
        for (const request of requests) {
          const caseId = newThurstoneContractCaseId();
          next = addContractSuiteCase(next, policyForEditor(editor, request), {
            caseId,
            updatedAt: nextTimestamp(next)
          });
          firstAddedCaseId ??= caseId;
        }
        if (strictSuite.cases.length === 0 && firstAddedCaseId !== undefined) {
          next = selectContractSuiteCase(next, firstAddedCaseId, {
            updatedAt: nextTimestamp(next)
          });
        }
        onChange(next);
        const nextCovered = new Set(next.cases.map(({ expectedTool }) => expectedTool));
        const complete = next.catalogSnapshot.tools.every((tool) => nextCovered.has(tool.name));
        setEditorVisible(!complete);
        clearEditor(
          `Added ${requests.length} ${requests.length === 1 ? "request case" : "request cases"} ` +
            `for ${input.name}.`
        );
      }
      queueMicrotask(() => caseNameRef.current?.focus());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function beginEdit(testCase: ThurstoneContractCaseV1) {
    setEditingCaseId(testCase.caseId);
    setEditor(editorFromCase(testCase));
    setEditorVisible(true);
    setError(undefined);
    setAnnouncement(`Editing ${testCase.name}.`);
    queueMicrotask(() => caseNameRef.current?.focus());
  }

  function loadStarter(toolName: ThurstoneDemoSelectableToolName) {
    setEditor({ ...DEMO_STARTER_CASES[toolName] });
    setEditingCaseId(null);
    setDraftStatus("saving");
    setError(undefined);
    setAnnouncement(`Loaded the ${toolName} Demo starter. Review it before adding the case.`);
    setEditorVisible(true);
    queueMicrotask(() => caseNameRef.current?.focus());
  }

  function addRequestsToGroup(toolName: ThurstoneDemoSelectableToolName) {
    const starter = DEMO_STARTER_CASES[toolName];
    const existingName = strictSuite.cases.find(
      (testCase) => testCase.expectedTool === toolName
    )?.name;
    setEditor({
      ...starter,
      name: existingName ?? starter.name,
      requests: [{ ...starter.requests[0]!, request: "" }]
    });
    setEditingCaseId(null);
    setDraftStatus("saving");
    setError(undefined);
    setEditorVisible(true);
    setAnnouncement(`Add more representative requests for ${toolName}.`);
    queueMicrotask(() => caseNameRef.current?.focus());
  }

  function resetDraft() {
    setEditor(
      editor.expectedTool === "" ? EMPTY_EDITOR : { ...DEMO_STARTER_CASES[editor.expectedTool] }
    );
    setEditingCaseId(null);
    setError(undefined);
    setDraftStatus("saving");
    setAnnouncement("The unfinished case was reset to its Demo starter.");
  }

  function removeCase(testCase: ThurstoneContractCaseV1) {
    try {
      const next = removeContractSuiteCase(strictSuite, testCase.caseId, {
        updatedAt: nextTimestamp(strictSuite)
      });
      onChange(next);
      const nextCovered = new Set(next.cases.map(({ expectedTool }) => expectedTool));
      if (next.catalogSnapshot.tools.some((tool) => !nextCovered.has(tool.name))) {
        setEditorVisible(true);
      }
      if (editingCaseId === testCase.caseId) clearEditor();
      setError(undefined);
      setAnnouncement(
        next.cases.length === 0
          ? `Removed ${testCase.name}. This contract suite is now empty.`
          : `Removed ${testCase.name}. ${next.cases.length} request ${next.cases.length === 1 ? "case remains" : "cases remain"}.`
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function openReview() {
    try {
      if (strictSuite.cases.length === 0) throw new Error("Add at least one request case first.");
      if (runMode === "continuous" && journeyValidation?.valid !== true) {
        throw new Error("Fix the continuous journey order before arming it.");
      }
      const queue =
        runQueue ??
        createContractRunQueue(
          strictSuite,
          runMode,
          runMode === "continuous" ? journeyPlan?.orderedCaseIds : undefined
        );
      const remaining = queueRemainingCaseIds(queue);
      const caseId = queue.currentCaseId ?? remaining[0];
      const selectedCase = strictSuite.cases.find((testCase) => testCase.caseId === caseId);
      if (selectedCase === undefined) throw new Error("The next contract request is unavailable.");
      const selectedSuite =
        strictSuite.selectedCaseId === selectedCase.caseId
          ? strictSuite
          : selectContractSuiteCase(strictSuite, selectedCase.caseId, {
              updatedAt: nextTimestamp(strictSuite)
            });
      writeContractRunQueue(window.sessionStorage, queue);
      setRunQueue(queue);
      const orderedCases = queue.orderedCaseIds.map((orderedCaseId) => {
        const testCase = selectedSuite.cases.find(({ caseId }) => caseId === orderedCaseId);
        if (testCase === undefined) throw new Error("The contract run plan is incomplete.");
        return testCase;
      });
      setReviewSelection({ suite: selectedSuite, selectedCase, mode: queue.mode, orderedCases });
      onChange(selectedSuite);
      setReviewOpen(true);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function updateJourneyPlan(next: ContinuousJourneyPlanDraft) {
    const reconciled = reconcileContinuousJourneyPlanDraft(strictSuite, next);
    window.sessionStorage.setItem(
      continuousJourneyPlanStorageKey(strictSuite.suiteId),
      JSON.stringify(reconciled)
    );
    setJourneyPlan(reconciled);
    setError(undefined);
  }

  function confirmArm() {
    if (reviewSelection === undefined) return;
    setReviewOpen(false);
    onReviewArm(reviewSelection);
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
      </header>

      {uncoveredTools.length > 0 ? (
        <section className={styles.starters} aria-labelledby="demo-starter-cases-title">
          <div className={styles.starterHeading}>
            <p className={styles.kicker}>From your Stage 2 catalog</p>
            <h3 id="demo-starter-cases-title">Start with a curated Demo case.</h3>
            <p>
              Choose an uncovered tool to prefill a reviewable draft. Nothing enters your contract
              until you add the test case.
            </p>
          </div>
          <div className={styles.starterGrid}>
            {uncoveredTools.map((tool) => {
              const starter = DEMO_STARTER_CASES[tool.name];
              const active = editingCaseId === null && editor.expectedTool === tool.name;
              return (
                <button
                  className={styles.starterButton}
                  type="button"
                  key={tool.name}
                  aria-pressed={active}
                  disabled={runQueue !== null}
                  onClick={() => loadStarter(tool.name)}
                >
                  <code>{tool.name}</code>
                  <strong>{starter.name}</strong>
                  <small>“{starter.requests[0]?.request}”</small>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

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

      {error !== undefined && !editorVisible ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {!editorVisible && allSelectedToolsCovered && runQueue === null ? (
        <section className={styles.coverageComplete} aria-label="Catalog coverage complete">
          <div>
            <strong>All selected tools are represented in this contract.</strong>
            <p>Use “+ Add requests” inside a contract group to expand its regression coverage.</p>
          </div>
        </section>
      ) : null}

      <div className={styles.workspace}>
        {editorVisible ? (
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
              <div className={styles.editorHeaderActions}>
                {editingCaseId === null ? (
                  <span className={styles.draftStatus} aria-live="polite">
                    {draftStatus === "saving" ? "Saving draft…" : "Draft saved"}
                  </span>
                ) : null}
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => {
                    if (editingCaseId === null) resetDraft();
                    else clearEditor("Edit canceled. The saved contract case was preserved.");
                  }}
                >
                  {editingCaseId === null ? "Reset" : "Cancel edit"}
                </button>
              </div>
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

            <div className={styles.requestsHeading}>
              <strong>Representative user requests</strong>
              {editingCaseId === null ? (
                <button
                  className={styles.addRequestButton}
                  type="button"
                  onClick={addRepresentativeRequest}
                  disabled={
                    strictSuite.cases.length + editor.requests.length >=
                    THURSTONE_CONTRACT_SUITE_MAX_CASES
                  }
                >
                  + Add request
                </button>
              ) : null}
            </div>
            {editor.requests.map((variant, index) => {
              const variantId = index === 0 ? requestId : `${requestId}-${index + 1}`;
              return (
                <div className={styles.requestVariant} key={variantId}>
                  <label htmlFor={variantId}>Request {index + 1}</label>
                  <div>
                    <textarea
                      id={variantId}
                      value={variant.request}
                      maxLength={280}
                      required
                      rows={2}
                      placeholder={
                        index === 0
                          ? "I am ready—request checkout for this cart."
                          : "Add another way a user might express the same intended action."
                      }
                      onChange={(event) => updateRequest(index, event.target.value)}
                    />
                    {editingCaseId === null && index > 0 ? (
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => removeAdditionalRequest(index)}
                      >
                        − Remove
                      </button>
                    ) : null}
                  </div>
                  {editor.expectedTool !== "" ? (
                    <SchemaArgumentEditor
                      toolName={editor.expectedTool}
                      requestIndex={index}
                      values={variant.arguments}
                      onChange={(name, value) => updateRequestArgument(index, name, value)}
                    />
                  ) : null}
                </div>
              );
            })}
            <small className={styles.fieldHelp}>
              Add at least one representative request. Every request must express the same intended
              action and becomes an independent case and result.
            </small>

            {editorPolicy !== null && editor.expectedTool !== "" ? (
              <dl
                className={styles.policyPreview}
                aria-label="Contract rules derived from this tool"
              >
                <div>
                  <dt>Expected agent action</dt>
                  <dd>
                    Call <code>{editor.expectedTool}</code>
                  </dd>
                </div>
                <div>
                  <dt>Expected arguments</dt>
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
            </div>
          </form>
        ) : null}

        <section className={styles.visualizer} aria-labelledby="contract-suite-cases-title">
          <div className={styles.visualizerHeading}>
            <div>
              <p className={styles.kicker}>Your contract</p>
              <h3 id="contract-suite-cases-title">Visible regression suite</h3>
            </div>
          </div>

          {strictSuite.cases.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No test cases yet.</strong>
              <p>
                Add a representative request and its expected real tool. The case will appear here.
              </p>
            </div>
          ) : (
            <ol className={styles.caseGroups}>
              {groupedCases.map((group) => (
                <li key={group.tool.name}>
                  <section
                    className={styles.caseGroup}
                    aria-label={`${group.tool.name} test group`}
                  >
                    <header className={styles.caseGroupHeading}>
                      <div>
                        <code>{group.tool.name}</code>
                        <strong>{group.tool.title}</strong>
                      </div>
                      <span>
                        {group.cases.length} request {group.cases.length === 1 ? "case" : "cases"}
                      </span>
                      {runQueue === null ? (
                        <button
                          className={styles.textButton}
                          type="button"
                          onClick={() => addRequestsToGroup(group.tool.name)}
                        >
                          + Add requests
                        </button>
                      ) : null}
                    </header>
                    <ol className={styles.caseList}>
                      {group.cases.map((testCase) => {
                        const terminal = runQueue?.results.find(
                          ({ caseId }) => caseId === testCase.caseId
                        );
                        const queued = runQueue?.orderedCaseIds.includes(testCase.caseId) ?? false;
                        const index = strictSuite.cases.findIndex(
                          ({ caseId }) => caseId === testCase.caseId
                        );
                        return (
                          <li key={testCase.caseId}>
                            <article className={styles.caseCard} data-selected={false}>
                              <header>
                                <span className={styles.ordinal}>{index + 1}</span>
                                <div>
                                  <h4>{testCase.name}</h4>
                                  <p>“{testCase.request}”</p>
                                </div>
                                {terminal ? (
                                  <strong
                                    className={styles.selectedBadge}
                                    data-verdict={terminal.verdict}
                                  >
                                    {terminal.verdict}
                                  </strong>
                                ) : queued ? (
                                  <strong className={styles.queuedBadge}>Queued</strong>
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
                                <button
                                  type="button"
                                  disabled={runQueue !== null}
                                  onClick={() => beginEdit(testCase)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={runQueue !== null}
                                  onClick={() => removeCase(testCase)}
                                >
                                  Remove
                                </button>
                              </div>
                            </article>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                </li>
              ))}
            </ol>
          )}

          {runQueue === null ? (
            <fieldset className={styles.runMode}>
              <legend>Choose how to run this contract</legend>
              <label data-selected={runMode === "regression"}>
                <input
                  type="radio"
                  name="contract-run-mode"
                  value="regression"
                  checked={runMode === "regression"}
                  onChange={() => setRunMode("regression")}
                />
                <span>
                  <strong>Regression suite</strong>
                  Run every request in one fresh agent chat with a clean fixture for each case.
                  <small>
                    Every case runs even if another fails, because failures cannot contaminate later
                    site state. The agent conversation is shared across the batch.
                  </small>
                </span>
              </label>
              <label
                data-selected={runMode === "continuous"}
                data-disabled={!canRunContinuousJourney(strictSuite)}
              >
                <input
                  type="radio"
                  name="contract-run-mode"
                  value="continuous"
                  checked={runMode === "continuous"}
                  disabled={!canRunContinuousJourney(strictSuite)}
                  onChange={() => setRunMode("continuous")}
                />
                <span>
                  <strong>Continuous journey</strong>
                  Run two or more requests in the same agent context with verified state carried
                  forward.
                  <small>
                    Stops at the first issue because an incorrect state would make later verdicts
                    unreliable. Earlier passes remain preserved.
                  </small>
                  {!canRunContinuousJourney(strictSuite) ? (
                    <small>Add at least two contract requests to unlock.</small>
                  ) : null}
                </span>
              </label>
            </fieldset>
          ) : null}

          {runQueue === null && runMode === "continuous" && journeyPlan !== undefined ? (
            <ContinuousJourneyOrganizer
              suite={strictSuite}
              plan={journeyPlan}
              onChange={updateJourneyPlan}
            />
          ) : null}

          <aside className={styles.executionBoundary}>
            <strong>
              {runQueue?.mode === "continuous" || (runQueue === null && runMode === "continuous")
                ? `One journey. ${journeyPlan?.orderedCaseIds.length ?? 0} ordered checks.`
                : "Every request in this contract will be tested."}
            </strong>
            <p>
              {runQueue?.mode === "continuous" || (runQueue === null && runMode === "continuous")
                ? "Thurstone keeps one agent context and one synthetic checkout state. It stops at the first issue so later checks are never scored against unreliable state."
                : "Thurstone uses one agent chat, resets the site fixture before every request, preserves every result, and continues after individual failures."}
            </p>
          </aside>
          {runQueue !== null && remainingRunCaseIds.length === 0 ? (
            <div className={styles.runComplete}>
              <strong>Contract run complete</strong>
              <span>
                {runQueue.results.length} independent request{" "}
                {runQueue.results.length === 1 ? "result" : "results"} preserved.
              </span>
            </div>
          ) : (
            <button
              className={styles.armButton}
              type="button"
              onClick={openReview}
              disabled={
                strictSuite.cases.length === 0 ||
                (runMode === "continuous" && journeyValidation?.valid !== true)
              }
            >
              {runQueue === null
                ? runMode === "continuous"
                  ? `Run continuous journey · ${journeyPlan?.orderedCaseIds.length ?? 0} steps`
                  : `Run contract · ${strictSuite.cases.length} requests`
                : `Continue contract · ${remainingRunCaseIds.length} ${remainingRunCaseIds.length === 1 ? "request" : "requests"} remaining`}
            </button>
          )}
        </section>
      </div>

      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {reviewOpen && reviewSelection !== undefined ? (
        <ReviewArmDialog
          selection={reviewSelection}
          preflight={preflight}
          onCancel={closeReview}
          onConfirm={confirmArm}
        />
      ) : null}
    </section>
  );
}
