import { HeroSignalBackdrop } from "@/components/hero-signal-backdrop";
import { BrowserEntryGuide } from "@/components/demo/browser-entry-guide";
import { ReferenceEvidenceDisclosures } from "@/components/results/reference-evidence-disclosures";
import { StatusPill } from "@/components/status-pill";

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
            Thurstone helps website owners uncover semantic mistakes in their WebMCP catalog,
            understand what went wrong, and fix them before agents frustrate real visitors or
            customers.
          </p>
          <div className="button-row intro-actions" aria-label="Start with Thurstone">
            <a className="button button-primary" href="/demo">
              Test with your agent
            </a>
            <a className="button button-secondary" href="/results">
              See verified reference results
            </a>
          </div>
          <BrowserEntryGuide compact />
        </div>
      </section>

      <section
        className="intro-section semantic-release-story"
        aria-labelledby="release-story-title"
      >
        <div className="intro-section-heading">
          <p className="eyebrow">From hidden failure to verified fix</p>
          <h2 id="release-story-title">
            Follow a semantic bug from the user’s words to a verified fix.
          </h2>
          <p>
            Thurstone tests the whole chain your handler tests cannot see. The owner declares what a
            request must mean. A fresh agent chooses from the real catalog. Thurstone captures the
            native call, checks independent site state and the ledger, and turns any mismatch into a
            regression the team can run again.
          </p>
        </div>
        <p className="semantic-story-example">
          <strong>Example:</strong> a shopper explicitly asks to begin checkout. Both available
          tools work, but only one matches what the shopper meant.
        </p>
        <ol
          className="semantic-story-grid"
          aria-label="How Thurstone turns a semantic mismatch into a verified fix"
        >
          <li>
            <span>01 · The request</span>
            <h3>“I’m ready—start checkout for this cart.”</h3>
            <p>The human intent is explicit and consequential.</p>
          </li>
          <li>
            <span>02 · The owner’s contract</span>
            <h3>
              Call <code>checkout_request</code> exactly once.
            </h3>
            <p>Create one pending approval and make no other state change.</p>
          </li>
          <li>
            <span>03 · The agent decision</span>
            <h3>
              The fresh agent selects <code>order_review</code>.
            </h3>
            <p>It sees the request and live tools—but never the owner’s answer key.</p>
          </li>
          <li>
            <span>04 · Native WebMCP</span>
            <h3>
              <code>order_review</code> executes correctly.
            </h3>
            <p>The handler returns a valid read-only order summary.</p>
          </li>
          <li data-outcome="issue">
            <span>05 · Trusted verdict</span>
            <h3>
              Expected <code>checkout_request</code>; observed <code>order_review</code>.
            </h3>
            <p>No checkout transition occurred. The contract failed at tool selection.</p>
          </li>
          <li data-outcome="next">
            <span>06 · Fix and rerun</span>
            <h3>Investigate the boundary between review and authorization.</h3>
            <p>Clarify the catalog descriptions, then rerun this preserved case.</p>
          </li>
        </ol>
        <div className="semantic-story-payoff">
          <strong>Thurstone does not stop at “failed.”</strong>
          <p>
            It identifies which tested layer diverged, shows the evidence, and gives the owner a
            concrete criterion for the next run. The owner makes the change; Thurstone verifies
            whether the same contract now passes.
          </p>
          <small>
            The recommended investigation is based on observed evidence—not a claim about the
            agent’s private reasoning.
          </small>
        </div>
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
          Test Thurstone with your agent
        </a>
      </section>

      <section className="intro-section proof-section" aria-labelledby="proof-title">
        <div className="intro-section-heading">
          <p className="eyebrow">Verified reference evidence</p>
          <h2 id="proof-title">Proven on our reference WebMCP.</h2>
          <p>
            These are Thurstone’s existing reference results—not results from your browser. Open
            either matrix to inspect every tested request, expected behavior, observed action,
            verified effect, and verdict.
          </p>
        </div>
        <div className="proof-grid">
          <article className="proof-card proof-semantic">
            <StatusPill state="ready">Verified semantic run</StatusPill>
            <p className="proof-score">24/24</p>
            <h3>Intended behaviors verified</h3>
            <p>24 real agent decisions · 20 native calls · 4 correct clarifications</p>
          </article>
          <div className="proof-separator" aria-label="Separate test matrices">
            <span>Separate</span>
          </div>
          <article className="proof-card proof-integrity">
            <StatusPill state="ready">Provider-free native tests</StatusPill>
            <p className="proof-score">3/3</p>
            <h3>Tested hostile invocations preserved site rules</h3>
            <p>Privileged fields · nonexistent items · duplicate execution</p>
          </article>
        </div>
        <ReferenceEvidenceDisclosures />
        <div className="button-row proof-actions">
          <a className="button button-primary" href="/results">
            View complete evidence
          </a>
          <a className="button button-secondary" href="/workflow">
            See the workflow
          </a>
        </div>
      </section>
    </div>
  );
}
