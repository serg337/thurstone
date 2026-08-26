export function SimulationNotice() {
  return (
    <aside className="simulation-notice" aria-label="Simulation and model data notice">
      <strong>Simulated checkout — no purchase occurs.</strong>
      <span>
        No payment or external transaction is possible. When the model-backed lane is enabled,
        synthetic prompts may be sent to the disclosed provider.
      </span>
    </aside>
  );
}
