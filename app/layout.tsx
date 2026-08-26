import type { Metadata, Viewport } from "next";

import { SimulationNotice } from "@/components/simulation-notice";
import { SiteHeader } from "@/components/site-header";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
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
