const steps = [
  "Understand the semantic boundary",
  "Choose the real WebMCP test catalog",
  "Build the contract suite",
  "Send the selected case to a fresh agent",
  "Inspect, diagnose, and preserve"
] as const;

export function OwnerDemoProgress({ current }: { readonly current: number }) {
  const primaryStage = current === 4 ? 3 : Math.min(current, steps.length);
  const progressLabel =
    current === 4
      ? `Stage ${primaryStage} of ${steps.length} · Review and arm selected case`
      : `Stage ${primaryStage} of ${steps.length}`;

  return (
    <nav className="owner-progress" aria-label="Demo progress">
      <p>{progressLabel}</p>
      <ol>
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <li
              key={label}
              data-state={
                number === primaryStage ? "current" : number < primaryStage ? "complete" : "next"
              }
              aria-current={number === primaryStage ? "step" : undefined}
            >
              <span aria-hidden="true">{number < primaryStage ? "✓" : number}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
