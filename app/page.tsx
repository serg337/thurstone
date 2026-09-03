import { HeroSignalBackdrop } from "@/components/hero-signal-backdrop";
import { HomeWorkflowOrbit } from "@/components/home-workflow-orbit";
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
            <a className="button button-primary" href="/judge">
              Judges: start here
            </a>
            <a className="button button-secondary" href="/demo">
              Test with your agent
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
            Semantic bugs can survive normal WebMCP development because handlers are tested one at a
            time. A tool can work exactly as coded while an agent still chooses it for the wrong
            request. Without a semantic release check, that gap may remain invisible until users
            encounter it.
          </p>
        </div>
        <div className="semantic-release-map">
          <ol className="semantic-shared-path" aria-label="Shared WebMCP release preparation">
            <li>
              <span>01 · Build your WebMCP</span>
              <h3>Create the tools your website will expose to agents.</h3>
            </li>
            <li>
              <span>02 · Configure the catalog</span>
              <h3>Define the names, descriptions, schemas, and annotations agents will use.</h3>
            </li>
            <li>
              <span>03 · Test each handler</span>
              <h3>Confirm every tool works correctly when called directly.</h3>
            </li>
            <li>
              <span>04 · Prepare to release</span>
              <h3>
                The code works—but nothing has checked whether an agent will choose the right tool
                for what a user means.
              </h3>
            </li>
          </ol>

          <div className="semantic-release-lanes">
            <section className="semantic-release-lane lane-without" aria-labelledby="without-title">
              <header>
                <span>Without Thurstone</span>
                <h3 id="without-title">No semantic release gate</h3>
              </header>
              <ol aria-label="Release path without Thurstone">
                <li>
                  <span>05 · Deploy without semantic testing</span>
                  <h4>The release goes live without testing how agents interpret the catalog.</h4>
                </li>
                <li data-outcome="issue">
                  <span>06 · Hidden bug reaches users</span>
                  <h4>
                    An agent can choose the wrong tool, execute it successfully, and still create
                    the wrong experience.
                  </h4>
                </li>
              </ol>
            </section>

            <section className="semantic-release-lane lane-with" aria-labelledby="with-title">
              <header>
                <span>With Thurstone</span>
                <h3 id="with-title">With semantic release check</h3>
              </header>
              <div className="thurstone-release-check">
                <span>05 · Run Thurstone</span>
                <h4>
                  Your handlers passed. Now test whether agents understand when to use them: test a
                  real agent’s choice, verify the site’s actual effect, and detect any mismatch.
                </h4>
              </div>
              <div className="thurstone-release-outcomes">
                <article data-outcome="issue">
                  <span>Issue found</span>
                  <h4>Fix and rerun</h4>
                  <p>
                    See where expected and observed behavior diverged, update the catalog, and rerun
                    the same preserved test.
                  </p>
                  <small aria-label="Returns to Run Thurstone">↺ Same test</small>
                </article>
                <article data-outcome="pass">
                  <span>06 · Verified deploy</span>
                  <h4>Release with evidence</h4>
                  <p>
                    Deploy when the agent’s action and the site’s effect match what you intended.
                  </p>
                </article>
              </div>
            </section>
          </div>
        </div>
        <div className="semantic-story-payoff">
          <strong>Thurstone does not stop at “failed.”</strong>
          <p>
            Thurstone adds one simple check before deployment: did the agent choose the intended
            tool, and did the site produce only the allowed effect? If not, it shows where the
            tested behavior diverged and what to investigate. You make the change; Thurstone
            verifies the same test before release.
          </p>
          <small>
            The recommended investigation is based on observed evidence—not a claim about the
            agent’s private reasoning.
          </small>
        </div>
      </section>

      <section
        className="intro-section home-workflow-section"
        id="thurstone-today"
        aria-labelledby="thurstone-today-title"
      >
        <h2 id="thurstone-today-title">Thurstone today</h2>
        <HomeWorkflowOrbit />
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
      </section>
    </div>
  );
}
