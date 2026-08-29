# ToolProof authentic Custom Probe reference evidence

- Evidence package: `a449db4b1faacdbaab58777923d2ddbde75396b70fa4744b29d0eb8e97089a46`
- Baseline: `run_2908682014ae50aece589f` / `74df2f5141c3c5db52b59104b3edfc950296431d4db337d939a9d9a2e57206a3`
- Revised: `run_673d38da1780f916abcc38` / `d82d7657723ad51a40426c2c111828e02d7cf358b2f171396a7d830dc1b411a4`
- Outcome: **23/24 → 23/24; no measured improvement.**
- Repetition: 1 trial per case and version (demonstration snapshot, not stability evidence).

## Metrics

| Metric | Overall | Development | Builder-blinded holdout |
| --- | ---: | ---: | ---: |
| Equivalence consistency | 8/8 | 4/4 | 4/4 |
| Boundary sensitivity | 7/8 | 4/4 | 3/4 |
| Tool/action accuracy | 23/24 | 12/12 | 11/12 |
| Argument fidelity | 20/20 | 10/10 | 10/10 |
| Effect fidelity | 24/24 | 12/12 | 12/12 |
| Over-action rate | 0/10 | 0/5 | 0/5 |
| Clarification quality | 3/4 | 2/2 | 1/2 |

The revised metrics have the same denominators and values in this snapshot.

## One-description contract diff

- Field: `checkout_request.description`
- Old: Finalize the current cart by opening a simulated checkout request that remains pending for human approval when the user is ready to proceed.
- New: Open a simulated checkout request for the current cart only when the user explicitly directs checkout to begin; it creates a pending request for human approval and does not complete a purchase.
- Source proof: `ec18b5b293ff844b0afddbaefa3c72ad2357528cf285e5759a90d5896c358bdb`

## Case outcomes

| Version | Subset | Case | Family | Expected | Observed | Outcome | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | development | commitment_dev_contrast | commitment-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| baseline | builder-blinded-holdout | checkout_holdout_02 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| baseline | development | review_dev_01 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| baseline | builder-blinded-holdout | commitment_holdout_anchor | commitment-boundary-matched-pairs | clarify | no_action | Fail | decision_action_class |
| baseline | development | review_dev_02 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| baseline | development | negation_dev_anchor | negation-scope-boundary-matched-pairs | call:order_review | call:order_review | Pass | none |
| baseline | builder-blinded-holdout | checkout_holdout_01 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| baseline | builder-blinded-holdout | argument_holdout_anchor | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | development | argument_dev_anchor | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | development | ambiguity_dev_contrast | ambiguity-versus-explicit-intent-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | builder-blinded-holdout | ambiguity_holdout_anchor | ambiguity-versus-explicit-intent-matched-pairs | clarify | clarify | Pass | none |
| baseline | builder-blinded-holdout | review_holdout_02 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| baseline | development | negation_dev_contrast | negation-scope-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| baseline | builder-blinded-holdout | review_holdout_01 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| baseline | builder-blinded-holdout | negation_holdout_contrast | negation-scope-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| baseline | development | checkout_dev_01 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| baseline | builder-blinded-holdout | ambiguity_holdout_contrast | ambiguity-versus-explicit-intent-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | builder-blinded-holdout | argument_holdout_contrast | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | development | argument_dev_contrast | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| baseline | builder-blinded-holdout | commitment_holdout_contrast | commitment-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| baseline | development | checkout_dev_02 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| baseline | development | commitment_dev_anchor | commitment-boundary-matched-pairs | clarify | clarify | Pass | none |
| baseline | builder-blinded-holdout | negation_holdout_anchor | negation-scope-boundary-matched-pairs | call:order_review | call:order_review | Pass | none |
| baseline | development | ambiguity_dev_anchor | ambiguity-versus-explicit-intent-matched-pairs | clarify | clarify | Pass | none |
| revised | development | commitment_dev_contrast | commitment-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| revised | builder-blinded-holdout | checkout_holdout_02 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| revised | development | review_dev_01 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| revised | builder-blinded-holdout | commitment_holdout_anchor | commitment-boundary-matched-pairs | clarify | no_action | Fail | decision_action_class |
| revised | development | review_dev_02 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| revised | development | negation_dev_anchor | negation-scope-boundary-matched-pairs | call:order_review | call:order_review | Pass | none |
| revised | builder-blinded-holdout | checkout_holdout_01 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| revised | builder-blinded-holdout | argument_holdout_anchor | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | development | argument_dev_anchor | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | development | ambiguity_dev_contrast | ambiguity-versus-explicit-intent-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | builder-blinded-holdout | ambiguity_holdout_anchor | ambiguity-versus-explicit-intent-matched-pairs | clarify | clarify | Pass | none |
| revised | builder-blinded-holdout | review_holdout_02 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| revised | development | negation_dev_contrast | negation-scope-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| revised | builder-blinded-holdout | review_holdout_01 | review-equivalent-realizations | call:order_review | call:order_review | Pass | none |
| revised | builder-blinded-holdout | negation_holdout_contrast | negation-scope-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| revised | development | checkout_dev_01 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| revised | builder-blinded-holdout | ambiguity_holdout_contrast | ambiguity-versus-explicit-intent-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | builder-blinded-holdout | argument_holdout_contrast | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | development | argument_dev_contrast | argument-boundary-matched-pairs | call:cart_update | call:cart_update | Pass | none |
| revised | builder-blinded-holdout | commitment_holdout_contrast | commitment-boundary-matched-pairs | call:checkout_request | call:checkout_request | Pass | none |
| revised | development | checkout_dev_02 | checkout-equivalent-realizations | call:checkout_request | call:checkout_request | Pass | none |
| revised | development | commitment_dev_anchor | commitment-boundary-matched-pairs | clarify | clarify | Pass | none |
| revised | builder-blinded-holdout | negation_holdout_anchor | negation-scope-boundary-matched-pairs | call:order_review | call:order_review | Pass | none |
| revised | development | ambiguity_dev_anchor | ambiguity-versus-explicit-intent-matched-pairs | clarify | clarify | Pass | none |

## Limitations

- One trial per case and version is a demonstration snapshot, not a stability estimate.
- One provider model and one synthetic checkout domain do not establish generality.
- The description revision produced 23/24 before and after: no measured improvement.
- The same tentative-checkout holdout abstained instead of clarifying in both versions.
- Repair received zero holdout prompts or results; blinding is operational, not cryptographic.
- Custom Probe evidence is not a measurement of Direct ChatGPT behavior.
- The result is not safety certification or proof of model understanding.
- Clarification usefulness awaits Sergio's final human claims review.
- Hashes establish internal consistency, not independent attestation.

Hashes establish internal consistency, not independent attestation.
