export function SimulationNotice() {
  return (
    <aside className="simulation-notice" aria-label="Simulation and model data notice">
      <strong>Synthetic checkout. No purchase occurs.</strong>
      <span>
        No payment, shipment, or external transaction is possible. When a model-backed lane is
        enabled, synthetic prompts may be sent to the disclosed provider.
      </span>
    </aside>
  );
}
