import { describe, expect, it } from "vitest";

import { BYOA_HANDOFF_TOKEN_MAX_BYTES } from "@/lib/demo/agent-handoff";
import {
  createByoaHandoffEnvelopeV2,
  sealByoaHandoffV2
} from "@/lib/demo/agent-handoff-token-v2.server";
import {
  agentVisibleRunProjectionV2,
  createCompiledByoaSessionV2,
  transitionByoaSessionV2
} from "@/lib/demo/agent-session-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase
} from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";

const environment = {
  NODE_ENV: "test",
  TOOLPROOF_SIGNING_SECRET: Buffer.alloc(32, 29).toString("base64url")
} as NodeJS.ProcessEnv;

describe("BYOA Handoff v2 sizing", () => {
  it("keeps the maximum bounded four-tool descriptor snapshot below the cookie cap", async () => {
    const names = ["cart_get", "cart_update", "order_review", "checkout_request"] as const;
    const longText = (name: (typeof names)[number]) => {
      const alphabet = "abcdefghijkmnopqstuvxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789 ";
      let state = Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 97);
      let value = "";
      for (let index = 0; index < 599; index += 1) {
        state = (state * 48_271) % 2_147_483_647;
        value += alphabet[state % alphabet.length];
      }
      return `${value}z`;
    };
    const catalogSnapshot = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: names,
      descriptorOverrides: {
        cart_get: { title: "Read the current synthetic cart", description: longText("cart_get") },
        cart_update: {
          title: "Update one synthetic cart quantity",
          description: longText("cart_update")
        },
        order_review: {
          title: "Review the complete synthetic order",
          description: longText("order_review")
        },
        checkout_request: {
          title: "Request one synthetic pending checkout",
          description: longText("checkout_request")
        }
      }
    });
    let suite = await createThurstoneContractSuite({
      suiteId: "suite_50505050-5050-4050-8050-505050505050",
      name: "Maximum catalog",
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
        caseId: "case_60606060-6060-4060-8060-606060606060",
        updatedAt: "2026-09-01T00:00:01.000Z"
      }
    );
    suite = selectContractSuiteCase(suite, suite.cases[0]!.caseId, {
      updatedAt: "2026-09-01T00:00:02.000Z"
    });
    const lineage = await expectedLineageForThurstoneSuite(suite);
    const contract = await createByoaContractV3({
      contractId: "byoa_70707070-7070-4070-8070-707070707070",
      suite,
      buildCommit: "e".repeat(40),
      createdAt: "2026-09-01T00:00:03.000Z"
    });
    let session = await createCompiledByoaSessionV2({
      runId: "byoa_run_80808080-8080-4080-8080-808080808080",
      contract,
      lineage,
      createdAt: "2026-09-01T00:00:04.000Z",
      expiresAt: "2026-09-01T00:20:00.000Z"
    });
    session = transitionByoaSessionV2(session, "HANDOFF_ISSUED", {
      at: "2026-09-01T00:00:05.000Z",
      reasonCode: "owner_issued_fresh_handoff"
    });
    const envelope = createByoaHandoffEnvelopeV2({
      session,
      projection: agentVisibleRunProjectionV2(session),
      now: new Date("2026-09-01T00:00:06.000Z")
    });
    const token = sealByoaHandoffV2(envelope, environment);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(BYOA_HANDOFF_TOKEN_MAX_BYTES);
  });
});
