# ToolProof execution plan

Snapshot date: **2026-08-29, immediately before the evidence-build deployment**. This table is a
historical execution checkpoint, not a mutable post-release dashboard. Gates 7–9 below intentionally
show the state at freeze preparation; the deployed health/status receipts, public release, and
durable submission manifest are authoritative for later terminal state. Status values are `pending`,
`in progress`, `human gate`, `blocked`, or `complete`. A gate is complete only with linked
reproducible proof.

| Gate | Scope                                                                                                                                     | Depends on | Pass evidence                                                                                            | Status                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0    | Authority, environment, repository, official requirements, HTTPS/native proof, provider/fallback and immutable lifetime-control preflight | None       | Deployed native observation, verified production capability/provider/store receipts, and Gate 0 ledger   | Complete                                  |
| 1    | Deterministic five-tool sandbox, shared reducer, registry lifecycle, reset, native discovery/execution plumbing                           | Gate 0     | Green deterministic/integration tests and native invocation receipts for every active tool               | Complete                                  |
| 2    | Four non-scored fresh-context model-selection calibration cases                                                                           | Gate 1     | Authentic model choice → native execution → state/effect trace → deterministic score, with leakage tests | Complete                                  |
| 3    | Studio, human-reviewed semantic contract, exact 24-case 12/12 suite, protocol freeze                                                      | Gate 2     | Human approval receipt and canonical freeze hashes                                                       | Complete                                  |
| 4    | Complete frozen v1 baseline                                                                                                               | Gate 3     | Terminal schedule receipt and raw-to-aggregate verification                                              | Complete                                  |
| 5    | Isolated development-only repair, one approved description change, unchanged v2 rerun                                                     | Gate 4     | Human revision approval, one-variable diff, terminal v2 receipt                                          | Complete                                  |
| 6    | Trace-derived Meaning Matrix, inspector, JSON/Markdown exports                                                                            | Gate 5     | Clean recomputation matches UI and exports byte-for-byte                                                 | Complete                                  |
| 7    | Final adversarial security/control verification, accessibility, signed-out browser path, Direct ChatGPT observations                      | Gate 6     | Automated checks plus real deployed browser evidence                                                     | In progress — exact judge receipt pending |
| 8    | Private public-ready repository, release-candidate deployment, clean clone, final docs and capture package                                | Gate 7     | Green publication audit and release-candidate approval package                                           | In progress — clean-clone/final audit     |
| 9    | Human approval, collateral-only release commit, public repository/tag/release, video, Devpost receipt, freeze                             | Gate 8     | One truthful immutable submission chain and freeze receipt                                               | Pending                                   |

P1 is deliberately deferred: higher-repetition follow-up, hot tool swapping, multi-step cases, second reviewer, generic contract import/export, and broader browser polish.
