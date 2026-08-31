export interface SignalFlowStage {
  readonly title: string;
  readonly summary: string;
  readonly detail: string;
}

export function SignalFlow({
  stages,
  label = "Thurstone verification flow"
}: {
  readonly stages: readonly SignalFlowStage[];
  readonly label?: string;
}) {
  return (
    <ol className="signal-flow" aria-label={label}>
      {stages.map((stage, index) => (
        <li key={stage.title}>
          <span className="eyebrow">{String(index + 1).padStart(2, "0")}</span>
          <strong>{stage.title}</strong>
          <p>{stage.summary}</p>
          <details>
            <summary>What this means</summary>
            <p>{stage.detail}</p>
          </details>
        </li>
      ))}
    </ol>
  );
}
