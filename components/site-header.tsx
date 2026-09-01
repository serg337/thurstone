/* eslint-disable @next/next/no-html-link-for-pages -- Trust-surface links intentionally force a new top-level document. */

"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();
  const liveTestSurface = pathname === "/demo/handoff" || pathname === "/demo/run";
  const hideNavigation = isolated || liveTestSurface;
  const brandContent = (
    <>
      <BrandMark />
      <span className="brand-type">
        <strong aria-hidden="true">
          <span>THUR</span>
          <span className="brand-stone">STONE</span>
        </strong>
        <small>BY INVARRA</small>
      </span>
    </>
  );

  return (
    <header className="site-header">
      <div className="header-inner">
        {hideNavigation ? (
          <span className="brand" aria-label={`${PRODUCT_NAME} isolated test`}>
            {brandContent}
          </span>
        ) : (
          <a className="brand" href="/" aria-label={`${PRODUCT_NAME} home`}>
            {brandContent}
          </a>
        )}
        {hideNavigation ? (
          <span className="fixture-id">
            {liveTestSurface ? "Isolated live test" : "Isolated calibration"}
          </span>
        ) : (
          <PrimaryNavigation />
        )}
      </div>
    </header>
  );
}
