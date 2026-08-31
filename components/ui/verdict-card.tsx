export type VerdictCardState = "pass" | "fail" | "incomplete" | "unavailable";

const labels: Readonly<Record<VerdictCardState, string>> = Object.freeze({
  pass: "Pass",
  fail: "Issue found",
  incomplete: "Incomplete",
  unavailable: "Unavailable"
});

export function VerdictCard({
  verdict,
  title,
  children
}: {
  readonly verdict: VerdictCardState;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <article
      className="verdict-card"
      data-verdict={verdict}
      aria-label={`${labels[verdict]}: ${title}`}
    >
      <span className="eyebrow">{labels[verdict]}</span>
      <h3>{title}</h3>
      {children}
    </article>
  );
}
