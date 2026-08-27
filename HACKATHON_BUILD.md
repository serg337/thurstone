# Challenge-period build record

## Before 25 August 2026

- The ToolProof name, high-level semantic-invariance idea, and planning material existed before the challenge period.
- No submitted public application code, WebMCP integration, deployment, evidence run, or release existed in this repository.

## Built during the challenge period

Work begins on 26 August 2026 and will be linked to ordinary timestamped commits as each gate passes:

| Area              | Challenge-period work                                                                                                          | Commit evidence                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Repository safety | Publication boundary, source exclusions, durable gate controls                                                                 | `72d8381`, `7a5714d`                                                        |
| Web application   | Studio, Lab, Results, responsive interface, diagnostics                                                                        | `6a42336`                                                                   |
| Native WebMCP     | Imperative registration, lifecycle manager, discovery/execution adapter                                                        | `850b151` (deployed Chrome discovery/invocation and rendered receipt)       |
| Sandbox           | Deterministic checkout/review store, five safe tools, replay tombstones, dynamic registry, native adapter, reset and traces    | Gate 1 local candidate complete; exact deployed/native-proof commit pending |
| Evaluation        | Immutable lifetime policy, signed-token/atomic Redis guard, disabled Probe routes; model runner/evidence lineage still pending | `86584fe` (Git-linked real Redis verification and zero-use guard init)      |
| Product evidence  | Meaning Matrix, inspector, exports, Direct ChatGPT observations                                                                | Pending                                                                     |
| Release           | CI, documentation, deployment, video package, submission and freeze records                                                    | `6a42336` (initial CI/docs; release pending)                                |

This file will be updated with real commit identifiers. History will not be backdated or rewritten to manufacture challenge-period evidence.
