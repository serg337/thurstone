# Rights and naming review

Checked: 2026-08-29. This is a bounded release-risk review, not a trademark clearance or legal opinion.

## Project-name search

A quick exact-name web search found several pre-existing software uses of “ToolProof” or
“Toolproof”:

- `toolproof.app`, a test framework for command-line and web applications;
- `toolproof.com`, an early-stage human/AI proof-based tools project;
- `github.com/Moshe-ship/toolproof`, an agent tool-verification project; and
- `kynth.studio/toolproof`, an AI-agent tooling measurement page.

The overlap is material because at least two uses concern software testing or agent-tool
verification. An indexed search did not establish an applicable registered mark, but absence of a
search result is not clearance.

For this challenge release, the project therefore uses the compound identification **ToolProof by
Invarra — created by Sergio Valencia** consistently, makes no claim to exclusivity, registration,
certification, or endorsement, and uses neither `™` nor `®`. The repository, deployment, and
submission describe the narrow WebMCP semantic-testing implementation rather than a broad product
category. This is the accepted challenge-release risk treatment; a broader commercial launch,
trademark filing, or enforcement decision requires a professional clearance review and a new human
decision. Renaming the frozen challenge evidence is not part of this release.

## Third-party product names and interface capture

OpenAI's current Site Tools documentation states that ChatGPT Work and Codex can discover and use
Site Tools in the ChatGPT desktop built-in browser. The demo uses “OpenAI,” “ChatGPT,” “Codex,” and
model names only to identify the authentically tested interoperability path. OpenAI's published
brand guidance requires accurate use, clear ownership, no implied sponsorship, and no more
prominence than the project's own identity.

The Direct Site Tools video excerpt is therefore limited to the minimum factual interface needed
to show the request, discovered Site Tool, native result, and resulting page effect. Account data
and unrelated interface are cropped; no OpenAI or Chrome logo is used in the thumbnail or end card;
the ToolProof identity remains primary; and both the video and application state that no
affiliation, certification, or endorsement is implied. The capture is demonstration evidence, not
an extracted or redistributed product asset.

References checked:

- https://learn.chatgpt.com/docs/webmcp
- https://openai.com/brand/
- https://developer.chrome.com/docs/ai/webmcp

## Project-authored image provenance

`public/toolproof-results.jpg` is a 1280×720 sRGB JPEG captured from the signed-out `/results`
route at `https://toolproof-rust.vercel.app` on deployment commit
`88deff46d4e06bb109158f7ef8a68e704f9fcc08` on 2026-08-29 at approximately `12:29:33Z`.
Its SHA-256 is `16d414589500895629ab72bbbe8603439b7372a1dfd43db36ead5736de0bf93c`.
It contains only the ToolProof interface and the authentic `23/24 → 23/24` result. Before the
evidence-build freeze, the image must be rechecked against the candidate's visible Results values;
if any visible claim differs, it must be recaptured from that candidate before commit.

The image was rechecked on 2026-08-29 after the current evidence-candidate build and browser suite:
the visible simulation notice, paired `23/24 → 23/24` result, Development `12/12 → 12/12`,
Builder-blinded holdout `11/12 → 11/12`, and no-improvement claim remain exact. No visible claim
depends on the later Direct-observation namespace or judge receipt.

The release uses the project-authored screenshot-derived thumbnail specified in
`docs/demo-script.md`. Any unrelated thumbnail already present in an authenticated Devpost draft
must be replaced; it may be retained only if Sergio separately verifies its creator, source,
license, and correspondence to the submitted build during the reserved final media review.

No third-party stock image, icon, font file, music, video, sound, or dataset is distributed by the
repository.
