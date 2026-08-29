import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-shell error-page">
      <p className="eyebrow">404</p>
      <h1>This Thurstone route does not exist.</h1>
      <p>No tool or evidence action was attempted.</p>
      <Link className="button button-primary" href="/">
        Return home
      </Link>
    </div>
  );
}
