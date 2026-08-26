import type { Metadata } from "next";

import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Studio" };

const contractFields = [
  "Approved intent and meaning held fixed",
  "Required tool or clarification outcome",
  "Canonical arguments and effect predicates",
  "Allowed and forbidden state changes",
  "Fixture, subset, and human review receipt"
];

export default function StudioPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Studio · authoring trust surface</p>
          <h1>Declare the contract before seeing outcomes.</h1>
          <p>
            An authoring agent can draft. A human remains the semantic authority for every identity,
            boundary, argument, effect, and revision.
          </p>
        </div>
        <StatusPill state="pending">Authoring tools pending Gate 3</StatusPill>
      </header>

      <div className="studio-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Contract anatomy</span>
              <h2>Human-approved meaning</h2>
            </div>
          </div>
          <ul className="check-list">
            {contractFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </section>

        <section className="panel phase-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Phase isolation</span>
              <h2>Who can see what</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>Authoring Builder</dt>
              <dd>Manifest and candidate suite before freeze</dd>
            </div>
            <div>
              <dt>Human reviewer</dt>
              <dd>Every semantic label and approval boundary</dd>
            </div>
            <div>
              <dt>Probe</dt>
              <dd>One blinded request and live target catalog per trial</dd>
            </div>
            <div>
              <dt>Repair Builder</dt>
              <dd>Development evidence only, after terminal baseline</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
