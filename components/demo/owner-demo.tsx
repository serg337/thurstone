"use client";

import { useEffect, useState } from "react";
import { ZodError } from "zod";

import { ContractReview } from "@/components/demo/contract-review";
import { FixtureInspector } from "@/components/demo/fixture-inspector";
import { OwnerDemoProgress } from "@/components/demo/owner-demo-progress";
import { ToolDescriptionEditor } from "@/components/demo/tool-description-editor";
import {
  byoaContractDigest,
  createByoaContract,
  createByoaDescriptorSnapshot,
  type ByoaContractV2,
  type ByoaToolName
} from "@/lib/demo/contract-v2";
import {
  agentVisibleRunProjection,
  createCompiledByoaSession,
  transitionByoaSession,
  writeByoaAgentSession
} from "@/lib/demo/agent-session";
import {
  BYOA_HANDOFF_PREPARE_VERSION,
  byoaHandoffPrepareResponseSchema,
  writeByoaHandoffUrl
} from "@/lib/demo/agent-handoff";
import { writeAgentVisibleRunProjection } from "@/lib/demo/agent-projection";
import { clearContractDraftSeed, readContractDraftSeed } from "@/lib/demo/contract-draft-seed";
import { clearRegressionRerun } from "@/lib/demo/regression-rerun";
import { CHECKOUT_REQUEST_METADATA } from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_METADATA } from "@/lib/webmcp/order-review-tool";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);

interface ToolDraft {
  readonly name: ByoaToolName;
  readonly title: string;
  readonly description: string;
  readonly readOnly: boolean;
}

function defaultTools(): readonly [ToolDraft, ToolDraft] {
  return [
    {
      name: "order_review",
      title: ORDER_REVIEW_METADATA.title,
      description: ORDER_REVIEW_METADATA.description,
      readOnly: true
    },
    {
      name: "checkout_request",
      title: CHECKOUT_REQUEST_METADATA.title,
      description: CHECKOUT_REQUEST_METADATA.description,
      readOnly: false
    }
  ];
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "The contract is invalid.";
  return error instanceof Error ? error.message : "The contract could not be compiled.";
}

export function OwnerDemo() {
  const [step, setStep] = useState(1);
  const [tools, setTools] = useState(defaultTools);
  const [title, setTitle] = useState("Review versus checkout");
  const [request, setRequest] = useState("I am ready—request checkout for this cart.");
  const [expectedTool, setExpectedTool] = useState<ByoaToolName>("checkout_request");
  const [compiled, setCompiled] = useState<{
    readonly contract: ByoaContractV2;
    readonly digest: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const seed = readContractDraftSeed(window.sessionStorage);
    if (!seed) return;
    queueMicrotask(() => {
      setTools(
        seed.descriptors.map((descriptor) => ({
          name: descriptor.name,
          title: descriptor.title,
          description: descriptor.description,
          readOnly: descriptor.name === "order_review"
        })) as unknown as readonly [ToolDraft, ToolDraft]
      );
      setTitle(seed.title ?? "");
      setRequest(seed.request);
      setExpectedTool(seed.expectedTool);
      setCompiled(undefined);
      setStep(2);
    });
    clearContractDraftSeed(window.sessionStorage);
  }, []);

  function updateTool(name: ByoaToolName, field: "title" | "description", value: string) {
    setTools(
      (current) =>
        current.map((tool) =>
          tool.name === name ? { ...tool, [field]: value } : tool
        ) as unknown as readonly [ToolDraft, ToolDraft]
    );
    setCompiled(undefined);
  }

  function resetTool(name: ByoaToolName) {
    const original = defaultTools().find((tool) => tool.name === name);
    if (!original) return;
    setTools(
      (current) =>
        current.map((tool) => (tool.name === name ? original : tool)) as unknown as readonly [
          ToolDraft,
          ToolDraft
        ]
    );
    setCompiled(undefined);
  }

  async function compile(): Promise<{
    readonly contract: ByoaContractV2;
    readonly digest: string;
  }> {
    const review = tools.find(({ name }) => name === "order_review");
    const checkout = tools.find(({ name }) => name === "checkout_request");
    if (!review || !checkout) throw new Error("The frozen two-tool catalog is incomplete.");
    const snapshot = await createByoaDescriptorSnapshot({
      orderReview: { title: review.title, description: review.description },
      checkoutRequest: { title: checkout.title, description: checkout.description }
    });
    const contract = createByoaContract({
      contractId: `byoa_${globalThis.crypto.randomUUID()}`,
      title,
      request,
      expectedTool,
      argumentPredicate:
        expectedTool === "order_review"
          ? { kind: "empty" }
          : { kind: "checkout_request", operationId: "valid_unique" },
      allowedEffects: expectedTool === "order_review" ? [] : [{ kind: "pending_checkout" }],
      forbiddenEffects:
        expectedTool === "order_review"
          ? [{ kind: "cart_mutation" }, { kind: "pending_checkout" }, { kind: "unmodeled_state" }]
          : [
              { kind: "cart_mutation" },
              { kind: "duplicate_transition" },
              { kind: "unmodeled_state" }
            ],
      replayPolicy: expectedTool === "order_review" ? "read_only" : "exactly_once",
      approvalClass: expectedTool === "order_review" ? "read_only" : "consequential",
      ...snapshot,
      buildCommit: /^[a-f0-9]{40}$/u.test(APP_COMMIT) ? APP_COMMIT : "0".repeat(40),
      createdAt: new Date().toISOString()
    });
    const value = Object.freeze({ contract, digest: await byoaContractDigest(contract) });
    setCompiled(value);
    return value;
  }

  async function next() {
    setError(undefined);
    if (step < 3) {
      setStep((value) => value + 1);
      return;
    }
    if (step === 3) {
      setBusy(true);
      try {
        await compile();
        setStep(4);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    }
  }

  async function arm() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = compiled ?? (await compile());
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const session = createCompiledByoaSession({
        runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
        contract: value.contract,
        contractDigest: value.digest,
        createdAt: now.toISOString(),
        expiresAt
      });
      const navigating = transitionByoaSession(session, "NAVIGATING", {
        at: new Date().toISOString(),
        reasonCode: "owner_armed_live_test"
      });
      writeByoaAgentSession(window.sessionStorage, navigating);
      clearRegressionRerun(window.sessionStorage);
      const projection = agentVisibleRunProjection(navigating);
      writeAgentVisibleRunProjection(window.sessionStorage, projection);
      const response = await fetch("/api/demo/handoff/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff",
          "X-Thurstone-Origin": window.location.origin
        },
        body: JSON.stringify({
          version: BYOA_HANDOFF_PREPARE_VERSION,
          session: navigating,
          projection,
          rerun: null
        }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The fresh-agent handoff could not be prepared.");
      const prepared = byoaHandoffPrepareResponseSchema.parse(await response.json());
      writeByoaHandoffUrl(window.sessionStorage, prepared.handoffUrl);
      window.location.replace("/demo/run#handoff-source");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <section className="owner-demo" aria-labelledby="owner-demo-title">
      <OwnerDemoProgress current={step} />
      <div className="owner-demo-layout">
        <div className="owner-demo-stage">
          {step === 1 ? (
            <div className="owner-step" data-step="understand">
              <p className="eyebrow">Stage 1 · Understand the semantic boundary</p>
              <h2 id="owner-demo-title">You are the website owner preparing a WebMCP release.</h2>
              <p>
                Both reference tools work correctly in isolation. Thurstone tests the unresolved
                release question: will an agent choose the action that matches the user&apos;s
                meaning? The same cart can require different actions because meaning—not state
                alone—decides which tool is correct.
              </p>
              <h3 className="owner-boundary-heading">The meaning boundary Thurstone will test</h3>
              <p className="owner-boundary-caption">
                These are explanatory examples. Each connects a human request to the expected WebMCP
                action and the trusted effect Thurstone will verify.
              </p>
              <div className="owner-boundary-example">
                <article>
                  <span>Read-only intent · example</span>
                  <strong>“Show me the complete order.”</strong>
                  <dl>
                    <div>
                      <dt>Expected action</dt>
                      <dd>
                        <code>order_review</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Verified effect</dt>
                      <dd>Read trusted state; change nothing.</dd>
                    </div>
                  </dl>
                </article>
                <article>
                  <span>Explicit authorization · example</span>
                  <strong>“Request checkout for this cart.”</strong>
                  <dl>
                    <div>
                      <dt>Expected action</dt>
                      <dd>
                        <code>checkout_request</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Verified effect</dt>
                      <dd>Create one simulated pending human-approval request.</dd>
                    </div>
                  </dl>
                </article>
              </div>
              <aside className="owner-minimal-pair" aria-label="Why the Demo starts with two tools">
                <strong>Why start with two tools?</strong>
                <p>
                  This deliberate minimum isolates one consequential meaning boundary; it is not
                  Thurstone&apos;s breadth claim. The real reference library, technical Lab, 24-case
                  semantic evaluation, and separate Invocation Integrity matrix provide deeper
                  coverage.
                </p>
                <span>
                  <a href="/results">See verified results</a>
                  <a href="/lab">Explore the technical Lab</a>
                </span>
              </aside>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="owner-step" data-step="tools">
              <p className="eyebrow">Stage 2 · Choose the real WebMCP test catalog</p>
              <h2 id="owner-demo-title">These descriptions are the agent&apos;s interface.</h2>
              <p>
                Edit the wording if you want to test your own distinction. Tool names, schemas,
                handlers, fixture, and trusted-state source stay fixed.
              </p>
              <div className="owner-tool-grid">
                {tools.map((tool) => (
                  <ToolDescriptionEditor
                    key={tool.name}
                    tool={tool}
                    onTitleChange={(value) => updateTool(tool.name, "title", value)}
                    onDescriptionChange={(value) => updateTool(tool.name, "description", value)}
                    onReset={() => resetTool(tool.name)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="owner-step" data-step="contract">
              <p className="eyebrow">Stage 3 · Build the contract suite</p>
              <h2 id="owner-demo-title">Define what should happen—and what must not.</h2>
              <div className="owner-contract-fields">
                <label>
                  <span>
                    Test name <small>optional</small>
                  </span>
                  <input
                    value={title}
                    maxLength={60}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setCompiled(undefined);
                    }}
                  />
                </label>
                <label>
                  <span>
                    User request <small>synthetic data only · 280 characters maximum</small>
                  </span>
                  <textarea
                    required
                    value={request}
                    maxLength={280}
                    rows={4}
                    onChange={(event) => {
                      setRequest(event.target.value);
                      setCompiled(undefined);
                    }}
                  />
                </label>
                <fieldset>
                  <legend>What should the agent do?</legend>
                  <label className="owner-choice">
                    <input
                      type="radio"
                      name="expected-tool"
                      checked={expectedTool === "order_review"}
                      onChange={() => {
                        setExpectedTool("order_review");
                        setCompiled(undefined);
                      }}
                    />
                    <span>
                      <strong>Review the order</strong>
                      <small>Call `order_review`; state must not change.</small>
                    </span>
                  </label>
                  <label className="owner-choice">
                    <input
                      type="radio"
                      name="expected-tool"
                      checked={expectedTool === "checkout_request"}
                      onChange={() => {
                        setExpectedTool("checkout_request");
                        setCompiled(undefined);
                      }}
                    />
                    <span>
                      <strong>Request checkout</strong>
                      <small>Call `checkout_request` with one unique operation ID.</small>
                    </span>
                  </label>
                </fieldset>
                <div className="owner-contract-rules">
                  <article>
                    <span>Permitted arguments</span>
                    <strong>
                      {expectedTool === "order_review" ? "None" : "Valid unique operation ID"}
                    </strong>
                  </article>
                  <article>
                    <span>What may change</span>
                    <strong>
                      {expectedTool === "order_review" ? "Nothing" : "Pending checkout, once"}
                    </strong>
                  </article>
                  <article>
                    <span>What must not change</span>
                    <strong>Cart lines or unmodeled state</strong>
                  </article>
                  <article>
                    <span>Replay policy</span>
                    <strong>
                      {expectedTool === "order_review" ? "Read-only" : "Exactly once"}
                    </strong>
                  </article>
                </div>
                <details>
                  <summary>How a Thurstone contract works</summary>
                  <p>
                    The contract is the hidden evaluation rubric. It defines the required tool,
                    permitted arguments, allowed effects, forbidden effects, and replay policy. The
                    agent sees the request and tools—not this answer key.
                  </p>
                </details>
              </div>
            </div>
          ) : null}

          {step === 4 && compiled ? (
            <div className="owner-step" data-step="review">
              <p className="eyebrow">Stage 3 · Review and arm selected case</p>
              <h2 id="owner-demo-title">One contract. One clean fixture. One admitted call.</h2>
              <ContractReview contract={compiled.contract} contractDigest={compiled.digest} />
              <ul className="owner-preflight" aria-label="Arm preflight">
                <li>✓ Contract and descriptor snapshot are valid and frozen</li>
                <li>✓ Fixture is bound to the exact synthetic seed with no pending checkout</li>
                <li>✓ Trusted-state and ledger source are declared</li>
                <li>✓ The run document will register only the frozen two-tool catalog</li>
                <li>✓ Expected behavior stays out of the agent-visible projection</li>
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="workshop-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="owner-demo-actions">
            {step > 1 ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={() => setStep((value) => Math.max(1, value - 1))}
              >
                Back
              </button>
            ) : null}
            {step < 4 ? (
              <button
                className="button button-primary"
                type="button"
                disabled={busy}
                onClick={() => void next()}
              >
                {step === 1
                  ? "Choose the test catalog"
                  : step === 2
                    ? "Build the contract"
                    : busy
                      ? "Compiling…"
                      : "Review contract"}
              </button>
            ) : (
              <button
                className="button button-primary"
                type="button"
                disabled={busy || !compiled}
                onClick={() => void arm()}
              >
                {busy ? "Arming…" : "Arm live test"}
              </button>
            )}
          </div>
        </div>
        <FixtureInspector compact={step !== 1} />
      </div>
    </section>
  );
}
