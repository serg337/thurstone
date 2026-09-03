import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Read the measurement principles behind Thurstone: the Latent Invariance Principle and Canonical Semantic Realization.",
  alternates: { canonical: "/research" }
};

const papers = [
  {
    number: "01",
    shortName: "LIP",
    title: "The Latent Invariance Principle",
    subtitle: "An epistemic constraint on measurement under indirect observation",
    summary:
      "When intent cannot be observed directly, one correct response is weak evidence. Stable behavior across meaning-preserving representations is stronger evidence that a system is tracking the underlying phenomenon—not merely its wording.",
    thurstone:
      "This is why Thurstone preserves one intended behavior while testing representative ways a person may express it.",
    equations: [
      {
        label: "Representation process",
        formula: "r = g(Φ, c, ε)",
        note: "A request expresses latent meaning through context and surface variation."
      },
      {
        label: "Observed behavior",
        formula: "B(r)",
        note: "The evaluator sees what the system does with that representation."
      }
    ],
    insight: "Hold meaning fixed. Change the representation. Observe whether behavior drifts.",
    researchHref: "https://invarra.ai/research#the-latent-invariance-principle-full-paper",
    pdfHref: "https://invarra.ai/papers/latent_invariance_principle.pdf",
    publicationHref: "https://zenodo.org/records/21203401"
  },
  {
    number: "02",
    shortName: "CSR",
    title: "Canonical Semantic Realization",
    subtitle: "A measurement framework for controlled semantic variation",
    summary:
      "CSR separates the meaning being tested, the language used to express it, and the outcome produced by the system. Meaning becomes the experimental unit; each valid realization becomes another measurement.",
    thurstone:
      "This becomes Thurstone’s contract structure: declare the meaning once, test representative requests, and compare every tool decision and site effect with the same expectation.",
    equations: [
      {
        label: "Realization relation",
        formula: "p = π(s, c)",
        note: "A prompt realizes one canonical semantic unit under a condition."
      },
      {
        label: "Semantic preservation",
        formula: "p₁ ≡ₛₑₘ p₂",
        note: "Valid realizations preserve the same meaning-bearing commitments."
      }
    ],
    insight: "Meaning is the unit. Wording is controlled variation. Outcomes are evidence.",
    researchHref: "https://invarra.ai/research#canonical-semantic-realization-full-paper",
    pdfHref: "https://invarra.ai/papers/canonical_semantic_realization.pdf",
    publicationHref: "https://zenodo.org/records/21203393"
  }
] as const;

export default function ResearchPage() {
  return (
    <div className="page-shell route-page research-page">
      <header className="research-hero" aria-labelledby="research-title">
        <div className="research-hero-copy">
          <p className="eyebrow">Research foundation</p>
          <h1 id="research-title">Meaning is the unit. Behavior is the evidence.</h1>
          <p>
            Thurstone applies two Invarra measurement principles to WebMCP: keep intended meaning
            explicit, vary how it is expressed, and verify what the live system actually does.
          </p>
          <div className="button-row">
            <a
              className="button button-primary"
              href="https://invarra.ai/research"
              target="_blank"
              rel="noreferrer"
            >
              Read the full papers
            </a>
            <a className="button button-secondary" href="/demo">
              Test the method
            </a>
          </div>
        </div>

        <div className="research-hero-visual" aria-label="Meaning, representation, and behavior">
          <div className="research-hero-node" data-node="meaning">
            <span>Latent meaning</span>
            <strong>Φ</strong>
          </div>
          <span className="research-hero-operator" aria-hidden="true">
            →
          </span>
          <div className="research-hero-node" data-node="representation">
            <span>Representation</span>
            <strong>r</strong>
          </div>
          <span className="research-hero-operator" aria-hidden="true">
            →
          </span>
          <div className="research-hero-node" data-node="behavior">
            <span>Behavior</span>
            <strong>B(r)</strong>
          </div>
          <p>Did the action remain faithful to the meaning?</p>
        </div>
      </header>

      <section className="research-thesis" aria-labelledby="research-thesis-title">
        <div>
          <p className="eyebrow">The measurement problem</p>
          <h2 id="research-thesis-title">
            A successful tool call can still be the wrong behavior.
          </h2>
        </div>
        <p>
          Ordinary tests can prove that a handler works. These papers explain why evaluating a
          semantic system requires another question: does its behavior remain correct when the same
          intended meaning appears through valid variation?
        </p>
      </section>

      <section className="research-papers" aria-labelledby="research-papers-title">
        <div className="research-section-heading">
          <p className="eyebrow">Published foundation</p>
          <h2 id="research-papers-title">Two principles. One measurable WebMCP contract.</h2>
        </div>

        {papers.map((paper) => (
          <article className="research-paper" key={paper.number} data-paper={paper.shortName}>
            <div className="research-paper-copy">
              <div className="research-paper-meta">
                <span>Paper {paper.number}</span>
                <span>Invarra Research · June 28, 2026</span>
              </div>
              <header>
                <span className="research-paper-monogram" aria-hidden="true">
                  {paper.shortName}
                </span>
                <div>
                  <h3>{paper.title}</h3>
                  <p className="research-paper-subtitle">{paper.subtitle}</p>
                </div>
              </header>
              <p className="research-paper-summary">{paper.summary}</p>
              <div className="research-product-connection">
                <span>In Thurstone</span>
                <p>{paper.thurstone}</p>
              </div>
              <footer className="research-paper-actions">
                <a href={paper.researchHref} target="_blank" rel="noreferrer">
                  Read on Invarra
                </a>
                <a href={paper.pdfHref} target="_blank" rel="noreferrer">
                  View PDF
                </a>
                <a href={paper.publicationHref} target="_blank" rel="noreferrer">
                  Publication record
                </a>
              </footer>
            </div>

            <div className="research-equation-canvas" aria-label={`${paper.title} equations`}>
              <span className="research-equation-watermark" aria-hidden="true">
                {paper.shortName}
              </span>
              {paper.equations.map((equation) => (
                <section key={equation.label}>
                  <span>{equation.label}</span>
                  <p aria-label={`${equation.label}: ${equation.formula}`}>{equation.formula}</p>
                  <small>{equation.note}</small>
                </section>
              ))}
              <blockquote>{paper.insight}</blockquote>
            </div>
          </article>
        ))}
      </section>

      <section className="research-translation" aria-labelledby="research-translation-title">
        <div className="research-section-heading">
          <p className="eyebrow">From research to product</p>
          <h2 id="research-translation-title">
            Thurstone turns the measurement layers into a test.
          </h2>
        </div>
        <div className="research-translation-map">
          <div>
            <span>Research language</span>
            <strong>Canonical meaning</strong>
            <small>s</small>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <span>Owner input</span>
            <strong>Contract + requests</strong>
            <small>E(s)</small>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <span>Observed system</span>
            <strong>Tool + arguments</strong>
            <small>B(r)</small>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <span>Trusted reality</span>
            <strong>Effect + verdict</strong>
            <small>expected ≟ actual</small>
          </div>
        </div>
      </section>
    </div>
  );
}
