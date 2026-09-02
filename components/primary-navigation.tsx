"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  OWNER_JOURNEY_REPORT_CHANGE_EVENT,
  OWNER_JOURNEY_REPORT_STORAGE_KEY
} from "@/lib/demo/owner-journey-report-marker";

export const PRIMARY_NAVIGATION = Object.freeze([
  { href: "/demo", label: "Demo" },
  { href: "/workflow", label: "Workflow" },
  { href: "/research", label: "Research" }
] as const);

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation() {
  const pathname = usePathname();
  const [latestResultsAvailable, setLatestResultsAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) {
        setLatestResultsAvailable(
          window.sessionStorage.getItem(OWNER_JOURNEY_REPORT_STORAGE_KEY) !== null
        );
      }
    };
    window.addEventListener(OWNER_JOURNEY_REPORT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    refresh();
    return () => {
      active = false;
      window.removeEventListener(OWNER_JOURNEY_REPORT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const links = latestResultsAvailable
    ? [
        PRIMARY_NAVIGATION[0],
        { href: "/results", label: "Latest Results" } as const,
        ...PRIMARY_NAVIGATION.slice(1)
      ]
    : PRIMARY_NAVIGATION;

  return (
    <nav aria-label="Primary navigation">
      {links.map(({ href, label }) => {
        const current = isCurrentPath(pathname, href);
        return (
          <a href={href} key={href} aria-current={current ? "page" : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
