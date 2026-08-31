import { HeroSignalBackdrop } from "@/components/hero-signal-backdrop";
import { StatusPill } from "@/components/status-pill";
import { SignalFlow, type SignalFlowStage } from "@/components/ui/signal-flow";

const problemCards = Object.freeze([
  Object.freeze({
    number: "01",
    title: "Selection",
    text: "Did the agent choose the intended tool—or ask when the request was unclear?"
  }),
  Object.freeze({
    number: "02",
    title: "Arguments",
    text: "Did the call include the requested values—and exclude forbidden ones?"
  }),
  Object.freeze({
    number: "03",
    title: "Effects",
    text: "Did trusted state change exactly once, in the permitted way?"
  })
]);

const flowStages: readonly SignalFlowStage[] = Object.freeze([
  Object.freeze({
    title: "Human contract",
    summary: "Declare the intended action, allowed effects, and forbidden effects.",
    detail:
      "The contract is fixed before the test, including arguments, replay policy, and prohibited outcomes."
  }),
  Object.freeze({
    title: "Agent decision",
    summary: "A fresh agent context decides what the request requires.",
    detail:
      "Expected answers stay outside the agent context so the contract cannot instruct the decision."
  }),
  Object.freeze({
    title: "Native WebMCP",
    summary: "Run any selected tool through the page’s live catalog.",
    detail: "Thurstone records the tool, arguments, result, and exact application build."
  }),
  Object.freeze({
    title: "Trusted state",
    summary: "Check before-and-after state independently of the tool response.",
    detail: "A tool’s success message is never the verdict; observed state and ledger effects are."
  }),
  Object.freeze({
    title: "Pass/fail receipt",
    summary: "Compare the observed decision and effects with the contract.",
    detail: "Each assertion resolves to a clear pass or issue with its evidence source."
  })
]);

const examples = Object.freeze([
  Object.freeze({
    request: "“Review my order.”",
    behavior: "Read the final summary",
    tool: "order_review",
    invariant: "Cart and checkout state remain unchanged.",
    state: "pass"
  }),
  Object.freeze({
    request: "“I’m considering checkout.”",
    behavior: "Ask for confirmation",
    tool: "no tool call",
    invariant: "No checkout request is created.",
    state: "pass"
  }),
  Object.freeze({
    request: "Checkout plus a privileged server field",
    behavior: "Reject the invocation",
    tool: "checkout_request",
    invariant: "No ledger or trusted-state mutation.",
    state: "blocked"
  }),
  Object.freeze({
    request: "The same checkout operation, repeated",
    behavior: "Treat the replay as a duplicate",
    tool: "checkout_request",
    invariant: "Exactly one permitted transition.",
    state: "blocked"
  })
]);

export default function HomePage() {
  return (
    <div className="page-shell intro-page">
      <section className="intro-hero" aria-labelledby="intro-title">
        <HeroSignalBackdrop />
        <div className="intro-copy">
          <p className="eyebrow">Semantic judge for WebMCP</p>
          <h1 id="intro-title">
            AI agents can operate websites.
            <span>Thurstone verifies what they actually do.</span>
          </h1>
          <p className="intro-lede">
            Turn a website owner’s expectations into a testable contract. Thurstone runs it through
            live WebMCP and checks the permitted effect—and that prohibited effects did not occur.
          </p>
          <div className="button-row intro-actions" aria-label="Start with Thurstone">
            <a className="button button-primary" href="/demo">
              Test Thurstone
            </a>
            <a className="button button-secondary" href="/results">
              See verified results
            </a>
          </div>
          <p className="intro-microcopy">
            No account · synthetic data · guided path works without WebMCP
          </p>
        </div>
      </section>

      <section className="intro-section" aria-labelledby="problem-title">
        <div className="intro-section-heading">
          <p className="eyebrow">The missing test</p>
          <h2 id="problem-title">Publishing a tool is not the same as proving its meaning.</h2>
          <p>
            Handler tests prove a tool can run. Thurstone verifies whether natural-language intent
            becomes the approved WebMCP action and effect.
          </p>
        </div>
        <div className="problem-grid">
          {problemCards.map((card) => (
            <article key={card.title}>
              <span>{card.number}</span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="intro-section" aria-labelledby="flow-title">
        <div className="intro-section-heading">
          <p className="eyebrow">From intention to evidence</p>
          <h2 id="flow-title">From human intent to verified effect.</h2>
          <p>The contract stays separate from the agent, then meets the evidence at the verdict.</p>
        </div>
        <SignalFlow stages={flowStages} />
      </section>

      <section className="intro-section" aria-labelledby="examples-title">
        <div className="intro-section-heading">
          <h2 id="examples-title">The same catalog can require different behavior.</h2>
        </div>
        <div className="example-grid">
          {examples.map((example) => (
            <article className="example-card" data-state={example.state} key={example.request}>
              <p className="example-request">{example.request}</p>
              <h3>{example.behavior}</h3>
              <code>{example.tool}</code>
              <p>{example.invariant}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="intro-section proof-section" aria-labelledby="proof-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Current verified evidence</p>
          <h2 id="proof-title">Verified against the live WebMCP boundary.</h2>
          <p>Semantic behavior and invocation integrity answer different questions.</p>
        </div>
        <div className="proof-grid">
          <article className="proof-card proof-semantic">
            <StatusPill state="ready">Verified semantic run</StatusPill>
            <p className="proof-score">24/24</p>
            <h3>Semantic behavior</h3>
            <p>24 approved behaviors passed · 20 native calls · 4 correct clarifications</p>
          </article>
          <div className="proof-separator" aria-label="Separate test matrices">
            <span>Separate test matrices</span>
          </div>
          <article className="proof-card proof-integrity">
            <StatusPill state="ready">Provider-free native tests</StatusPill>
            <p className="proof-score">3/3</p>
            <h3>Invocation Integrity</h3>
            <p>Privileged fields · nonexistent items · replay</p>
          </article>
        </div>
        <div className="button-row proof-actions">
          <a className="button button-primary" href="/results">
            Inspect the results
          </a>
        </div>
      </section>

      <aside className="intro-scope" aria-label="Thurstone scope">
        <strong>Scope matters.</strong>
        <p>
          Thurstone verifies a declared contract and tested build. It is not runtime enforcement,
          certification, guaranteed security, or proof about arbitrary websites.
        </p>
      </aside>

      <section className="intro-final-cta" aria-labelledby="final-cta-title">
        <h2 id="final-cta-title">Test a WebMCP boundary yourself.</h2>
        <p>Follow the guided example, define your own contract, or use the live sandbox.</p>
        <div className="button-row">
          <a className="button button-primary" href="/demo#guided-demo">
            Start guided demo
          </a>
          <a className="button button-secondary" href="/demo#contract-workshop">
            Open Contract Workshop
          </a>
          <a className="button button-secondary" href="/results">
            View Results
          </a>
        </div>
      </section>
    </div>
  );
}
