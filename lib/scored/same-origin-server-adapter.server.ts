import "server-only";

import { randomBytes } from "node:crypto";

import type {
  FallbackResetEvidence,
  FallbackTrialEvidence
} from "@/lib/fallback/lab-page-adapter.server";
import type { FallbackServerAdapter } from "@/lib/fallback/trial-runner";
import type {
  ProbeBoundaryEvidence,
  ProbeClientCompletionInput,
  ProbeOpaqueClaim,
  ProbePublicClaim
} from "@/lib/probe/client-runner";
import type { ProbeDecision } from "@/lib/probe/decision";
import type { ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import {
  scoredAuthorizationResponseSchema,
  scoredCompleteResponseSchema,
  scoredDecisionResponseSchema,
  scoredNativeResponseSchema,
  scoredSessionResponseSchema
} from "@/lib/scored/service-contract";
import { SCORED_RECOVERY_COOKIE } from "@/lib/scored/session.server";
import type { Page } from "puppeteer-core";

const MAX_RESPONSE_CHARACTERS = 4_000_000;
const ALLOWED_PATHS = new Set([
  "/api/scored/session",
  "/api/scored/issue",
  "/api/scored/decide",
  "/api/scored/native",
  "/api/scored/complete",
  "/api/scored/failure",
  "/api/scored/reveal"
]);

export class ScoredSameOriginApiError extends Error {
  readonly nativeCallMade = false;

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly inferencePerformed: boolean
  ) {
    super(code);
    this.name = "ScoredSameOriginApiError";
  }
}

export interface ScoredBrowserSessionState {
  readonly phase: "baseline" | "revised";
  readonly csrfToken: string;
  readonly buildCommit: string;
  readonly frozenProtocolHash: string;
  readonly reviewPackageHash: string;
  readonly sessionExpiresAt: number;
  readonly recoveryExpiresAt: number;
  readonly documentId: string;
  readonly path: "/lab" | "/results";
  readonly completedCount: number;
  readonly remainingCount: number;
  readonly currentOrdinal: number;
  readonly currentAttempt: 0 | 1;
  readonly terminal: boolean;
}

export interface ScoredBrowserAuthorization {
  readonly version: 1;
  readonly probeToken: string;
  readonly envelope: Awaited<
    ReturnType<typeof scoredAuthorizationResponseSchema.parse>
  >["authorization"]["envelope"];
  readonly claimsHash: string;
}

function newDocumentId(): string {
  return `document_${randomBytes(16).toString("base64url")}`;
}

async function pageFetchJson(input: {
  readonly page: Page;
  readonly path: string;
  readonly method: "POST" | "PUT" | "DELETE";
  readonly body: unknown;
  readonly csrfToken?: string;
  readonly documentId?: string;
}): Promise<unknown> {
  if (!ALLOWED_PATHS.has(input.path)) {
    throw new ScoredSameOriginApiError("scored_path_not_allowed", 0, false);
  }
  const result = await input.page.evaluate(
    async ({ path, method, body, csrfToken, documentId, maximumCharacters }) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrfToken) headers["X-ToolProof-CSRF"] = csrfToken;
      if (documentId) headers["X-ToolProof-Document"] = documentId;
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers,
        body: JSON.stringify(body)
      });
      const source = await response.text();
      if (source.length > maximumCharacters) {
        return {
          ok: false,
          status: response.status,
          value: { error: "scored_response_too_large", inferencePerformed: false }
        };
      }
      let value: unknown;
      try {
        value = JSON.parse(source) as unknown;
      } catch {
        value = { error: "scored_response_not_json", inferencePerformed: false };
      }
      return { ok: response.ok, status: response.status, value };
    },
    {
      path: input.path,
      method: input.method,
      body: input.body,
      csrfToken: input.csrfToken ?? "",
      documentId: input.documentId ?? "",
      maximumCharacters: MAX_RESPONSE_CHARACTERS
    }
  );
  if (!result.ok) {
    const value =
      result.value && typeof result.value === "object"
        ? (result.value as Record<string, unknown>)
        : {};
    throw new ScoredSameOriginApiError(
      typeof value.error === "string" ? value.error : "scored_request_failed",
      result.status,
      value.inferencePerformed === true
    );
  }
  return result.value;
}

function sessionState(value: unknown, documentId: string): ScoredBrowserSessionState {
  const parsed = scoredSessionResponseSchema.parse(value);
  return Object.freeze({ ...parsed, documentId });
}

export async function startScoredBrowserSession(input: {
  readonly page: Page;
  readonly capability: string;
  readonly phase: "baseline" | "revised";
  readonly launchId: string;
  readonly documentId?: string;
}): Promise<ScoredBrowserSessionState> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.capability)) {
    throw new ScoredSameOriginApiError("invalid_scored_operator_capability", 0, false);
  }
  const documentId = input.documentId ?? newDocumentId();
  return sessionState(
    await pageFetchJson({
      page: input.page,
      path: "/api/scored/session",
      method: "POST",
      body: {
        intent: "start-frozen-toolproof-scored-run",
        capability: input.capability,
        phase: input.phase,
        launchId: input.launchId,
        documentId
      }
    }),
    documentId
  );
}

export async function recoverScoredBrowserSession(input: {
  readonly page: Page;
  readonly documentId: string;
  readonly expectedBuildCommit?: string;
}): Promise<ScoredBrowserSessionState> {
  const recovered = sessionState(
    await pageFetchJson({
      page: input.page,
      path: "/api/scored/session",
      method: "PUT",
      documentId: input.documentId,
      body: { intent: "recover-frozen-toolproof-scored-run", documentId: input.documentId }
    }),
    input.documentId
  );
  if (input.expectedBuildCommit && recovered.buildCommit !== input.expectedBuildCommit) {
    throw new ScoredSameOriginApiError("scored_session_recovery_mismatch", 409, false);
  }
  return recovered;
}

export async function scoredRecoveryCookie(page: Page, targetOrigin: string): Promise<string> {
  const origin = new URL(targetOrigin);
  if (origin.origin !== targetOrigin) {
    throw new ScoredSameOriginApiError("scored_recovery_cookie_invalid", 0, false);
  }
  const matches = (await page.browserContext().cookies()).filter(
    ({ name }) => name === SCORED_RECOVERY_COOKIE
  );
  const recovery = matches[0];
  if (
    matches.length !== 1 ||
    !recovery?.value ||
    recovery.domain !== origin.hostname ||
    recovery.path !== "/" ||
    !recovery.httpOnly ||
    !recovery.secure ||
    recovery.sameSite !== "Strict"
  ) {
    throw new ScoredSameOriginApiError("scored_recovery_cookie_missing", 409, false);
  }
  return recovery.value;
}

export async function installScoredRecoveryCookie(
  page: Page,
  value: string,
  targetOrigin: string
): Promise<void> {
  if (!value || new URL(targetOrigin).origin !== targetOrigin) {
    throw new ScoredSameOriginApiError("scored_recovery_cookie_invalid", 0, false);
  }
  const cdp = await page.target().createCDPSession();
  try {
    const result = await cdp.send("Network.setCookie", {
      name: SCORED_RECOVERY_COOKIE,
      value,
      url: `${targetOrigin}/`,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict"
    });
    if (!result.success) {
      throw new ScoredSameOriginApiError("scored_recovery_cookie_install_failed", 0, false);
    }
  } finally {
    await cdp.detach();
  }
}

export class ToolProofScoredSameOriginServerAdapter implements FallbackServerAdapter<
  ScoredBrowserAuthorization,
  FallbackResetEvidence,
  FallbackTrialEvidence,
  unknown
> {
  #authorization: ScoredBrowserAuthorization | null = null;
  #providerReceipt: unknown = null;
  #decision: ProbeDecision | null = null;
  #lastApiError: ScoredSameOriginApiError | null = null;

  constructor(
    private readonly page: Page,
    private session: ScoredBrowserSessionState
  ) {}

  async issueOpaqueClaim(input: {
    readonly initialBoundary: ProbeBoundaryEvidence<FallbackResetEvidence>;
    readonly liveManifest: ProbeLiveManifest;
  }): Promise<ProbeOpaqueClaim<ScoredBrowserAuthorization>> {
    const response = scoredAuthorizationResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/scored/issue",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          initialBoundary: input.initialBoundary,
          liveManifest: input.liveManifest
        }
      })
    );
    this.#authorization = response.authorization;
    this.#providerReceipt = null;
    this.#decision = null;
    this.#lastApiError = null;
    return Object.freeze({
      runId: response.runId,
      caseId: response.caseId,
      trialId: response.trialId,
      authorization: response.authorization
    });
  }

  async requestFreshDecision(input: {
    readonly claim: ProbeOpaqueClaim<ScoredBrowserAuthorization>;
  }): Promise<unknown> {
    const authorization = this.requireAuthorization(input.claim);
    try {
      const response = scoredDecisionResponseSchema.parse(
        await pageFetchJson({
          page: this.page,
          path: "/api/scored/decide",
          method: "POST",
          csrfToken: this.session.csrfToken,
          documentId: this.session.documentId,
          body: {
            probeToken: authorization.probeToken,
            envelope: authorization.envelope
          }
        })
      );
      this.#providerReceipt = response.providerReceipt;
      this.#decision = response.decision;
      return response;
    } catch (error) {
      if (error instanceof ScoredSameOriginApiError) this.#lastApiError = error;
      throw error;
    }
  }

  async admitNative(input: {
    readonly claim: ProbePublicClaim;
    readonly toolName: string;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<void> {
    const authorization = this.requireAuthorization(input.claim);
    if (
      this.#decision?.kind !== "call" ||
      this.#decision.tool !== input.toolName ||
      authorization.envelope.liveManifest.manifestHash !== input.manifestHash
    ) {
      throw new ScoredSameOriginApiError("scored_native_binding_mismatch", 409, false);
    }
    const response = scoredNativeResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/scored/native",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          probeToken: authorization.probeToken,
          envelope: authorization.envelope,
          decision: this.#decision,
          registrationGeneration: input.registrationGeneration
        }
      })
    );
    if (response.status !== "admitted") {
      throw new ScoredSameOriginApiError("scored_native_already_admitted", 409, false);
    }
  }

  async completeAndSeal(
    completion: ProbeClientCompletionInput<FallbackResetEvidence, FallbackTrialEvidence>
  ): Promise<unknown> {
    const authorization = this.requireAuthorization(completion.claim);
    if (this.#providerReceipt === null) {
      throw new ScoredSameOriginApiError("scored_provider_receipt_missing", 409, false);
    }
    const response = scoredCompleteResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/scored/complete",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          probeToken: authorization.probeToken,
          envelope: authorization.envelope,
          completion
        }
      })
    );
    this.session = Object.freeze({
      ...this.session,
      completedCount: response.completedCount,
      remainingCount: response.remainingCount,
      currentOrdinal: response.completedCount,
      currentAttempt: 0,
      terminal: response.terminal,
      path: response.terminal ? "/results" : "/lab"
    });
    this.#authorization = null;
    this.#providerReceipt = null;
    this.#decision = null;
    this.#lastApiError = null;
    return response;
  }

  async recordFailure(
    error: unknown,
    authorizationOverride: ScoredBrowserAuthorization | null = null
  ): Promise<unknown> {
    const apiError = this.#lastApiError;
    const source = error instanceof Error ? error : new Error("scored_trial_failed");
    const authorization = authorizationOverride ?? this.#authorization;
    return pageFetchJson({
      page: this.page,
      path: "/api/scored/failure",
      method: "POST",
      csrfToken: this.session.csrfToken,
      documentId: this.session.documentId,
      body: {
        stage: "stage" in source && typeof source.stage === "string" ? source.stage : "runner",
        code:
          apiError?.code ??
          ("code" in source && typeof source.code === "string" ? source.code : source.name),
        message: source.message.slice(0, 1_000) || "Scored trial failed.",
        inferencePerformed: apiError?.inferencePerformed ?? false,
        nativeCallMade:
          "nativeCallMade" in source && typeof source.nativeCallMade === "boolean"
            ? source.nativeCallMade
            : false,
        ...(authorization
          ? { probeToken: authorization.probeToken, envelope: authorization.envelope }
          : {})
      }
    });
  }

  async reveal(): Promise<unknown> {
    return pageFetchJson({
      page: this.page,
      path: "/api/scored/reveal",
      method: "POST",
      csrfToken: this.session.csrfToken,
      documentId: this.session.documentId,
      body: { intent: "reveal-terminal-scored-run" }
    });
  }

  async acknowledge(evidenceDigest: string): Promise<void> {
    await pageFetchJson({
      page: this.page,
      path: "/api/scored/reveal",
      method: "DELETE",
      csrfToken: this.session.csrfToken,
      documentId: this.session.documentId,
      body: { intent: "acknowledge-verified-scored-run", evidenceDigest }
    });
  }

  sessionState(): ScoredBrowserSessionState {
    return this.session;
  }

  currentAuthorization(): ScoredBrowserAuthorization | null {
    return this.#authorization;
  }

  private requireAuthorization(
    claim: ProbePublicClaim | ProbeOpaqueClaim<ScoredBrowserAuthorization>
  ): ScoredBrowserAuthorization {
    const authorization = this.#authorization;
    if (
      !authorization ||
      authorization.envelope.runId !== claim.runId ||
      authorization.envelope.caseId !== claim.caseId ||
      authorization.envelope.trialId !== claim.trialId
    ) {
      throw new ScoredSameOriginApiError("scored_claim_binding_missing", 409, false);
    }
    return authorization;
  }
}
