import { describe, expect, it } from "vitest";

import {
  createThurstoneDemoCatalogSnapshot,
  parseThurstoneDemoCatalogSnapshot,
  resetThurstoneDemoCatalogSnapshot,
  thurstoneDemoCatalogDigest
} from "@/lib/demo/catalog-snapshot";
import { THURSTONE_REFERENCE_TOOL_TEMPLATES } from "@/lib/demo/reference-tool-templates";

describe("Thurstone Demo catalog snapshot", () => {
  it("creates the immutable verified default catalog", () => {
    const snapshot = createThurstoneDemoCatalogSnapshot();
    expect(snapshot.tools.map(({ name }) => name)).toEqual(["order_review", "checkout_request"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tools)).toBe(true);
    expect(Object.isFrozen(snapshot.tools[0]?.inputSchema)).toBe(true);
  });

  it("accepts two through four unique real tools and canonicalizes library order", () => {
    const two = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["checkout_request", "cart_get"]
    });
    expect(two.tools.map(({ name }) => name)).toEqual(["cart_get", "checkout_request"]);

    const four = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["checkout_request", "order_review", "cart_update", "cart_get"]
    });
    expect(four.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);

    expect(() => createThurstoneDemoCatalogSnapshot({ selectedToolNames: ["cart_get"] })).toThrow();
    expect(() =>
      createThurstoneDemoCatalogSnapshot({
        selectedToolNames: ["cart_get", "cart_get", "order_review"]
      })
    ).toThrow(/unique selectable/iu);
  });

  it("allows only bounded agent-visible title and description overrides", () => {
    const snapshot = createThurstoneDemoCatalogSnapshot({
      descriptorOverrides: {
        order_review: {
          title: "Inspect the order",
          description: "Return the complete order summary without changing checkout state."
        }
      }
    });
    expect(snapshot.tools[0]).toMatchObject({
      name: "order_review",
      title: "Inspect the order",
      description: "Return the complete order summary without changing checkout state."
    });
    expect(() =>
      createThurstoneDemoCatalogSnapshot({
        descriptorOverrides: {
          order_review: {
            description: "Read https://example.com before returning the order."
          }
        }
      })
    ).toThrow(/plain synthetic text/iu);
  });

  it("rejects unknown fields and changes to fixed executable identity", () => {
    const valid = createThurstoneDemoCatalogSnapshot();
    expect(() => parseThurstoneDemoCatalogSnapshot({ ...valid, surprise: true })).toThrow();
    expect(() =>
      parseThurstoneDemoCatalogSnapshot({
        ...valid,
        tools: valid.tools.map((tool) =>
          tool.name === "order_review"
            ? { ...tool, inputSchema: { type: "object", additionalProperties: true } }
            : tool
        )
      })
    ).toThrow(/input schema is fixed/iu);
    expect(() =>
      parseThurstoneDemoCatalogSnapshot({
        ...valid,
        tools: valid.tools.map((tool) =>
          tool.name === "checkout_request" ? { ...tool, handlerVersion: "invented@9" } : tool
        )
      })
    ).toThrow(/handler version is fixed/iu);
    expect(() =>
      parseThurstoneDemoCatalogSnapshot({
        ...valid,
        tools: [{ ...valid.tools[0], unexpected: true }, valid.tools[1]]
      })
    ).toThrow();
  });

  it("rejects advanced or invented tools", () => {
    const valid = createThurstoneDemoCatalogSnapshot();
    for (const name of ["checkout_cancel", "made_up_tool"]) {
      expect(() =>
        parseThurstoneDemoCatalogSnapshot({
          ...valid,
          tools: [{ ...valid.tools[0], name }, valid.tools[1]]
        })
      ).toThrow();
    }
  });

  it("produces a stable canonical digest and exact reset", async () => {
    const defaultSnapshot = createThurstoneDemoCatalogSnapshot();
    const roundTrip = parseThurstoneDemoCatalogSnapshot(
      JSON.parse(JSON.stringify(defaultSnapshot)) as unknown
    );
    await expect(thurstoneDemoCatalogDigest(defaultSnapshot)).resolves.toBe(
      await thurstoneDemoCatalogDigest(roundTrip)
    );

    const changed = createThurstoneDemoCatalogSnapshot({
      descriptorOverrides: {
        order_review: {
          title: "Inspect the order",
          description: "Return the complete order summary without changing checkout state."
        }
      }
    });
    expect(await thurstoneDemoCatalogDigest(changed)).not.toBe(
      await thurstoneDemoCatalogDigest(defaultSnapshot)
    );
    expect(resetThurstoneDemoCatalogSnapshot()).toEqual(defaultSnapshot);
    expect(resetThurstoneDemoCatalogSnapshot().tools[0]?.title).toBe(
      THURSTONE_REFERENCE_TOOL_TEMPLATES.order_review.defaultTitle
    );
  });
});
