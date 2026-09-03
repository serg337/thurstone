# GitHub release draft — Thurstone challenge submission

Planned tag: `challenge-submission-v1.0.0`

This draft must not be published until the repository-publication gate. Replace the angle-bracket
fields only after exact release verification.

## Thurstone: semantic release testing for WebMCP

WebMCP makes website tools callable. It does not guarantee correct tool choice or permitted
effects.

Thurstone lets a website owner define what a request should mean, lets a visitor's supported agent
use the live WebMCP catalog, and checks whether the native action, canonical arguments, and trusted
site state match the owner's contract.

## What is included

- No-authoring three-case Judge Quick Start with a normal live baseline, disclosed deterministic
  site fault, authentic semantic collision, and full Judge Results report
- Automatic receive, arm, and case advance after the user selects Browser from ChatGPT's `@` menu
  and sends the copied `Open https://…` command; no visual Browser computer-control clicks required
- One-to-four-tool live reference catalog
- JSON-Schema-derived contract authoring
- Independent regression queues that continue after issues
- Stateful continuous journeys that stop before later requests inherit untrusted state
- Fresh ChatGPT desktop Browser handoff
- Native WebMCP invocation capture
- Trusted before/after state and append-only ledger verification
- Deterministic PASS / ISSUE / INCOMPLETE / UNAVAILABLE / NOT RUN results
- Evidence-backed diagnosis and saved regression cases
- Controlled provider-free mismatch demonstration
- Public sample native checkout receipt
- Bounded semantic and Invocation Integrity reference evidence

## Try it

- Live: https://thurstone.invarra.ai
- Judge quick start: https://thurstone.invarra.ai/judge
- Demo: https://thurstone.invarra.ai/demo
- Public sample: https://github.com/serg337/thurstone/blob/challenge-submission-v1.0.0/evidence/sample-report.md
- Video: <PUBLIC_YOUTUBE_URL>

## Release identity

- Evidence-bearing semantic build: `9d5afd81ead84dd4a6bbc1b1c9898ea664646b1a`
- Pre-recording candidate: `<PRE_RECORDING_SHA>`
- Final release SHA: `<RELEASE_SHA>`
- Production deployment: `<DEPLOYMENT_ID>`
- Tag: `challenge-submission-v1.0.0`

The final release is permitted to differ from the pre-recording candidate only in approved public
link fields. Runtime, dependencies, WebMCP catalog, schemas, handlers, fixture, evaluator, reference
cases, and canonical evidence must remain unchanged.

## Evidence boundaries

- Current successor semantic snapshot: `24/24`, one trial per frozen case; bounded reference
  regression, not an independent benchmark.
- Historical paired experiment: `23/24 → 23/24`, no measured improvement; separate protocol.
- Invocation Integrity: separate `3/3`, four deterministic native calls, zero model calls.
- Public sample: authentic Chrome 152 native compatibility PASS, not answer-isolated model
  selection.
- Controlled mismatch: deterministic no-model demonstration, not an agent failure.

Thurstone is a pre-release testing and audit system—not runtime enforcement, certification,
guaranteed security, statistical proof of model understanding, or arbitrary-site verification.

## Provenance and license

Thurstone product work began August 26, 2026 during the OpenAI WebMCP Challenge. Earlier LIP and CSR
measurement notes supplied conceptual background only.

Original Thurstone repository material is MIT-licensed by Sergio Valencia. Third-party components
remain under the licenses documented in `THIRD_PARTY_NOTICES.md`.

The checkout is simulated. No purchase, payment, shipment, inventory change, message, or external
transaction occurs.
