# OpenAI WebMCP Challenge compliance

Last verified against the live challenge pages: **2026-09-03**

- [Challenge overview](https://webmcp.devpost.com/)
- [Official rules](https://webmcp.devpost.com/rules)
- [Resources and FAQ](https://webmcp.devpost.com/resources)
- Submission deadline: **September 3, 2026 at 1:00 p.m. PDT / 20:00 UTC / 22:00 CEST**
- Judging access must remain free and unrestricted through **September 21, 2026 at 5:00 p.m. PDT /
  September 22 at 02:00 CEST**

The official rules and challenge website control if this file conflicts with them.

## Requirement-to-evidence matrix

| Requirement                                                                | Authoritative source                                                    | Thurstone response                                                                                                                                                                 | Verification evidence                                                                                | Status                                         | Owner  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| Build a WebMCP-powered app where people and agents interact or collaborate | [Overview — What to Build](https://webmcp.devpost.com/#requirements)    | The owner defines intended meaning; a visitor's agent uses the live WebMCP tools; Thurstone verifies whether the native action and page state match that meaning.                  | [`README.md`](README.md#what-the-human-and-agent-do-together), production Demo                       | Ready                                          | Codex  |
| Project functions consistently as depicted                                 | [Rules §4 — Functionality](https://webmcp.devpost.com/rules)            | The judge quick start, reference checkout, contract builder, regression queue, continuous journey, native adapter, and results are exercised by automated and manual verification. | CI, [`docs/testing.md`](docs/testing.md), `/api/health`                                              | Ready                                          | Codex  |
| New project or meaningful challenge-period extension                       | [Rules §4 — New & Existing](https://webmcp.devpost.com/rules)           | Thurstone product work began August 26, 2026. LIP and CSR from June 28 are conceptual background only; no Thurstone software, catalog, or agent path predated the challenge.       | Git history, [`README.md`](README.md#built-during-the-challenge)                                     | Ready                                          | Codex  |
| Authorized third-party SDK/API/data use                                    | [Rules §4 — Third Party Integrations](https://webmcp.devpost.com/rules) | All dependencies, adapted source, services, and assets are inventoried with licenses and notices.                                                                                  | [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), [`docs/rights-review.md`](docs/rights-review.md) | Ready; final human rights confirmation pending | Sergio |
| Working live URL in ChatGPT in-app Browser or WebMCP-enabled Chrome        | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | `https://thurstone.invarra.ai` is a signed-out HTTPS deployment. The full agent path uses ChatGPT's built-in Browser; Chrome 149+ supports direct native compatibility testing.    | Production health, browser evidence, [`docs/testing.md`](docs/testing.md)                            | Ready                                          | Codex  |
| Explain why the use case fits WebMCP                                       | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | WebMCP makes the catalog, native invocation, structured arguments, and site effects observable as one contract.                                                                    | [`submission/devpost.md`](submission/devpost.md)                                                     | Ready                                          | Codex  |
| Explain the better user experience                                         | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | Owners catch semantic failures before release; visitors receive agent behavior that better matches their intent and clarification boundaries.                                      | [`submission/devpost.md`](submission/devpost.md)                                                     | Ready                                          | Codex  |
| Explain what people and agents can do together                             | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | The owner supplies meaning and policy, the visitor's agent supplies real consumer behavior, and Thurstone verifies trusted site reality.                                           | [`README.md`](README.md#what-the-human-and-agent-do-together), Devpost copy                          | Ready                                          | Codex  |
| Briefly explain the WebMCP implementation                                  | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | Checked-in source registers real tools, verifies discovery, admits one native action per case, and evaluates canonical arguments plus trusted effects.                             | [`README.md`](README.md#where-the-webmcp-is)                                                         | Ready                                          | Codex  |
| Public source repository                                                   | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | Planned URL: `https://github.com/serg337/thurstone`. The repository remains private until the approved final publication step.                                                     | GitHub visibility check                                                                              | Pending final human-authorized release         | Codex  |
| Repository contains functional source, assets, and instructions            | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | Application, WebMCP source, evidence, tests, deployment instructions, and local setup are included without private control files.                                                  | README, clean-clone verification, publication scan                                                   | Ready before visibility transition             | Codex  |
| Detectable open-source license visible in repository About                 | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | Root MIT license names Sergio Valencia; GitHub detects it as MIT.                                                                                                                  | [`LICENSE`](LICENSE), GitHub metadata                                                                | Ready before visibility transition             | Codex  |
| Checked-in `document.modelContext.registerTool(...)` implementation        | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | The central registry passes complete checked-in tool definitions to `ModelContext.registerTool()` with cancellation.                                                               | [`lib/webmcp/registry-manager.ts`](lib/webmcp/registry-manager.ts#L657-L677)                         | Ready                                          | Codex  |
| Public YouTube video, clear demo with audio, under three minutes           | [Submission Requirements](https://webmcp.devpost.com/#requirements)     | A 2:40–2:50 recording package is prepared against the frozen pre-recording candidate.                                                                                              | [`docs/demo-script.md`](docs/demo-script.md), `submission/media/`                                    | Pending Sergio recording/upload/publication    | Sergio |
| Video uses only authorized third-party marks/music/material                | [Rules §4 — Video](https://webmcp.devpost.com/rules)                    | Original narration and project-owned assets; no music. Necessary product UI must follow applicable brand guidance and receive Sergio's final rights approval.                      | Rights checklist and frame review                                                                    | Pending final human confirmation               | Sergio |
| Project remains free and unrestricted through judging                      | [Rules §4 — Testing](https://webmcp.devpost.com/rules)                  | No Thurstone account, paywall, payment, or project API key is required for judges. Production must remain operational through the judging deadline.                                | Signed-out production checks                                                                         | Ready; operational obligation remains          | Sergio |
| All submission materials are English                                       | [Rules §4 — Language](https://webmcp.devpost.com/rules)                 | App, repository, Devpost copy, video script, captions, and testing instructions are English.                                                                                       | Collateral review                                                                                    | Ready                                          | Codex  |
| Submission is original, entrant-owned, and non-infringing                  | [Rules §4 — Ownership/IP](https://webmcp.devpost.com/rules)             | Entrant-created material is owned by Sergio Valencia; third-party material remains under documented licenses.                                                                      | License, notices, rights review                                                                      | Pending Sergio certification                   | Sergio |
| Complete all required Devpost fields and formally submit before deadline   | [Rules §4 — How To Enter](https://webmcp.devpost.com/rules)             | Paste-ready content is maintained in `submission/devpost.md`; final acceptance and Submit are reserved for Sergio.                                                                 | Devpost receipt                                                                                      | Pending Sergio                                 | Sergio |

## Current product truth

- Canonical URL: `https://thurstone.invarra.ai`
- Judge quick start: `/judge` preloads a normal baseline, disclosed deterministic site fault, and
  authentic semantic collision; one Arm action creates an answer-isolated three-case regression
  handoff; the owner page tracks progress and automatically opens a full Judge Results report
- Owner workflow: understand the boundary → configure one to four real tools → build contract cases →
  choose regression suite or continuous journey → arm one secure queue → inspect synchronized results
- Regression suite: one agent chat, clean fixture per request, every independent case runs even
  after an issue
- Continuous journey: one agent context and carried state, repeated tools allowed, stops at the first
  issue, optional owner-selected process-ending tool must appear last
- Agent command: contains every owner-authorized request but no expected actions, effects,
  assertions, or diagnoses
- Native admission: one eligible native action per case; later or concurrent attempts reject before
  domain execution
- Trusted evidence: canonical arguments, native trace, browser-local site-owned state, append-only
  ledger, assertions, diagnosis, and result
- Results: PASS, ISSUE, INCOMPLETE, UNAVAILABLE, plus NOT RUN when a stateful journey stops
- Controlled example: deterministic wrong real native call, explicitly no model call and never an
  agent-performance claim
- Initial catalog: `cart_get`, `cart_update`, `checkout_request`, `order_review`
- Pending-only Lab tool: `checkout_cancel`

## Evidence boundaries

- Current successor semantic snapshot: `24/24`, one trial per frozen case. Bounded reference
  regression, not an independent benchmark.
- Historical paired experiment: `23/24 → 23/24`, one description changed, no measured improvement.
  Different protocol; not the predecessor of the current snapshot.
- Invocation Integrity: separate `3/3`, four deterministic native calls, zero model calls.
- Direct Site Tools observations: separate fresh-context observations.
- Controlled mismatch and judge-created Demo results never alter any reference denominator.

## Final reserved actions

1. Freeze and deploy the exact pre-recording candidate.
2. Sergio records and uploads the under-three-minute video as unlisted.
3. After Sergio's legal/publication approval, add final links only and create the final release SHA.
4. Make the repository public, verify MIT detection, and create the annotated release tag.
5. Make the video public and verify it signed out.
6. Sergio accepts the legal terms and submits the Devpost entry.
7. Record the receipt and freeze the repository, deployment, release, video, and submission.

Judges are not required to run the application. The video, description, screenshots, and repository
must therefore communicate the product truth without relying on a successful live test.
