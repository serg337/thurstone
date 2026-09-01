# WebMCP Challenge checklist

Official source: [webmcp.devpost.com/rules](https://webmcp.devpost.com/rules)

Last checked: **2026-09-01**

## Required project

- WebMCP-powered web application: complete
- Working live URL: [thurstone.invarra.ai](https://thurstone.invarra.ai)
- Accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome: verified
- Genuine non-trivial `document.modelContext.registerTool()` implementation: complete
- Functionality matches the submitted description and video: revised five-stage release candidate
  complete; exact-successor Production and final video checks pending

## Required submission material

- English project description explaining WebMCP fit, user experience, human-agent collaboration,
  and implementation: draft exists; final edit pending
- Public source repository with all required source and instructions: repository prepared; public
  transition pending
- Detectable open-source license in repository About section: MIT file present; GitHub About update
  pending public release
- Public YouTube demonstration with audio, under three minutes: pending human recording/upload
- Live URL and testing instructions in Devpost: pending final form completion

## Current technical status

- Primary production origin: `https://thurstone.invarra.ai`
- Primary judge workflow: five stages from semantic-boundary explanation through a real selected
  catalog, multi-case suite, nested selected-case arm, opaque fresh-agent handoff, explicit
  observation start, and Result v3
- BYOA catalog: two to four real reference tools selected from `cart_get`, `cart_update`,
  `order_review`, and `checkout_request`; one selected case and one eligible call per live trial
- Fresh handoff lifecycle: non-consuming landing, explicit one-time **Receive isolated test**
  claim, `RECEIVED`, `READY_TO_ARM`, explicit start, then exact catalog registration and bounded
  timer
- Trusted challenge state, suites, results, and My Tests v2: bounded browser-local site-owned data
- Redis Demo use: expiring digest-bound handoff/admission ledger only, not customer state or a
  customer database
- Initial WebMCP tools: `cart_get`, `cart_update`, `checkout_request`, `order_review`
- Pending-only tool: `checkout_cancel`
- Current semantic evaluation: 24/24 approved behaviors passed
- Current Invocation Integrity evaluation: 3/3 deterministic cases passed
- Deterministic diagnosis, controlled no-model-call mismatch, and My Tests v2
  save/export/edit/linked-rerun loop: complete
- One-call BYOA trials do not claim replay coverage; replay/idempotency remains in the separate
  Invocation Integrity matrix
- Built-in Browser fresh-agent selection and flagged-Chrome direct compatibility remain separate
  evidence tiers
- Full unit/integration, browser, accessibility, security, dependency, license, and secret-history
  checks: predecessor passing; complete exact-successor qualification pending R7 closeout
- Durable model-call guard: 160 calls / USD $10 lifetime ceiling

Supported-client limitation: Thurstone verifies that its own fresh page and handoff projection
withhold the owner answer. It cannot certify every consumer's hidden context or identity. Count an
independent-agent result only when an actually fresh supported built-in Browser task and authentic
native invocation are observed.

## Remaining human/public actions

1. Complete the final user walkthrough and exact-release authentic fresh-agent R8 capture.
2. Approve final legal claims, screenshots, and the captured video candidate.
3. Record/finalize and publicly upload the under-three-minute YouTube demo with audio and captions.
4. Make the GitHub repository public and verify the MIT license is visible in About.
5. Complete and submit the Devpost form.
6. Save the submission receipt and freeze the judged artifact through the judging period.

Judges are not required to test the live application and may judge from the description, images,
and video. The submission must therefore show the working product quickly and explain the value in
plain language.
