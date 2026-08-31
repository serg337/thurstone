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
    equations: ["r = g(Φ, c, ε)", "Observe B(r); evaluate the latent target"],
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
    equations: ["p = π(s, c)", "p₁ ≡sem p₂ for valid realizations"],
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
            Thurstone is built on a simple discipline: define what meaning must remain stable,
            control how that meaning is represented, then measure what the live system actually
            does.
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
          <h2 id="research-method-title">Two papers. One inspectable testing discipline.</h2>
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
          <h2 id="research-papers-title">Read the papers at their canonical source.</h2>
          <p>
            Thurstone provides the product connection below. Invarra remains the authoritative home
            for the complete papers, publication records, license, and PDF downloads.
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
              <div className="research-equations" aria-label={`${paper.title} notation`}>
                {paper.equations.map((equation) => (
                  <code key={equation}>{equation}</code>
                ))}
              </div>
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
          <p className="eyebrow">Sibling product · a different boundary</p>
          <h2 id="phalanx-bridge-title">From measurement to enforcement.</h2>
          <p>
            Thurstone tests whether agent behavior matches a declared WebMCP contract. Phalanx
            governs which written instructions may control protected LLM outputs and actions at
            runtime. Different products, one evidence discipline.
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

      <section className="research-boundary" aria-labelledby="research-boundary-title">
        <p className="eyebrow">Public research boundary</p>
        <h2 id="research-boundary-title">
          Principles are public. Operational test machinery is not.
        </h2>
        <p>
          The papers explain the measurement argument. They do not publish private corpus methods,
          admission procedures, transformation libraries, scoring logic, thresholds, or
          client-specific protocols. Thurstone&apos;s public demo remains a bounded synthetic
          reference environment.
        </p>
      </section>
    </div>
  );
}
