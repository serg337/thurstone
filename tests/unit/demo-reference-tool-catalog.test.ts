import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  const [snapshot, setSnapshot] = useState(
    initial ?? createThurstoneDemoCatalogSnapshot({ selectedToolNames: [] })
  );
  const [processEndingToolNames, setProcessEndingToolNames] = useState<
    readonly ThurstoneDemoSelectableToolName[]
  >([]);
  return createElement(ReferenceToolCatalog, {
    snapshot,
    referencedToolNames,
    processEndingToolNames,
    onChange: setSnapshot,
    onProcessEndingChange: (toolName, processEnding) =>
      setProcessEndingToolNames((current) =>
        processEnding
          ? [...current, toolName]
          : current.filter((candidate) => candidate !== toolName)
      )
  });
}

describe("ReferenceToolCatalog", () => {
  it("starts empty and selects only bounded real tools from the four-button library", async () => {
    const user = userEvent.setup();
    render(createElement(Harness));

    expect(screen.getByText("No tools selected yet.")).toBeVisible();
    for (const name of ["cart_get", "cart_update", "order_review", "checkout_request"]) {
      expect(screen.getByRole("button", { name: new RegExp(name, "u") })).toBeVisible();
    }

    await user.click(screen.getByRole("button", { name: /order_review/u }));
    await user.click(screen.getByRole("button", { name: /checkout_request/u }));
    expect(screen.queryByRole("button", { name: /order_review/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /checkout_request/u })).not.toBeInTheDocument();
    expect(document.querySelector('[data-tool-name="order_review"]')).not.toBeNull();
    expect(document.querySelector('[data-tool-name="checkout_request"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /cart_get/u }));
    await user.click(screen.getByRole("button", { name: /cart_update/u }));
    expect(screen.getByText("All available tools selected.")).toBeVisible();
  });

  it("allows the selected catalog to return to an empty draft", async () => {
    const user = userEvent.setup();
    render(createElement(Harness));

    const reviewChoice = screen.getByRole("button", { name: /order_review/u });
    await user.click(reviewChoice);
    expect(screen.queryByRole("button", { name: /order_review/u })).not.toBeInTheDocument();
    const reviewRow = document.querySelector('[data-tool-name="order_review"]');
    expect(reviewRow).not.toBeNull();
    await user.click(within(reviewRow as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: /order_review/u })).toBeVisible();
    expect(screen.getByText("No tools selected yet.")).toBeVisible();
  });

  it("updates only agent-visible wording and keeps fixed executable identity visible", async () => {
    const user = userEvent.setup();
    render(
      createElement(Harness, {
        initial: createThurstoneDemoCatalogSnapshot({ selectedToolNames: ["order_review"] })
      })
    );

    const reviewRow = document.querySelector('[data-tool-name="order_review"]');
    expect(reviewRow).not.toBeNull();
    const title = within(reviewRow as HTMLElement).getByLabelText(/Agent-visible title/iu);
    await user.clear(title);
    await user.type(title, "Inspect the order");
    expect(within(reviewRow as HTMLElement).getByText("Editing…")).toBeVisible();
    await user.tab();

    expect(title).toHaveValue("Inspect the order");
    await waitFor(() => expect(within(reviewRow as HTMLElement).getByText("Saved")).toBeVisible());
    const technical = within(reviewRow as HTMLElement)
      .getByText(/View fixed handler, schema, annotations/iu)
      .closest("details");
    expect(technical).not.toHaveAttribute("open");
    expect(within(reviewRow as HTMLElement).getByText("order_review@1.0.0")).toBeInTheDocument();
    expect(
      within(reviewRow as HTMLElement).getAllByText(/additionalProperties/iu).length
    ).toBeGreaterThanOrEqual(1);

    await user.click(within(reviewRow as HTMLElement).getByRole("button", { name: "Reset" }));
    expect(title).toHaveValue("Review order summary");
  });

  it("defaults to Standard and lets the owner mark a selected tool process-ending", async () => {
    const user = userEvent.setup();
    render(
      createElement(Harness, {
        initial: createThurstoneDemoCatalogSnapshot({
          selectedToolNames: ["checkout_request"]
        })
      })
    );
    const checkoutRow = document.querySelector('[data-tool-name="checkout_request"]');
    expect(checkoutRow).not.toBeNull();
    const checkbox = within(checkoutRow as HTMLElement).getByRole("checkbox", {
      name: "Process-ending"
    });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
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

    expect(screen.queryByRole("button", { name: /cart_get/u })).not.toBeInTheDocument();
    const cartRow = document.querySelector('[data-tool-name="cart_get"]');
    expect(cartRow).not.toBeNull();
    const remove = within(cartRow as HTMLElement).getByRole("button", { name: "Remove" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", expect.stringMatching(/Reassign or delete/iu));
  });
});
