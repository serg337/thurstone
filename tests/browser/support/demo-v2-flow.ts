import { expect, type BrowserContext, type Page } from "@playwright/test";

import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

import { installEmulatedConsumer } from "./emulated-consumer";

const HANDOFF_COMMAND_PREFIX = "Open ";

export function handoffUrlFromCommand(command: string): string {
  const firstLine = command.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith(HANDOFF_COMMAND_PREFIX)) {
    throw new Error("The fresh-agent command does not match the frozen complete-command format.");
  }
  return firstLine.slice(HANDOFF_COMMAND_PREFIX.length);
}

export async function prepareV2Handoff(
  owner: Page,
  input: {
    readonly name?: string;
    readonly request?: string;
    readonly expectedTool?: "order_review" | "checkout_request";
  } = {}
): Promise<string> {
  const name = input.name ?? "Request checkout";
  const request = input.request ?? "I am ready—request checkout for this cart.";
  const expectedTool = input.expectedTool ?? "checkout_request";
  await owner.goto("/demo");
  await owner.getByRole("button", { name: "Choose the test catalog" }).click();
  await owner.getByRole("button", { name: /order_review/u }).click();
  await owner.getByRole("button", { name: /checkout_request/u }).click();
  await owner.getByRole("button", { name: "Build the contract suite" }).click();
  await owner
    .getByRole("region", { name: "Start with a curated Demo case." })
    .getByRole("button", { name: new RegExp(expectedTool, "u") })
    .click();
  await owner.getByLabel("Test-case name").fill(name);
  await owner.getByLabel("Request 1").fill(request);
  await owner.getByRole("button", { name: "Add test case" }).click();
  await owner.getByRole("button", { name: /Run contract/u }).click();
  await owner.getByRole("button", { name: "Arm live test" }).click();
  await owner.waitForURL(/\/demo\/run#handoff-source-v2$/u);
  return handoffUrlFromCommand(await owner.getByLabel("Exact fresh-agent command").inputValue());
}

export async function openFreshV2(
  context: BrowserContext,
  handoffUrl: string,
  argumentMode: "json-string" | "object" = "json-string"
): Promise<Page> {
  const fresh = await context.newPage();
  await installEmulatedConsumer(fresh, argumentMode);
  await fresh.goto(handoffUrl);
  await expect(
    fresh.getByRole("heading", { name: "Receive this test in ChatGPT's Browser." })
  ).toBeVisible();
  await fresh.getByRole("button", { name: "Receive isolated test" }).click();
  await fresh.waitForURL(/\/demo\/run$/u);
  await expect(
    fresh.getByRole("heading", { name: "Review what this agent receives." })
  ).toBeVisible();
  return fresh;
}

export async function startFreshV2(
  fresh: Page,
  expectedNames: readonly string[] = ["order_review", "checkout_request"]
): Promise<void> {
  await fresh.getByRole("button", { name: "Continue to readiness" }).click();
  await fresh.getByRole("button", { name: "Start live observation" }).click();
  await expect(fresh.locator("[data-byoa-v2-state='ARMED']")).toBeVisible();
  await expect
    .poll(() =>
      fresh.evaluate(async () =>
        (await document.modelContext?.getTools?.())?.map(({ name }) => name)
      )
    )
    .toEqual(expectedNames);
}

export async function invokeFreshV2(
  fresh: Page,
  toolName: "cart_get" | "cart_update" | "order_review" | "checkout_request",
  input: Record<string, unknown>
): Promise<void> {
  await fresh.evaluate(
    async ({ selectedName, selectedInput }) => {
      const consumer = document.modelContext as RuntimeModelContext | undefined;
      if (!consumer?.getTools || !consumer.executeTool) throw new Error("Consumer unavailable.");
      const selected = (await consumer.getTools()).find(({ name }) => name === selectedName);
      if (!selected) throw new Error(`${selectedName} was not registered.`);
      await consumer.executeTool(selected, JSON.stringify(selectedInput), {
        signal: new AbortController().signal
      });
    },
    { selectedName: toolName, selectedInput: input }
  );
}
