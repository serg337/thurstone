import { HeroSignalBackdrop } from "@/components/hero-signal-backdrop";
import { BrowserEntryGuide } from "@/components/demo/browser-entry-guide";
import { StatusPill } from "@/components/status-pill";
import { SignalFlow, type SignalFlowStage } from "@/components/ui/signal-flow";

const flowStages: readonly SignalFlowStage[] = Object.freeze([
  {
    title: "Define",
    summary: "Turn intended meaning into a contract.",
    detail:
      "Declare the required tool, arguments, allowed effects, forbidden effects, and replay policy."
  },
  {
    title: "Agent decides",
    summary: "Your supported agent sees only the request and live tools.",
    detail: "The owner’s expected answer stays outside the agent-visible surface."
  },
  {
    title: "Native WebMCP",
    summary: "Observe the first admitted tool invocation.",
    detail: "Thurstone records the native tool, raw and canonical arguments, build, and catalog."
  },
  {
    title: "Verify reality",
    summary: "Check trusted state and ledger independently.",
    detail: "A tool response never decides the verdict; the site-owned state and ledger do."
  },
  {
    title: "Diagnose",
    summary: "See what failed and where to investigate.",
    detail:
      "Deterministic facts, qualified hypotheses, and a concrete rerun criterion preserve the case."
  }
]);

const lifecycleUses = [
  "Before the first launch",
  "Before every WebMCP change",
  "After changing tool descriptions or schemas",
  "When changing models or agent providers",
  "After browser or WebMCP updates",
  "To reproduce an agent mistake",
  "As a scheduled regression suite after launch"
] as const;

export default function HomePage() {
  return (
    <div className="page-shell intro-page">
      <section className="intro-hero" aria-labelledby="intro-title">
        <HeroSignalBackdrop />
        <div className="intro-copy">
          <p className="eyebrow">Semantic release testing for WebMCP</p>
          <h1 id="intro-title">
            Your WebMCP code can be correct.
            <span>The agent can still choose the wrong action.</span>
          </h1>
          <p className="intro-lede">
            Thurstone lets website owners define what a request should mean, test it with a real
            agent, and verify what the site actually changed—before that behavior reaches users.
          </p>
          <div className="button-row intro-actions" aria-label="Start with Thurstone">
            <a className="button button-primary" href="/demo">
              Test with your agent
            </a>
            <a className="button button-secondary" href="/results">
              See verified results
            </a>
          </div>
          <p className="intro-microcopy">
            No account · safe reference checkout · use ChatGPT desktop&apos;s built-in Browser
          </p>
          <BrowserEntryGuide compact />
        </div>
      </section>

      <section className="intro-section" aria-labelledby="problem-title">
        <div className="intro-section-heading">
          <p className="eyebrow">The bug ordinary tests miss</p>
          <h2 id="problem-title">
            The missing failure lives between the user’s words and your code.
          </h2>
          <p>
            A handler can execute perfectly and still be the wrong action for what the user meant.
          </p>
        </div>
        <div
          className="semantic-failure-example"
          role="group"
          aria-label="Semantic failure example"
        >
          <div>
            <span>User</span>
            <strong>“I’m considering checkout.”</strong>
          </div>
          <div>
            <span>Agent</span>
            <strong>Calls `checkout_request`</strong>
          </div>
          <div>
            <span>Handler</span>
            <strong>Executes correctly</strong>
          </div>
          <div>
            <span>Site</span>
            <strong>Creates a pending checkout</strong>
          </div>
          <div data-outcome="issue">
            <span>Verdict</span>
            <strong>The code worked. The behavior was wrong.</strong>
          </div>
        </div>
        <p className="semantic-failure-payoff">
          <strong>Unit tests prove that a tool works.</strong> Thurstone tests whether it should
          have been called.
        </p>
      </section>

      <section className="intro-section" aria-labelledby="mechanism-title">
        <div className="intro-section-heading">
          <p className="eyebrow">The product mechanism</p>
          <h2 id="mechanism-title">Turn intent into a release test.</h2>
          <p>Human contract → agent decision → native WebMCP → trusted reality → next action.</p>
        </div>
        <SignalFlow stages={flowStages} />
      </section>

      <section className="intro-section actionable-failure" aria-labelledby="diagnosis-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Actionable failure</p>
          <h2 id="diagnosis-title">An issue should tell you where to look next.</h2>
          <p>
            Thurstone identifies which tested layer diverged, shows the evidence, and recommends
            what to investigate. You make the change; Thurstone reruns the contract to verify it.
          </p>
        </div>
        <article className="diagnosis-example-card">
          <span>Wrong tool selected</span>
          <h3>Expected `checkout_request`; observed `order_review`.</h3>
          <p>
            No checkout transition occurred. The evidence places the mismatch at tool selection.
          </p>
          <strong>
            Investigate whether the descriptions clearly distinguish read-only review from explicit
            checkout authorization, then rerun the same case.
          </strong>
          <small>
            This is an investigation hypothesis—not a claim about the agent’s private reasoning.
          </small>
        </article>
      </section>

      <section className="intro-section" aria-labelledby="lifecycle-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Semantic regression</p>
          <h2 id="lifecycle-title">Run Thurstone whenever meaning can drift.</h2>
        </div>
        <div className="lifecycle-grid">
          {lifecycleUses.map((use) => (
            <article key={use}>{use}</article>
          ))}
        </div>
        <div className="release-loop" aria-label="WebMCP release loop">
          <strong>Build or change WebMCP</strong>
          <span aria-hidden="true">→</span>
          <strong>Run Thurstone safely</strong>
          <span aria-hidden="true">→</span>
          <strong>Pass: release · Issue: investigate and rerun</strong>
        </div>
      </section>

      <section className="intro-final-cta" aria-labelledby="live-invitation-title">
        <p className="eyebrow">Live challenge experience</p>
        <h2 id="live-invitation-title">Don’t watch a demo. Run one with your own agent.</h2>
        <p>
          Act as a WebMCP owner. Define the contract, arm the safe reference site, ask ChatGPT to
          act, and see whether the real effect matches what you intended.
        </p>
        <a className="button button-primary" href="/demo">
          Build a contract
        </a>
      </section>

      <section className="intro-section proof-section" aria-labelledby="proof-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Verified reference evidence</p>
          <h2 id="proof-title">A working product, backed by separate test matrices.</h2>
        </div>
        <div className="proof-grid">
          <article className="proof-card proof-semantic">
            <StatusPill state="ready">Verified semantic run</StatusPill>
            <p className="proof-score">24/24</p>
            <h3>Semantic behaviors</h3>
            <p>24 provider decisions · 20 native calls · 4 correct clarifications</p>
          </article>
          <div className="proof-separator" aria-label="Separate test matrices">
            <span>Separate</span>
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
          <a className="button button-secondary" href="/workflow">
            See the workflow
          </a>
        </div>
      </section>

      <aside className="intro-scope" aria-label="Thurstone challenge scope">
        <strong>Challenge scope</strong>
        <p>
          This experience uses Thurstone’s synthetic reference checkout. Customer deployments would
          connect the same workflow to their own catalog, test environment, and trusted-state
          source. Thurstone tests releases; it does not intercept live customer sessions.
        </p>
      </aside>
    </div>
  );
}
