import styles from "@/components/demo/diagnostic-result-v3.module.css";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";
import Link from "next/link";
import type { ReactNode } from "react";

function verdictTitle(result: ByoaDemoResultV3): string {
  if (result.verdict === "pass") return "Your selected contract case held.";
  if (result.verdict === "issue") return "Thurstone found a semantic mismatch before release.";
  if (result.verdict === "unavailable") return "This environment could not expose the live test.";
  return "Thurstone could not verify an agent decision.";
}

function verdictSummary(result: ByoaDemoResultV3): string {
  if (result.verdict === "pass") {
    return "The observed native action, arguments, trusted effect, and tested invariants matched the owner contract.";
  }
  if (result.verdict === "issue") {
    return "At least one measured contract assertion diverged. Review the verified facts and next step below before release.";
  }
  return "No verified semantic conclusion is claimed. Preserve the receipt, recover the required environment, and rerun the same case.";
}

function pendingLabel(value: ByoaDemoResultV3["trustedStateBefore"]["value"]["pendingCheckout"]) {
  return value === null ? "No pending checkout" : `Pending · ${value.status}`;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function readableItem(value: unknown): string {
  if (value === "field-notebook") return "Field notebook";
  if (value === "stoneware-mug") return "Stoneware mug";
  return typeof value === "string" ? value : "unspecified item";
}

function argumentSummary(value: unknown): string {
  if (value === null) return "No arguments observed";
  if (typeof value !== "object" || Array.isArray(value)) return pretty(value);
  const record = value as Record<string, unknown>;
  if (record.itemId !== undefined && typeof record.quantity === "number") {
    return `Set ${readableItem(record.itemId)} quantity to ${record.quantity}`;
  }
  if (record.kind === "empty" || Object.keys(record).length === 0) return "No arguments";
  if (record.kind === "checkout_request") return "One valid, unique operation ID";
  return pretty(value);
}

export function DiagnosticResultV3({
  result,
  actions
}: {
  readonly result: ByoaDemoResultV3;
  readonly actions?: ReactNode;
}) {
  const primaryFinding = result.diagnostic.findings.find(
    ({ findingId }) => findingId === result.diagnostic.primaryFindingId
  );
  const failedAssertions = result.assertions.filter(({ passed }) => !passed);

  return (
    <section
      className={styles.result}
      data-verdict={result.verdict}
      aria-labelledby="v3-result-title"
    >
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">Stage 5 of 5 · verified outcome</p>
          <h1 id="v3-result-title">{verdictTitle(result)}</h1>
          <p>{verdictSummary(result)}</p>
        </div>
        <div className={styles.badges} aria-label="Evidence classification">
          <span>{result.verdict.toUpperCase()}</span>
          <span>{result.evidenceTier.replaceAll("-", " ")}</span>
          <span>{result.answerKeyIsolation.replaceAll("-", " ")}</span>
        </div>
      </header>
      {actions ? <div className={styles.primaryActions}>{actions}</div> : null}

      <section className={styles.hierarchy} aria-labelledby="decision-hierarchy-title">
        <h2 id="decision-hierarchy-title">Request → contract → observed reality</h2>
        <div>
          <article>
            <span>What the user requested</span>
            <blockquote>{result.contract.request}</blockquote>
          </article>
          <article>
            <span>What the owner contract required</span>
            <strong>
              Call <code>{result.selectedExpectedTool}</code>
            </strong>
            <p>{argumentSummary(result.contract.argumentPredicate)}</p>
          </article>
          <article data-observed={result.observedTool === result.selectedExpectedTool}>
            <span>What the agent actually did</span>
            <strong>
              {result.observedTool ? (
                <>
                  Called <code>{result.observedTool}</code>
                </>
              ) : (
                "No native invocation observed"
              )}
            </strong>
            <p>
              {argumentSummary(result.canonicalArguments)} ·{" "}
              {result.handlerOutcome?.status ?? "No handler outcome"}
            </p>
          </article>
        </div>
      </section>

      <details className={styles.technicalEvidence}>
        <summary>View technical evidence and assertion details</summary>
        <div>
          <section className={styles.arguments} aria-labelledby="arguments-title">
            <div>
              <h2 id="arguments-title">Arguments the site received</h2>
              <p>Raw transport and canonical contract comparison are shown separately.</p>
            </div>
            <div>
              <article>
                <span>Raw</span>
                <pre>{pretty(result.rawArguments)}</pre>
              </article>
              <article>
                <span>Canonical</span>
                <pre>{pretty(result.canonicalArguments)}</pre>
              </article>
            </div>
          </section>

          <section className={styles.state} aria-labelledby="trusted-state-title">
            <header>
              <div>
                <h2 id="trusted-state-title">Trusted before-and-after state</h2>
                <p>
                  The verdict uses site-owned state and ledger evidence, not the tool response
                  alone.
                </p>
              </div>
              <span>{result.sourceTruth.stateAuthority.replaceAll("-", " ")}</span>
            </header>
            <div className={styles.stateColumns}>
              {[
                ["Before", result.trustedStateBefore.value],
                ["After", result.trustedStateAfter.value]
              ].map(([label, state]) => {
                const snapshot = state as ByoaDemoResultV3["trustedStateBefore"]["value"];
                return (
                  <article key={label as string}>
                    <span>{label as string}</span>
                    <strong>Revision {snapshot.revision}</strong>
                    <ul>
                      {snapshot.lines.map((line) => (
                        <li key={line.itemId}>
                          {line.name}: {line.quantity}
                        </li>
                      ))}
                    </ul>
                    <small>{pendingLabel(snapshot.pendingCheckout)}</small>
                  </article>
                );
              })}
            </div>
            <div className={styles.ledger}>
              <article>
                <span>Native events</span>
                <strong>{result.ledgerDiff.eventCountDelta}</strong>
              </article>
              <article>
                <span>State transitions</span>
                <strong>{result.ledgerDiff.stateTransitionCount}</strong>
              </article>
              <article>
                <span>Revision delta</span>
                <strong>{result.ledgerDiff.effect.revision.delta}</strong>
              </article>
              <article>
                <span>Later calls rejected</span>
                <strong>{result.ledgerDiff.rejectedAdditionalAttempts}</strong>
              </article>
            </div>
            <p className={styles.replayBoundary}>
              Replay was not measured in this one-call trial. Replay/idempotency remains a separate
              Invocation Integrity test.
            </p>
          </section>

          <section className={styles.assertions} aria-labelledby="assertions-title">
            <header>
              <div>
                <h2 id="assertions-title">Why Thurstone reached this verdict</h2>
                <p>
                  {failedAssertions.length === 0
                    ? "Every measured assertion passed."
                    : `${failedAssertions.length} measured assertion(s) failed.`}
                </p>
              </div>
              <strong>
                {result.assertions.filter(({ passed }) => passed).length}/{result.assertions.length}
              </strong>
            </header>
            <ul>
              {result.assertions.map((assertion) => (
                <li key={assertion.assertionId} data-passed={assertion.passed}>
                  <span aria-hidden="true">{assertion.passed ? "✓" : "×"}</span>
                  <div>
                    <strong>{assertion.label}</strong>
                    <p>{assertion.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>

      <section className={styles.diagnosis} aria-labelledby="diagnosis-title-v3">
        <p className="eyebrow">Deterministic diagnosis</p>
        <h2 id="diagnosis-title-v3">
          {primaryFinding?.title ??
            (result.verdict === "pass"
              ? "No repair is indicated by this case."
              : "The case needs another observable trial.")}
        </h2>
        <p>
          {primaryFinding?.verifiedSummary ??
            (result.verdict === "pass"
              ? "The tested contract boundary held. Save it as a regression case and continue with the required suite."
              : "This receipt is inconclusive and must not be treated as a semantic pass or issue.")}
        </p>
        {primaryFinding ? (
          <>
            <div className={styles.facts}>
              <h3>Verified facts</h3>
              <ul>
                {primaryFinding.facts.map((fact) => (
                  <li key={fact.factId}>{fact.message}</li>
                ))}
              </ul>
            </div>
            {primaryFinding.hypothesis ? (
              <aside className={styles.hypothesis}>
                <strong>Investigation hypothesis—not private agent reasoning</strong>
                <p>{primaryFinding.hypothesis.message}</p>
              </aside>
            ) : null}
            <div className={styles.nextStep}>
              <span>Recommended next step · {primaryFinding.nextStep.target}</span>
              <strong>{primaryFinding.nextStep.instruction}</strong>
              <p>Success criterion: {primaryFinding.nextStep.successCriterion}</p>
            </div>
          </>
        ) : null}
        <p className={styles.releaseGuidance}>
          Release guidance:{" "}
          <strong>{result.diagnostic.releaseGuidance.replaceAll("-", " ")}</strong>
        </p>
      </section>

      <details className={styles.evidence}>
        <summary>What this receipt proves—and what it does not</summary>
        <dl>
          <div>
            <dt>Launch</dt>
            <dd>{result.launchMode.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Evidence tier</dt>
            <dd>{result.evidenceTier.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Answer-key isolation</dt>
            <dd>{result.answerKeyIsolation.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>
              <code>{result.buildCommit}</code>
            </dd>
          </div>
        </dl>
        <ul>
          {result.diagnostic.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>

      <section className={styles.controlled} aria-labelledby="controlled-mismatch-title">
        <p className="eyebrow">Controlled example — no model call</p>
        <h2 id="controlled-mismatch-title">See how Thurstone catches a mismatch</h2>
        <p>
          Open a fresh top-level document for one deliberately wrong real WebMCP invocation. The
          separate document preserves the central registry boundary and cannot replace this
          run&apos;s retired handlers or change its result.
        </p>
        <a className="button button-secondary" href="/demo/controlled">
          Open controlled mismatch in a fresh document
        </a>
      </section>

      <section className={styles.deeper} aria-labelledby="explore-deeper-title">
        <h2 id="explore-deeper-title">Explore deeper</h2>
        <div>
          <a href="/lab">
            <strong>Five-tool technical Lab</strong>
            <span>Direct native controls, reset, cancellation, and forensic receipts.</span>
          </a>
          <a href="/results">
            <strong>24-case semantic reference</strong>
            <span>Equivalent wording, ambiguity, negation, arguments, and clarification.</span>
          </a>
          <a href="/invocation-integrity">
            <strong>3-case Invocation Integrity</strong>
            <span>Privileged fields, nonexistent items, and replay/idempotency.</span>
          </a>
          <Link href="/#thurstone-today">
            <strong>Release workflow</strong>
            <span>Where Thurstone fits before launch and after WebMCP changes.</span>
          </Link>
          <a href="/research">
            <strong>Research foundations</strong>
            <span>LIP, CSR, and related Invarra work behind semantic contract testing.</span>
          </a>
        </div>
      </section>

      <details className={styles.raw}>
        <summary>View complete Result v3 evidence</summary>
        <pre>{pretty(result)}</pre>
      </details>
    </section>
  );
}
