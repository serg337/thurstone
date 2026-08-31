export type RuntimeStatusState = "checking" | "ready" | "blocked";

const defaultLabels: Readonly<Record<RuntimeStatusState, string>> = Object.freeze({
  checking: "Checking WebMCP",
  ready: "WebMCP ready",
  blocked: "Setup needed"
});

export function RuntimeStatus({
  state,
  children
}: {
  readonly state: RuntimeStatusState;
  readonly children?: React.ReactNode;
}) {
  return (
    <span className="runtime-status" data-state={state} role="status">
      {children ?? defaultLabels[state]}
    </span>
  );
}
