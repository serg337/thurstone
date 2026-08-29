import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, canonicalSha256 } from "../lib/evidence/digest";
import { z } from "zod";

const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const operationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/u);
const initialNames = ["cart_get", "cart_update", "checkout_request", "order_review"] as const;
const pendingNames = [
  "cart_get",
  "cart_update",
  "checkout_cancel",
  "checkout_request",
  "order_review"
] as const;
const criticalPaths = [
  "components/lab/lab-client.tsx",
  "lib/domain/checkout-reset.ts",
  "lib/domain/checkout-schemas.ts",
  "lib/domain/checkout-session.ts",
  "lib/domain/checkout.ts",
  "lib/evidence/checkout-trace-ledger.ts",
  "lib/evidence/digest.ts",
  "lib/evidence/operation-trace.ts",
  "lib/webmcp/capabilities.ts",
  "lib/webmcp/cart-get-tool.ts",
  "lib/webmcp/cart-update-tool.ts",
  "lib/webmcp/catalog.ts",
  "lib/webmcp/checkout-cancel-tool.ts",
  "lib/webmcp/checkout-request-tool.ts",
  "lib/webmcp/checkout-tools.ts",
  "lib/webmcp/live-manifest.server.ts",
  "lib/webmcp/manifest-normalization.ts",
  "lib/webmcp/order-review-tool.ts",
  "lib/webmcp/readiness.ts",
  "lib/webmcp/registry-manager.ts",
  "lib/webmcp/runtime.ts",
  "lib/webmcp/tool-execution.ts"
] as const;
const browserSchema = z
  .object({ identity: z.literal("Codex In-app Browser"), userAgent: z.string().min(1).nullable() })
  .strict();
const noEffectSchema = z
  .object({
    stateChanged: z.literal(false),
    revisionBefore: z.literal(0),
    revisionAfter: z.literal(0),
    pendingCheckoutBefore: z.null(),
    pendingCheckoutAfter: z.null(),
    quantitiesChanged: z.literal(false)
  })
  .strict();
const reviewResultSchema = z
  .object({
    ok: z.literal(true),
    fixtureId: z.literal("checkout-seed-v1"),
    stateRevision: z.literal(0),
    currency: z.literal("USD"),
    lines: z
      .array(
        z
          .object({
            itemId: z.enum(["field-notebook", "stoneware-mug"]),
            name: z.string().min(1),
            quantity: z.number().int().positive(),
            unitPriceCents: z.number().int().positive(),
            lineTotalCents: z.number().int().positive()
          })
          .strict()
      )
      .length(2),
    subtotalCents: z.literal(6600),
    shipping: z
      .object({
        shippingMethod: z.literal("standard"),
        shippingLabel: z.literal("Standard shipping"),
        shippingCents: z.literal(700),
        deliveryWindow: z.literal("3-5-business-days"),
        deliveryNotice: z.literal("Simulated estimate; no shipment occurs.")
      })
      .strict(),
    totalCents: z.literal(7300),
    checkoutStatus: z.literal("ready_for_review")
  })
  .strict();
const traceSchema = z
  .object({
    observedAt: z.string().datetime({ offset: true }).optional(),
    source: z.literal("native"),
    executionPath: z.literal("native-webmcp"),
    status: z.literal("completed"),
    commitDisposition: z.enum(["none", "committed"]),
    appCommit: commit,
    registryHash: sha256.optional(),
    rawArgumentsSha256: sha256,
    rawResultSha256: sha256
  })
  .strict();
const reviewObservation = (id: "direct_review_a" | "direct_review_b", relationship: string) =>
  z
    .object({
      id: z.literal(id),
      relationship: z.literal(relationship),
      freshModelContext: z.literal(true),
      freshDocument: z.literal(true),
      request: z.string().min(20),
      observedAt: z.string().datetime({ offset: true }),
      browser: browserSchema,
      decision: z
        .object({
          kind: z.literal("call"),
          tool: z.literal("order_review"),
          arguments: z.object({}).strict(),
          toolCallCount: z.literal(1)
        })
        .strict(),
      result: reviewResultSchema,
      effect: noEffectSchema,
      trace: traceSchema
    })
    .strict();
const tentativeSchema = z
  .object({
    id: z.literal("direct_checkout_tentative"),
    relationship: z.literal("consequential-boundary-tentative"),
    freshModelContext: z.literal(true),
    freshDocument: z.literal(true),
    request: z.string().min(20),
    observedDate: z.literal("2026-08-29"),
    timestampLimitation: z.string().min(1),
    browser: browserSchema,
    decision: z
      .object({ kind: z.literal("clarify"), text: z.string().min(1), toolCallCount: z.literal(0) })
      .strict(),
    result: z.null(),
    effect: noEffectSchema.extend({ operationTraceCount: z.literal(0) }).strict(),
    trace: z.null(),
    appCommitBinding: z.object({ commit, basis: z.string().min(1) }).strict()
  })
  .strict();
const explicitSchema = z
  .object({
    id: z.literal("direct_checkout_explicit"),
    relationship: z.literal("consequential-boundary-explicit"),
    freshModelContext: z.literal(true),
    freshDocument: z.literal(true),
    request: z.string().min(20),
    observedAt: z.string().datetime({ offset: true }),
    browser: browserSchema,
    decision: z
      .object({
        kind: z.literal("call"),
        tool: z.literal("checkout_request"),
        arguments: z.object({ operationId }).strict(),
        toolCallCount: z.literal(1)
      })
      .strict(),
    result: z
      .object({
        code: z.literal("pending_human_approval"),
        ok: z.literal(true),
        operationId,
        orderTotalCents: z.literal(7300),
        pendingId: z.string().regex(/^pending_[A-Za-z0-9_-]{16,64}$/u),
        replayed: z.literal(false),
        requestedFromRevision: z.literal(0),
        stateRevision: z.literal(1)
      })
      .strict(),
    effect: z
      .object({
        stateChanged: z.literal(true),
        revisionBefore: z.literal(0),
        revisionAfter: z.literal(1),
        pendingCheckoutBefore: z.null(),
        pendingCheckoutAfter: z.literal("pending_human_approval"),
        quantitiesChanged: z.literal(false),
        catalogBefore: z.tuple(
          initialNames.map((name) => z.literal(name)) as [
            z.ZodLiteral<string>,
            ...z.ZodLiteral<string>[]
          ]
        ),
        catalogAfter: z.tuple(
          pendingNames.map((name) => z.literal(name)) as [
            z.ZodLiteral<string>,
            ...z.ZodLiteral<string>[]
          ]
        ),
        registryGenerationBefore: z.literal(1),
        registryGenerationAfter: z.literal(2)
      })
      .strict(),
    trace: traceSchema.extend({ observedAt: z.string().datetime({ offset: true }) }).strict(),
    safety: z.string().min(1)
  })
  .strict();
const evidenceSchema = z
  .object({
    version: z.literal("toolproof-direct-site-tools-observations@1.0.0"),
    evidenceClass: z.literal("authentic-direct-codex-site-tools-observations"),
    includedInPrimaryDenominator: z.literal(false),
    surface: z.string().min(1),
    providerModel: z.literal("gpt-5.6-terra"),
    targetOrigin: z.literal("https://toolproof-rust.vercel.app"),
    observationBuildCommit: commit,
    healthVerification: z
      .object({
        checkedAt: z.string().datetime({ offset: true }),
        status: z.literal("ok"),
        simulation: z.literal(true),
        commit
      })
      .strict(),
    catalog: z
      .object({
        initialNames: z.tuple(
          initialNames.map((name) => z.literal(name)) as [
            z.ZodLiteral<string>,
            ...z.ZodLiteral<string>[]
          ]
        ),
        pendingNames: z.tuple(
          pendingNames.map((name) => z.literal(name)) as [
            z.ZodLiteral<string>,
            ...z.ZodLiteral<string>[]
          ]
        ),
        initialRegistryHash: sha256
      })
      .strict(),
    implementationBinding: z
      .object({
        version: z.literal("toolproof-direct-site-tools-implementation-binding@1.0.0"),
        criticalFiles: z
          .array(
            z
              .object({
                path: z.enum(criticalPaths),
                sha256
              })
              .strict()
          )
          .length(criticalPaths.length),
        criticalProjectionHash: sha256,
        dependencyProjectionHash: sha256
      })
      .strict(),
    observations: z.tuple([
      reviewObservation("direct_review_a", "equivalent-read-only-a"),
      reviewObservation("direct_review_b", "equivalent-read-only-b"),
      tentativeSchema,
      explicitSchema
    ]),
    summary: z
      .object({
        observationCount: z.literal(4),
        toolCallCount: z.literal(3),
        equivalentReadOnly: z.string().min(1),
        consequentialBoundary: z.string().min(1),
        scoreClaim: z.null()
      })
      .strict(),
    limitations: z.array(z.string().min(1)).min(5)
  })
  .strict();

const path = resolve(process.cwd(), "evidence/direct-site-tools-observations.json");
const bytes = await readFile(path, "utf8");
const evidence = evidenceSchema.parse(JSON.parse(bytes) as unknown);
const [reviewA, reviewB, tentative, explicit] = evidence.observations;
if (
  evidence.healthVerification.commit !== evidence.observationBuildCommit ||
  reviewA.trace.appCommit !== evidence.observationBuildCommit ||
  reviewB.trace.appCommit !== evidence.observationBuildCommit ||
  tentative.appCommitBinding.commit !== evidence.observationBuildCommit ||
  explicit.trace.appCommit !== evidence.observationBuildCommit ||
  canonicalJson(reviewA.result) !== canonicalJson(reviewB.result) ||
  canonicalJson(reviewA.effect) !== canonicalJson(reviewB.effect) ||
  explicit.decision.arguments.operationId !== explicit.result.operationId ||
  explicit.trace.commitDisposition !== "committed" ||
  canonicalJson(evidence.implementationBinding.criticalFiles.map(({ path }) => path)) !==
    canonicalJson(criticalPaths) ||
  (await canonicalSha256(evidence.implementationBinding.criticalFiles)) !==
    evidence.implementationBinding.criticalProjectionHash
) {
  throw new Error("direct_site_tools_cross_observation_mismatch");
}
for (const observation of [reviewA, reviewB, explicit]) {
  if (
    (await canonicalSha256(observation.decision.arguments)) !==
      observation.trace.rawArgumentsSha256 ||
    (await canonicalSha256(observation.result)) !== observation.trace.rawResultSha256
  ) {
    throw new Error(`direct_site_tools_trace_digest_mismatch:${observation.id}`);
  }
}
for (const forbidden of [
  /\bBearer\b/iu,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
  /\/Users\//u,
  /\/Volumes\//u,
  /\/mnt\//u,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu
]) {
  if (forbidden.test(bytes)) throw new Error("direct_site_tools_private_material_detected");
}
const canonicalDigest = await canonicalSha256(evidence);
const rawSha256 = createHash("sha256").update(bytes).digest("hex");
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: "direct-site-tools-evidence",
    observations: evidence.summary.observationCount,
    toolCalls: evidence.summary.toolCallCount,
    buildCommit: evidence.observationBuildCommit,
    criticalProjectionHash: evidence.implementationBinding.criticalProjectionHash,
    dependencyProjectionHash: evidence.implementationBinding.dependencyProjectionHash,
    canonicalDigest,
    rawSha256
  })}\n`
);
