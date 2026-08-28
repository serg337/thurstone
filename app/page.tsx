import { StatusPill } from "@/components/status-pill";

const workflow = [
  {
    number: "01",
    title: "Declare meaning",
    text: "A human and agent draft the intended action, arguments, effects, and semantic boundaries."
  },
  {
    number: "02",
    title: "Run the same contract",
    text: "Fresh model contexts act through the live WebMCP catalog from a verified fixture."
  },
  {
    number: "03",
    title: "Inspect exact effects",
    text: "Trace-derived evidence separates tool choice, arguments, observable state, and over-action."
  }
];

export default function HomePage() {
  return (
    <div className="page-shell home-page">
      <section className="hero">
        <div className="hero-copy">
          <StatusPill state="pending">Gate 1 · deterministic native sandbox</StatusPill>
          <p className="eyebrow">Semantic regression for agent-callable sites</p>
          <h1>
            Unit tests for <span>meaning.</span>
          </h1>
          <p className="hero-lede">
            ToolProof tests whether agent actions track declared human-approved meaning rather than
            superficial wording.
          </p>
          <p className="byline">ToolProof by Invarra — created by Sergio Valencia.</p>
          <div className="button-row">
            <a className="button button-primary" href="/lab">
              Open checkout lab
            </a>
            <a className="button button-secondary" href="/studio">
              See the contract workflow
            </a>
          </div>
        </div>

        <div className="meaning-card" aria-label="ToolProof principle">
          <div className="meaning-row">
            <span className="signal signal-same" aria-hidden="true" />
            <div>
              <small>Same approved meaning</small>
              <strong>Equivalent action</strong>
            </div>
          </div>
          <div className="matrix-divider" aria-hidden="true">
            <span />
            <em>vs</em>
            <span />
          </div>
          <div className="meaning-row">
            <span className="signal signal-change" aria-hidden="true" />
            <div>
              <small>Meaning-changing boundary</small>
              <strong>Required action difference</strong>
            </div>
          </div>
          <p>
            Selection, canonical arguments, approval posture, and page effects remain independently
            inspectable.
          </p>
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="workflow-title">
        <div className="section-heading">
          <p className="eyebrow">Human + agent workflow</p>
          <h2 id="workflow-title">From ambiguous wording to inspectable behavior</h2>
        </div>
        <div className="workflow-grid">
          {workflow.map(({ number, title, text }) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="judge-path" aria-labelledby="judge-path-title">
        <div>
          <p className="eyebrow">60-second judge path</p>
          <h2 id="judge-path-title">Two requests. One consequential boundary.</h2>
          <p>
            In a supported WebMCP browser, inspect the seeded cart, request a read-only review,
            reset, then explicitly start the simulated checkout approval step.
          </p>
        </div>
        <ol>
          <li>Open the Lab and confirm native provider readiness.</li>
          <li>Ask to see the complete order before deciding.</li>
          <li>Reset, then ask to start checkout approval.</li>
          <li>Inspect the exact tool and page effect in Results.</li>
        </ol>
      </section>
    </div>
  );
}
