import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { SimulationNotice } from "@/components/simulation-notice";
import { SiteHeader } from "@/components/site-header";
import { PROBE_RESULTS_COOKIE, PROBE_SESSION_COOKIE } from "@/lib/probe/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ToolProof — unit tests for WebMCP meaning",
    template: "%s · ToolProof"
  },
  description:
    "ToolProof tests whether WebMCP tool behavior follows human-approved meaning rather than superficial wording.",
  applicationName: "ToolProof",
  authors: [{ name: "Sergio Valencia" }]
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b1020"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const isolated = cookieStore.has(PROBE_SESSION_COOKIE) && !cookieStore.has(PROBE_RESULTS_COOKIE);
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
          <span>ToolProof by Invarra — created by Sergio Valencia.</span>
          <span>WebMCP is an evolving draft. No affiliation or endorsement is implied.</span>
        </footer>
      </body>
    </html>
  );
}
