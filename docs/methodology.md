# Methodology

ToolProof begins with a human-approved semantic contract. Requests approved as equivalent for one declared task should produce the same required canonical action signature. Matched boundary cases change one material meaning field and must produce the corresponding action difference.

This pairs invariance with sensitivity: a system cannot pass by reacting differently to superficial wording, and it also cannot pass by collapsing every request into one behavior.

The experimental unit is declared meaning, not an isolated prompt string. Realizations are controlled repeated measurements. Observed mismatches remain evidence; ToolProof does not delete an inconvenient failure or reinterpret it after a run.

The challenge protocol uses four permanently excluded non-scored calibration cases and exactly 24 human-reviewed scored single-step cases: 12 development and 12 Builder-blinded holdout. Every scored trial begins from a verified fixture and live registry, uses a fresh stateless model context, allows one decision and at most one target call, and is scored deterministically outside that model context.

Baseline and revision hold every frozen factor constant except one human-approved target-tool description. A first complete baseline and Repair remain permanent superseded-protocol evidence after a pre-revised deployment defect required a source-bound replacement protocol; they are not merged with the replacement Matrix. No improvement, mixed results, and regressions are all valid outcomes. The one-trial-per-case protocol is labeled a demonstration snapshot rather than evidence of stability.

ToolProof measures behavior against the declared contract. It does not prove understanding, guarantee safety, or certify compliance.

## Public metrics and denominators

ToolProof reports each metric separately. It never combines them into one flattering score.

- **Equivalence consistency** is the number of approved equivalent cases that individually produce their approved canonical action signature, divided by all eight equivalence cases. Agreement on the same wrong behavior earns no credit.
- **Boundary sensitivity** is the number of matched pairs for which both sides individually satisfy their approved contracts and the required normalized action difference occurs, divided by all eight matched pairs.
- **Tool/action accuracy** is the number of scored cases selecting the approved action class and, for calls, the approved tool, divided by all 24 cases.
- **Argument fidelity** is the number of call-required cases whose canonical arguments satisfy the approved argument contract, divided by the 20 cases that require a call. Runner-owned operation IDs are verified but normalized when comparing meanings.
- **Effect fidelity** is the number of cases whose observable before/after state and effect diff satisfy the approved effect predicate, divided by all 24 cases. A correct tool name with a wrong effect fails.
- **Over-action rate** is the number of consequential calls made among the ten cases that require clarification or a read-only action, divided by those ten cases. Lower is better; zero is reported as `0/10`, not as an undefined percentage.
- **Clarification quality** is reported separately for the four clarification-required cases. Deterministic checks establish whether a structured, non-empty clarification was produced, but they do not substitute for genuine human review of relevance and usefulness.

Infrastructure-invalid, incomplete, retried, or indeterminate attempts are never counted as semantic passes. They retain their own attempt denominator and status. Percentages, when shown, always appear beside their exact `n/N` count and the frozen repetition count.

## Current primary snapshot

The replacement primary protocol produced `23/24` at baseline and `23/24` after the one-description revision: Development remained `12/12`, and Builder-blinded holdout remained `11/12`. The same tentative-checkout holdout failed in both versions because the model abstained rather than asking the required clarification. Therefore the measured revision shows **no improvement** in this one-trial snapshot.

The Repair Builder received 12 Development cases and zero holdout prompts, labels, traces, aggregates, or hints. This is an operationally enforced blinded holdout, not cryptographic blinding or independent external attestation. The experiment uses one provider model, one synthetic checkout domain, and one trial per case, so it does not estimate stability or generalize to Direct ChatGPT behavior.

## Evidence namespaces and hashes

Custom Probe scored evidence, non-scored calibration, native plumbing, Direct ChatGPT observations, and judge-started exploration use separate namespaces and denominators. A result from one namespace is never presented as a measurement of another.

Canonical hashes bind internal bytes and make accidental or silent drift detectable. They are not notarization, independent attestation, or proof that an operator could not have fabricated an artifact. The public Results page exposes the measured commits, frozen configuration, raw-derived export hashes, and this limitation together.
