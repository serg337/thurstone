const steps = [
  "Understand the semantic boundary",
  "Choose the real WebMCP test catalog",
  "Build the contract suite",
  "Send the selected case to a fresh agent",
  "Inspect, diagnose, and preserve"
] as const;

interface OwnerDemoProgressProps {
  readonly current: number;
  readonly availableStages?: readonly number[];
  readonly onNavigate?: (stage: 1 | 2 | 3) => void;
}

export function OwnerDemoProgress({
  current,
  availableStages = [],
  onNavigate
}: OwnerDemoProgressProps) {
  const primaryStage = current === 4 ? 3 : Math.min(current, steps.length);

  return (
    <nav className="owner-progress" aria-label="Demo progress">
      <ol>
        {steps.map((label, index) => {
          const number = index + 1;
          const navigable =
            onNavigate !== undefined && number <= 3 && availableStages.includes(number);
          return (
            <li
              key={label}
              data-state={
                number === primaryStage ? "current" : number < primaryStage ? "complete" : "next"
              }
              aria-current={number === primaryStage ? "step" : undefined}
            >
              <button
                type="button"
                disabled={!navigable}
                aria-label={navigable ? `Open stage ${number}` : `Stage ${number} locked`}
                title={label}
                onClick={() => {
                  if (navigable) onNavigate(number as 1 | 2 | 3);
                }}
              >
                <span aria-hidden="true">{number < primaryStage ? "✓" : number}</span>
                <strong>{label}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
