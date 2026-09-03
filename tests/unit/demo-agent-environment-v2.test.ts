import { describe, expect, it } from "vitest";

import {
  createByoaAgentEnvironmentV2,
  createByoaAgentEnvironmentV2FromProjection,
  createResetByoaAgentEnvironmentV2FromProjection
} from "@/lib/demo/agent-environment-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase
} from "@/lib/demo/contract-suite";
import { createByoaContractV3 } from "@/lib/demo/contract-v3";
import {
  THURSTONE_REFERENCE_TOOL_TEMPLATES,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";

const buildCommit = "d".repeat(40);

async function liveContract(
  selectedToolNames: readonly ThurstoneDemoSelectableToolName[] = [
    "cart_get",
    "cart_update",
    "order_review",
    "checkout_request"
  ]
) {
  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
    selectedToolNames,
    descriptorOverrides: {
      cart_get: {
        title: "Inspect cart lines",
        description:
          "Return the current cart line identities and quantities without changing state."
      }
    }
  });
  let suite = await createThurstoneContractSuite({
    suiteId: "suite_11111111-1111-4111-8111-111111111111",
    name: "Selected runtime suite",
    catalogSnapshot,
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  suite = addContractSuiteCase(
    suite,
    {
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
    },
    {
      caseId: "case_22222222-2222-4222-8222-222222222222",
      updatedAt: "2026-09-01T00:00:01.000Z"
    }
  );
  suite = selectContractSuiteCase(suite, "case_22222222-2222-4222-8222-222222222222", {
    updatedAt: "2026-09-01T00:00:02.000Z"
  });
  return createByoaContractV3({
    contractId: "byoa_33333333-3333-4333-8333-333333333333",
    suite,
    buildCommit,
    createdAt: "2026-09-01T00:00:03.000Z"
  });
}

function executionContext(signal = new AbortController().signal) {
  return { signal };
}

describe("dynamic isolated BYOA environment v2", () => {
  it("binds the exact selected real tools, descriptors, handlers, catalog, domain, and build", async () => {
    const contract = await liveContract();
    const environment = await createByoaAgentEnvironmentV2(contract, buildCommit);

    expect(environment.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);
    expect(environment.tools[0]?.title).toBe("Inspect cart lines");
    expect(environment.tools[0]?.description).toMatch(/without changing state/iu);
    expect(environment.tools[0]?.inputSchema).toEqual(
      THURSTONE_REFERENCE_TOOL_TEMPLATES.cart_get.inputSchema
    );
    expect(environment.tools[0]?.annotations).toEqual(
      THURSTONE_REFERENCE_TOOL_TEMPLATES.cart_get.annotations
    );
    expect(environment.manifest).toMatchObject({
      version: "thurstone-byoa-agent-environment-manifest@2",
      toolsetVersion: "thurstone-byoa-demo-toolset@2",
      catalogToolsetVersion: "thurstone-demo-reference-toolset@2",
      domainVersion: "checkout-domain@1.0.0",
      appCommit: buildCommit,
      catalogDigest: contract.catalogDigest
    });
    expect(environment.manifest.handlerVersions).toEqual(
      contract.catalogSnapshot.tools.map(({ name, handlerVersion }) => ({
        name,
        version: handlerVersion
      }))
    );
    expect(environment.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(environment.initialState.revision).toBe(0);
    expect(environment.initialLedger.totalTraceCount).toBe(0);
  });

  it("omits every unselected tool", async () => {
    const contract = await liveContract(["order_review", "checkout_request"]);
    const environment = await createByoaAgentEnvironmentV2(contract, buildCommit);
    expect(environment.tools.map(({ name }) => name)).toEqual(["order_review", "checkout_request"]);
    expect(environment.manifest.tools.map(({ name }) => name)).toEqual([
      "order_review",
      "checkout_request"
    ]);
  });

  it("admits a wrong first tool for an ISSUE and rejects every later call pre-domain", async () => {
    const environment = await createByoaAgentEnvironmentV2(await liveContract(), buildCommit);
    const cartGet = environment.tools.find(({ name }) => name === "cart_get");
    const checkout = environment.tools.find(({ name }) => name === "checkout_request");

    await expect(cartGet?.execute({}, executionContext())).resolves.toMatchObject({ ok: true });
    await expect(
      checkout?.execute({ operationId: "checkout_attempt_0001" }, executionContext())
    ).rejects.toMatchObject({ name: "InvalidStateError" });

    expect(environment.gate.snapshot()).toMatchObject({
      claim: { toolName: "cart_get", disposition: "fulfilled" },
      rejectedAdditionalAttempts: 1
    });
    expect(environment.ledger.snapshot().current).toHaveLength(1);
    expect(environment.store.getSnapshot().state).toEqual(environment.initialState);
  });

  it("claims synchronously across concurrent tools and permits exactly one state transition", async () => {
    const environment = await createByoaAgentEnvironmentV2(await liveContract(), buildCommit);
    const update = environment.tools.find(({ name }) => name === "cart_update");
    const review = environment.tools.find(({ name }) => name === "order_review");
    const first = update?.execute(
      {
        operationId: "cart_update_live_0001",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 3
      },
      executionContext()
    );

    expect(environment.gate.snapshot().claim).toMatchObject({
      toolName: "cart_update",
      disposition: "in-flight"
    });
    await expect(review?.execute({}, executionContext())).rejects.toMatchObject({
      name: "InvalidStateError"
    });
    await expect(first).resolves.toMatchObject({ ok: true, code: "updated", stateRevision: 1 });
    expect(environment.store.getSnapshot().state.revision).toBe(1);
    expect(environment.ledger.snapshot().current).toHaveLength(1);
  });

  it("preserves the supplied cancellation signal and records no canceled mutation effect", async () => {
    const environment = await createByoaAgentEnvironmentV2(await liveContract(), buildCommit);
    const update = environment.tools.find(({ name }) => name === "cart_update");
    const controller = new AbortController();
    controller.abort(new DOMException("Canceled", "AbortError"));

    await expect(
      update?.execute(
        {
          operationId: "cart_update_live_0002",
          operation: "set_quantity",
          itemId: "stoneware-mug",
          quantity: 3
        },
        executionContext(controller.signal)
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(environment.gate.snapshot().claim).toMatchObject({
      toolName: "cart_update",
      disposition: "rejected",
      error: { name: "AbortError" }
    });
    expect(environment.store.getSnapshot().state.revision).toBe(0);
    expect(environment.ledger.snapshot().current).toEqual([
      expect.objectContaining({
        toolName: "cart_update",
        status: "canceled",
        commitDisposition: "none"
      })
    ]);
  });

  it("reconstructs the same strict catalog from an agent-visible projection v2", async () => {
    const contract = await liveContract(["cart_get", "order_review", "checkout_request"]);
    const projection = {
      version: "thurstone-byoa-agent-projection@2" as const,
      runId: "byoa_run_44444444-4444-4444-8444-444444444444",
      request: contract.request,
      fixture: { fixtureId: contract.fixtureId, summary: "Two items; synthetic total $73." },
      descriptors: contract.catalogSnapshot.tools.map(
        ({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations
        })
      ),
      catalogDigest: contract.catalogDigest,
      buildCommit,
      expiresAt: "2026-09-01T00:30:00.000Z"
    };
    const environment = await createByoaAgentEnvironmentV2FromProjection(projection, buildCommit);
    expect(environment.contract).toBeNull();
    expect(environment.projection).toEqual(projection);
    expect(environment.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "order_review",
      "checkout_request"
    ]);
    await expect(
      createByoaAgentEnvironmentV2FromProjection(
        { ...projection, catalogDigest: "0".repeat(64) },
        buildCommit
      )
    ).rejects.toThrow(/catalog digest/iu);
  });

  it("isolates the planted no-op to one reset regression environment", async () => {
    const contract = await liveContract();
    const projection = {
      version: "thurstone-byoa-agent-projection@2" as const,
      runId: "byoa_run_55555555-5555-4555-8555-555555555555",
      request: "Set the Field notebook quantity to 2.",
      fixture: { fixtureId: contract.fixtureId, summary: "Two-item synthetic checkout fixture." },
      descriptors: contract.catalogSnapshot.tools.map(
        ({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations
        })
      ),
      catalogDigest: contract.catalogDigest,
      runtimeVariant: "planted-cart-update-noop" as const,
      buildCommit,
      expiresAt: "2026-09-01T00:30:00.000Z"
    };
    const prior = await createByoaAgentEnvironmentV2FromProjection(
      { ...projection, runtimeVariant: "standard" as const },
      buildCommit
    );
    prior.gate.deactivate();
    const planted = await createResetByoaAgentEnvironmentV2FromProjection(
      projection,
      buildCommit,
      prior
    );
    planted.gate.beginNextStep();
    const update = planted.tools.find(({ name }) => name === "cart_update");
    await expect(
      update?.execute(
        {
          operationId: "judge_planted_update_0001",
          operation: "set_quantity",
          itemId: "field-notebook",
          quantity: 2
        },
        executionContext()
      )
    ).resolves.toMatchObject({ ok: true, code: "no_change", quantity: 1, stateRevision: 0 });
    expect(planted.runtimeVariantState.current).toBe("planted-cart-update-noop");
    expect(planted.gate.snapshot().claim?.rawInput).toMatchObject({ quantity: 2 });
    expect(planted.ledger.snapshot().current[0]?.canonicalArguments?.value).toMatchObject({
      itemId: "field-notebook",
      quantity: 2
    });
    expect(planted.store.getSnapshot().state).toMatchObject({ revision: 0 });
    expect(planted.store.getSnapshot().state.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemId: "field-notebook", quantity: 1 })])
    );
  });

  it("fails closed when the runtime build is not the frozen build", async () => {
    await expect(
      createByoaAgentEnvironmentV2(await liveContract(), "e".repeat(40))
    ).rejects.toThrow(/build must match/iu);
  });
});
