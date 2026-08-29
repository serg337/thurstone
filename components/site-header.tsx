/* eslint-disable @next/next/no-html-link-for-pages -- Trust-surface links intentionally force a new top-level document. */

import { PRODUCT_NAME } from "@/lib/brand";

const navigation = [
  { href: "/studio", label: "Studio" },
  { href: "/lab", label: "Lab" },
  { href: "/results", label: "Results" }
];

export function SiteHeader({ isolated = false }: { readonly isolated?: boolean }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="/" aria-label={`${PRODUCT_NAME} home`}>
          <span className="brand-mark" aria-hidden="true">
            TH
          </span>
          <span>
            <strong>{PRODUCT_NAME}</strong>
            <small>by Invarra</small>
          </span>
        </a>
        {isolated ? (
          <span className="fixture-id">Isolated calibration</span>
        ) : (
          <nav aria-label="Primary navigation">
            {navigation.map(({ href, label }) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
