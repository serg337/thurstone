import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContractSuiteBuilder,
  type ContractSuiteArmSelection
} from "@/components/demo/contract-suite-builder";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseInput,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";

afterEach(cleanup);

const suiteId = "suite_11111111-1111-4111-8111-111111111111";
const reviewCaseId = "case_22222222-2222-4222-8222-222222222222";
const checkoutCaseId = "case_33333333-3333-4333-8333-333333333333";

const reviewCase: ThurstoneContractCaseInput = {
  name: "Review order",
  request: "Show me the complete order.",
  expectedTool: "order_review",
  argumentPredicate: { kind: "empty" },
  allowedEffects: [],
  forbiddenEffects: [
    { kind: "cart_mutation" },
    { kind: "pending_checkout" },
    { kind: "unmodeled_state" }
  ],
  replayPolicy: "read_only",
  approvalClass: "read_only"
};

const checkoutCase: ThurstoneContractCaseInput = {
  name: "Request checkout",
  request: "I am ready—request checkout for this cart.",
  expectedTool: "checkout_request",
  argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
  allowedEffects: [{ kind: "pending_checkout" }],
  forbiddenEffects: [
    { kind: "cart_mutation" },
    { kind: "duplicate_transition" },
    { kind: "unmodeled_state" }
  ],
  replayPolicy: "exactly_once",
  approvalClass: "consequential"
};

async function emptySuite(allTools = false): Promise<ThurstoneContractSuiteV1> {
  return createThurstoneContractSuite({
    suiteId,
    name: "Checkout meaning",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot(
      allTools
        ? { selectedToolNames: ["cart_get", "cart_update", "order_review", "checkout_request"] }
        : undefined
    ),
    createdAt: "2026-09-01T08:00:00.000Z"
  });
}

async function suiteWithTwoCases(): Promise<ThurstoneContractSuiteV1> {
  let suite = await emptySuite();
  suite = addContractSuiteCase(suite, reviewCase, {
    caseId: reviewCaseId,
    updatedAt: "2026-09-01T08:00:01.000Z"
  });
  suite = addContractSuiteCase(suite, checkoutCase, {
    caseId: checkoutCaseId,
    updatedAt: "2026-09-01T08:00:02.000Z"
  });
  return selectContractSuiteCase(suite, checkoutCaseId, {
    updatedAt: "2026-09-01T08:00:03.000Z"
  });
}

function Harness({
  initialSuite,
  onReviewArm = () => undefined
}: {
  readonly initialSuite: ThurstoneContractSuiteV1;
  readonly onReviewArm?: (selection: ContractSuiteArmSelection) => void;
}) {
  const [suite, setSuite] = useState(initialSuite);
  return createElement(ContractSuiteBuilder, {
    suite,
    onChange: setSuite,
    onReviewArm,
    preflight: {
      buildCommit: "a".repeat(40),
      cleanFixture: "ready",
      catalog: "ready",
      answerKeyIsolation: "ready"
    }
  });
}

async function fillCase(
  user: ReturnType<typeof userEvent.setup>,
  input: { readonly name: string; readonly request: string; readonly tool: string }
) {
  const starters = screen.queryByRole("region", { name: "Start with a curated Demo case." });
  const starter = starters
    ? within(starters).queryByRole("button", { name: new RegExp(input.tool, "u") })
    : null;
  if (starter) await user.click(starter);
  else {
    const group = screen.getByRole("region", { name: `${input.tool} test group` });
    await user.click(within(group).getByRole("button", { name: "+ Add requests" }));
  }
  await user.clear(screen.getByLabelText("Test-case name"));
  await user.clear(screen.getByLabelText("Request 1"));
  await user.type(screen.getByLabelText("Test-case name"), input.name);
  await user.type(screen.getByLabelText("Request 1"), input.request);
}

describe("ContractSuiteBuilder", () => {
  it("turns Stage 2 selections into reviewable Demo starter drafts", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await emptySuite() }));

    const starters = screen.getByRole("region", { name: "Start with a curated Demo case." });
    expect(within(starters).getAllByRole("button")).toHaveLength(2);
    await user.click(within(starters).getByRole("button", { name: /order_review/u }));
    expect(screen.getByLabelText("Test-case name")).toHaveValue("Review complete order");
    expect(screen.getByLabelText("Request 1")).toHaveValue("Show me the complete order.");
    expect(screen.getByLabelText("Contract rules derived from this tool")).toHaveTextContent(
      "Call order_review"
    );
    expect(screen.getByText("Read-only policy")).toBeVisible();

    const singleToolSuite = await createThurstoneContractSuite({
      suiteId: "suite_44444444-4444-4444-8444-444444444444",
      name: "Single checkout tool",
      catalogSnapshot: createThurstoneDemoCatalogSnapshot({
        selectedToolNames: ["checkout_request"]
      }),
      createdAt: "2026-09-01T08:10:00.000Z"
    });
    cleanup();
    render(createElement(Harness, { initialSuite: singleToolSuite }));
    expect(screen.getByLabelText("Test-case name")).toHaveValue("Begin checkout");
    expect(screen.getByLabelText("Request 1")).toHaveValue(
      "I am ready—request checkout for this cart."
    );
    expect(screen.getByLabelText("Contract rules derived from this tool")).toHaveTextContent(
      "Call checkout_request"
    );
    expect(screen.getByText(/Generated automatically at runtime/iu)).toBeVisible();
  });

  it("groups multiple representative requests under one expected action", async () => {
    const user = userEvent.setup();
    const singleToolSuite = await createThurstoneContractSuite({
      suiteId: "suite_55555555-5555-4555-8555-555555555555",
      name: "Checkout variants",
      catalogSnapshot: createThurstoneDemoCatalogSnapshot({
        selectedToolNames: ["checkout_request"]
      }),
      createdAt: "2026-09-01T08:20:00.000Z"
    });
    render(createElement(Harness, { initialSuite: singleToolSuite }));

    await user.click(screen.getByRole("button", { name: /Add request/u }));
    await user.type(screen.getByLabelText("Request 2"), "Proceed to checkout.");
    await user.click(screen.getByRole("button", { name: /Add request/u }));
    await user.type(screen.getByLabelText("Request 3"), "Start checkout for this cart.");
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    const group = screen.getByRole("region", { name: "checkout_request test group" });
    expect(within(group).getByText("3 request cases")).toBeVisible();
    expect(within(group).getAllByRole("article")).toHaveLength(3);
    expect(within(group).getByText("“Proceed to checkout.”")).toBeVisible();
    expect(within(group).getByText("“Start checkout for this cart.”")).toBeVisible();
    expect(screen.getByText("All selected tools are represented in this contract.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add test case" })).not.toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "+ Add requests" }));
    expect(screen.getByRole("button", { name: "Add test case" })).toBeVisible();
  });

  it("generates independent schema arguments for every cart_update request", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await emptySuite(true) }));
    const starters = screen.getByRole("region", { name: "Start with a curated Demo case." });
    await user.click(within(starters).getByRole("button", { name: /cart_update/u }));
    await user.click(screen.getByRole("button", { name: /Add request/u }));
    await user.type(screen.getByLabelText("Request 2"), "Remove the notebook from my cart.");
    const items = screen.getAllByLabelText(/^Item ID/iu);
    const quantities = screen.getAllByLabelText(/^Quantity/iu);
    expect(items).toHaveLength(2);
    expect(quantities).toHaveLength(2);
    await user.selectOptions(items[1]!, "field-notebook");
    await user.clear(quantities[1]!);
    await user.type(quantities[1]!, "0");
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    const group = screen.getByRole("region", { name: "cart_update test group" });
    expect(within(group).getAllByRole("article")).toHaveLength(2);
    expect(within(group).getByText(/Set stoneware-mug to 3/iu)).toBeVisible();
    expect(within(group).getByText(/Set field-notebook to 0/iu)).toBeVisible();
  });

  it("builds a visible multi-case suite and clears only the case editor after add", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await emptySuite() }));

    await fillCase(user, {
      name: "Review order",
      request: "Show me the complete order.",
      tool: "order_review"
    });
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    expect(screen.getByRole("heading", { name: "Review order" })).toBeVisible();
    expect(screen.getByLabelText("Test-case name")).toHaveValue("");
    expect(screen.getByLabelText("Request 1")).toHaveValue("");
    expect(screen.getByLabelText("Contract-suite name")).toHaveValue("Checkout meaning");
    expect(screen.getByText(/Added 1 request case for Review order/u)).toBeInTheDocument();

    await fillCase(user, {
      name: "Explicit checkout",
      request: "I am ready—request checkout for this cart.",
      tool: "checkout_request"
    });
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    expect(screen.getByRole("heading", { name: "Review order" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Explicit checkout" })).toBeVisible();
    expect(screen.queryByText("2 cases")).not.toBeInTheDocument();
    const checkoutCard = screen
      .getByRole("heading", { name: "Explicit checkout" })
      .closest("article");
    expect(checkoutCard).not.toBeNull();
    expect(within(checkoutCard as HTMLElement).getByText("checkout_request")).toBeVisible();
    expect(
      within(checkoutCard as HTMLElement).getByText(/Generated automatically at runtime/u)
    ).toBeVisible();
  });

  it("renders arguments from the selected real tool and reports strict duplicate errors", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await emptySuite(true) }));

    const starters = screen.getByRole("region", { name: "Start with a curated Demo case." });
    for (const tool of ["cart_get", "cart_update", "order_review", "checkout_request"]) {
      expect(within(starters).getByRole("button", { name: new RegExp(tool, "u") })).toBeVisible();
    }

    await fillCase(user, {
      name: "Update mugs",
      request: "Set the stoneware mug quantity to three.",
      tool: "cart_update"
    });
    expect(screen.getByRole("group", { name: /Expected arguments/u })).toBeVisible();
    expect(screen.getByLabelText(/^Item ID/iu)).toHaveValue("stoneware-mug");
    expect(screen.getByLabelText(/^Quantity/iu)).toHaveValue(3);
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    const card = screen.getByRole("heading", { name: "Update mugs" }).closest("article");
    expect(within(card as HTMLElement).getByText(/Set stoneware-mug to 3/u)).toBeVisible();

    await fillCase(user, {
      name: "Same meaning, different label",
      request: "Set the stoneware mug quantity to three.",
      tool: "cart_update"
    });
    await user.click(screen.getByRole("button", { name: "Add test case" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "An exact request, action, and argument case already exists"
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("supports deterministic edit, remove, and an honest empty state", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await suiteWithTwoCases() }));

    const reviewCard = screen
      .getByRole("heading", { name: "Review order" })
      .closest("article") as HTMLElement;
    const checkoutCard = screen
      .getByRole("heading", { name: "Request checkout" })
      .closest("article") as HTMLElement;
    await user.click(within(reviewCard).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Test-case name"));
    await user.type(screen.getByLabelText("Test-case name"), "Read final order");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("heading", { name: "Read final order" })).toBeVisible();

    await user.click(within(checkoutCard).getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("heading", { name: "Request checkout" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 request case remains/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run contract · 1 requests" })).toBeEnabled();

    const remainingCard = screen
      .getByRole("heading", { name: "Read final order" })
      .closest("article") as HTMLElement;
    await user.click(within(remainingCard).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No test cases yet.")).toBeVisible();
    expect(screen.getByText(/suite is now empty/u)).toBeInTheDocument();
  });

  it("reviews the queued suite in an accessible answer-key-isolated arm dialog", async () => {
    const user = userEvent.setup();
    const onReviewArm = vi.fn<(selection: ContractSuiteArmSelection) => void>();
    render(
      createElement(Harness, {
        initialSuite: await suiteWithTwoCases(),
        onReviewArm
      })
    );

    await user.click(screen.getByRole("button", { name: "Run contract · 2 requests" }));
    const dialog = screen.getByRole("dialog", { name: "Arm 2-request suite" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText("Withheld until verification")).toBeVisible();
    const runOrder = within(dialog)
      .getByRole("heading", { name: "Run order" })
      .closest("section") as HTMLElement;
    expect(within(runOrder).getByText(reviewCase.request)).toBeVisible();
    expect(within(runOrder).getAllByRole("listitem")).toHaveLength(2);
    expect(within(runOrder).queryByText("Allowed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close review" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run contract · 2 requests" }));
    await user.click(screen.getByRole("button", { name: "Arm regression suite" }));
    expect(onReviewArm).toHaveBeenCalledTimes(1);
    expect(onReviewArm.mock.calls[0]?.[0].selectedCase.caseId).toBe(reviewCaseId);
    expect(onReviewArm.mock.calls[0]?.[0].suite.cases).toHaveLength(2);
    expect(onReviewArm.mock.calls[0]?.[0].mode).toBe("regression");
    expect(onReviewArm.mock.calls[0]?.[0].orderedCases).toHaveLength(2);
  });
});
