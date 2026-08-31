import type { Metadata } from "next";

import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Read the measurement principles behind Thurstone: the Latent Invariance Principle and Canonical Semantic Realization.",
  alternates: { canonical: "/research" }
};

const papers = [
  {
    number: "01",
    title: "The Latent Invariance Principle",
    subtitle: "An epistemic constraint on measurement under indirect observation",
    summary:
      "When the target is latent—such as intent or understanding—one correct response is not enough. Stability across meaning-preserving representations is evidence that a system is tracking the underlying phenomenon rather than the surface form.",
    thurstone:
      "LIP explains why Thurstone tests controlled families of requests instead of treating one polished prompt as sufficient release evidence.",
    researchHref: "https://invarra.ai/research#the-latent-invariance-principle-full-paper",
    pdfHref: "https://invarra.ai/papers/latent_invariance_principle.pdf",
    publicationHref: "https://zenodo.org/records/21203401"
  },
  {
    number: "02",
    title: "Canonical Semantic Realization",
    subtitle: "A measurement framework for controlled semantic variation",
    summary:
      "CSR separates the canonical semantic unit, the language or presentation used to realize it, and the observed system outcome. Meaning is the experimental unit; realizations are controlled repeated measurements.",
    thurstone:
      "CSR gives Thurstone its core structure: declare one meaning, exercise valid realizations, and compare each observed WebMCP decision and effect with the same contract.",
    researchHref: "https://invarra.ai/research#canonical-semantic-realization-full-paper",
    pdfHref: "https://invarra.ai/papers/canonical_semantic_realization.pdf",
    publicationHref: "https://zenodo.org/records/21203393"
  }
] as const;

export default function ResearchPage() {
  return (
    <div className="page-shell route-page research-page">
      <header className="route-hero research-hero" aria-labelledby="research-title">
        <div>
          <p className="eyebrow">Research foundation</p>
          <h1 id="research-title">The measurement research behind Thurstone.</h1>
          <p>
            Thurstone treats meaning as something to measure: hold intent constant, vary wording
            deliberately, and verify the live system’s decision and effect.
          </p>
          <div className="button-row">
            <a
              className="button button-primary"
              href="https://invarra.ai/research"
              target="_blank"
              rel="noreferrer"
            >
              Open Invarra Research
            </a>
            <a className="button button-secondary" href="/demo#guided-demo">
              See the method in action
            </a>
          </div>
        </div>
        <StatusPill state="ready">Two published papers</StatusPill>
      </header>

      <section className="research-method" aria-labelledby="research-method-title">
        <div className="research-section-heading">
          <p className="eyebrow">From principle to product</p>
          <h2 id="research-method-title">Why one correct prompt is not enough.</h2>
          <p>
            LIP explains why stable behavior across valid variation matters. CSR defines how to
            separate meaning, realization, and outcome. Thurstone applies both ideas to a live
            WebMCP contract.
          </p>
        </div>
        <ol className="research-method-flow" aria-label="Research to Thurstone flow">
          <li>
            <span>01</span>
            <strong>Why variation matters</strong>
            <p>Correct once does not establish that an agent followed the intended meaning.</p>
          </li>
          <li>
            <span>02</span>
            <strong>How meaning stays controlled</strong>
            <p>Equivalent realizations remain bound to one human-approved semantic unit.</p>
          </li>
          <li>
            <span>03</span>
            <strong>What the website actually did</strong>
            <p>Native execution, trusted state, and the ledger determine the verdict.</p>
          </li>
        </ol>
      </section>

      <section className="research-papers" aria-labelledby="research-papers-title">
        <div className="research-section-heading">
          <p className="eyebrow">Published foundation</p>
          <h2 id="research-papers-title">The two ideas behind Thurstone.</h2>
          <p>
            Read the product connection here. Invarra hosts the full papers, PDFs, licenses, and
            publication records.
          </p>
        </div>

        {papers.map((paper) => (
          <article className="panel research-paper" key={paper.number}>
            <header>
              <div className="research-paper-meta">
                <span>Paper {paper.number}</span>
                <span>Invarra Research · June 28, 2026</span>
              </div>
              <h3>{paper.title}</h3>
              <p className="research-paper-subtitle">{paper.subtitle}</p>
            </header>
            <div className="research-paper-body">
              <section aria-label={`${paper.title} summary`}>
                <h4>Research principle</h4>
                <p>{paper.summary}</p>
              </section>
              <section aria-label={`${paper.title} relationship to Thurstone`}>
                <h4>Why it matters to Thurstone</h4>
                <p>{paper.thurstone}</p>
              </section>
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
          </article>
        ))}
      </section>

      <aside className="panel phalanx-bridge" aria-labelledby="phalanx-bridge-title">
        <div>
          <p className="eyebrow">Sibling product</p>
          <h2 id="phalanx-bridge-title">Thurstone tests. Phalanx governs.</h2>
          <p>
            Thurstone measures whether behavior matched a declared contract. Phalanx controls which
            instructions may influence protected AI actions at runtime.
          </p>
        </div>
        <a
          className="button button-secondary"
          href="https://invarra.ai/phalanx"
          target="_blank"
          rel="noreferrer"
        >
          Explore Phalanx
        </a>
      </aside>
    </div>
  );
}
