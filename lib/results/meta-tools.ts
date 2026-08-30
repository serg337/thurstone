import type { Gate6EvidencePackage } from "@/lib/results/evidence-package";

export const TOOLPROOF_GET_RESULTS_TOOL_NAME = "toolproof_get_results";
export const TOOLPROOF_PROPOSE_REVISION_TOOL_NAME = "toolproof_propose_revision";

export interface ToolProofDevelopmentResultsProjection {
  readonly version: "toolproof-development-results-projection@1.0.0";
  readonly evidenceLabel: "one-trial demonstration snapshot";
  readonly baselineEvidenceDigest: string;
  readonly development: {
    readonly earned: number;
    readonly possible: 12;
    readonly rows: readonly {
      readonly caseId: string;
      readonly family: string;
      readonly request: string;
      readonly expectedAction: string;
      readonly observedAction: string;
      readonly passed: boolean;
      readonly failureCodes: readonly string[];
    }[];
  };
  readonly holdout: {
    readonly status: "sealed";
    readonly caseCount: 12;
    readonly commitmentDigest: string;
  };
}

export interface RevisionProposal {
  readonly proposedDescription: string;
  readonly rationale: string;
}

export interface ToolProofPairedResultsProjection {
  readonly version: "toolproof-paired-results-projection@1.0.0";
  readonly evidenceLabel: "one-trial demonstration snapshot";
  readonly baselineEvidenceDigest: string;
  readonly revisedEvidenceDigest: string;
  readonly development: {
    readonly baselineEarned: number;
    readonly revisedEarned: number;
    readonly possible: 12;
  };
  readonly holdout: {
    readonly baselineEarned: number;
    readonly revisedEarned: number;
    readonly possible: 12;
  };
  readonly rows: readonly unknown[];
}

type ExecutionContext = { readonly signal?: AbortSignal };

function abort(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Results tool execution was canceled.", "AbortError");
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function proposal(value: unknown): RevisionProposal {
  if (
    !plainRecord(value) ||
    Object.keys(value).sort().join(",") !== "proposedDescription,rationale"
  ) {
    throw new TypeError("Revision proposal requires only proposedDescription and rationale.");
  }
  const proposedDescription = String(value.proposedDescription ?? "").trim();
  const rationale = String(value.rationale ?? "").trim();
  if (
    proposedDescription.length < 40 ||
    proposedDescription.length > 500 ||
    rationale.length < 20 ||
    rationale.length > 2_000
  ) {
    throw new RangeError("Revision proposal is outside the bounded authoring contract.");
  }
  return Object.freeze({ proposedDescription, rationale });
}

export function createResultsMetaTools(input: {
  readonly results: ToolProofDevelopmentResultsProjection;
  readonly onProposal: (proposal: RevisionProposal) => void;
}): readonly WebMCP.ModelContextTool[] {
  const inspect: WebMCP.ModelContextTool = {
    name: TOOLPROOF_GET_RESULTS_TOOL_NAME,
    title: "Inspect development evidence",
    description:
      "Return terminal baseline development evidence only. Builder-blinded holdout prompts, labels, rows, aggregates, and hints remain sealed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async (_value: Record<string, unknown>, { signal }: ExecutionContext = {}) => {
      abort(signal);
      return input.results;
    }
  };
  const propose: WebMCP.ModelContextTool = {
    name: TOOLPROOF_PROPOSE_REVISION_TOOL_NAME,
    title: "Propose one description revision",
    description:
      "Propose one replacement checkout_request description from development evidence. This cannot approve, freeze, deploy, or reveal holdout evidence.",
    inputSchema: {
      type: "object",
      properties: {
        proposedDescription: { type: "string", minLength: 40, maxLength: 500 },
        rationale: { type: "string", minLength: 20, maxLength: 2_000 }
      },
      required: ["proposedDescription", "rationale"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async (value: Record<string, unknown>, { signal }: ExecutionContext = {}) => {
      abort(signal);
      const parsed = proposal(value);
      input.onProposal(parsed);
      abort(signal);
      return Object.freeze({
        ok: true,
        status: "proposal-presented-for-human-review",
        humanApproval: "required",
        canFreeze: false
      });
    }
  };
  return Object.freeze([inspect, propose]);
}

// thurstone-impact-execution:lazy-tool-helper
export type PairedResultsPackageLoader = (
  signal: AbortSignal | undefined
) => Promise<Gate6EvidencePackage>;

export function createLazyPairedResultsMetaTool(
  load: PairedResultsPackageLoader
): WebMCP.ModelContextTool {
  const descriptor = createPairedResultsMetaTool({} as Gate6EvidencePackage);
  return {
    ...descriptor,
    execute: async (value: Record<string, unknown>, context: ExecutionContext = {}) => {
      abort(context.signal);
      const results = await load(context.signal);
      abort(context.signal);
      void value;
      return results;
    }
  };
}

export function createPairedResultsMetaTool(
  results: ToolProofPairedResultsProjection | Gate6EvidencePackage
): WebMCP.ModelContextTool {
  return {
    name: TOOLPROOF_GET_RESULTS_TOOL_NAME,
    title: "Inspect paired semantic evidence",
    description:
      "Return the terminal baseline-versus-revised development and Builder-blinded holdout comparison after the revision freeze and revised run.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async (_value: Record<string, unknown>, { signal }: ExecutionContext = {}) => {
      abort(signal);
      return results;
    }
  };
}
