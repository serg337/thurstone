import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import type { FallbackCalibrationEnvelope } from "@/lib/fallback/calibration-envelope";
import type { FallbackServerAdapter } from "@/lib/fallback/trial-runner";
import {
  createProbeFixtureSynopsis,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import type {
  ProbeBoundaryEvidence,
  ProbeClientCompletionInput,
  ProbeOpaqueClaim,
  ProbePublicClaim
} from "@/lib/probe/client-runner";
import { probeDecisionSchema, type ProbeDecision } from "@/lib/probe/decision";
import {
  fallbackProbeCompleteResponseSchema,
  fallbackProbeFreshDecisionResponseSchema,
  fallbackProbeIssueResultSchema,
  fallbackProbeSessionRecoveryResponseSchema,
  fallbackProbeSessionStartResponseSchema,
  probeNativeAdmissionResponseSchema,
  type FallbackProbeFreshDecisionResponse,
  type FallbackProbeIssueResponse,
  type FallbackProbeSessionStartResponse
} from "@/lib/probe/service-contract";
import { PROBE_RECOVERY_COOKIE } from "@/lib/probe/session";
import type { Page } from "puppeteer-core";

export const FALLBACK_SAME_ORIGIN_ADAPTER_VERSION =
  "toolproof-fallback-same-origin-server-adapter@1.0.0";

const MAX_RESPONSE_CHARACTERS = 4_000_000;
const ALLOWED_PATHS = new Set([
  "/api/probe/arm",
  "/api/probe/fallback/session",
  "/api/probe/fallback/issue",
  "/api/probe/fallback/decide",
  "/api/probe/fallback/native",
  "/api/probe/fallback/complete",
  "/api/probe/fallback/reveal"
]);

export class FallbackSameOriginApiError extends Error {
  readonly nativeCallMade = false;

  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly inferencePerformed: boolean
  ) {
    super(code);
    this.name = "FallbackSameOriginApiError";
  }
}

export interface FallbackBrowserSessionState {
  readonly csrfToken: string;
  readonly continuation: string;
  readonly buildCommit: string;
  readonly expiresAt: number;
  readonly recoveryExpiresAt: number;
  readonly documentId: string;
  readonly path: "/lab" | "/results";
}

interface FallbackAuthorization {
  readonly version: 1;
  readonly probeToken: string;
  readonly envelope: FallbackCalibrationEnvelope;
  readonly continuation: string;
}

function opaqueDocumentId(): string {
  return `document_${randomBytes(16).toString("base64url")}`;
}

function opaqueLaunchId(): string {
  return `launch_${randomUUID()}`;
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
    throw new FallbackSameOriginApiError("fallback_path_not_allowed", 0, false);
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
          value: { error: "fallback_response_too_large", inferencePerformed: false }
        };
      }
      let value: unknown;
      try {
        value = JSON.parse(source) as unknown;
      } catch {
        value = { error: "fallback_response_not_json", inferencePerformed: false };
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
    throw new FallbackSameOriginApiError(
      typeof value.error === "string" ? value.error : "fallback_request_failed",
      result.status,
      value.inferencePerformed === true
    );
  }
  return result.value;
}

export async function armAndStartFallbackBrowserSession(input: {
  readonly page: Page;
  readonly capability: string;
  readonly launchId?: string;
  readonly documentId?: string;
}): Promise<FallbackBrowserSessionState> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.capability)) {
    throw new FallbackSameOriginApiError("invalid_operator_capability", 0, false);
  }
  await pageFetchJson({
    page: input.page,
    path: "/api/probe/arm",
    method: "POST",
    body: { capability: input.capability }
  });
  const started = fallbackProbeSessionStartResponseSchema.parse(
    await pageFetchJson({
      page: input.page,
      path: "/api/probe/fallback/session",
      method: "POST",
      body: {
        intent: "start-pinned-fallback-four-case-calibration",
        launchId: input.launchId ?? opaqueLaunchId()
      }
    })
  );
  return recoverFallbackBrowserSession({
    page: input.page,
    documentId: input.documentId ?? opaqueDocumentId(),
    expectedBuildCommit: started.buildCommit
  });
}

export async function recoverFallbackBrowserSession(input: {
  readonly page: Page;
  readonly documentId?: string;
  readonly expectedBuildCommit?: string;
}): Promise<FallbackBrowserSessionState> {
  const documentId = input.documentId ?? opaqueDocumentId();
  const recovered = fallbackProbeSessionRecoveryResponseSchema.parse(
    await pageFetchJson({
      page: input.page,
      path: "/api/probe/fallback/session",
      method: "PUT",
      body: { intent: "recover-pinned-fallback-four-case-calibration", documentId },
      documentId
    })
  );
  if (
    (input.expectedBuildCommit && recovered.buildCommit !== input.expectedBuildCommit) ||
    (recovered.path !== "/lab" && recovered.path !== "/results")
  ) {
    throw new FallbackSameOriginApiError("fallback_session_recovery_mismatch", 409, false);
  }
  return Object.freeze({
    csrfToken: recovered.csrfToken,
    continuation: recovered.continuation,
    buildCommit: recovered.buildCommit,
    expiresAt: recovered.expiresAt,
    recoveryExpiresAt: recovered.recoveryExpiresAt,
    documentId,
    path: recovered.path
  });
}

export async function fallbackRecoveryCookie(page: Page, targetOrigin: string): Promise<string> {
  const origin = new URL(targetOrigin);
  if (origin.origin !== targetOrigin) {
    throw new FallbackSameOriginApiError("fallback_recovery_cookie_invalid", 0, false);
  }
  const cookies = await page.browserContext().cookies();
  const matches = cookies.filter(({ name }) => name === PROBE_RECOVERY_COOKIE);
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
    throw new FallbackSameOriginApiError("fallback_recovery_cookie_missing", 409, false);
  }
  return recovery.value;
}

export async function installFallbackRecoveryCookie(
  page: Page,
  value: string,
  targetOrigin: string
): Promise<void> {
  if (!value || new URL(targetOrigin).origin !== targetOrigin) {
    throw new FallbackSameOriginApiError("fallback_recovery_cookie_invalid", 0, false);
  }
  const session = await page.target().createCDPSession();
  try {
    const result = await session.send("Network.setCookie", {
      name: PROBE_RECOVERY_COOKIE,
      value,
      url: `${targetOrigin}/`,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict"
    });
    if (!result.success) {
      throw new FallbackSameOriginApiError("fallback_recovery_cookie_install_failed", 0, false);
    }
  } finally {
    await session.detach();
  }
}

export class ToolProofFallbackSameOriginServerAdapter<
  TResetReceipt,
  TEvidence
> implements FallbackServerAdapter<FallbackAuthorization, TResetReceipt, TEvidence, unknown> {
  #authorization: FallbackAuthorization | null = null;
  #initialBoundary: ProbeBoundaryEvidence<TResetReceipt> | null = null;
  #providerReceipt: unknown = null;
  #decision: ProbeDecision | null = null;

  constructor(
    private readonly page: Page,
    private session: FallbackBrowserSessionState
  ) {}

  async issueOpaqueClaim(input: {
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
    readonly liveManifest: ProbeLiveManifest;
  }): Promise<ProbeOpaqueClaim<FallbackAuthorization>> {
    const response = fallbackProbeIssueResultSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/probe/fallback/issue",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          continuation: this.session.continuation,
          initialBoundary: input.initialBoundary,
          fixture: createProbeFixtureSynopsis(createCheckoutFixture()),
          liveManifest: input.liveManifest
        }
      })
    );
    if (response.status !== "issued") {
      throw new FallbackSameOriginApiError("fallback_trial_already_sealed", 409, false);
    }
    this.#authorization = response.authorization;
    this.#initialBoundary = input.initialBoundary;
    this.#providerReceipt = null;
    this.#decision = null;
    return Object.freeze({
      runId: response.runId,
      caseId: response.caseId,
      trialId: response.trialId,
      authorization: response.authorization
    });
  }

  async requestFreshDecision(input: {
    readonly claim: ProbeOpaqueClaim<FallbackAuthorization>;
  }): Promise<FallbackProbeFreshDecisionResponse> {
    const authorization = this.requireAuthorization(input.claim);
    const response = fallbackProbeFreshDecisionResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/probe/fallback/decide",
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
    this.#decision =
      response.decision === null ? null : probeDecisionSchema.parse(response.decision);
    return response;
  }

  async admitNative(input: {
    readonly claim: ProbePublicClaim;
    readonly toolName: string;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<void> {
    const authorization = this.requireAuthorization(input.claim);
    if (
      authorization.envelope.liveManifest.manifestHash !== input.manifestHash ||
      this.#initialBoundary === null ||
      this.#decision?.kind !== "call" ||
      this.#decision.tool !== input.toolName ||
      !authorization.envelope.liveManifest.tools.some(({ name }) => name === input.toolName) ||
      !Number.isSafeInteger(input.registrationGeneration) ||
      input.registrationGeneration < 1
    ) {
      throw new FallbackSameOriginApiError("fallback_native_binding_mismatch", 409, false);
    }
    const response = probeNativeAdmissionResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/probe/fallback/native",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          probeToken: authorization.probeToken,
          envelope: authorization.envelope,
          initialBoundary: this.#initialBoundary
        }
      })
    );
    if (response.status !== "admitted") {
      throw new FallbackSameOriginApiError(
        "fallback_native_allowance_already_consumed",
        409,
        false
      );
    }
  }

  async completeAndSeal(
    completion: ProbeClientCompletionInput<TResetReceipt, TEvidence>
  ): Promise<unknown> {
    const authorization = this.requireAuthorization(completion.claim);
    if (this.#providerReceipt === null) {
      throw new FallbackSameOriginApiError("fallback_provider_receipt_missing", 409, false);
    }
    const response = fallbackProbeCompleteResponseSchema.parse(
      await pageFetchJson({
        page: this.page,
        path: "/api/probe/fallback/complete",
        method: "POST",
        csrfToken: this.session.csrfToken,
        documentId: this.session.documentId,
        body: {
          probeToken: authorization.probeToken,
          envelope: authorization.envelope,
          providerReceipt: this.#providerReceipt,
          continuation: this.session.continuation,
          completion
        }
      })
    );
    this.session = Object.freeze({ ...this.session, continuation: response.continuation });
    this.#authorization = null;
    this.#initialBoundary = null;
    this.#providerReceipt = null;
    this.#decision = null;
    return response;
  }

  async reveal(): Promise<unknown> {
    return pageFetchJson({
      page: this.page,
      path: "/api/probe/fallback/reveal",
      method: "POST",
      csrfToken: this.session.csrfToken,
      documentId: this.session.documentId,
      body: { continuation: this.session.continuation }
    });
  }

  async acknowledge(): Promise<void> {
    await pageFetchJson({
      page: this.page,
      path: "/api/probe/fallback/reveal",
      method: "DELETE",
      csrfToken: this.session.csrfToken,
      documentId: this.session.documentId,
      body: { continuation: this.session.continuation }
    });
  }

  sessionState(): FallbackBrowserSessionState {
    return this.session;
  }

  private requireAuthorization(
    claim: ProbePublicClaim | ProbeOpaqueClaim<FallbackAuthorization>
  ): FallbackAuthorization {
    const authorization = this.#authorization;
    if (
      !authorization ||
      authorization.envelope.runId !== claim.runId ||
      authorization.envelope.caseId !== claim.caseId ||
      authorization.envelope.trialId !== claim.trialId
    ) {
      throw new FallbackSameOriginApiError("fallback_claim_binding_missing", 409, false);
    }
    return authorization;
  }
}

export type { FallbackProbeIssueResponse, FallbackProbeSessionStartResponse };
