"use client";

export function ProbeSessionBlocked() {
  return (
    <section className="panel probe-runner-panel" aria-labelledby="probe-blocked-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 2 · locked recovery surface</span>
          <h2 id="probe-blocked-title">The isolated session could not be verified.</h2>
        </div>
        <span className="status-pill status-blocked">Locked</span>
      </div>
      <p>
        Normal Lab controls remain unavailable while a Probe session cookie exists. Retry after a
        transient control-plane failure, or deliberately clear the local session without changing
        the durable provider guard.
      </p>
      <div className="button-row">
        <button className="button button-primary" onClick={() => globalThis.location.reload()}>
          Retry isolated session verification
        </button>
      </div>
      <small>
        Session cleanup remains locked until the server can prove that no calibration grant is in
        flight.
      </small>
    </section>
  );
}
