import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ReferenceToolCatalog } from "@/components/demo/reference-tool-catalog";
import {
  createThurstoneDemoCatalogSnapshot,
  type ThurstoneDemoCatalogSnapshotV1
} from "@/lib/demo/catalog-snapshot";
import type { ThurstoneDemoSelectableToolName } from "@/lib/demo/reference-tool-templates";

afterEach(cleanup);

function Harness({
  initial,
  referencedToolNames = []
}: {
  readonly initial?: ThurstoneDemoCatalogSnapshotV1;
  readonly referencedToolNames?: readonly ThurstoneDemoSelectableToolName[];
}) {
  const [snapshot, setSnapshot] = useState(initial ?? createThurstoneDemoCatalogSnapshot());
  return createElement(ReferenceToolCatalog, {
    snapshot,
    referencedToolNames,
    onChange: setSnapshot
  });
}

describe("ReferenceToolCatalog", () => {
  it("starts with the real default pair and adds only bounded real tools", async () => {
    const user = userEvent.setup();
    render(createElement(Harness));

    expect(screen.getByText("2 real tools selected")).toBeVisible();
    expect(screen.getByText("2 discoverable tools")).toBeVisible();
    expect(screen.getAllByText("order_review", { exact: true }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("checkout_request", { exact: true }).length).toBeGreaterThanOrEqual(
      2
    );
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "Remove" })) {
      expect(button).toBeDisabled();
    }

    await user.click(screen.getByRole("button", { name: /Add cart_get/u }));
    expect(screen.getByText("3 real tools selected")).toBeVisible();
    expect(screen.getByText("3 discoverable tools")).toBeVisible();
    expect(screen.getAllByText("cart_get", { exact: true }).length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole("button", { name: /Add cart_update/u }));
    expect(screen.getByText("4 real tools selected")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add cart_/u })).not.toBeInTheDocument();
    expect(screen.getByText("checkout_cancel", { exact: true })).toBeVisible();
    expect(screen.getByText(/is real but advanced/iu)).toBeVisible();
  });

  it("updates only agent-visible wording and keeps fixed executable identity visible", async () => {
    const user = userEvent.setup();
    render(createElement(Harness));

    const reviewRow = document.querySelector('[data-tool-name="order_review"]');
    expect(reviewRow).not.toBeNull();
    const title = within(reviewRow as HTMLElement).getByLabelText(/Agent-visible title/iu);
    await user.clear(title);
    await user.type(title, "Inspect the order");
    await user.click(
      within(reviewRow as HTMLElement).getByRole("button", { name: "Apply agent wording" })
    );

    const preview = screen
      .getByRole("heading", { name: "What the agent receives" })
      .closest("section");
    expect(preview).not.toBeNull();
    expect(within(preview as HTMLElement).getByText("Inspect the order")).toBeVisible();
    expect(within(reviewRow as HTMLElement).getByText("order_review@1.0.0")).toBeVisible();
    expect(
      within(reviewRow as HTMLElement).getAllByText(/additionalProperties/iu).length
    ).toBeGreaterThanOrEqual(1);

    await user.click(
      within(reviewRow as HTMLElement).getByRole("button", {
        name: "Reset to verified default"
      })
    );
    expect(title).toHaveValue("Review order summary");
  });

  it("blocks removing a tool referenced by an existing case", () => {
    render(
      createElement(Harness, {
        initial: createThurstoneDemoCatalogSnapshot({
          selectedToolNames: ["cart_get", "order_review", "checkout_request"]
        }),
        referencedToolNames: ["cart_get"]
      })
    );

    const row = document.querySelector('[data-tool-name="cart_get"]');
    const remove = within(row as HTMLElement).getByRole("button", { name: "Remove" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", expect.stringMatching(/Reassign or delete/iu));
  });
});
