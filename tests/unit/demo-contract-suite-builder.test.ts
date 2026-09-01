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
  await user.type(screen.getByLabelText("Test-case name"), input.name);
  await user.type(screen.getByLabelText("Representative user request"), input.request);
  await user.selectOptions(screen.getByLabelText("What should the agent do?"), input.tool);
}

describe("ContractSuiteBuilder", () => {
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
    expect(screen.getByLabelText("Representative user request")).toHaveValue("");
    expect(screen.getByLabelText("Contract-suite name")).toHaveValue("Checkout meaning");
    expect(screen.getByText(/Added Review order/u)).toBeInTheDocument();

    await fillCase(user, {
      name: "Explicit checkout",
      request: "I am ready—request checkout for this cart.",
      tool: "checkout_request"
    });
    await user.click(screen.getByRole("button", { name: "Add test case" }));

    expect(screen.getByRole("heading", { name: "Review order" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Explicit checkout" })).toBeVisible();
    expect(screen.getByText("2 cases")).toBeVisible();
    const checkoutCard = screen
      .getByRole("heading", { name: "Explicit checkout" })
      .closest("article");
    expect(checkoutCard).not.toBeNull();
    expect(within(checkoutCard as HTMLElement).getByText("checkout_request")).toBeVisible();
    expect(within(checkoutCard as HTMLElement).getByText(/valid and unique/u)).toBeVisible();
  });

  it("renders arguments from the selected real tool and reports strict duplicate errors", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await emptySuite(true) }));

    expect(
      within(screen.getByLabelText("What should the agent do?"))
        .getAllByRole("option")
        .map((option) => option.getAttribute("value"))
    ).toEqual(["", "cart_get", "cart_update", "order_review", "checkout_request"]);

    await fillCase(user, {
      name: "Update mugs",
      request: "Set the stoneware mug quantity to three.",
      tool: "cart_update"
    });
    expect(screen.getByRole("group", { name: /Expected arguments/u })).toBeVisible();
    expect(screen.getByLabelText("Cart item")).toHaveValue("stoneware-mug");
    expect(screen.getByLabelText("Quantity")).toHaveValue(3);
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

  it("supports deterministic edit, remove, selection, and an honest empty state", async () => {
    const user = userEvent.setup();
    render(createElement(Harness, { initialSuite: await suiteWithTwoCases() }));

    const reviewCard = screen
      .getByRole("heading", { name: "Review order" })
      .closest("article") as HTMLElement;
    const checkoutCard = screen
      .getByRole("heading", { name: "Request checkout" })
      .closest("article") as HTMLElement;
    expect(within(checkoutCard).getByRole("radio", { name: "Select for live test" })).toBeChecked();

    await user.click(within(reviewCard).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Test-case name"));
    await user.type(screen.getByLabelText("Test-case name"), "Read final order");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("heading", { name: "Read final order" })).toBeVisible();

    await user.click(within(checkoutCard).getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("heading", { name: "Request checkout" })).not.toBeInTheDocument();
    expect(screen.getByText(/Select another case before arming/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review and arm selected case" })).toBeDisabled();

    const remainingCard = screen
      .getByRole("heading", { name: "Read final order" })
      .closest("article") as HTMLElement;
    await user.click(within(remainingCard).getByRole("radio", { name: "Select for live test" }));
    expect(screen.getByRole("button", { name: "Review and arm selected case" })).toBeEnabled();
    await user.click(within(remainingCard).getByRole("button", { name: "Remove" }));
    expect(screen.getByText("No test cases yet.")).toBeVisible();
    expect(screen.getByText(/suite is now empty/u)).toBeInTheDocument();
  });

  it("reviews exactly one selected case in an accessible answer-key-isolated arm dialog", async () => {
    const user = userEvent.setup();
    const onReviewArm = vi.fn<(selection: ContractSuiteArmSelection) => void>();
    render(
      createElement(Harness, {
        initialSuite: await suiteWithTwoCases(),
        onReviewArm
      })
    );

    await user.click(screen.getByRole("button", { name: "Review and arm selected case" }));
    const dialog = screen.getByRole("dialog", { name: /Arm “Request checkout”/u });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText("Owner expects · hidden rubric")).toBeVisible();
    const agentSection = within(dialog)
      .getByRole("heading", { name: "Request plus the exact catalog" })
      .closest("section") as HTMLElement;
    expect(within(agentSection).getByText(checkoutCase.request)).toBeVisible();
    expect(within(agentSection).getAllByRole("listitem")).toHaveLength(2);
    expect(within(agentSection).queryByText("Allowed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close review" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review and arm selected case" }));
    await user.click(screen.getByRole("button", { name: "Arm live test" }));
    expect(onReviewArm).toHaveBeenCalledTimes(1);
    expect(onReviewArm.mock.calls[0]?.[0].selectedCase.caseId).toBe(checkoutCaseId);
    expect(onReviewArm.mock.calls[0]?.[0].suite.cases).toHaveLength(2);
  });
});
