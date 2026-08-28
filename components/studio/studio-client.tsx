"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import {
  createStudioMetaTools,
  STUDIO_REVIEW_NOTE_MAX_LENGTH,
  type LastVerifiedTargetSnapshot,
  type StudioAuthoringPhase,
  type StudioCaseDraftUpdate,
  type StudioContractDraftPatch,
  type StudioDraftInput,
  type StudioDraftReceipt,
  type StudioReviewReceipt
} from "@/lib/studio/meta-tools";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

export interface StudioFamilySummary {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly development: number;
  readonly holdout: number;
  readonly relationship: string;
}

export interface StudioCaseReviewProjection {
  readonly opaqueId: string;
  readonly ordinal: number;
  readonly subset: "development" | "builder-blinded-holdout";
  readonly family: string;
  readonly relationshipId: string | null;
  readonly prompt: string;
  readonly meaningIdentity: string;
  readonly meaningSpec: string;
  readonly expectedDecision: string;
  readonly argumentPredicate: string;
  readonly allowedEffects: readonly string[];
  readonly forbiddenEffects: readonly string[];
  readonly approvalClass: string;
  readonly fixtureId: string;
}

export interface StudioReviewPackageView {
  readonly version: string;
  readonly status: "preparing" | "candidate-ready" | "awaiting-human" | "frozen";
  readonly packageHash: string | null;
  readonly frozenProtocolHash: string | null;
  readonly humanReviewReceiptId: string | null;
  readonly reviewedAt: string | null;
  readonly exactPackageReady: boolean;
  readonly totalCases: number;
  readonly developmentCases: number;
  readonly holdoutCases: number;
  readonly repetitionCount: 1;
  readonly families: readonly StudioFamilySummary[];
  readonly cases: readonly StudioCaseReviewProjection[];
  /** Exact canonical server-produced bytes. Never reconstructed from the rendered projection. */
  readonly canonicalJson: string | null;
  readonly successorLineage: {
    readonly disposition: "superseded-protocol";
    readonly predecessorRunId: string;
    readonly predecessorEvidenceDigest: string;
    readonly priorRepairReceiptHash: string;
    readonly baselinePhaseCallOffset: 24;
    readonly repairPhaseCallOffset: 1;
    readonly revisedPhaseCallOffset: 0;
    readonly originalAuthoringContextRemainsTerminated: true;
    readonly lineageHash: string;
  } | null;
  readonly readinessIssues: readonly string[];
  readonly contractDraft: {
    readonly title: string;
    readonly meaningPrinciple: string;
    readonly clarificationPolicy: string;
    readonly effectPolicy: string;
  };
}

export interface StudioClientProps {
  readonly target: LastVerifiedTargetSnapshot;
  readonly reviewPackage: StudioReviewPackageView;
}

interface StudioSessionState {
  readonly phase: StudioAuthoringPhase;
  readonly reviewNote: string;
  readonly requestedFocus: NonNullable<StudioDraftInput["requestedFocus"]> | "";
  readonly contractPatch: StudioContractDraftPatch;
  readonly caseUpdates: Readonly<Record<string, StudioCaseDraftUpdate>>;
  readonly presented: boolean;
  readonly activity: string;
}

type StudioSessionAction =
  | { readonly type: "inspect" }
  | { readonly type: "edit-note"; readonly note: string }
  | { readonly type: "set-focus"; readonly focus: StudioSessionState["requestedFocus"] }
  | {
      readonly type: "edit-contract";
      readonly field: keyof StudioContractDraftPatch;
      readonly value: string;
    }
  | {
      readonly type: "edit-case";
      readonly caseId: string;
      readonly field: keyof Omit<StudioCaseDraftUpdate, "caseId">;
      readonly value: string | readonly string[];
    }
  | { readonly type: "draft"; readonly input: StudioDraftInput }
  | { readonly type: "present" }
  | { readonly type: "return-to-draft" };

const INITIAL_REGISTRY_STATUS: RegistryStatus = { phase: "idle", toolNames: [] };

function sessionReducer(
  state: StudioSessionState,
  action: StudioSessionAction
): StudioSessionState {
  switch (action.type) {
    case "inspect":
      return {
        ...state,
        phase: state.phase === "inspect" ? "draft" : state.phase,
        activity: "Last verified target snapshot inspected. Drafting is available."
      };
    case "edit-note":
      return { ...state, reviewNote: action.note, presented: false };
    case "set-focus":
      return { ...state, requestedFocus: action.focus, presented: false };
    case "edit-contract":
      return {
        ...state,
        contractPatch: { ...state.contractPatch, [action.field]: action.value },
        presented: false
      };
    case "edit-case": {
      const current = state.caseUpdates[action.caseId] ?? { caseId: action.caseId };
      return {
        ...state,
        caseUpdates: {
          ...state.caseUpdates,
          [action.caseId]: { ...current, [action.field]: action.value }
        },
        presented: false
      };
    }
    case "draft":
      return {
        phase: "review",
        reviewNote: action.input.reviewNote ?? state.reviewNote,
        requestedFocus: action.input.requestedFocus ?? "",
        contractPatch: { ...state.contractPatch, ...action.input.contractPatch },
        caseUpdates: {
          ...state.caseUpdates,
          ...Object.fromEntries(
            (action.input.caseUpdates ?? []).map((update) => [
              update.caseId,
              { ...state.caseUpdates[update.caseId], ...update }
            ])
          )
        },
        presented: false,
        activity:
          "Structured candidate changes saved in this browser session. Human review is still required."
      };
    case "present":
      return {
        ...state,
        phase: "review",
        presented: true,
        activity: "Candidate presented for human review. No approval or freeze was recorded."
      };
    case "return-to-draft":
      return {
        ...state,
        phase: "draft",
        presented: false,
        activity: "Candidate returned to the session-local drafting phase."
      };
  }
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function shortDigest(value: string | null, visible = 16): string {
  if (!value) return "pending";
  return value.length <= visible ? value : `${value.slice(0, visible)}…`;
}

function phaseLabel(phase: StudioAuthoringPhase): string {
  if (phase === "inspect") return "Inspect";
  if (phase === "draft") return "Draft";
  return "Review";
}

export function studioAuthoringIsLocked(
  reviewPackage: Pick<StudioReviewPackageView, "status" | "successorLineage">
): boolean {
  return reviewPackage.status === "frozen" || reviewPackage.successorLineage !== null;
}

export function StudioClient({ target, reviewPackage }: StudioClientProps) {
  const packageFrozen = reviewPackage.status === "frozen";
  const authoringLocked = studioAuthoringIsLocked(reviewPackage);
  const [session, dispatch] = useReducer(sessionReducer, {
    phase: "inspect",
    reviewNote: "",
    requestedFocus: "",
    contractPatch: {},
    caseUpdates: {},
    presented: false,
    activity: "Inspect the last verified target snapshot to begin."
  });
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>(INITIAL_REGISTRY_STATUS);
  const [providerChecked, setProviderChecked] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState(reviewPackage.cases[0]?.opaqueId ?? "");
  const reviewAlertRef = useRef<HTMLDivElement>(null);

  const inspect = useCallback(() => {
    dispatch({ type: "inspect" });
    return target;
  }, [target]);

  const knownCaseIds = useMemo(
    () => new Set(reviewPackage.cases.map(({ opaqueId }) => opaqueId)),
    [reviewPackage.cases]
  );

  const saveDraft = useCallback(
    (input: StudioDraftInput): StudioDraftReceipt => {
      if (authoringLocked) throw new Error("studio_authoring_context_terminated");
      const unknownCaseIds = (input.caseUpdates ?? [])
        .map(({ caseId }) => caseId)
        .filter((caseId) => !knownCaseIds.has(caseId));
      if (unknownCaseIds.length > 0) {
        throw new RangeError(`Unknown review caseId: ${unknownCaseIds.join(", ")}.`);
      }
      dispatch({ type: "draft", input });
      return Object.freeze({
        ok: true,
        status: "candidate-note-saved",
        sessionLocal: true,
        phase: "review",
        humanApproval: "required",
        noteLength: input.reviewNote?.length ?? 0,
        requestedFocus: input.requestedFocus ?? null,
        contractFieldsUpdated: Object.freeze(Object.keys(input.contractPatch ?? {})),
        caseIdsUpdated: Object.freeze((input.caseUpdates ?? []).map(({ caseId }) => caseId))
      });
    },
    [authoringLocked, knownCaseIds]
  );

  const submitReview = useCallback((): StudioReviewReceipt => {
    if (authoringLocked) throw new Error("studio_authoring_context_terminated");
    dispatch({ type: "present" });
    return Object.freeze({
      ok: true,
      status: "presented-to-human",
      sessionLocal: true,
      phase: "review",
      humanApproval: "required",
      canApprove: false,
      canFreeze: false
    });
  }, [authoringLocked]);

  const metaTools = useMemo(
    () => createStudioMetaTools({ inspect, draft: saveDraft, submitReview }),
    [inspect, saveDraft, submitReview]
  );
  const desiredTools = useMemo(
    () => (authoringLocked ? [] : metaTools.forPhase(session.phase)),
    [authoringLocked, metaTools, session.phase]
  );
  const desiredNames = useMemo(() => desiredTools.map(({ name }) => name), [desiredTools]);

  useEffect(() => {
    const context = document.modelContext;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setProviderAvailable(Boolean(context && typeof context.registerTool === "function"));
      setProviderChecked(true);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, desiredTools, setRegistryStatus);
  }, [desiredTools]);

  useEffect(() => {
    if (session.presented) reviewAlertRef.current?.focus();
  }, [session.presented]);

  const registryReady =
    registryStatus.phase === "ready" && sameNames(registryStatus.toolNames, desiredNames);
  const packageReady = reviewPackage.exactPackageReady && reviewPackage.canonicalJson !== null;
  const noteIsValid = session.reviewNote.trim().length <= STUDIO_REVIEW_NOTE_MAX_LENGTH;
  const hasStructuredDraft =
    Object.keys(session.contractPatch).length > 0 || Object.keys(session.caseUpdates).length > 0;
  const draftIsValid = noteIsValid && hasStructuredDraft;

  const projectedContract = {
    ...reviewPackage.contractDraft,
    ...session.contractPatch
  };
  const projectedCases = reviewPackage.cases.map((item) => {
    const update = session.caseUpdates[item.opaqueId];
    if (!update) return item;
    return {
      ...item,
      ...update,
      opaqueId: item.opaqueId,
      expectedDecision:
        update.expectedDecision ??
        (update.expectedTool ? `Call ${update.expectedTool}` : item.expectedDecision)
    };
  });
  const selectedCase = projectedCases.find(({ opaqueId }) => opaqueId === selectedCaseId);

  const beginDraft = () => {
    inspect();
  };

  const handleSaveDraft = () => {
    if (!draftIsValid) return;
    saveDraft({
      ...(session.reviewNote.trim() === "" ? {} : { reviewNote: session.reviewNote.trim() }),
      ...(session.requestedFocus === "" ? {} : { requestedFocus: session.requestedFocus }),
      ...(Object.keys(session.contractPatch).length === 0
        ? {}
        : { contractPatch: session.contractPatch }),
      ...(Object.keys(session.caseUpdates).length === 0
        ? {}
        : { caseUpdates: Object.values(session.caseUpdates) })
    });
  };

  const copyReviewPackage = async () => {
    if (!reviewPackage.canonicalJson) return;
    try {
      await navigator.clipboard.writeText(reviewPackage.canonicalJson);
      setExportStatus("Exact canonical review package copied.");
    } catch {
      setExportStatus("Copy was blocked by this browser. Use Download exact review package.");
    }
  };

  const downloadReviewPackage = () => {
    if (!reviewPackage.canonicalJson) return;
    const blob = new Blob([reviewPackage.canonicalJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `toolproof-gate3-review-${(reviewPackage.packageHash ?? "candidate").slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExportStatus("Exact canonical review package downloaded.");
  };

  return (
    <div className="page-shell route-page studio-workbench">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Studio · authoring trust surface</p>
          <h1>Freeze meaning before measuring behavior.</h1>
          <p>
            {authoringLocked
              ? "The original Authoring Builder is permanently terminated. This document is read-only for Sergio’s exact review."
              : "The Authoring Builder may inspect and draft. Sergio remains the semantic authority for every identity, boundary, argument, effect, fixture, and revision."}
          </p>
        </div>
        <StatusPill state={packageFrozen ? "ready" : packageReady ? "pending" : "blocked"}>
          {packageFrozen
            ? "Human-approved protocol frozen"
            : packageReady
              ? "Exact package awaits human review"
              : "Exact package in preparation"}
        </StatusPill>
      </header>

      <section className="panel studio-boundary" aria-labelledby="studio-boundary-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Trust boundary</span>
            <h2 id="studio-boundary-heading">Last verified target—not a live Lab claim</h2>
          </div>
          <span className="fixture-id">commit {target.sourceCommit.slice(0, 12)}</span>
        </div>
        <p>
          This sanitized receipt comes from authentic Gate 2 evidence at the exact source commit.
          Studio is a separate top-level document and does not claim the Lab registry is live now.
          Every scored trial will independently verify its live Lab catalog before execution.
        </p>
        <dl className="studio-fingerprint">
          <div>
            <dt>Manifest</dt>
            <dd>{shortDigest(target.manifestHash, 24)}</dd>
          </div>
          <div>
            <dt>Catalog</dt>
            <dd>
              {target.catalogState} · generation {target.registrationGeneration}
            </dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>{target.verifiedAt}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{shortDigest(target.sourceEvidenceDigest, 24)}</dd>
          </div>
        </dl>
      </section>

      <div className="studio-grid studio-main-grid">
        <section className="panel" aria-labelledby="target-manifest-heading">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Versioned target manifest</span>
              <h2 id="target-manifest-heading">Initial-state WebMCP catalog</h2>
            </div>
            <span className="fixture-id">{target.toolsetVersion}</span>
          </div>
          <ul className="studio-tool-list">
            {target.manifest.map((tool) => (
              <li key={tool.name}>
                <div>
                  <code>{tool.name}</code>
                  <span>{tool.annotations.readOnlyHint ? "read-only" : "mutating"}</span>
                </div>
                <strong>{tool.title}</strong>
                <p>{tool.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="allocation-heading">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Frozen-shape requirement</span>
              <h2 id="allocation-heading">Six families · balanced 12 / 12</h2>
            </div>
            <span className="fixture-id">{reviewPackage.totalCases} cases</span>
          </div>
          <div className="studio-allocation" aria-label="Suite allocation">
            <div>
              <strong>{reviewPackage.developmentCases}</strong>
              <span>Development</span>
            </div>
            <div>
              <strong>{reviewPackage.holdoutCases}</strong>
              <span>Builder-blinded holdout</span>
            </div>
            <div>
              <strong>{reviewPackage.repetitionCount}</strong>
              <span>Trial per case and version</span>
            </div>
          </div>
          <ul className="studio-family-list">
            {reviewPackage.families.map((family) => (
              <li key={family.id}>
                <div>
                  <strong>{family.label}</strong>
                  <small>{family.relationship}</small>
                </div>
                <span>
                  {family.total} · {family.development}/{family.holdout}
                </span>
              </li>
            ))}
          </ul>
          <p className="studio-disclosure">
            P0 is a disclosed one-trial-per-case demonstration snapshot. Every matched boundary pair
            remains wholly inside one subset, and the same repetition count applies to v1 and v2.
          </p>
        </section>
      </div>

      <section className="panel studio-v1" aria-labelledby="v1-description-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">One-variable baseline</span>
            <h2 id="v1-description-heading">Exact v1 checkout_request description</h2>
          </div>
          <span className="fixture-id">human review required</span>
        </div>
        <blockquote>
          {target.manifest.find(({ name }) => name === "checkout_request")?.description ??
            "Description unavailable in the last verified manifest."}
        </blockquote>
        <p>
          This plausible developer wording is held fixed for the complete baseline. After baseline,
          only this description may change, once, through a separately approved revision.
        </p>
      </section>

      <section className="panel studio-authoring" aria-labelledby="authoring-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Phase-specific Site Tools</span>
            <h2 id="authoring-heading">
              {authoringLocked
                ? "Authoring context permanently terminated"
                : "Authoring handoff · " + phaseLabel(session.phase)}
            </h2>
          </div>
          <StatusPill
            state={
              authoringLocked
                ? "neutral"
                : registryReady
                  ? "ready"
                  : providerAvailable
                    ? "pending"
                    : "neutral"
            }
          >
            {authoringLocked
              ? "No authoring tools exposed"
              : !providerChecked
                ? "Checking Site Tools"
                : !providerAvailable
                  ? "Site Tools unavailable"
                  : registryReady
                    ? `Registry ready · generation ${registryStatus.generation ?? 0}`
                    : registryStatus.phase === "error"
                      ? "Registry error"
                      : "Registry transitioning"}
          </StatusPill>
        </div>

        {authoringLocked ? (
          <div className="studio-review-alert" role="status">
            <strong>Read-only semantic review.</strong>
            <span>
              No inspect, draft, or submit-review Site Tool is registered. The original Authoring
              Builder was not reauthorized, no successor reauthoring is permitted, and a frozen
              package cannot be edited.
            </span>
          </div>
        ) : (
          <>
            <ol className="studio-phase-track">
              {(["inspect", "draft", "review"] as const).map((phase, index) => (
                <li key={phase} data-active={session.phase === phase}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{phaseLabel(phase)}</strong>
                    <small>
                      {phase === "inspect"
                        ? "Historical verified target snapshot"
                        : phase === "draft"
                          ? "Session-local contract and case patch"
                          : "Present to Sergio; never self-approve"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>

            <p className="studio-registry-names">
              Exposed now: <code>{desiredNames.join(", ")}</code>
            </p>
            {registryStatus.phase === "error" ? (
              <p className="studio-error" role="alert">
                {registryStatus.error}
              </p>
            ) : null}

            {session.phase === "inspect" ? (
              <div className="studio-action-block">
                <p>
                  Inspection returns the exact historical snapshot above and opens the drafting
                  phase. It performs no model call and reads no active Lab document.
                </p>
                <button className="button button-primary" type="button" onClick={beginDraft}>
                  Inspect snapshot and open drafting
                </button>
              </div>
            ) : (
              <div className="studio-draft-form">
                <fieldset>
                  <legend>Contract text draft</legend>
                  <label htmlFor="studio-contract-title">
                    Contract title
                    <input
                      id="studio-contract-title"
                      value={projectedContract.title}
                      maxLength={160}
                      onChange={(event) =>
                        dispatch({
                          type: "edit-contract",
                          field: "title",
                          value: event.currentTarget.value
                        })
                      }
                    />
                  </label>
                  <label htmlFor="studio-meaning-principle">
                    Meaning held fixed
                    <textarea
                      id="studio-meaning-principle"
                      value={projectedContract.meaningPrinciple}
                      rows={3}
                      onChange={(event) =>
                        dispatch({
                          type: "edit-contract",
                          field: "meaningPrinciple",
                          value: event.currentTarget.value
                        })
                      }
                    />
                  </label>
                  <div className="studio-two-fields">
                    <label htmlFor="studio-clarification-policy">
                      Clarification policy
                      <textarea
                        id="studio-clarification-policy"
                        value={projectedContract.clarificationPolicy}
                        rows={3}
                        onChange={(event) =>
                          dispatch({
                            type: "edit-contract",
                            field: "clarificationPolicy",
                            value: event.currentTarget.value
                          })
                        }
                      />
                    </label>
                    <label htmlFor="studio-effect-policy">
                      Observable effect policy
                      <textarea
                        id="studio-effect-policy"
                        value={projectedContract.effectPolicy}
                        rows={3}
                        onChange={(event) =>
                          dispatch({
                            type: "edit-contract",
                            field: "effectPolicy",
                            value: event.currentTarget.value
                          })
                        }
                      />
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <legend>Candidate case draft</legend>
                  {projectedCases.length > 0 ? (
                    <>
                      <label htmlFor="studio-case-selector">
                        Human review case ID
                        <select
                          id="studio-case-selector"
                          value={selectedCaseId}
                          onChange={(event) => setSelectedCaseId(event.currentTarget.value)}
                        >
                          {projectedCases.map((item) => (
                            <option value={item.opaqueId} key={item.opaqueId}>
                              {item.ordinal}. {item.opaqueId} · {item.family}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedCase ? (
                        <>
                          <label htmlFor="studio-case-prompt">
                            Exact request
                            <textarea
                              id="studio-case-prompt"
                              value={selectedCase.prompt}
                              rows={3}
                              onChange={(event) =>
                                dispatch({
                                  type: "edit-case",
                                  caseId: selectedCase.opaqueId,
                                  field: "prompt",
                                  value: event.currentTarget.value
                                })
                              }
                            />
                          </label>
                          <label htmlFor="studio-case-meaning">
                            Meaning specification
                            <textarea
                              id="studio-case-meaning"
                              value={selectedCase.meaningSpec}
                              rows={3}
                              onChange={(event) =>
                                dispatch({
                                  type: "edit-case",
                                  caseId: selectedCase.opaqueId,
                                  field: "meaningSpec",
                                  value: event.currentTarget.value
                                })
                              }
                            />
                          </label>
                          <div className="studio-two-fields">
                            <label htmlFor="studio-case-decision">
                              Expected outcome
                              <textarea
                                id="studio-case-decision"
                                value={selectedCase.expectedDecision}
                                rows={3}
                                onChange={(event) =>
                                  dispatch({
                                    type: "edit-case",
                                    caseId: selectedCase.opaqueId,
                                    field: "expectedDecision",
                                    value: event.currentTarget.value
                                  })
                                }
                              />
                            </label>
                            <label htmlFor="studio-case-arguments">
                              Argument predicate
                              <textarea
                                id="studio-case-arguments"
                                value={selectedCase.argumentPredicate}
                                rows={3}
                                onChange={(event) =>
                                  dispatch({
                                    type: "edit-case",
                                    caseId: selectedCase.opaqueId,
                                    field: "argumentPredicate",
                                    value: event.currentTarget.value
                                  })
                                }
                              />
                            </label>
                          </div>
                          <div className="studio-two-fields">
                            <label htmlFor="studio-case-allowed-effects">
                              Allowed effects · one per line
                              <textarea
                                id="studio-case-allowed-effects"
                                value={selectedCase.allowedEffects.join("\n")}
                                rows={3}
                                onChange={(event) =>
                                  dispatch({
                                    type: "edit-case",
                                    caseId: selectedCase.opaqueId,
                                    field: "allowedEffects",
                                    value: event.currentTarget.value
                                      .split("\n")
                                      .map((value) => value.trim())
                                      .filter(Boolean)
                                  })
                                }
                              />
                            </label>
                            <label htmlFor="studio-case-forbidden-effects">
                              Forbidden effects · one per line
                              <textarea
                                id="studio-case-forbidden-effects"
                                value={selectedCase.forbiddenEffects.join("\n")}
                                rows={3}
                                onChange={(event) =>
                                  dispatch({
                                    type: "edit-case",
                                    caseId: selectedCase.opaqueId,
                                    field: "forbiddenEffects",
                                    value: event.currentTarget.value
                                      .split("\n")
                                      .map((value) => value.trim())
                                      .filter(Boolean)
                                  })
                                }
                              />
                            </label>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p>
                      Structured case editing opens when the exact server-owned candidate rows are
                      present. No invented placeholder case may be patched.
                    </p>
                  )}
                </fieldset>

                <label htmlFor="studio-review-note">
                  Session-local review note (optional when structured fields changed)
                  <textarea
                    id="studio-review-note"
                    value={session.reviewNote}
                    maxLength={STUDIO_REVIEW_NOTE_MAX_LENGTH}
                    rows={5}
                    onChange={(event) =>
                      dispatch({ type: "edit-note", note: event.currentTarget.value })
                    }
                    placeholder="Flag an identity, boundary, argument, effect, fixture, or allocation item for Sergio."
                  />
                </label>
                <label htmlFor="studio-review-focus">
                  Review focus
                  <select
                    id="studio-review-focus"
                    value={session.requestedFocus}
                    onChange={(event) =>
                      dispatch({
                        type: "set-focus",
                        focus: event.currentTarget.value as StudioSessionState["requestedFocus"]
                      })
                    }
                  >
                    <option value="">General</option>
                    <option value="meaning">Meaning identities</option>
                    <option value="boundaries">Boundary pairs</option>
                    <option value="arguments">Argument predicates</option>
                    <option value="effects">Effect rules</option>
                    <option value="allocation">Allocation and pairing</option>
                  </select>
                </label>
                <div className="button-row">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={!draftIsValid}
                    onClick={handleSaveDraft}
                  >
                    Save structured draft for human review
                  </button>
                  {session.phase === "review" ? (
                    <>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={submitReview}
                      >
                        Present draft to human UI
                      </button>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => dispatch({ type: "return-to-draft" })}
                      >
                        Return to drafting
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            <p className="studio-activity" aria-live="polite">
              {session.activity}
            </p>
            {session.presented ? (
              <div className="studio-review-alert" ref={reviewAlertRef} role="status" tabIndex={-1}>
                <strong>Presented—not approved.</strong>
                <span>
                  The Authoring Builder handoff is visible to Sergio. No semantic decision, review
                  receipt, provider call, or freeze occurred.
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="panel studio-review-package" aria-labelledby="review-package-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Exact review artifact</span>
            <h2 id="review-package-heading">Human semantic-review gate</h2>
          </div>
          <span className="fixture-id">
            {reviewPackage.packageHash ? shortDigest(reviewPackage.packageHash) : "hash pending"}
          </span>
        </div>
        <p>
          Status: <strong>{reviewPackage.status}</strong>. The package must bind all 24 exact case
          texts, expectations, fixtures, pairings, ordering, runner/evaluator rules, and hashes
          before approval can open.
        </p>
        {reviewPackage.successorLineage ? (
          <div className="runtime-receipt" aria-label="Successor protocol evidence lineage">
            <span>Declared predecessor · durable execution preflight required</span>
            <strong>{reviewPackage.successorLineage.disposition}</strong>
            <small>
              Prior baseline {reviewPackage.successorLineage.predecessorRunId} · offsets baseline{" "}
              {reviewPackage.successorLineage.baselinePhaseCallOffset}, Repair{" "}
              {reviewPackage.successorLineage.repairPhaseCallOffset}, revised{" "}
              {reviewPackage.successorLineage.revisedPhaseCallOffset} · original Authoring Builder
              remains terminated · lineage {reviewPackage.successorLineage.lineageHash}
            </small>
          </div>
        ) : null}
        {packageFrozen ? (
          <div className="runtime-receipt" aria-label="Frozen Gate 3 human review receipt">
            <span>Human semantic authority · Sergio Valencia</span>
            <strong>{reviewPackage.humanReviewReceiptId}</strong>
            <small>
              Reviewed {reviewPackage.reviewedAt} · frozen protocol{" "}
              {reviewPackage.frozenProtocolHash}
            </small>
          </div>
        ) : null}

        {projectedCases.length > 0 ? (
          <ol className="studio-case-list">
            {projectedCases.map((item) => (
              <li key={item.opaqueId}>
                <details>
                  <summary>
                    <span>Case {item.ordinal}</span>
                    <strong>{item.family}</strong>
                    <small>{item.subset}</small>
                  </summary>
                  {session.caseUpdates[item.opaqueId] ? (
                    <p className="studio-session-marker">Session-local draft override</p>
                  ) : null}
                  <dl>
                    <div>
                      <dt>Request</dt>
                      <dd>{item.prompt}</dd>
                    </div>
                    <div>
                      <dt>Meaning</dt>
                      <dd>
                        {item.meaningIdentity} · {item.meaningSpec}
                      </dd>
                    </div>
                    <div>
                      <dt>Expected decision</dt>
                      <dd>{item.expectedDecision}</dd>
                    </div>
                    <div>
                      <dt>Arguments</dt>
                      <dd>{item.argumentPredicate}</dd>
                    </div>
                    <div>
                      <dt>Allowed effects</dt>
                      <dd>{item.allowedEffects.join(", ") || "none"}</dd>
                    </div>
                    <div>
                      <dt>Forbidden effects</dt>
                      <dd>{item.forbiddenEffects.join(", ") || "none"}</dd>
                    </div>
                    <div>
                      <dt>Approval</dt>
                      <dd>{item.approvalClass}</dd>
                    </div>
                    <div>
                      <dt>Fixture</dt>
                      <dd>{item.fixtureId}</dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <div className="studio-package-pending" role="status">
            Exact case rows are not loaded into this candidate yet. No placeholder prompt or
            expected answer is presented as review truth.
          </div>
        )}

        {reviewPackage.readinessIssues.length > 0 ? (
          <ul className="studio-readiness-issues" aria-label="Review package blockers">
            {reviewPackage.readinessIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}

        <div className="button-row studio-review-controls">
          <button
            className="button button-secondary"
            type="button"
            disabled={!packageReady}
            onClick={() => void copyReviewPackage()}
          >
            Copy exact review package
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!packageReady}
            onClick={downloadReviewPackage}
          >
            Download exact review package
          </button>
          <button className="button button-primary" type="button" disabled>
            {packageFrozen ? "Semantic package approved" : "Approve semantic package"}
          </button>
          <button className="button button-primary" type="button" disabled>
            {packageFrozen ? "Gate 3 frozen" : "Freeze Gate 3"}
          </button>
        </div>
        <p className="studio-human-boundary">
          {packageFrozen
            ? "The recorded Sergio review receipt and frozen protocol are shown above. Studio meta-tools remain unable to approve, alter, or refreeze them."
            : "Approval and freeze are intentionally disabled in this candidate. Meta-tools can inspect, draft, and present only; Codex cannot generate Sergio’s review receipt."}
        </p>
        <p className="studio-export-status" aria-live="polite">
          {exportStatus}
        </p>
      </section>
    </div>
  );
}
