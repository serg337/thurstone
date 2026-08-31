import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { SimulationNotice } from "@/components/simulation-notice";
import { SiteHeader } from "@/components/site-header";
import { PRODUCT_BYLINE, PRODUCT_NAME, PRODUCT_ORIGIN } from "@/lib/brand";
import { PROBE_RESULTS_COOKIE, PROBE_SESSION_COOKIE } from "@/lib/probe/session";
import { SCORED_RESULTS_COOKIE, SCORED_SESSION_COOKIE } from "@/lib/scored/session.server";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT_ORIGIN),
  title: {
    default: `${PRODUCT_NAME} — semantic testing for WebMCP`,
    template: `%s · ${PRODUCT_NAME}`
  },
  description: `${PRODUCT_NAME} verifies whether AI agents choose the intended WebMCP tools, use safe arguments, and produce the site-defined effects.`,
  alternates: { canonical: "/" },
  applicationName: PRODUCT_NAME,
  authors: [{ name: "Sergio Valencia" }],
  openGraph: {
    type: "website",
    title: `${PRODUCT_NAME} — semantic testing for WebMCP`,
    description: `${PRODUCT_NAME} verifies whether AI agents choose the intended WebMCP tools, use safe arguments, and produce the site-defined effects.`,
    url: PRODUCT_ORIGIN,
    images: [
      {
        url: "/thurstone-og.png",
        width: 1200,
        height: 630,
        alt: `${PRODUCT_NAME} semantic judge for WebMCP`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — semantic testing for WebMCP`,
    description: `${PRODUCT_NAME} verifies whether AI agents choose the intended WebMCP tools, use safe arguments, and produce the site-defined effects.`,
    images: ["/thurstone-og.png"]
  }
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#02070a"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const isolated =
    (cookieStore.has(PROBE_SESSION_COOKIE) && !cookieStore.has(PROBE_RESULTS_COOKIE)) ||
    (cookieStore.has(SCORED_SESSION_COOKIE) && !cookieStore.has(SCORED_RESULTS_COOKIE));
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader isolated={isolated} />
        <SimulationNotice />
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <span>{PRODUCT_BYLINE}</span>
          <span>WebMCP is an evolving draft. No affiliation or endorsement is implied.</span>
        </footer>
      </body>
    </html>
  );
}
