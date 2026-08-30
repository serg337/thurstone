# Rights and naming review

Checked: 2026-08-29. This is a bounded release-risk review, not a trademark clearance or legal opinion.

## Project-name search and rename continuity

A fresh exact-name web search for **Thurstone** found an established scientific surname and method,
plus a current open-source/PyPI software package using the bare lowercase name for Thurstone-model
ability estimation:

- `github.com/microprediction/thurstone`;
- `pypi.org/project/thurstone/`; and
- `thurstone.microprediction.org`.

These uses are in statistical/rating software rather than WebMCP semantic testing, but they make a
claim of exclusivity inappropriate. The indexed search did not establish an applicable registered
mark; absence from an indexed search is not trademark clearance or a legal conclusion.

The earlier working-name review found several unrelated software uses of “ToolProof” or
“Toolproof,” including agent/tool-testing projects. Sergio adopted **Thurstone** as the current
public product name on 29 August 2026. The challenge evidence had already been captured under the
ToolProof working name, so immutable evidence files, protocol/version identifiers, environment
names, storage keys, and the original deployment origin retain that historical namespace. They are
not current branding and are not rewritten.

For this challenge release, the project uses the compound identification **Thurstone by Invarra —
created by Sergio Valencia**, makes no claim to exclusivity, registration, certification, or
endorsement, and uses neither `™` nor `®`. It does not claim affiliation with Louis Leon Thurstone,
the statistical software package, its maintainers, or any other namesake. A broader commercial
launch, trademark filing, or enforcement decision requires professional clearance and a new human
decision.

## Third-party product names and interface capture

OpenAI's current Site Tools documentation states that ChatGPT Work and Codex can discover and use
Site Tools in the ChatGPT desktop built-in browser. The demo uses “OpenAI,” “ChatGPT,” “Codex,” and
model names only to identify the authentically tested interoperability path. OpenAI's published
brand guidance requires accurate use, clear ownership, no implied sponsorship, and no more
prominence than the project's own identity.

The Direct Site Tools video excerpt is therefore limited to the minimum factual interface needed
to show the request, discovered Site Tool, native result, and resulting page effect. Account data
and unrelated interface are cropped; no OpenAI or Chrome logo is used in the thumbnail or end card;
the Thurstone identity remains primary; and both the video and application state that no
affiliation, certification, or endorsement is implied. The capture is demonstration evidence, not
an extracted or redistributed product asset.

References checked:

- https://learn.chatgpt.com/docs/webmcp
- https://openai.com/brand/
- https://developer.chrome.com/docs/ai/webmcp

## Project-authored image provenance

`public/toolproof-results.jpg` is a legacy-path 1280×720 sRGB JPEG captured from the signed-out `/results`
route at `https://toolproof-rust.vercel.app` on deployment commit
`88deff46d4e06bb109158f7ef8a68e704f9fcc08` on 2026-08-29 at approximately `12:29:33Z`.
Its SHA-256 is `16d414589500895629ab72bbbe8603439b7372a1dfd43db36ead5736de0bf93c`.
The retained evidence-build image shows the then-current ToolProof working name and the authentic
`23/24 → 23/24` result. It remains byte-identical historical evidence.

The current release uses a separate `public/thurstone-results.jpg`, captured from the signed-out
evidence-build Results page at `2026-08-29T17:39:29.381Z`. Before the rebrand deployment existed, the
page DOM changed only the project-owned `ToolProof`/`TP` header, footer, and document title to the
exact pending source values `Thurstone`/`TH`; the trace-derived result content was not edited. The
JPEG is 1280×720 sRGB, 113,108 bytes, with SHA-256
`ba0813d9ae761358e483642b6730712456a4693d79558e25c25252b92a327d1f`. Its inherited browser ICC
profile was removed without changing any decoded pixel (`compare -metric AE` returned `0`), so no
third-party profile or copyright metadata is distributed. After the exact rebrand deployment, the
signed-out production asset returned 113,108 bytes with that same SHA-256. This exact deployed-byte
receipt closed the Gate 8 equality condition; the older historical image remains unmodified and is
not relabeled.

The underlying Results claims used in both images were rechecked on 2026-08-29 after the evidence
candidate and browser suite: the visible simulation notice, paired `23/24 → 23/24` result,
Development `12/12 → 12/12`, Builder-blinded holdout `11/12 → 11/12`, and no-improvement claim
remain exact. No visible claim depends on the later Direct-observation namespace or judge receipt.

The final Devpost image is `public/thurstone-devpost-thumbnail.jpg`, deterministically derived from
the verified `public/thurstone-results.jpg` source using only a project-owned SVG text overlay. The
thumbnail is a 1200×800 JPEG, 148,339 bytes, with SHA-256
`9145872a26f156dadd9f2384b97c54eda7ef13a686c4e478eab384ef75121b15`; the source SHA-256 is
`ba0813d9ae761358e483642b6730712456a4693d79558e25c25252b92a327d1f`. It contains no ICC, EXIF, or
XMP metadata and no third-party logo, image, or font asset. The unrelated thumbnail already present
in the authenticated Devpost draft must be replaced with this exact tracked file.

No third-party stock image, icon, font file, music, video, sound, or dataset is distributed by the
repository.
