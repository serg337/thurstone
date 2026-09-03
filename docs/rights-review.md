# Rights, privacy, and claims review

Technical verification can inventory files and licenses. Sergio Valencia must personally confirm
ownership, permissions, eligibility, publicity consent, and the final video frames before release.

## Entrant and ownership

- Legal entrant, repository owner, copyright owner, and potential prize recipient: **Sergio
  Valencia, individual**.
- Public presentation: **Thurstone by Invarra**.
- Invarra is a research/presentation brand, not an incorporated entrant.
- Entrant-created Thurstone source and assets are licensed under the repository's MIT license.
- Third-party/open-source components are used under their own recorded licenses and are not claimed
  as Sergio's property.
- No other Invarra product is part of the entry.

## Challenge-period provenance

- Thurstone product work began August 26, 2026 during the challenge.
- Application code, reference WebMCP catalog, owner contract system, supported-agent path, native
  invocation capture, state/effect verification, evidence system, Demo, and judge UX are
  challenge-period work.
- LIP and CSR were published June 28, 2026 and are conceptual background only.
- Git history is the source for dated implementation provenance.

## Source and dependency rights

- Root license: MIT, `Copyright (c) 2026 Sergio Valencia`.
- Complete npm dependency and adapted-source inventory:
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- GoogleChromeLabs native browser patterns are adapted under the recorded Apache-2.0 license.
- Managed services are identified factually; their names do not imply sponsorship or endorsement.
- The repository must preserve required notices and must not relicense third-party material as
  original Thurstone code.

## Project-owned assets

| Asset                               | Purpose                          | Rights basis                                                             |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `public/thurstone-thumbnail.png`    | Devpost thumbnail/master artwork | Sergio-supplied and owned; final Sergio confirmation required            |
| `public/thurstone-hero.webp`        | Responsive derivative            | Deterministically derived from the owned master                          |
| `public/thurstone-og.png`           | Social/16:9 derivative           | Deterministically derived from the owned master                          |
| `public/thurstone-mark.png`         | Header/favicon mark              | Project-owned Thurstone derivative                                       |
| Project CSS, text, and inline icons | Product interface                | Entrant-created challenge work                                           |
| Gallery screenshots                 | Submission media                 | Must show only the verified Thurstone product and authorized consumer UI |
| Narration and captions              | Demo video                       | Original Sergio narration and submission-authored captions               |

The removed cross-product logo is not part of the candidate or media package.

## Video and gallery frame review

Before publication, inspect every frame and screenshot:

- no secret, API key, cookie, environment value, opaque handoff token, private URL, personal tab,
  email address, browsing history, or local filesystem path;
- no unlicensed music, stock image, font, icon, animation, or third-party promotional asset;
- no third-party product logo used as decoration;
- any necessary ChatGPT or Chrome interface appears only to demonstrate compatible operation,
  follows applicable brand guidance, remains less prominent than Thurstone, and does not imply
  endorsement;
- no private source-of-truth or `.toolproof-local` material;
- no unsupported score, fabricated receipt, or staged model failure;
- controlled mismatch visibly says **Controlled example — no model call**;
- synthetic checkout/no-purchase boundary is stated in narration and context.

Relevant brand guidance:

- OpenAI: <https://openai.com/brand/>
- Google permissions/brand resources: <https://about.google/brand-resource-center/>

If rights to any frame are uncertain, crop or replace it rather than assume permission.

## Privacy and data boundary

The challenge application uses fictional checkout data. It has no customer accounts, payment
details, real inventory, messaging, shipment, or external transaction path.

Public artifacts must not contain:

- provider keys or deployment secrets;
- handoff or recovery capabilities;
- raw private provider responses;
- customer, credential, payment, or personal data;
- browsing history or local machine paths;
- ignored operator records.

The judge-facing contract, test state, and results are bounded browser-local site-owned data.
Upstash stores only short-lived digest-bound handoff/admission state and permanent guard/evidence
records required by the declared evaluation history.

## Approved claim boundary

Approved:

> WebMCP makes website tools callable. It does not guarantee correct tool choice or permitted
> effects.

> The owner defines what a request should mean. A visitor's agent uses the live WebMCP tools.
> Thurstone checks whether the action and page state match that meaning.

> Thurstone tests whether the observed WebMCP action, canonical arguments, and trusted site effect
> satisfy an owner-defined contract for the tested build.

Not approved:

- winner, best, certified, secure, safe, production-proof, or statistically conclusive;
- proof of model understanding or private model reasoning;
- runtime enforcement or guaranteed prevention;
- arbitrary-site verification;
- `24/24` as an independent benchmark;
- `24/24` and `3/3` as a combined score;
- the Field notebook/Stoneware mug contract disagreement as an agent error;
- the controlled mismatch as authentic model evidence;
- the historical `23/24 → 23/24` pair as the predecessor of the separate current `24/24` snapshot;
- affiliation with or endorsement by OpenAI, Google, Chrome, Devpost, or WebMCP authors.

## Final human confirmation

Sergio must personally confirm:

- eligibility and absence of prohibited conflicts;
- ownership of entrant-created code and artwork;
- permission for every third-party item shown;
- accuracy of the new-versus-pre-existing boundary;
- acceptance of the challenge, Devpost, publicity, liability, dispute, and tax terms;
- final video, gallery, public release, and Devpost claims.

Codex may audit and prepare these materials but cannot make those personal legal attestations.
