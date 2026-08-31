import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimulationNotice } from "@/components/simulation-notice";
import { SiteHeader } from "@/components/site-header";
import { RuntimeStatus } from "@/components/ui/runtime-status";
import { SignalFlow } from "@/components/ui/signal-flow";
import { VerdictCard } from "@/components/ui/verdict-card";

vi.mock("next/navigation", () => ({ usePathname: () => "/results" }));

afterEach(cleanup);

describe("Thurstone judge frontend primitives", () => {
  it("presents the three-item judge navigation without exposing expert routes", () => {
    const { container } = render(SiteHeader({}));

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.textContent)).toEqual(["Demo", "Results", "Research"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/demo",
      "/results",
      "/research"
    ]);
    expect(within(navigation).getByRole("link", { name: "Results" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(navigation).getByRole("link", { name: "Demo" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(container.querySelector(".brand-mark img")).toHaveAttribute(
      "src",
      expect.stringContaining("thurstone-mark.png")
    );
    expect(within(navigation).queryByText("Studio")).not.toBeInTheDocument();
    expect(within(navigation).queryByText("Integrity")).not.toBeInTheDocument();
  });

  it("keeps isolated documents free of ordinary navigation", () => {
    render(SiteHeader({ isolated: true }));
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Isolated calibration")).toBeVisible();
  });

  it("uses a neutral synthetic-commerce disclosure", () => {
    render(SimulationNotice());
    const notice = screen.getByLabelText("Simulation notice");
    expect(notice).toHaveTextContent("Synthetic checkout. No purchase occurs.");
    expect(notice).toHaveTextContent("No payment, shipment, or external transaction is possible.");
    expect(notice).toHaveTextContent("No payment, shipment, or external transaction is possible.");
  });

  it("exposes runtime and verdict meaning as text rather than color alone", () => {
    render(RuntimeStatus({ state: "blocked" }));
    render(
      VerdictCard({
        verdict: "fail",
        title: "A declared invariant changed.",
        children: "The trusted state did not match the contract."
      })
    );

    expect(screen.getByRole("status")).toHaveTextContent("Setup needed");
    expect(screen.getByRole("article", { name: /Issue found:/u })).toHaveTextContent("Issue found");
  });

  it("renders an ordered, expandable five-stage verification flow", () => {
    const stages = ["Contract", "Decision", "Execution", "State", "Receipt"].map((title) => ({
      title,
      summary: `${title} summary`,
      detail: `${title} detail`
    }));
    render(SignalFlow({ stages }));

    const flow = screen.getByRole("list", { name: "Thurstone verification flow" });
    expect(within(flow).getAllByRole("listitem")).toHaveLength(5);
    expect(within(flow).getAllByText("What this means")).toHaveLength(5);
  });
});
