/* eslint-disable @next/next/no-html-link-for-pages -- Trust-surface links intentionally force a new top-level document. */

import Image from "next/image";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { PRODUCT_NAME } from "@/lib/brand";

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image src="/thurstone-mark.png" alt="" width={256} height={256} priority sizes="52px" />
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
          <PrimaryNavigation />
        )}
      </div>
    </header>
  );
}
