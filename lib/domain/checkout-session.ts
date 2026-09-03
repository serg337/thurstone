import type { ZodError } from "zod";

import {
  cartGet as readCart,
  cartUpdate as reduceCartUpdate,
  checkoutCancel as reduceCheckoutCancel,
  checkoutError,
  checkoutRequest as reduceCheckoutRequest,
  createCheckoutFixture,
  orderReview as readOrderReview,
  withReplay,
  type CartGetResult,
  type CheckoutErrorCode,
  type CheckoutErrorResult,
  type CheckoutState,
  type MutationResult,
  type OrderReviewResult
} from "@/lib/domain/checkout";
import {
  cartUpdateInputSchema,
  checkoutOperationInputSchema,
  emptyToolInputSchema,
  type CartUpdateInput,
  type CheckoutOperationInput
} from "@/lib/domain/checkout-schemas";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { normalizeJsonSafe, snapshotEnumerableData } from "@/lib/evidence/operation-trace";

export type CheckoutSessionSource = "ui" | "native";
export type CheckoutSessionToolName =
  | "cart_get"
  | "order_review"
  | "cart_update"
  | "checkout_request"
  | "checkout_cancel"
  | "fixture_reset";
export type CheckoutMutationToolName = Extract<
  CheckoutSessionToolName,
  "cart_update" | "checkout_request" | "checkout_cancel"
>;
export type CheckoutSessionIdKind = "session" | "trajectory" | "event" | "reset";

export interface CheckoutSessionContext {
  readonly source?: CheckoutSessionSource;
  readonly signal?: AbortSignal;
  readonly holdForVerification?: boolean;
  readonly demoFault?: "cart_update_successful_noop";
}

interface CancellationLatch {
  readonly isAborted: () => boolean;
  readonly state: () => CheckoutSessionCancellation;
  readonly markLinearized: () => void;
  readonly dispose: () => void;
}

interface TrackedCheckoutSessionContext extends CheckoutSessionContext {
  readonly cancellation: CancellationLatch;
}

function createCancellationLatch(signal: AbortSignal | undefined): CancellationLatch {
  let linearized = false;
  let observed: CheckoutSessionCancellation = signal?.aborted ? "before_commit" : "none";
  const onAbort = () => {
    if (observed === "none") observed = linearized ? "after_completion" : "before_commit";
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  return Object.freeze({
    isAborted: () => observed !== "none",
    state: () => observed,
    markLinearized: () => {
      linearized = true;
    },
    dispose: () => signal?.removeEventListener("abort", onAbort)
  });
}

export interface CheckoutSessionHaltReason {
  readonly code: "subscriber_failure" | "trace_sink_failure";
  readonly eventId: string;
  readonly observedAt: string;
  readonly message: string;
}

export interface CheckoutSessionSnapshot {
  readonly sessionId: string;
  readonly trajectoryId: string;
  readonly state: CheckoutState;
  readonly haltedReason: CheckoutSessionHaltReason | null;
}

export interface CheckoutSessionInspection extends CheckoutSessionSnapshot {
  readonly currentOperationCount: number;
  readonly retainedTombstoneCount: number;
  readonly currentTraceCount: number;
  readonly archivedTrajectoryCount: number;
  readonly lastResetTrace: CheckoutSessionTraceSummary | null;
}

export type CheckoutSessionTraceOutcome =
  | "completed"
  | "validation_error"
  | "expected_error"
  | "duplicate"
  | "canceled"
  | "unexpected_error"
  | "partial";

export type CheckoutSessionCommitDisposition = "none" | "committed" | "replayed" | "partial";
export type CheckoutSessionCancellation = "none" | "before_commit" | "after_completion";

export interface CheckoutSessionTraceSummary {
  readonly eventId: string;
  readonly sessionId: string;
  readonly trajectoryId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly source: CheckoutSessionSource;
  readonly toolName: CheckoutSessionToolName;
  readonly outcome: CheckoutSessionTraceOutcome;
  readonly commitDisposition: CheckoutSessionCommitDisposition;
  readonly cancellation: CheckoutSessionCancellation;
  readonly stateRevisionBefore: number;
  readonly stateRevisionAfter: number;
  readonly effectApplied: boolean;
  readonly operationId?: string;
}

export interface CheckoutSessionTraceEvent extends CheckoutSessionTraceSummary {
  /** The real evidence sink is responsible for lossless, JSON-safe normalization. */
  readonly rawInput: unknown;
  readonly canonicalInput: unknown | null;
  readonly canonicalCommand: string | null;
  readonly stateBefore: CheckoutState;
  readonly stateAfter: CheckoutState;
  readonly result: CartGetResult | OrderReviewResult | MutationResult | CheckoutResetReceipt | null;
  readonly error: { readonly name: string; readonly message: string } | null;
  readonly finalCancellation: () => CheckoutSessionCancellation;
}

export interface CheckoutTrajectoryArchive {
  readonly trajectoryId: string;
  readonly archivedByResetId: string;
  readonly archivedAt: string;
  readonly eventCount: number;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  readonly entries: readonly CheckoutSessionTraceSummary[];
}

export interface CheckoutSessionTraceSink {
  append(event: CheckoutSessionTraceEvent): void | Promise<void>;
  archive?(archive: CheckoutTrajectoryArchive): void | Promise<void>;
}

export interface CheckoutSessionCommit {
  readonly kind: "mutation" | "reset";
  readonly toolName: CheckoutMutationToolName | "fixture_reset";
  readonly eventId: string;
  readonly previousState: CheckoutState;
  readonly state: CheckoutState;
  readonly result: MutationResult | CheckoutResetReceipt;
}

export type CheckoutSessionSubscriber = (
  commit: CheckoutSessionCommit,
  snapshot: CheckoutSessionSnapshot
) => void | Promise<void>;

export interface CheckoutResetCore {
  readonly fixtureId: CheckoutState["fixtureId"];
  readonly fixtureVersion: CheckoutState["fixtureVersion"];
  readonly fixtureSeed: CheckoutState["seed"];
  readonly stateRevision: 0;
  readonly stateHash: string;
  readonly pendingCheckout: null;
  readonly lines: readonly {
    readonly itemId: CheckoutState["lines"][number]["itemId"];
    readonly quantity: number;
  }[];
  readonly currentOperationCount: 0;
}

export interface CheckoutResetReceipt {
  readonly ok: true;
  readonly code: "fixture_reset";
  readonly receiptScope: "domain_core";
  readonly registryVerification: "pending";
  readonly resetId: string;
  readonly resetEventId: string;
  readonly resetAt: string;
  readonly sessionId: string;
  readonly trajectoryId: string;
  readonly archivedTrajectoryId: string;
  readonly archivedEventCount: number;
  readonly retainedTombstoneCount: number;
  readonly core: CheckoutResetCore;
  readonly coreHash: string;
}

export interface CheckoutSessionOptions {
  readonly clock?: () => string;
  readonly idFactory?: (kind: CheckoutSessionIdKind) => string;
  readonly traceSink?: CheckoutSessionTraceSink;
  readonly maxTombstones?: number;
}

interface OperationTombstone {
  readonly canonicalCommand: string;
  readonly originalResult: MutationResult;
}

interface InternalSession {
  readonly state: CheckoutState;
  readonly tombstones: ReadonlyMap<string, OperationTombstone>;
  readonly currentOperationIds: ReadonlySet<string>;
  readonly trajectoryId: string;
  readonly entries: readonly CheckoutSessionTraceSummary[];
  readonly archives: readonly CheckoutTrajectoryArchive[];
  readonly lastResetTrace: CheckoutSessionTraceSummary | null;
  readonly haltedReason: CheckoutSessionHaltReason | null;
}

type ReadResult = CartGetResult | OrderReviewResult | CheckoutErrorResult;

const DEFAULT_MAX_TOMBSTONES = 2_048;

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdFactory(kind: CheckoutSessionIdKind): string {
  return `${kind}_${globalThis.crypto.randomUUID()}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The checkout operation was canceled before state commit.", "AbortError");
}

function errorDetails(error: unknown): { readonly name: string; readonly message: string } {
  if (error instanceof Error) {
    return Object.freeze({ name: error.name, message: error.message });
  }

  return Object.freeze({ name: "Error", message: "An unknown session error occurred." });
}

function operationIdFromRaw(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  try {
    const operationId = (input as Record<string, unknown>).operationId;
    return typeof operationId === "string" ? operationId : undefined;
  } catch {
    return undefined;
  }
}

function validationCode(error: ZodError): CheckoutErrorCode {
  const firstPath = error.issues[0]?.path[0];
  if (firstPath === "operationId") return "invalid_operation_id";
  if (firstPath === "itemId") return "invalid_item";
  if (firstPath === "operation") return "invalid_operation";
  if (firstPath === "quantity") return "invalid_quantity";
  return "invalid_arguments";
}

function validationMessage(code: CheckoutErrorCode): string {
  switch (code) {
    case "invalid_operation_id":
      return "operationId must be a 16–64 character URL-safe identifier.";
    case "invalid_item":
      return "itemId must name an item in the deterministic checkout fixture.";
    case "invalid_operation":
      return "operation must be set_quantity.";
    case "invalid_quantity":
      return "quantity must be an integer from 0 through 10; 0 removes the cart line.";
    default:
      return "Arguments do not match the tool's closed input schema.";
  }
}

function sessionError(
  state: CheckoutState,
  code: CheckoutErrorCode,
  message: string,
  operationId?: string,
  retryable = false
): CheckoutErrorResult {
  return Object.freeze({
    ok: false,
    code,
    message,
    retryable,
    ...(operationId === undefined ? {} : { operationId }),
    replayed: false,
    stateRevision: state.revision
  });
}

function validationResult(
  state: CheckoutState,
  input: unknown,
  error: ZodError
): CheckoutErrorResult {
  const code = validationCode(error);
  return sessionError(state, code, validationMessage(code), operationIdFromRaw(input), true);
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function freezeSummary(summary: CheckoutSessionTraceSummary): CheckoutSessionTraceSummary {
  return Object.freeze(summary);
}

export class CheckoutSessionStore {
  private readonly sessionId: string;
  private readonly clock: () => string;
  private readonly idFactory: (kind: CheckoutSessionIdKind) => string;
  private readonly traceSink: CheckoutSessionTraceSink | undefined;
  private readonly maxTombstones: number;
  private readonly subscribers = new Set<CheckoutSessionSubscriber>();
  private tail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private resetAdmission: { readonly resetId?: string; readonly trajectoryId?: string } | undefined;
  private internal: InternalSession;
  private publicSnapshot: CheckoutSessionSnapshot;

  constructor(options: CheckoutSessionOptions = {}) {
    const maxTombstones = options.maxTombstones ?? DEFAULT_MAX_TOMBSTONES;
    if (!Number.isSafeInteger(maxTombstones) || maxTombstones < 1) {
      throw new RangeError("maxTombstones must be a positive safe integer.");
    }

    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.traceSink = options.traceSink;
    this.maxTombstones = maxTombstones;
    this.sessionId = this.idFactory("session");
    this.internal = {
      state: createCheckoutFixture(),
      tombstones: new Map(),
      currentOperationIds: new Set(),
      trajectoryId: this.idFactory("trajectory"),
      entries: Object.freeze([]),
      archives: Object.freeze([]),
      lastResetTrace: null,
      haltedReason: null
    };
    this.publicSnapshot = this.buildSnapshot();
  }

  getSnapshot = (): CheckoutSessionSnapshot => this.publicSnapshot;

  inspect = (): CheckoutSessionInspection =>
    Object.freeze({
      ...this.publicSnapshot,
      currentOperationCount: this.internal.currentOperationIds.size,
      retainedTombstoneCount: this.internal.tombstones.size,
      currentTraceCount: this.internal.entries.length,
      archivedTrajectoryCount: this.internal.archives.length,
      lastResetTrace: this.internal.lastResetTrace
    });

  currentTrajectory = (): readonly CheckoutSessionTraceSummary[] => this.internal.entries;

  archivedTrajectories = (): readonly CheckoutTrajectoryArchive[] => this.internal.archives;

  subscribe(listener: CheckoutSessionSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  cartGet = (
    input: unknown,
    context: CheckoutSessionContext = {}
  ): Promise<CartGetResult | CheckoutErrorResult> => {
    if (this.resetAdmission) return Promise.reject(this.resetAdmissionError());
    const rawInput = normalizeJsonSafe(input);
    const semanticInput = snapshotEnumerableData(input);
    return this.enqueueTracked(context, (tracked) =>
      this.performRead("cart_get", semanticInput, tracked, rawInput)
    );
  };

  orderReview = (
    input: unknown,
    context: CheckoutSessionContext = {}
  ): Promise<OrderReviewResult | CheckoutErrorResult> => {
    if (this.resetAdmission) return Promise.reject(this.resetAdmissionError());
    const rawInput = normalizeJsonSafe(input);
    const semanticInput = snapshotEnumerableData(input);
    return this.enqueueTracked(context, (tracked) =>
      this.performRead("order_review", semanticInput, tracked, rawInput)
    );
  };

  cartUpdate = (input: unknown, context: CheckoutSessionContext = {}): Promise<MutationResult> => {
    if (this.resetAdmission) return Promise.reject(this.resetAdmissionError());
    const rawInput = normalizeJsonSafe(input);
    const semanticInput = snapshotEnumerableData(input);
    return this.enqueueTracked(context, (tracked) =>
      this.performMutation("cart_update", semanticInput, tracked, rawInput)
    );
  };

  checkoutRequest = (
    input: unknown,
    context: CheckoutSessionContext = {}
  ): Promise<MutationResult> => {
    if (this.resetAdmission) return Promise.reject(this.resetAdmissionError());
    const rawInput = normalizeJsonSafe(input);
    const semanticInput = snapshotEnumerableData(input);
    return this.enqueueTracked(context, (tracked) =>
      this.performMutation("checkout_request", semanticInput, tracked, rawInput)
    );
  };

  checkoutCancel = (
    input: unknown,
    context: CheckoutSessionContext = {}
  ): Promise<MutationResult> => {
    if (this.resetAdmission) return Promise.reject(this.resetAdmissionError());
    const rawInput = normalizeJsonSafe(input);
    const semanticInput = snapshotEnumerableData(input);
    return this.enqueueTracked(context, (tracked) =>
      this.performMutation("checkout_cancel", semanticInput, tracked, rawInput)
    );
  };

  hardReset = (context: CheckoutSessionContext = {}): Promise<CheckoutResetReceipt> => {
    if (context.holdForVerification) this.resetAdmission = Object.freeze({});
    return this.enqueueTracked(context, (tracked) => this.performReset(tracked)).catch((error) => {
      this.resetAdmission = undefined;
      throw error;
    });
  };

  isResetAdmissionLocked = (): boolean => this.resetAdmission !== undefined;

  releaseResetAdmission(resetId: string): boolean {
    if (!this.resetAdmission || this.resetAdmission.resetId !== resetId) return false;
    this.resetAdmission = undefined;
    return true;
  }

  abandonResetAdmission(): void {
    this.resetAdmission = undefined;
  }

  private resetAdmissionError(): DOMException {
    return new DOMException(
      "Checkout operations are paused while the reset receipt is verified.",
      "InvalidStateError"
    );
  }

  private buildSnapshot(): CheckoutSessionSnapshot {
    return Object.freeze({
      sessionId: this.sessionId,
      trajectoryId: this.internal.trajectoryId,
      state: this.internal.state,
      haltedReason: this.internal.haltedReason
    });
  }

  private assignInternal(next: InternalSession): void {
    const snapshotChanged =
      next.state !== this.internal.state ||
      next.trajectoryId !== this.internal.trajectoryId ||
      next.haltedReason !== this.internal.haltedReason;
    this.internal = next;
    if (snapshotChanged) this.publicSnapshot = this.buildSnapshot();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private enqueueTracked<T>(
    context: CheckoutSessionContext,
    operation: (context: TrackedCheckoutSessionContext) => Promise<T>
  ): Promise<T> {
    const cancellation = createCancellationLatch(context.signal);
    const tracked: TrackedCheckoutSessionContext = Object.freeze({ ...context, cancellation });
    return this.enqueue(() => operation(tracked)).finally(cancellation.dispose);
  }

  private nextTraceBase(
    toolName: CheckoutSessionToolName,
    source: CheckoutSessionSource,
    stateBefore: CheckoutState,
    operationId?: string,
    trajectoryId = this.internal.trajectoryId
  ): Pick<
    CheckoutSessionTraceEvent,
    | "eventId"
    | "sessionId"
    | "sequence"
    | "observedAt"
    | "source"
    | "toolName"
    | "stateBefore"
    | "stateRevisionBefore"
  > & { readonly operationId?: string; readonly trajectoryId: string } {
    this.sequence += 1;
    return {
      eventId: this.idFactory("event"),
      sessionId: this.sessionId,
      sequence: this.sequence,
      observedAt: this.clock(),
      source,
      toolName,
      stateBefore,
      stateRevisionBefore: stateBefore.revision,
      ...(operationId === undefined ? {} : { operationId }),
      trajectoryId
    };
  }

  private summaryFrom(event: CheckoutSessionTraceEvent): CheckoutSessionTraceSummary {
    return freezeSummary({
      eventId: event.eventId,
      sessionId: event.sessionId,
      trajectoryId: event.trajectoryId,
      sequence: event.sequence,
      observedAt: event.observedAt,
      source: event.source,
      toolName: event.toolName,
      outcome: event.outcome,
      commitDisposition: event.commitDisposition,
      cancellation: event.cancellation,
      stateRevisionBefore: event.stateRevisionBefore,
      stateRevisionAfter: event.stateRevisionAfter,
      effectApplied: event.effectApplied,
      ...(event.operationId === undefined ? {} : { operationId: event.operationId })
    });
  }

  private appendTraceOnly(event: CheckoutSessionTraceEvent): void {
    this.assignInternal({
      ...this.internal,
      entries: Object.freeze([...this.internal.entries, this.summaryFrom(event)])
    });
  }

  private replaceTraceSummary(event: CheckoutSessionTraceEvent): void {
    if (this.internal.lastResetTrace?.eventId === event.eventId) {
      this.assignInternal({ ...this.internal, lastResetTrace: this.summaryFrom(event) });
      return;
    }
    const entries = this.internal.entries;
    if (entries.at(-1)?.eventId === event.eventId) {
      this.assignInternal({
        ...this.internal,
        entries: Object.freeze([...entries.slice(0, -1), this.summaryFrom(event)])
      });
    }
  }

  private async deliverTrace(event: CheckoutSessionTraceEvent): Promise<void> {
    let finalEvent = event;

    if (this.traceSink) {
      try {
        await this.traceSink.append(event);
      } catch {
        this.halt("trace_sink_failure", event, "The evidence trace sink failed.");
        finalEvent = Object.freeze({
          ...event,
          outcome: "partial" as const,
          commitDisposition:
            event.commitDisposition === "committed" ? ("partial" as const) : event.commitDisposition
        });
      }
    }

    const cancellation = event.finalCancellation();
    if (cancellation !== finalEvent.cancellation) {
      finalEvent = Object.freeze({ ...finalEvent, cancellation });
    }
    if (finalEvent !== event) {
      this.replaceTraceSummary(finalEvent);
    }
  }

  private halt(
    code: CheckoutSessionHaltReason["code"],
    event: CheckoutSessionTraceEvent,
    message: string
  ): void {
    if (this.internal.haltedReason) return;
    const haltedReason = Object.freeze({
      code,
      eventId: event.eventId,
      observedAt: event.observedAt,
      message
    });
    this.assignInternal({ ...this.internal, haltedReason });
  }

  private async traceCancellation(
    toolName: CheckoutSessionToolName,
    input: unknown,
    context: TrackedCheckoutSessionContext,
    canonicalInput: unknown | null = null,
    canonicalCommand: string | null = null,
    semanticInput: unknown = input
  ): Promise<never> {
    const state = this.internal.state;
    const operationId = operationIdFromRaw(semanticInput);
    const base = this.nextTraceBase(toolName, context.source ?? "ui", state, operationId);
    const event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome: "canceled",
      commitDisposition: "none",
      cancellation: "before_commit",
      rawInput: input,
      canonicalInput,
      canonicalCommand,
      stateAfter: state,
      stateRevisionAfter: state.revision,
      effectApplied: false,
      result: null,
      error: Object.freeze({ name: "AbortError", message: "Canceled before state commit." }),
      finalCancellation: context.cancellation.state
    });
    this.appendTraceOnly(event);
    await this.deliverTrace(event);
    throw abortError();
  }

  private haltedResult(input: unknown): CheckoutErrorResult {
    return sessionError(
      this.internal.state,
      "session_halted",
      "The checkout session is halted. Perform a hard reset before continuing.",
      operationIdFromRaw(input)
    );
  }

  private async traceTerminalResult(
    toolName: CheckoutSessionToolName,
    input: unknown,
    context: TrackedCheckoutSessionContext,
    result: ReadResult | MutationResult,
    outcome: CheckoutSessionTraceOutcome,
    canonicalInput: unknown | null = null,
    canonicalCommand: string | null = null,
    commitDisposition: CheckoutSessionCommitDisposition = "none"
  ): Promise<void> {
    const state = this.internal.state;
    context.cancellation.markLinearized();
    const operationId = "operationId" in result ? result.operationId : undefined;
    const base = this.nextTraceBase(toolName, context.source ?? "ui", state, operationId);
    const event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome,
      commitDisposition,
      cancellation: context.cancellation.state(),
      rawInput: input,
      canonicalInput,
      canonicalCommand,
      stateAfter: state,
      stateRevisionAfter: state.revision,
      effectApplied: false,
      result,
      error: null,
      finalCancellation: context.cancellation.state
    });
    this.appendTraceOnly(event);
    await this.deliverTrace(event);
  }

  private performRead(
    toolName: "cart_get",
    input: unknown,
    context: TrackedCheckoutSessionContext,
    rawInput: unknown
  ): Promise<CartGetResult | CheckoutErrorResult>;
  private performRead(
    toolName: "order_review",
    input: unknown,
    context: TrackedCheckoutSessionContext,
    rawInput: unknown
  ): Promise<OrderReviewResult | CheckoutErrorResult>;
  private async performRead(
    toolName: "cart_get" | "order_review",
    input: unknown,
    context: TrackedCheckoutSessionContext,
    rawInput: unknown
  ): Promise<ReadResult> {
    if (context.cancellation.isAborted()) {
      await this.traceCancellation(toolName, rawInput, context, null, null, input);
    }

    if (this.internal.haltedReason) {
      const result = this.haltedResult(input);
      await this.traceTerminalResult(toolName, rawInput, context, result, "expected_error");
      return result;
    }

    let parsed;
    try {
      parsed = emptyToolInputSchema.safeParse(input);
    } catch (error) {
      await this.traceUnexpectedError(toolName, rawInput, context, null, null, error);
      throw error;
    }
    if (!parsed.success) {
      const result = validationResult(this.internal.state, input, parsed.error);
      await this.traceTerminalResult(toolName, rawInput, context, result, "validation_error");
      return result;
    }

    const canonicalInput = freezeDeep(parsed.data);
    const state = this.internal.state;
    const result = freezeDeep(toolName === "cart_get" ? readCart(state) : readOrderReview(state));
    context.cancellation.markLinearized();
    const base = this.nextTraceBase(toolName, context.source ?? "ui", state);
    const event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome: "completed",
      commitDisposition: "none",
      cancellation: context.cancellation.state(),
      rawInput,
      canonicalInput,
      canonicalCommand: canonicalJson({ toolName, input: canonicalInput }),
      stateAfter: state,
      stateRevisionAfter: state.revision,
      effectApplied: false,
      result,
      error: null,
      finalCancellation: context.cancellation.state
    });
    this.appendTraceOnly(event);
    await this.deliverTrace(event);
    return result;
  }

  private parseMutation(
    toolName: CheckoutMutationToolName,
    input: unknown
  ):
    | { readonly success: true; readonly data: CartUpdateInput | CheckoutOperationInput }
    | { readonly success: false; readonly error: ZodError } {
    const parsed =
      toolName === "cart_update"
        ? cartUpdateInputSchema.safeParse(input)
        : checkoutOperationInputSchema.safeParse(input);
    return parsed;
  }

  private async performMutation(
    toolName: CheckoutMutationToolName,
    input: unknown,
    context: TrackedCheckoutSessionContext,
    rawInput: unknown
  ): Promise<MutationResult> {
    if (context.cancellation.isAborted()) {
      await this.traceCancellation(toolName, rawInput, context, null, null, input);
    }

    if (this.internal.haltedReason) {
      const result = this.haltedResult(input);
      await this.traceTerminalResult(toolName, rawInput, context, result, "expected_error");
      return result;
    }

    let parsed;
    try {
      parsed = this.parseMutation(toolName, input);
    } catch (error) {
      await this.traceUnexpectedError(toolName, rawInput, context, null, null, error);
      throw error;
    }
    if (!parsed.success) {
      const result = validationResult(this.internal.state, input, parsed.error);
      await this.traceTerminalResult(toolName, rawInput, context, result, "validation_error");
      return result;
    }

    const canonicalInput = freezeDeep(parsed.data);
    const canonicalCommand = canonicalJson({ toolName, input: canonicalInput });
    const operationId = parsed.data.operationId;
    const tombstone = this.internal.tombstones.get(operationId);

    if (tombstone) {
      if (tombstone.canonicalCommand === canonicalCommand) {
        const result = withReplay(tombstone.originalResult);
        await this.traceTerminalResult(
          toolName,
          rawInput,
          context,
          result,
          "duplicate",
          canonicalInput,
          canonicalCommand,
          "replayed"
        );
        return result;
      }

      const result = checkoutError(
        this.internal.state,
        operationId,
        "operation_id_conflict",
        "operationId was already consumed by a different canonical command.",
        false
      );
      await this.traceTerminalResult(
        toolName,
        rawInput,
        context,
        result,
        "expected_error",
        canonicalInput,
        canonicalCommand
      );
      return result;
    }

    if (this.internal.tombstones.size >= this.maxTombstones) {
      const result = checkoutError(
        this.internal.state,
        operationId,
        "operation_ledger_full",
        "The document-lifetime operation ledger is full; hard reset cannot clear it.",
        false
      );
      await this.traceTerminalResult(
        toolName,
        rawInput,
        context,
        result,
        "expected_error",
        canonicalInput,
        canonicalCommand
      );
      return result;
    }

    try {
      let transition;
      if (toolName === "cart_update") {
        const cartInput = parsed.data as CartUpdateInput;
        const currentQuantity = this.internal.state.lines.find(
          ({ itemId }) => itemId === cartInput.itemId
        )?.quantity;
        const effectiveInput =
          context.demoFault === "cart_update_successful_noop" && currentQuantity !== undefined
            ? { ...cartInput, quantity: currentQuantity }
            : cartInput;
        transition = reduceCartUpdate(this.internal.state, effectiveInput);
      } else if (toolName === "checkout_request") {
        const cartSnapshotHash = await canonicalSha256(this.internal.state);
        if (context.cancellation.isAborted()) {
          await this.traceCancellation(
            toolName,
            rawInput,
            context,
            canonicalInput,
            canonicalCommand,
            input
          );
        }
        transition = reduceCheckoutRequest(
          this.internal.state,
          parsed.data as CheckoutOperationInput,
          cartSnapshotHash
        );
      } else {
        transition = reduceCheckoutCancel(
          this.internal.state,
          parsed.data as CheckoutOperationInput
        );
      }

      if (context.cancellation.isAborted()) {
        await this.traceCancellation(
          toolName,
          rawInput,
          context,
          canonicalInput,
          canonicalCommand,
          input
        );
      }

      return await this.commitMutation(
        toolName,
        rawInput,
        context,
        canonicalInput,
        canonicalCommand,
        transition.state,
        transition.result,
        transition.effectApplied
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      await this.traceUnexpectedError(
        toolName,
        rawInput,
        context,
        canonicalInput,
        canonicalCommand,
        error
      );
      throw error;
    }
  }

  private async commitMutation(
    toolName: CheckoutMutationToolName,
    input: unknown,
    context: TrackedCheckoutSessionContext,
    canonicalInput: CartUpdateInput | CheckoutOperationInput,
    canonicalCommand: string,
    nextState: CheckoutState,
    result: MutationResult,
    effectApplied: boolean
  ): Promise<MutationResult> {
    const previousState = this.internal.state;
    context.cancellation.markLinearized();
    const base = this.nextTraceBase(
      toolName,
      context.source ?? "ui",
      previousState,
      result.operationId
    );
    let event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome: result.ok ? "completed" : "expected_error",
      commitDisposition: effectApplied ? "committed" : "none",
      cancellation: context.cancellation.state(),
      rawInput: input,
      canonicalInput,
      canonicalCommand,
      stateAfter: nextState,
      stateRevisionAfter: nextState.revision,
      effectApplied,
      result,
      error: null,
      finalCancellation: context.cancellation.state
    });
    const tombstones = new Map(this.internal.tombstones);
    tombstones.set(canonicalInput.operationId, {
      canonicalCommand,
      originalResult: result
    });
    const currentOperationIds = new Set(this.internal.currentOperationIds);
    currentOperationIds.add(canonicalInput.operationId);

    this.assignInternal({
      ...this.internal,
      state: nextState,
      tombstones,
      currentOperationIds,
      entries: Object.freeze([...this.internal.entries, this.summaryFrom(event)])
    });

    if (effectApplied) {
      const commit = Object.freeze({
        kind: "mutation" as const,
        toolName,
        eventId: event.eventId,
        previousState,
        state: nextState,
        result
      });
      const subscriberFailed = await this.notifySubscribers(commit, event);
      const canceledAfterCompletion = context.cancellation.state() === "after_completion";
      if (subscriberFailed || canceledAfterCompletion) {
        event = Object.freeze({
          ...event,
          outcome: subscriberFailed ? ("partial" as const) : event.outcome,
          commitDisposition: subscriberFailed ? ("partial" as const) : event.commitDisposition,
          cancellation: canceledAfterCompletion ? ("after_completion" as const) : event.cancellation
        });
        this.replaceTraceSummary(event);
      }
    }

    await this.deliverTrace(event);
    return result;
  }

  private async notifySubscribers(
    commit: CheckoutSessionCommit,
    event: CheckoutSessionTraceEvent
  ): Promise<boolean> {
    if (this.subscribers.size === 0) return false;
    const outcomes = await Promise.allSettled(
      [...this.subscribers].map((subscriber) =>
        Promise.resolve().then(() => subscriber(commit, this.publicSnapshot))
      )
    );
    const failed = outcomes.some(({ status }) => status === "rejected");
    if (failed) {
      this.halt(
        "subscriber_failure",
        event,
        "A post-commit checkout subscriber failed; the committed state was preserved."
      );
    }
    return failed;
  }

  private async traceUnexpectedError(
    toolName: CheckoutSessionToolName,
    input: unknown,
    context: TrackedCheckoutSessionContext,
    canonicalInput: unknown | null,
    canonicalCommand: string | null,
    error: unknown
  ): Promise<void> {
    const state = this.internal.state;
    context.cancellation.markLinearized();
    const operationId = operationIdFromRaw(input);
    const base = this.nextTraceBase(toolName, context.source ?? "ui", state, operationId);
    const event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome: "unexpected_error",
      commitDisposition: "none",
      cancellation: context.cancellation.state(),
      rawInput: input,
      canonicalInput,
      canonicalCommand,
      stateAfter: state,
      stateRevisionAfter: state.revision,
      effectApplied: false,
      result: null,
      error: errorDetails(error),
      finalCancellation: context.cancellation.state
    });
    this.appendTraceOnly(event);
    await this.deliverTrace(event);
  }

  private async performReset(
    context: TrackedCheckoutSessionContext
  ): Promise<CheckoutResetReceipt> {
    const input = Object.freeze({});
    if (context.cancellation.isAborted()) {
      await this.traceCancellation("fixture_reset", input, context);
    }

    const previousState = this.internal.state;
    const resetState = createCheckoutFixture();
    const stateHash = await canonicalSha256(resetState);
    const coreWithoutHash = Object.freeze({
      fixtureId: resetState.fixtureId,
      fixtureVersion: resetState.fixtureVersion,
      fixtureSeed: resetState.seed,
      stateRevision: 0 as const,
      stateHash,
      pendingCheckout: null,
      lines: Object.freeze(
        resetState.lines.map(({ itemId, quantity }) => Object.freeze({ itemId, quantity }))
      ),
      currentOperationCount: 0 as const
    });
    const coreHash = await canonicalSha256(coreWithoutHash);
    if (context.cancellation.isAborted()) {
      await this.traceCancellation("fixture_reset", input, context, input, canonicalJson(input));
    }

    const resetId = this.idFactory("reset");
    const resetAt = this.clock();
    const trajectoryId = this.idFactory("trajectory");
    if (context.holdForVerification) {
      this.resetAdmission = Object.freeze({ resetId, trajectoryId });
    }
    const archivedEntries = this.internal.entries;
    const archive: CheckoutTrajectoryArchive = Object.freeze({
      trajectoryId: this.internal.trajectoryId,
      archivedByResetId: resetId,
      archivedAt: resetAt,
      eventCount: archivedEntries.length,
      firstSequence: archivedEntries[0]?.sequence ?? null,
      lastSequence: archivedEntries.at(-1)?.sequence ?? null,
      entries: archivedEntries
    });
    const base = this.nextTraceBase(
      "fixture_reset",
      context.source ?? "ui",
      previousState,
      undefined,
      trajectoryId
    );
    const core: CheckoutResetCore = coreWithoutHash;
    const receipt: CheckoutResetReceipt = freezeDeep({
      ok: true,
      code: "fixture_reset",
      receiptScope: "domain_core",
      registryVerification: "pending",
      resetId,
      resetEventId: base.eventId,
      resetAt,
      sessionId: this.sessionId,
      trajectoryId,
      archivedTrajectoryId: archive.trajectoryId,
      archivedEventCount: archive.eventCount,
      retainedTombstoneCount: this.internal.tombstones.size,
      core,
      coreHash
    });
    context.cancellation.markLinearized();
    let event: CheckoutSessionTraceEvent = Object.freeze({
      ...base,
      outcome: "completed",
      commitDisposition: "committed",
      cancellation: context.cancellation.state(),
      rawInput: input,
      canonicalInput: input,
      canonicalCommand: canonicalJson({ toolName: "fixture_reset", input }),
      stateAfter: resetState,
      stateRevisionAfter: resetState.revision,
      effectApplied: true,
      result: receipt,
      error: null,
      finalCancellation: context.cancellation.state
    });

    this.assignInternal({
      state: resetState,
      tombstones: this.internal.tombstones,
      currentOperationIds: new Set(),
      trajectoryId,
      entries: Object.freeze([]),
      archives: Object.freeze([...this.internal.archives, archive]),
      lastResetTrace: this.summaryFrom(event),
      haltedReason: null
    });

    const commit = Object.freeze({
      kind: "reset" as const,
      toolName: "fixture_reset" as const,
      eventId: event.eventId,
      previousState,
      state: resetState,
      result: receipt
    });
    const subscriberFailed = await this.notifySubscribers(commit, event);
    const canceledAfterCompletion = context.cancellation.state() === "after_completion";
    if (subscriberFailed || canceledAfterCompletion) {
      event = Object.freeze({
        ...event,
        outcome: subscriberFailed ? ("partial" as const) : event.outcome,
        commitDisposition: subscriberFailed ? ("partial" as const) : event.commitDisposition,
        cancellation: canceledAfterCompletion ? ("after_completion" as const) : event.cancellation
      });
      this.replaceTraceSummary(event);
    }

    if (this.traceSink?.archive) {
      try {
        await this.traceSink.archive(archive);
      } catch {
        this.halt("trace_sink_failure", event, "The evidence trajectory archive sink failed.");
        event = Object.freeze({
          ...event,
          outcome: "partial",
          commitDisposition: "partial"
        });
        this.replaceTraceSummary(event);
      }
    }
    await this.deliverTrace(event);
    return receipt;
  }
}
