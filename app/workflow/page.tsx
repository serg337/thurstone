import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workflow",
  description:
    "See how Thurstone turns intended WebMCP meaning into a repeatable release decision today—and what comes next."
};

const currentStages = [
  [
    "Define",
    "Write the request, required tool, argument policy, permitted effect, and prohibited effect."
  ],
  [
    "Arm",
    "Freeze the contract, safe fixture, agent-visible descriptors, catalog, and tested build."
  ],
  [
    "Test with an agent",
    "Ask your supported agent to act through the isolated native WebMCP catalog."
  ],
  [
    "Verify reality",
    "Compare the native trace with independent trusted state and ledger evidence."
  ],
  [
    "Diagnose",
    "Separate verified facts from qualified investigation hypotheses and the next step."
  ],
  ["Save", "Preserve a terminal pass or issue as a bounded browser-local regression case."],
  ["Rerun", "Repeat the same contract after a deliberate catalog, model, browser, or site change."]
] as const;

const lifecycleUses = [
  "Before the first launch",
  "Before every WebMCP change",
  "After changing tool descriptions or schemas",
  "When changing models or agent providers",
  "After browser or WebMCP updates",
  "To reproduce an agent mistake",
  "As a scheduled regression suite after launch"
] as const;

export default function WorkflowPage() {
  return (
    <div className="page-shell workflow-page">
      <header className="route-hero" aria-labelledby="workflow-title">
        <div>
          <p className="eyebrow">Semantic release workflow</p>
          <h1 id="workflow-title">From human intent to a release decision.</h1>
          <p>
            Thurstone turns meaning into a repeatable test teams can run before launch and whenever
            WebMCP behavior changes.
          </p>
          <a className="button button-primary" href="/demo">
            Try the reference workflow
          </a>
        </div>
      </header>

      <section className="workflow-section" aria-labelledby="today-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Thurstone today</p>
          <h2 id="today-title">Define → Arm → Test → Verify → Diagnose → Save → Rerun</h2>
        </div>
        <ol className="product-workflow-timeline">
          {currentStages.map(([title, text], index) => (
            <li key={title}>
              <span>{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="workflow-section" aria-labelledby="fit-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Where it fits</p>
          <h2 id="fit-title">Run Thurstone whenever meaning can drift.</h2>
        </div>
        <div className="lifecycle-grid">
          {lifecycleUses.map((use) => (
            <article key={use}>{use}</article>
          ))}
        </div>
        <div className="release-loop" aria-label="Release decision loop">
          <strong>Build or change WebMCP</strong>
          <span aria-hidden="true">→</span>
          <strong>Run Thurstone safely</strong>
          <span aria-hidden="true">→</span>
          <strong>Pass: release · Issue: investigate and rerun</strong>
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="scope-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Current boundary</p>
          <h2 id="scope-title">What ships for the challenge—and what does not.</h2>
        </div>
        <div className="workflow-scope-grid">
          <article>
            <h3>Challenge release</h3>
            <ul>
              <li>Safe reference checkout</li>
              <li>Native bring-your-own-agent trial</li>
              <li>Independent state and ledger verification</li>
              <li>Deterministic diagnosis and next step</li>
              <li>Browser-local regression artifacts</li>
              <li>Immutable 24/24 and separate 3/3 reference evidence</li>
            </ul>
          </article>
          <article data-future="true">
            <h3>Not yet</h3>
            <ul>
              <li>Arbitrary customer-site connection</li>
              <li>Automatic onboarding or repair</li>
              <li>Hosted CI release blocking</li>
              <li>Live shopper-session monitoring</li>
              <li>Runtime enforcement</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="workflow-section product-direction" aria-labelledby="direction-title">
        <p className="eyebrow">Product direction — not in the challenge release</p>
        <h2 id="direction-title">From reference workflow to a team release system.</h2>
        <div className="direction-grid">
          <span>Customer catalog and trusted-state connectors</span>
          <span>Team contract suites</span>
          <span>Pull-request and deployment checks</span>
          <span>Scheduled agent, model, and browser matrices</span>
          <span>Candidate-repair impact comparison</span>
          <span>Optional runtime-guard research</span>
        </div>
        <p>
          These are directions, not current capabilities or promises. Today’s product is the
          bounded, working release-test loop demonstrated in the reference checkout.
        </p>
      </section>
    </div>
  );
}
