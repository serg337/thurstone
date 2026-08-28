export const TOOLPROOF_INSPECT_TOOL_NAME = "toolproof_inspect";
export const TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME = "toolproof_draft_contract";
export const TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME = "toolproof_submit_review";

export const STUDIO_REVIEW_NOTE_MAX_LENGTH = 2_000;
export const STUDIO_DRAFT_TEXT_MAX_LENGTH = 4_000;
export const STUDIO_EFFECT_LIST_MAX_LENGTH = 16;

export type StudioAuthoringPhase = "inspect" | "draft" | "review";

export interface LastVerifiedTargetSnapshot {
  readonly receiptVersion: "toolproof-last-verified-target@1.0.0";
  readonly status: "last-verified";
  readonly claimBoundary: "not-live-lab-registry";
  readonly sourceLane: "authentic-gate2-fallback";
  readonly sourceCommit: string;
  readonly sourceEvidenceDigest: string;
  readonly verifiedAt: string;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly catalogState: "initial";
  readonly toolsetVersion: string;
  readonly domainVersion: string;
  readonly registeredToolNames: readonly string[];
  readonly manifest: readonly {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly inputSchema: object;
    readonly annotations: Readonly<WebMCP.ToolAnnotations>;
  }[];
}

export interface StudioContractDraftPatch {
  readonly title?: string;
  readonly meaningPrinciple?: string;
  readonly clarificationPolicy?: string;
  readonly effectPolicy?: string;
}

export interface StudioCaseDraftUpdate {
  readonly caseId: string;
  readonly prompt?: string;
  readonly meaningIdentity?: string;
  readonly meaningSpec?: string;
  readonly expectedDecision?: string;
  readonly expectedTool?:
    "cart_get" | "cart_update" | "checkout_request" | "order_review" | "clarification";
  readonly argumentPredicate?: string;
  readonly allowedEffects?: readonly string[];
  readonly forbiddenEffects?: readonly string[];
  readonly approvalClass?: "read-only" | "reversible-mutation" | "human-gated-consequential";
}

export interface StudioDraftInput {
  readonly reviewNote?: string;
  readonly requestedFocus?: "meaning" | "boundaries" | "arguments" | "effects" | "allocation";
  readonly contractPatch?: StudioContractDraftPatch;
  readonly caseUpdates?: readonly StudioCaseDraftUpdate[];
}

export interface StudioDraftReceipt {
  readonly ok: true;
  readonly status: "candidate-note-saved";
  readonly sessionLocal: true;
  readonly phase: "review";
  readonly humanApproval: "required";
  readonly noteLength: number;
  readonly requestedFocus: StudioDraftInput["requestedFocus"] | null;
  readonly contractFieldsUpdated: readonly string[];
  readonly caseIdsUpdated: readonly string[];
}

export interface StudioReviewReceipt {
  readonly ok: true;
  readonly status: "presented-to-human";
  readonly sessionLocal: true;
  readonly phase: "review";
  readonly humanApproval: "required";
  readonly canApprove: false;
  readonly canFreeze: false;
}

export interface StudioToolActions {
  readonly inspect: () => LastVerifiedTargetSnapshot;
  readonly draft: (input: StudioDraftInput) => StudioDraftReceipt;
  readonly submitReview: () => StudioReviewReceipt;
}

export interface StudioMetaToolSet {
  readonly byName: Readonly<
    Record<
      | typeof TOOLPROOF_INSPECT_TOOL_NAME
      | typeof TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME
      | typeof TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME,
      WebMCP.ModelContextTool
    >
  >;
  readonly forPhase: (phase: StudioAuthoringPhase) => readonly WebMCP.ModelContextTool[];
}

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false
});

const DRAFT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    reviewNote: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: STUDIO_REVIEW_NOTE_MAX_LENGTH,
      description:
        "A session-local authoring note for Sergio to review. This cannot approve or freeze semantic meaning."
    }),
    requestedFocus: Object.freeze({
      type: "string",
      enum: Object.freeze(["meaning", "boundaries", "arguments", "effects", "allocation"])
    }),
    contractPatch: Object.freeze({
      type: "object",
      properties: Object.freeze({
        title: Object.freeze({ type: "string", minLength: 1, maxLength: 160 }),
        meaningPrinciple: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: STUDIO_DRAFT_TEXT_MAX_LENGTH
        }),
        clarificationPolicy: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: STUDIO_DRAFT_TEXT_MAX_LENGTH
        }),
        effectPolicy: Object.freeze({
          type: "string",
          minLength: 1,
          maxLength: STUDIO_DRAFT_TEXT_MAX_LENGTH
        })
      }),
      minProperties: 1,
      additionalProperties: false
    }),
    caseUpdates: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: Object.freeze({
        type: "object",
        properties: Object.freeze({
          caseId: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9_.:-]+$"
          }),
          prompt: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
          meaningIdentity: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
          meaningSpec: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: STUDIO_DRAFT_TEXT_MAX_LENGTH
          }),
          expectedDecision: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: 1_000
          }),
          expectedTool: Object.freeze({
            type: "string",
            enum: Object.freeze([
              "cart_get",
              "cart_update",
              "checkout_request",
              "order_review",
              "clarification"
            ])
          }),
          argumentPredicate: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: 2_000
          }),
          allowedEffects: Object.freeze({
            type: "array",
            maxItems: STUDIO_EFFECT_LIST_MAX_LENGTH,
            uniqueItems: true,
            items: Object.freeze({ type: "string", minLength: 1, maxLength: 256 })
          }),
          forbiddenEffects: Object.freeze({
            type: "array",
            maxItems: STUDIO_EFFECT_LIST_MAX_LENGTH,
            uniqueItems: true,
            items: Object.freeze({ type: "string", minLength: 1, maxLength: 256 })
          }),
          approvalClass: Object.freeze({
            type: "string",
            enum: Object.freeze(["read-only", "reversible-mutation", "human-gated-consequential"])
          })
        }),
        required: Object.freeze(["caseId"]),
        minProperties: 2,
        additionalProperties: false
      })
    })
  }),
  anyOf: Object.freeze([
    Object.freeze({ required: Object.freeze(["contractPatch"]) }),
    Object.freeze({ required: Object.freeze(["caseUpdates"]) })
  ]),
  additionalProperties: false
});

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Studio tool execution was canceled.", "AbortError");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maximum) {
    throw new RangeError(`${field} must contain 1-${maximum} characters after trimming.`);
  }
  return trimmed;
}

function parseRequiredText(value: unknown, field: string, maximum: number): string {
  const parsed = parseText(value, field, maximum);
  if (parsed === undefined) throw new TypeError(`${field} is required.`);
  return parsed;
}

function parseStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > STUDIO_EFFECT_LIST_MAX_LENGTH) {
    throw new TypeError(
      `${field} must be an array with at most ${STUDIO_EFFECT_LIST_MAX_LENGTH} items.`
    );
  }
  const parsed = value.map((item, index) => {
    const text = parseText(item, `${field}[${index}]`, 256);
    if (text === undefined) throw new TypeError(`${field}[${index}] is required.`);
    return text;
  });
  if (new Set(parsed).size !== parsed.length) throw new TypeError(`${field} must be unique.`);
  return Object.freeze(parsed);
}

function parseRequiredStringList(value: unknown, field: string): readonly string[] {
  const parsed = parseStringList(value, field);
  if (parsed === undefined) throw new TypeError(`${field} is required.`);
  return parsed;
}

function parseContractPatch(value: unknown): StudioContractDraftPatch | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) throw new TypeError("contractPatch must be an object.");
  const allowed = new Set(["title", "meaningPrinciple", "clarificationPolicy", "effectPolicy"]);
  if (Object.keys(value).length === 0 || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError("contractPatch must contain only declared, non-empty fields.");
  }
  return Object.freeze({
    ...(value.title === undefined
      ? {}
      : { title: parseRequiredText(value.title, "contractPatch.title", 160) }),
    ...(value.meaningPrinciple === undefined
      ? {}
      : {
          meaningPrinciple: parseRequiredText(
            value.meaningPrinciple,
            "contractPatch.meaningPrinciple",
            STUDIO_DRAFT_TEXT_MAX_LENGTH
          )
        }),
    ...(value.clarificationPolicy === undefined
      ? {}
      : {
          clarificationPolicy: parseRequiredText(
            value.clarificationPolicy,
            "contractPatch.clarificationPolicy",
            STUDIO_DRAFT_TEXT_MAX_LENGTH
          )
        }),
    ...(value.effectPolicy === undefined
      ? {}
      : {
          effectPolicy: parseRequiredText(
            value.effectPolicy,
            "contractPatch.effectPolicy",
            STUDIO_DRAFT_TEXT_MAX_LENGTH
          )
        })
  });
}

function parseCaseUpdates(value: unknown): readonly StudioCaseDraftUpdate[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    throw new TypeError("caseUpdates must contain 1-24 case patches.");
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((entry, index) => {
      if (!isPlainRecord(entry)) throw new TypeError(`caseUpdates[${index}] must be an object.`);
      const allowed = new Set([
        "caseId",
        "prompt",
        "meaningIdentity",
        "meaningSpec",
        "expectedDecision",
        "expectedTool",
        "argumentPredicate",
        "allowedEffects",
        "forbiddenEffects",
        "approvalClass"
      ]);
      if (Object.keys(entry).some((key) => !allowed.has(key)) || Object.keys(entry).length < 2) {
        throw new TypeError(
          `caseUpdates[${index}] must contain caseId and a declared patch field.`
        );
      }
      const caseId = parseRequiredText(entry.caseId, `caseUpdates[${index}].caseId`, 128);
      if (!/^[A-Za-z0-9_.:-]+$/u.test(caseId)) {
        throw new TypeError(`caseUpdates[${index}].caseId is invalid.`);
      }
      if (seen.has(caseId)) throw new TypeError("caseUpdates must not patch one case twice.");
      seen.add(caseId);
      const expectedTool = entry.expectedTool;
      if (
        expectedTool !== undefined &&
        expectedTool !== "cart_get" &&
        expectedTool !== "cart_update" &&
        expectedTool !== "checkout_request" &&
        expectedTool !== "order_review" &&
        expectedTool !== "clarification"
      ) {
        throw new TypeError(`caseUpdates[${index}].expectedTool is invalid.`);
      }
      const approvalClass = entry.approvalClass;
      if (
        approvalClass !== undefined &&
        approvalClass !== "read-only" &&
        approvalClass !== "reversible-mutation" &&
        approvalClass !== "human-gated-consequential"
      ) {
        throw new TypeError(`caseUpdates[${index}].approvalClass is invalid.`);
      }
      return Object.freeze({
        caseId,
        ...(entry.prompt === undefined
          ? {}
          : {
              prompt: parseRequiredText(entry.prompt, `caseUpdates[${index}].prompt`, 2_000)
            }),
        ...(entry.meaningIdentity === undefined
          ? {}
          : {
              meaningIdentity: parseRequiredText(
                entry.meaningIdentity,
                `caseUpdates[${index}].meaningIdentity`,
                256
              )
            }),
        ...(entry.meaningSpec === undefined
          ? {}
          : {
              meaningSpec: parseRequiredText(
                entry.meaningSpec,
                `caseUpdates[${index}].meaningSpec`,
                STUDIO_DRAFT_TEXT_MAX_LENGTH
              )
            }),
        ...(entry.expectedDecision === undefined
          ? {}
          : {
              expectedDecision: parseRequiredText(
                entry.expectedDecision,
                `caseUpdates[${index}].expectedDecision`,
                1_000
              )
            }),
        ...(expectedTool === undefined ? {} : { expectedTool }),
        ...(entry.argumentPredicate === undefined
          ? {}
          : {
              argumentPredicate: parseRequiredText(
                entry.argumentPredicate,
                `caseUpdates[${index}].argumentPredicate`,
                2_000
              )
            }),
        ...(entry.allowedEffects === undefined
          ? {}
          : {
              allowedEffects: parseRequiredStringList(
                entry.allowedEffects,
                `caseUpdates[${index}].allowedEffects`
              )
            }),
        ...(entry.forbiddenEffects === undefined
          ? {}
          : {
              forbiddenEffects: parseRequiredStringList(
                entry.forbiddenEffects,
                `caseUpdates[${index}].forbiddenEffects`
              )
            }),
        ...(approvalClass === undefined ? {} : { approvalClass })
      });
    })
  );
}

export function parseStudioDraftInput(input: unknown): StudioDraftInput {
  if (!isPlainRecord(input)) {
    throw new TypeError("toolproof_draft_contract requires an object input.");
  }
  const allowedKeys = new Set(["reviewNote", "requestedFocus", "contractPatch", "caseUpdates"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("toolproof_draft_contract received an undeclared argument.");
  }
  const reviewNote = parseText(input.reviewNote, "reviewNote", STUDIO_REVIEW_NOTE_MAX_LENGTH);
  const requestedFocus = input.requestedFocus;
  if (
    requestedFocus !== undefined &&
    requestedFocus !== "meaning" &&
    requestedFocus !== "boundaries" &&
    requestedFocus !== "arguments" &&
    requestedFocus !== "effects" &&
    requestedFocus !== "allocation"
  ) {
    throw new TypeError("requestedFocus is not a supported authoring focus.");
  }
  const contractPatch = parseContractPatch(input.contractPatch);
  const caseUpdates = parseCaseUpdates(input.caseUpdates);
  if (contractPatch === undefined && caseUpdates === undefined) {
    throw new TypeError(
      "toolproof_draft_contract requires contractPatch or caseUpdates; a reviewNote cannot be the only draft effect."
    );
  }
  return Object.freeze({
    ...(reviewNote === undefined ? {} : { reviewNote }),
    ...(requestedFocus === undefined ? {} : { requestedFocus }),
    ...(contractPatch === undefined ? {} : { contractPatch }),
    ...(caseUpdates === undefined ? {} : { caseUpdates })
  });
}

type OptionalExecutionContext = { readonly signal?: AbortSignal };

export function createStudioMetaTools(actions: StudioToolActions): StudioMetaToolSet {
  const inspect: WebMCP.ModelContextTool = {
    name: TOOLPROOF_INSPECT_TOOL_NAME,
    title: "Inspect last verified target",
    description:
      "Return the last verified target-tool manifest and sanitized Lab readiness fingerprint. This is historical verified evidence, not a claim that a separate Lab document is currently live.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute: async (_input: Record<string, unknown>, { signal }: OptionalExecutionContext = {}) => {
      abortIfRequested(signal);
      const result = actions.inspect();
      abortIfRequested(signal);
      return result;
    }
  };

  const draft: WebMCP.ModelContextTool = {
    name: TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME,
    title: "Draft contract review note",
    description:
      "Create or update session-local contract fields, candidate case fields, and review notes for human semantic review. Case updates are keyed by the human-visible caseId. This tool cannot approve meaning, create a review receipt, or freeze a suite.",
    inputSchema: DRAFT_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    execute: async (input: Record<string, unknown>, { signal }: OptionalExecutionContext = {}) => {
      abortIfRequested(signal);
      const parsed = parseStudioDraftInput(input);
      const result = actions.draft(parsed);
      abortIfRequested(signal);
      return result;
    }
  };

  const submitReview: WebMCP.ModelContextTool = {
    name: TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME,
    title: "Present candidate for human review",
    description:
      "Present the current session-local candidate in Studio for Sergio's review. This tool cannot approve semantic labels or freeze the execution protocol.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    execute: async (_input: Record<string, unknown>, { signal }: OptionalExecutionContext = {}) => {
      abortIfRequested(signal);
      const result = actions.submitReview();
      abortIfRequested(signal);
      return result;
    }
  };

  const byName = Object.freeze({
    [TOOLPROOF_INSPECT_TOOL_NAME]: inspect,
    [TOOLPROOF_DRAFT_CONTRACT_TOOL_NAME]: draft,
    [TOOLPROOF_SUBMIT_REVIEW_TOOL_NAME]: submitReview
  });
  const inspectPhase = Object.freeze([inspect]);
  const draftPhase = Object.freeze([inspect, draft]);
  const reviewPhase = Object.freeze([inspect, draft, submitReview]);

  return Object.freeze({
    byName,
    forPhase: (phase: StudioAuthoringPhase) => {
      if (phase === "inspect") return inspectPhase;
      if (phase === "draft") return draftPhase;
      return reviewPhase;
    }
  });
}
