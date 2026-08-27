import Link from "next/link";

const navigation = [
  { href: "/studio", label: "Studio" },
  { href: "/lab", label: "Lab" },
  { href: "/results", label: "Results" }
];

export function SiteHeader({ isolated = false }: { readonly isolated?: boolean }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="ToolProof home">
          <span className="brand-mark" aria-hidden="true">
            TP
          </span>
          <span>
            <strong>ToolProof</strong>
            <small>by Invarra</small>
          </span>
        </Link>
        {isolated ? (
          <span className="fixture-id">Isolated calibration</span>
        ) : (
          <nav aria-label="Primary navigation">
            {navigation.map(({ href, label }) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
