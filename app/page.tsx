import Image from "next/image";

import { StatusPill } from "@/components/status-pill";
import { SignalFlow, type SignalFlowStage } from "@/components/ui/signal-flow";
import { PRODUCT_BYLINE } from "@/lib/brand";

const problemCards = Object.freeze([
  Object.freeze({
    number: "01",
    title: "Selection",
    text: "Did the request choose the intended tool—or correctly ask for clarification?"
  }),
  Object.freeze({
    number: "02",
    title: "Arguments",
    text: "Were the requested values preserved while privileged and undeclared fields stayed out?"
  }),
  Object.freeze({
    number: "03",
    title: "Effects",
    text: "Did trusted state change exactly once, in the way the website represented?"
  })
]);

const flowStages: readonly SignalFlowStage[] = Object.freeze([
  Object.freeze({
    title: "Human contract",
    summary: "The website owner declares the intended action and allowed effects.",
    detail:
      "The contract fixes the request meaning, expected action or clarification, arguments, state effects, replay policy, and prohibited outcomes before the test runs."
  }),
  Object.freeze({
    title: "Agent decision",
    summary: "A fresh agent context decides what the request requires.",
    detail:
      "The decision is captured separately from the contract so expected answers do not become instructions to the agent under test."
  }),
  Object.freeze({
    title: "Native WebMCP",
    summary: "Any selected action crosses the page’s real Site Tools boundary.",
    detail:
      "Thurstone records the live catalog, canonical arguments, native result, cancellation state, and exact application build."
  }),
  Object.freeze({
    title: "Trusted state",
    summary: "Before and after state are checked independently of the tool response.",
    detail:
      "A returned success flag is not enough. Thurstone compares the domain state and append-only operation record with the contract’s allowed and forbidden effects."
  }),
  Object.freeze({
    title: "Pass/fail receipt",
    summary: "Every assertion resolves to an understandable release result.",
    detail:
      "The verdict links the request, contract, decision, call, effects, build, and limitations without combining unrelated test matrices."
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
    tool: "no target call",
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
        <div className="intro-copy">
          <p className="eyebrow">Semantic judge for WebMCP</p>
          <h1 id="intro-title">
            AI agents can operate websites.
            <span>Thurstone verifies what they actually do.</span>
          </h1>
          <p className="intro-lede">
            Thurstone verifies that agents do what the website owner intended—and nothing the owner
            prohibited.
          </p>
          <p className="intro-problem">
            Test whether an agent chose the intended tool, supplied safe arguments, and produced the
            effect your site represents.
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

        <figure className="intro-art">
          <Image
            src="/thurstone-hero.webp"
            width={960}
            height={640}
            priority
            sizes="(max-width: 899px) calc(100vw - 40px), 44vw"
            alt="Streams representing website requests converge on Thurstone’s verification checkpoint, which separates a verified cyan outcome from a prohibited amber outcome."
          />
          <figcaption>Requests converge. Declared invariants decide what passes.</figcaption>
        </figure>
      </section>

      <section className="intro-section" aria-labelledby="problem-title">
        <div className="intro-section-heading">
          <p className="eyebrow">The missing test</p>
          <h2 id="problem-title">Publishing a tool is not the same as proving its meaning.</h2>
          <p>
            Traditional handler tests prove that code can run. Thurstone tests the semantic layer:
            whether natural-language intent becomes the approved WebMCP action and effect.
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
          <h2 id="flow-title">One declared contract. Five inspectable stages.</h2>
          <p>
            The expected behavior stays separate from the agent and is compared with what the live
            page actually did.
          </p>
        </div>
        <SignalFlow stages={flowStages} />
      </section>

      <section className="intro-section" aria-labelledby="examples-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Concrete boundaries</p>
          <h2 id="examples-title">Meaning changes the action. Invariants constrain the effect.</h2>
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
          <p>Two separate test matrices answer two different questions.</p>
        </div>
        <div className="proof-grid">
          <article className="proof-card proof-semantic">
            <StatusPill state="ready">Verified reference run</StatusPill>
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

      <section className="intro-limitations" aria-labelledby="limits-title">
        <div>
          <p className="eyebrow">Evidence, not certification</p>
          <h2 id="limits-title">A strong result about one declared contract and tested build.</h2>
        </div>
        <p>
          Thurstone is a testing and audit system—not runtime enforcement, guaranteed security, or
          proof about arbitrary websites. The reference environment uses synthetic checkout data and
          cannot purchase anything.
        </p>
      </section>

      <section className="intro-final-cta" aria-labelledby="final-cta-title">
        <p className="eyebrow">See where intent becomes behavior</p>
        <h2 id="final-cta-title">
          Thurstone is the missing testing layer for agent-callable websites.
        </h2>
        <p>
          Start with the guided boundary, write your own reference contract, or open the full WebMCP
          sandbox.
        </p>
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
        <p className="intro-byline">{PRODUCT_BYLINE}</p>
      </section>
    </div>
  );
}
