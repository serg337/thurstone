/* eslint-disable @next/next/no-html-link-for-pages -- Trust-surface links intentionally force a new top-level document. */

import { PRODUCT_NAME } from "@/lib/brand";

const navigation = [
  { href: "/", label: "Intro" },
  // The dedicated /demo route is introduced in F3. Until then this label opens the existing
  // complete live demonstration surface rather than linking to an unfinished document.
  { href: "/lab", label: "Demo" },
  { href: "/results", label: "Results" }
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" role="presentation">
        <path d="M12 17v-4.5a8 8 0 0 1 16 0V17" />
        <path d="M9 17.5h22v17H9z" />
        <path d="m14.5 25.5 3.7 3.7 7.8-8" />
      </svg>
    </span>
  );
}

export function SiteHeader({ isolated = false }: { readonly isolated?: boolean }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="/" aria-label={`${PRODUCT_NAME} home`}>
          <BrandMark />
          <span className="brand-type">
            <strong aria-hidden="true">
              <span>THUR</span>
              <span className="brand-stone">STONE</span>
            </strong>
            <small>BY INVARRA</small>
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
