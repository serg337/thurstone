# WebMCP Challenge checklist

Official source: [webmcp.devpost.com/rules](https://webmcp.devpost.com/rules)

Last checked: **2026-08-31**

## Required project

- WebMCP-powered web application: complete
- Working live URL: [thurstone.invarra.ai](https://thurstone.invarra.ai)
- Accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome: verified
- Genuine non-trivial `document.modelContext.registerTool()` implementation: complete
- Functionality matches the submitted description and video: final video check pending

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
- Initial WebMCP tools: `cart_get`, `cart_update`, `checkout_request`, `order_review`
- Pending-only tool: `checkout_cancel`
- Current semantic evaluation: 24/24 approved behaviors passed
- Current Invocation Integrity evaluation: 3/3 deterministic cases passed
- Full unit/integration, browser, accessibility, security, dependency, license, and secret-history
  checks: passing
- Durable model-call guard: 160 calls / USD $10 lifetime ceiling

## Remaining human/public actions

1. Approve final claims, screenshots, and video script.
2. Record and publicly upload the under-three-minute YouTube demo.
3. Make the GitHub repository public and verify the MIT license is visible in About.
4. Complete and submit the Devpost form.
5. Save the submission receipt and freeze the judged artifact through the judging period.

Judges are not required to test the live application and may judge from the description, images,
and video. The submission must therefore show the working product quickly and explain the value in
plain language.
