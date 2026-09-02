"use client";

import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import styles from "@/components/demo/continuous-journey-organizer.module.css";
import type { ThurstoneContractSuiteV1 } from "@/lib/demo/contract-suite";
import {
  addContinuousJourneyStep,
  CONTINUOUS_JOURNEY_MAX_STEPS,
  moveContinuousJourneyStep,
  removeContinuousJourneyStep,
  selectContinuousJourneyCase,
  validateContinuousJourneyPlan,
  type ContinuousJourneyPlanDraft
} from "@/lib/demo/continuous-journey-plan";

export function ContinuousJourneyOrganizer({
  suite,
  plan,
  onChange,
  disabled = false
}: {
  readonly suite: ThurstoneContractSuiteV1;
  readonly plan: ContinuousJourneyPlanDraft;
  readonly onChange: (plan: ContinuousJourneyPlanDraft) => void;
  readonly disabled?: boolean;
}) {
  const [draggedCaseId, setDraggedCaseId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [dragTargetCaseId, setDragTargetCaseId] = useState<string | null>(null);
  const stepRefs = useRef(new Map<string, HTMLElement>());
  const previousPositionsRef = useRef(new Map<string, DOMRect>());
  const validation = validateContinuousJourneyPlan(suite, plan);
  const hasProcessEndingStep = plan.orderedCaseIds.some((caseId) => {
    const testCase = suite.cases.find((candidate) => candidate.caseId === caseId);
    return testCase ? suite.processEndingToolNames.includes(testCase.expectedTool) : false;
  });
  const availableCases = suite.cases.filter(
    (testCase) =>
      !plan.orderedCaseIds.includes(testCase.caseId) &&
      !(hasProcessEndingStep && suite.processEndingToolNames.includes(testCase.expectedTool))
  );
  const [pendingCaseId, setPendingCaseId] = useState("");
  const addCaseId = availableCases.some(({ caseId }) => caseId === pendingCaseId)
    ? pendingCaseId
    : (availableCases[0]?.caseId ?? "");
  const selectedCase = suite.cases.find(({ caseId }) => caseId === selectedCaseId);
  const canRemoveSelected = selectedCase !== undefined && plan.orderedCaseIds.length > 2;

  useLayoutEffect(() => {
    if (draggedCaseId === null || previousPositionsRef.current.size === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [caseId, element] of stepRefs.current) {
      if (caseId === draggedCaseId) continue;
      const previous = previousPositionsRef.current.get(caseId);
      if (previous === undefined) continue;
      const current = element.getBoundingClientRect();
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaY) < 1 || reduceMotion) continue;
      element.animate([{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }], {
        duration: 190,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
      });
    }
    previousPositionsRef.current.clear();
  }, [draggedCaseId, plan.orderedCaseIds]);

  function move(from: number, to: number) {
    if (disabled) return;
    previousPositionsRef.current = new Map(
      [...stepRefs.current].map(([caseId, element]) => [caseId, element.getBoundingClientRect()])
    );
    onChange(moveContinuousJourneyStep(plan, from, to));
  }

  function dragInto(event: DragEvent<HTMLElement>, targetCaseId: string) {
    event.preventDefault();
    if (draggedCaseId === null || draggedCaseId === targetCaseId) return;
    const from = plan.orderedCaseIds.indexOf(draggedCaseId);
    const to = plan.orderedCaseIds.indexOf(targetCaseId);
    if (from < 0 || to < 0) return;
    const targetBounds = event.currentTarget.getBoundingClientRect();
    const crossedMidpoint =
      from < to
        ? event.clientY >= targetBounds.top + targetBounds.height / 2
        : event.clientY <= targetBounds.top + targetBounds.height / 2;
    if (!crossedMidpoint) return;
    setDragTargetCaseId(targetCaseId);
    move(from, to);
  }

  function handleKeyboardMove(event: KeyboardEvent<HTMLElement>, caseId: string, index: number) {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedCaseId(caseId);
      return;
    }
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(index, event.key === "ArrowUp" ? index - 1 : index + 1);
  }

  return (
    <section className={styles.organizer} aria-labelledby="continuous-journey-title">
      <header>
        <div>
          <p className={styles.kicker}>Continuous journey organizer</p>
          <h3 id="continuous-journey-title">Arrange the customer journey before arming it.</h3>
          <p>
            Thurstone starts with one representative request per tool. Add other requests for a
            longer journey, then drag them into the order to verify. A process-ending tool must stay
            last.
          </p>
        </div>
        <span className={styles.startingCondition}>Starts with the clean Demo cart</span>
      </header>

      <ol className={styles.steps} aria-label="Ordered continuous journey steps">
        {validation.orderedCases.map((testCase, index) => {
          const alternatives = suite.cases.filter(
            ({ expectedTool }) => expectedTool === testCase.expectedTool
          );
          const middleGroup = plan.anyOrderMiddle && (index === 1 || index === 2);
          return (
            <li
              key={testCase.caseId}
              ref={(element) => {
                if (element) stepRefs.current.set(testCase.caseId, element);
                else stepRefs.current.delete(testCase.caseId);
              }}
              className={styles.step}
              data-middle-group={middleGroup}
              data-selected={selectedCaseId === testCase.caseId}
              data-dragging={draggedCaseId === testCase.caseId}
              data-drag-target={dragTargetCaseId === testCase.caseId}
              draggable={!disabled}
              tabIndex={disabled ? -1 : 0}
              aria-label={`Step ${index + 1}: ${testCase.expectedTool}, ${testCase.name}. Drag to reorder; Alt plus arrow keys also reorders.`}
              onPointerDown={() => setSelectedCaseId(testCase.caseId)}
              onKeyDown={(event) => handleKeyboardMove(event, testCase.caseId, index)}
              onDragStart={(event) => {
                setDraggedCaseId(testCase.caseId);
                setSelectedCaseId(testCase.caseId);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", testCase.caseId);
                const preview = event.currentTarget.cloneNode(true) as HTMLElement;
                preview.className = styles.dragPreview!;
                preview.removeAttribute("draggable");
                preview.setAttribute("aria-hidden", "true");
                preview.style.width = `${event.currentTarget.getBoundingClientRect().width}px`;
                document.body.append(preview);
                event.dataTransfer.setDragImage(preview, 28, preview.offsetHeight / 2);
                window.setTimeout(() => preview.remove(), 0);
              }}
              onDragEnd={() => {
                setDraggedCaseId(null);
                setDragTargetCaseId(null);
              }}
              onDragOver={(event) => dragInto(event, testCase.caseId)}
              onDragEnter={(event) => dragInto(event, testCase.caseId)}
              onDrop={(event) => {
                event.preventDefault();
                setDraggedCaseId(null);
                setDragTargetCaseId(null);
              }}
            >
              <span className={styles.ordinal}>{index + 1}</span>
              <div className={styles.stepBody}>
                <div>
                  <code>{testCase.expectedTool}</code>
                  <strong>{testCase.name}</strong>
                </div>
              </div>
              <select
                className={styles.requestPicker}
                aria-label={`Request for ${testCase.expectedTool}`}
                value={testCase.caseId}
                disabled={disabled}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedCaseId(testCase.caseId);
                }}
                onChange={(event) => {
                  onChange(selectContinuousJourneyCase(plan, suite, index, event.target.value));
                  setSelectedCaseId(event.target.value);
                }}
              >
                {alternatives.map((candidate) => (
                  <option
                    key={candidate.caseId}
                    value={candidate.caseId}
                    disabled={
                      candidate.caseId !== testCase.caseId &&
                      plan.orderedCaseIds.includes(candidate.caseId)
                    }
                  >
                    {candidate.request}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ol>

      <div className={styles.stepControls}>
        <label>
          Add another contract request
          <select
            value={addCaseId}
            disabled={disabled || availableCases.length === 0}
            onChange={(event) => setPendingCaseId(event.target.value)}
          >
            {availableCases.length === 0 ? (
              <option value="">Add another request case above first</option>
            ) : (
              availableCases.map((testCase) => (
                <option key={testCase.caseId} value={testCase.caseId}>
                  {testCase.expectedTool} — {testCase.request}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          disabled={
            disabled ||
            addCaseId === "" ||
            plan.orderedCaseIds.length >= CONTINUOUS_JOURNEY_MAX_STEPS
          }
          onClick={() => {
            const next = addContinuousJourneyStep(plan, suite, addCaseId);
            onChange(next);
            setSelectedCaseId(addCaseId);
            setPendingCaseId("");
          }}
        >
          Add step
        </button>
        <button
          type="button"
          disabled={disabled || !canRemoveSelected}
          onClick={() => {
            if (selectedCaseId === null) return;
            onChange(removeContinuousJourneyStep(plan, selectedCaseId));
            setSelectedCaseId(null);
          }}
        >
          Remove selected
        </button>
      </div>

      {plan.orderedCaseIds.length === 4 ? (
        <label className={styles.anyOrder} data-active={plan.anyOrderMiddle}>
          <input
            type="checkbox"
            checked={plan.anyOrderMiddle}
            disabled={disabled}
            onChange={(event) => onChange({ ...plan, anyOrderMiddle: event.target.checked })}
          />
          <span>
            <strong>Middle steps may occur in either order</strong>
            Use when both middle requests are valid in either order.
          </span>
        </label>
      ) : null}

      {!validation.valid ? (
        <div className={styles.preview} data-state="blocked" role="alert">
          <strong>Fix the journey order before arming.</strong>
          <ul>
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
