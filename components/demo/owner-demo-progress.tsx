const steps = [
  "Understand the test site",
  "Review the agent-visible tools",
  "Build the contract",
  "Review and arm",
  "Ask the agent",
  "Inspect the verdict"
] as const;

export function OwnerDemoProgress({ current }: { readonly current: number }) {
  return (
    <nav className="owner-progress" aria-label="Demo progress">
      <p>
        Step {current} of {steps.length}
      </p>
      <ol>
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <li
              key={label}
              data-state={number === current ? "current" : number < current ? "complete" : "next"}
              aria-current={number === current ? "step" : undefined}
            >
              <span aria-hidden="true">{number < current ? "✓" : number}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
