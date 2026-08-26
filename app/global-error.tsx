"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="page-shell error-page" role="alert">
          <p className="eyebrow">Application error</p>
          <h1>ToolProof stopped before making an uncertain claim.</h1>
          <p>Simulated checkout only. No purchase or external transaction can occur.</p>
          <button className="button button-primary" onClick={reset}>
            Reload application
          </button>
        </main>
      </body>
    </html>
  );
}
