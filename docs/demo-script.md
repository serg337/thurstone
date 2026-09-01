# Thurstone judge video script

Target duration: **2:50–2:55**. Record the exact production release at
`https://thurstone.invarra.ai` in a clean supported agent session. The native call shown in the
video must be authentic; do not substitute an internal button, prerecorded animation, or fabricated
receipt.

## 0:00–0:16 — The hidden release risk

Show the homepage hero and say:

> AI agents can operate websites, but a working WebMCP handler does not prove that an agent will
> choose it for the meaning the website owner intended. Thurstone turns that intended meaning into
> a release test.

Click **Test Thurstone**.

## 0:16–0:34 — The product in one sentence

Show the five-stage mechanism and say:

> The owner defines a contract. A real external agent sees only the live WebMCP tools. Thurstone
> observes the native call, verifies trusted site state and ledger effects, then returns a verdict
> and a concrete investigation path.

## 0:34–1:08 — Build a contract

On `/demo`, complete the six-step owner workflow:

1. keep the reference checkout fixture;
2. choose the request `I’m ready—start checkout for this cart.`;
3. expect `checkout_request`;
4. require one pending checkout and exactly one state transition;
5. keep the exactly-once replay policy;
6. review the owner contract separately from the two descriptions the agent will see.

Say:

> I am acting as the WebMCP owner. The answer key stays on the owner side. The external agent gets
> the request, fixture summary, and exactly two live tool descriptions—nothing that tells it which
> answer Thurstone expects.

Click **Arm live agent test**.

## 1:08–1:33 — Bring your own agent

On the isolated `/demo/run` page, show the frozen request and two-tool catalog. In the built-in
Browser (`@Browser`) of the latest ChatGPT desktop app, use a fresh GPT-5.6 Sol or Terra ChatGPT Work
or Codex agent. Send the exact request and let the agent invoke the native `checkout_request` Site
Tool. Do not use Chrome extension side chat for this proof.

Say:

> Thurstone does not impersonate the customer’s agent. This is bring your own agent: the same kind
> of agent a site owner or judge wants to qualify against the deployed WebMCP surface.

Keep the native tool invocation visible long enough to be readable.

## 1:33–2:04 — Verify reality, not the answer

Return to the terminal result and show, in order:

- expected versus observed tool and canonical arguments;
- trusted state before and after;
- the append-only ledger diff;
- the exactly-once assertion;
- the deterministic PASS or ISSUE verdict.

Say:

> The tool response is not the judge. Thurstone checks the independent site-owned state and ledger.
> If selection, arguments, effects, replay, or evidence disagree with the contract, it identifies
> the failed assertion and recommends the next investigation step without claiming an unproven
> root cause.

## 2:04–2:25 — Preserve the regression

Choose **Save to My Tests**, then briefly show export, edit, and rerun actions.

Say:

> A pass becomes a release regression. An issue keeps the same immutable evidence and can be rerun
> after the owner changes their WebMCP description or schema. Thurstone does not silently repair
> production code or overwrite the original result.

## 2:25–2:42 — Reference credibility

Open **Results**. Show **My Tests** first, then the unchanged **24/24 semantic behaviors** and the
separate **3/3 Invocation Integrity Matrix**.

Say:

> The reference evaluation covers benign meaning. The separate deterministic matrix covers three
> hostile direct invocations. Their scores are never combined.

## 2:42–2:55 — Lifecycle and boundary

Open **Workflow** and finish with:

> Run Thurstone before launch and after tools, descriptions, schemas, models, or browsers change.
> It is a testing and audit system for the declared contract—not runtime enforcement, certification,
> guaranteed security, or proof about arbitrary websites.

Finish on the Thurstone URL and Invarra attribution.

## Required capture checklist

- Final clean production SHA and `https://thurstone.invarra.ai` are visible or verifiable.
- Authentic external-agent Site Tools invocation; no internal substitute.
- Exact owner request and two agent-visible descriptors are shown.
- Trusted before/after state, ledger diff, verdict, and regression action are readable.
- Synthetic checkout disclosure remains visible; no purchase or external transaction occurs.
- Record at 16:9 with readable zoom, original narration, captions, and no credentials or personal
  tabs.
- Browser console has zero warning/error attributable to Thurstone.
- No secrets, capabilities, cookies, raw provider output, or private evidence appear.
- Reference scores remain `24/24` and separate `3/3`; no combined score.
- Uploaded public YouTube video is under three minutes and matches the deployed functionality.
