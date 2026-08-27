# Official source check

Checked: **2026-08-26**; Chrome 151 runtime clarification: **2026-08-27**
Scope: current primary official WebMCP Challenge, OpenAI Site Tools, WebMCP draft, and Chrome implementation guidance only.

The authenticated Devpost draft form was also inventoried read-only on 2026-08-26. Required fields cover project name/elevator pitch, public project story and technology tags, try-it links/media/video, entrant/status/country, live URL and optional private testing instructions, public licensed repository, tested WebMCP clients, AI development tools, and learning/career-value questions. No final submission or certification was performed; dynamic choices and final acknowledgments require release-time recheck.

Every URL below returned HTTP 200 at retrieval. Material requirements are mapped to planned or completed public evidence in [`CHALLENGE.md`](../CHALLENGE.md). No unofficial post, search snippet, secondary article, or generated summary is treated as authority.

## Challenge sources

| Official source   | URL                                      | Current signal on 2026-08-26                                                                                                                          | Matrix coverage                               |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Devpost Overview  | https://webmcp.devpost.com/              | Deadline September 3, 2026 at 1:00 p.m. PDT; working URL, description, sub-three-minute audio demo, public licensed repository; four judging criteria | C-012, C-015, C-021–C-034, C-045–C-049, X-002 |
| Official Rules    | https://webmcp.devpost.com/rules         | Controlling eligibility, dates, project/submission requirements, video, freeze, judging, IP, and precedence terms                                     | C-001–C-055, C-057, X-001–X-004               |
| Resources and FAQ | https://webmcp.devpost.com/resources     | Starter guidance plus 15 question-and-answer entries and AI-use guidance                                                                              | F-001–F-017, X-002, X-004                     |
| Dates             | https://webmcp.devpost.com/details/dates | Schedule shows submissions beginning August 25 at noon PDT, ending September 3 at 1:00 p.m.; judging and announcement match the Rules                 | C-002–C-004, X-001                            |
| Updates           | https://webmcp.devpost.com/updates       | No organizer announcement posted; page says announcements will appear here and be emailed to registered participants                                  | C-053, C-056                                  |

## Technical sources

| Official source        | URL                                                           | Material content checked                                                                                                                                                                                      | Matrix coverage                        |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| OpenAI Site Tools      | https://learn.chatgpt.com/docs/webmcp                         | ChatGPT implementation/availability; page-bound discovery; safety review; feature detection; `registerTool`; narrow inputs; existing auth/validation; human UI fallback                                       | T-001, T-002, T-005–T-006, T-015–T-020 |
| WebMCP draft           | https://webmachinelearning.github.io/webmcp/                  | Secure-context provider/consumer API; tool metadata and schemas; registration, discovery, object-form execution, cancellation, origins, annotations; security/privacy risks and mitigations; declarative TODO | T-001–T-017, T-026–T-030               |
| Chrome WebMCP overview | https://developer.chrome.com/docs/ai/webmcp                   | Chrome 149 origin trial/flag; imperative and declarative surfaces; limitations; origin isolation; `tools` Permissions Policy; inspector/testing guidance                                                      | T-001, T-011–T-012, T-019–T-020        |
| Chrome Imperative API  | https://developer.chrome.com/docs/ai/webmcp/imperative-api    | `registerTool`, lifecycle/cancellation, `getTools`, JSON-string-form `executeTool`, `toolchange`, cross-origin iframe two-sided opt-in                                                                        | T-003, T-007–T-011                     |
| Chrome best practices  | https://developer.chrome.com/docs/ai/webmcp/best-practices    | Tool strategy; clear language; narrow schemas; low model burden; reliability; evaluation-driven development                                                                                                   | T-005, T-021–T-025                     |
| Chrome tool security   | https://developer.chrome.com/docs/ai/webmcp/secure-tools      | Prompt injection warning; annotation hints; least origin exposure; character budgets                                                                                                                          | T-013, T-026, T-029–T-030              |
| Chrome evals           | https://developer.chrome.com/docs/ai/webmcp/evals             | Model touchpoints; failure modes; isolated/state-complete tool tests; deterministic and probabilistic tests; end-to-end order; mid-chain failure                                                              | T-031–T-038                            |
| Chrome DevTools WebMCP | https://developer.chrome.com/docs/devtools/application/webmcp | Available/Invoked tools; status/input/output; manual execution; schema/rejection troubleshooting; automation flag                                                                                             | T-039–T-042                            |

### Chrome 151 consumer descriptor clarification

The exact Chrome 151 source family used for ToolProof's supported path stores a registered `inputSchema` as serialized JSON and returns that string from `getTools()`, while preserving any supplied title. The matching official browser tests require both behaviors:

- [Chrome 151 registration and discovery implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.82/third_party/blink/renderer/core/script_tools/model_context.cc#333)
- [Chrome 151 discovered-tool string schema IDL](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.82/third_party/blink/renderer/core/script_tools/model_context_testing.idl#5)
- [Chrome 151 serialized-schema browser test](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.82/third_party/blink/web_tests/external/wpt/webmcp/imperative/exposedTo-defaults-same-origin.https.html#23)
- [Chrome 151 title-preservation browser test](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.82/third_party/blink/web_tests/external/wpt/webmcp/imperative/register-tool-title.https.html#14)

ToolProof therefore normalizes only object-versus-serialized-JSON schema representation at discovery. Parsed schema content, supplied title, description, annotations, owner, origin, and exact catalog names remain fail-closed comparisons.

## FAQ completeness check

The Resources page contained these 15 questions at retrieval; all have a dedicated matrix row:

1. Can I participate solo, on a team, or as an organization? — F-001
2. Is there a limit on team size? — F-002
3. Can I work on a project I already started? — F-003
4. Do judges test my project? — F-004
5. I've never built with WebMCP before. Can I still compete? — F-005
6. Do I need a private repo option? — F-006
7. Do I need an OpenAI account, Codex, or credits to build? — F-007
8. Which browser do I need? — F-008
9. Do I have to pay to host my project? — F-009
10. What do I need to submit? — F-010
11. Can judges build my project from scratch to test it? — F-011
12. I have a question the FAQ didn't answer. Where do I go? — F-012
13. Does my project have to be public? — F-013
14. Do I need a demo video? — F-014
15. Can I edit my submission after the deadline? — F-015

The unnumbered “Using AI to build your project” guidance is separately preserved as F-016 and F-017.

## Precedence decisions and anomalies

| Issue                                 | Official text in tension                                                                                                                                          | Applied decision                                                                                                                                                                                                   | Blocking?                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 11:00 a.m. versus noon start          | Rules: August 25 at 11:00 a.m. PT. Dates: August 25 at noon PDT.                                                                                                  | The Rules expressly prevail over inconsistent challenge materials, so 11:00 a.m. controls. Genuine ToolProof history must remain after both times.                                                                 | No                                       |
| “Since there's no video” fragment     | One sentence in “Do judges test my project?” says there is no video. The Rules, Overview, “What do I need to submit?”, and “Do I need a demo video?” require one. | Treat the isolated fragment as a typo. A public YouTube demo with audio, under three minutes, is mandatory.                                                                                                        | No                                       |
| Multiple-submission wording           | The Rules prohibit more than one submission, then refer to an entrant's “other Submissions.”                                                                      | Follow the strict first clause and submit ToolProof only once.                                                                                                                                                     | No                                       |
| Post-deadline mutation                | Rules prohibit changes to the Submission; FAQ warns against changing the Devpost entry, repository, or live site during judging.                                  | Follow the stricter FAQ operational boundary and freeze all judged artifacts.                                                                                                                                      | No                                       |
| `executeTool` argument representation | The current draft declares an object argument; Chrome's current implementation guide documents a valid JSON string.                                               | Support both only inside one narrow adapter, select a mode once with a harmless read-only compatibility tool, freeze it in the readiness receipt, and never retry a scored or mutating call with another encoding. | No; must be proven in the target runtime |
| Updates                               | The Updates page contains no amendment at retrieval.                                                                                                              | Continue monitoring it and registered-participant email; any later amendment triggers a new check.                                                                                                                 | No                                       |

Unresolved official conflicts requiring an entrant decision: **none as of 2026-08-26**. The wording anomalies above are retained publicly and handled conservatively rather than erased.

## Required repeat check

Repeat this same primary-source check immediately before public release and immediately before final submission. Record:

- retrieval date;
- HTTP/final-URL result;
- any added, removed, or changed Rule, FAQ question, Update, date, submission field, judging criterion, API behavior, client availability, security advice, or eval guidance;
- the exact affected `CHALLENGE.md` rows and evidence;
- any written organizer clarification.

Do not remove an older check. Append a dated change record so the public audit trail remains intact.

## Change record

| Date       | Result                                       | Material change                                                                                                                                                                                       |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Initial primary-source verification complete | Established the full challenge matrix, all 15 FAQ rows, the controlling 11:00 a.m. start, mandatory-video decision, current no-update state, and technical implementation/security/eval requirements. |
| 2026-08-27 | Chrome 151 runtime clarification recorded    | Verified serialized discovered schemas and supplied-title preservation in the M151 implementation and official browser tests; narrowed ToolProof normalization to schema transport only.              |
