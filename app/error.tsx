"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Thurstone route error", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <div className="page-shell error-page" role="alert">
      <p className="eyebrow">Route error</p>
      <h1>This view could not be rendered safely.</h1>
      <p>
        No tool action was inferred or retried. You can retry the view or reset the Lab fixture.
      </p>
      <button className="button button-primary" onClick={reset}>
        Retry view
      </button>
    </div>
  );
}
