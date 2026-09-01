"use client";

import { usePathname } from "next/navigation";

export const PRIMARY_NAVIGATION = Object.freeze([
  { href: "/demo", label: "Demo" },
  { href: "/results", label: "Results" },
  { href: "/workflow", label: "Workflow" },
  { href: "/research", label: "Research" }
] as const);

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation">
      {PRIMARY_NAVIGATION.map(({ href, label }) => {
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
