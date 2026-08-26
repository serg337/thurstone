interface StatusPillProps {
  readonly state: "ready" | "pending" | "blocked" | "neutral";
  readonly children: React.ReactNode;
}

export function StatusPill({ state, children }: StatusPillProps) {
  return <span className={`status-pill status-${state}`}>{children}</span>;
}
