export const SCORED_RETRY_DECISION_VERSION = "toolproof-scored-retry-decision@1.0.0";

export type ScoredDurableGrantState =
  "ISSUED" | "IN_FLIGHT" | "KNOWN" | "UNCERTAIN" | "EXPIRED" | null;

export function scoredInfrastructureReplacementEligible(input: {
  readonly attempt: 0 | 1;
  readonly clientInferencePerformed: boolean;
  readonly clientNativeCallMade: boolean;
  readonly decisionContinuationPresent: boolean;
  readonly nativeAdmissionPresent: boolean;
  readonly durableGrantState: ScoredDurableGrantState;
}): boolean {
  return (
    input.attempt === 0 &&
    !input.clientInferencePerformed &&
    !input.clientNativeCallMade &&
    !input.decisionContinuationPresent &&
    !input.nativeAdmissionPresent &&
    (input.durableGrantState === null ||
      input.durableGrantState === "ISSUED" ||
      input.durableGrantState === "EXPIRED")
  );
}
