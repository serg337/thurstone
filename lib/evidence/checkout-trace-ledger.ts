import {
  type CheckoutSessionSource,
  type CheckoutSessionToolName,
  type CheckoutSessionTraceEvent,
  type CheckoutSessionTraceSink,
  type CheckoutTrajectoryArchive
} from "@/lib/domain/checkout-session";
import { CHECKOUT_DOMAIN_VERSION } from "@/lib/domain/checkout";
import {
  appendOperationTrace,
  createOperationTrace,
  type OperationRuntimeIdentity,
  type OperationTrace
} from "@/lib/evidence/operation-trace";
import { CART_GET_HANDLER_VERSION } from "@/lib/webmcp/cart-get-tool";
import { CART_UPDATE_HANDLER_VERSION } from "@/lib/webmcp/cart-update-tool";
import { CHECKOUT_TOOLSET_VERSION } from "@/lib/webmcp/catalog";
import { CHECKOUT_CANCEL_HANDLER_VERSION } from "@/lib/webmcp/checkout-cancel-tool";
import { CHECKOUT_REQUEST_HANDLER_VERSION } from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_HANDLER_VERSION } from "@/lib/webmcp/order-review-tool";

export const FIXTURE_RESET_HANDLER_VERSION = "fixture_reset@1.0.0";

export interface CheckoutTraceArchive {
  readonly trajectoryId: string;
  readonly archivedByResetId: string;
  readonly archivedAt: string;
  readonly traces: readonly OperationTrace[];
}

export interface CheckoutTraceLedgerSnapshot {
  readonly current: readonly OperationTrace[];
  readonly archives: readonly CheckoutTraceArchive[];
  readonly resetTraces: readonly OperationTrace[];
  readonly lastResetTrace: OperationTrace | null;
  readonly totalTraceCount: number;
}

export interface CheckoutTraceLedgerOptions {
  readonly getRegistryHash: () => string;
  readonly getArgumentMode: () => "unverified" | "object" | "json-string";
  readonly appCommit: string;
  readonly toolsetVersion?: string;
  readonly origin?: string;
  readonly userAgent?: string;
}

const HANDLER_VERSIONS: Readonly<Record<CheckoutSessionToolName, string>> = {
  cart_get: CART_GET_HANDLER_VERSION,
  order_review: ORDER_REVIEW_HANDLER_VERSION,
  cart_update: CART_UPDATE_HANDLER_VERSION,
  checkout_request: CHECKOUT_REQUEST_HANDLER_VERSION,
  checkout_cancel: CHECKOUT_CANCEL_HANDLER_VERSION,
  fixture_reset: FIXTURE_RESET_HANDLER_VERSION
};

function runtimeIdentity(
  source: CheckoutSessionSource,
  options: CheckoutTraceLedgerOptions
): OperationRuntimeIdentity {
  return Object.freeze({
    executionPath: source === "ui" ? "ui" : "native-webmcp",
    origin: options.origin ?? globalThis.location?.origin ?? "unknown-origin",
    userAgent: options.userAgent ?? globalThis.navigator?.userAgent ?? "unknown-runtime",
    argumentMode: source === "ui" ? "not-applicable" : options.getArgumentMode()
  });
}

function freezeSnapshot(
  current: readonly OperationTrace[],
  archives: readonly CheckoutTraceArchive[],
  resetTraces: readonly OperationTrace[]
): CheckoutTraceLedgerSnapshot {
  const lastResetTrace = resetTraces.at(-1) ?? null;
  return Object.freeze({
    current,
    archives,
    resetTraces,
    lastResetTrace,
    totalTraceCount:
      current.length +
      archives.reduce((total, archive) => total + archive.traces.length, 0) +
      resetTraces.length
  });
}

export class CheckoutTraceLedger implements CheckoutSessionTraceSink {
  private current: readonly OperationTrace[] = Object.freeze([]);
  private archives: readonly CheckoutTraceArchive[] = Object.freeze([]);
  private resetTraces: readonly OperationTrace[] = Object.freeze([]);
  private lastEventId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly options: CheckoutTraceLedgerOptions;
  private publicSnapshot: CheckoutTraceLedgerSnapshot;

  constructor(options: CheckoutTraceLedgerOptions) {
    if (options.appCommit.trim().length === 0) throw new Error("appCommit must not be empty");
    this.options = options;
    this.publicSnapshot = freezeSnapshot(this.current, this.archives, this.resetTraces);
  }

  snapshot = (): CheckoutTraceLedgerSnapshot => this.publicSnapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async append(event: CheckoutSessionTraceEvent): Promise<void> {
    const trace = await createOperationTrace({
      eventId: event.eventId,
      sessionId: event.sessionId,
      runId: event.trajectoryId,
      parentEventId: this.lastEventId,
      sequence: event.sequence,
      source: event.source,
      toolName: event.toolName,
      ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
      observedAt: event.observedAt,
      registryHash: this.options.getRegistryHash(),
      handlerVersion: HANDLER_VERSIONS[event.toolName],
      domainVersion: CHECKOUT_DOMAIN_VERSION,
      toolsetVersion: this.options.toolsetVersion ?? CHECKOUT_TOOLSET_VERSION,
      appCommit: this.options.appCommit,
      runtime: runtimeIdentity(event.source, this.options),
      status: event.outcome,
      commitDisposition: event.commitDisposition,
      cancellationObservedAfterCommit: () =>
        event.finalCancellation() === "after_completion" && event.effectApplied,
      cancellationObservedAfterCompletion: () => event.finalCancellation() === "after_completion",
      rawArguments: event.rawInput,
      rawArgumentsAreNormalized: true,
      canonicalArguments: event.canonicalInput,
      rawResult: event.result,
      canonicalResult: event.result,
      error: event.error,
      stateBefore: event.stateBefore,
      stateAfter: event.stateAfter
    });

    if (event.toolName === "fixture_reset") {
      this.resetTraces = Object.freeze([...this.resetTraces, trace]);
    } else {
      this.current = appendOperationTrace(this.current, trace);
    }
    this.lastEventId = trace.eventId;
    this.publish();
  }

  archive(archive: CheckoutTrajectoryArchive): void {
    if (archive.trajectoryId !== this.current[0]?.runId && this.current.length > 0) {
      throw new Error("trace archive trajectory does not match the current evidence log");
    }
    if (archive.eventCount !== this.current.length) {
      throw new Error("trace archive count does not match the current evidence log");
    }
    const summaryIds = archive.entries.map(({ eventId }) => eventId);
    const traceIds = this.current.map(({ eventId }) => eventId);
    if (summaryIds.some((eventId, index) => eventId !== traceIds[index])) {
      throw new Error("trace archive entries do not match the current evidence log");
    }

    const frozenArchive = Object.freeze({
      trajectoryId: archive.trajectoryId,
      archivedByResetId: archive.archivedByResetId,
      archivedAt: archive.archivedAt,
      traces: this.current
    });
    this.archives = Object.freeze([...this.archives, frozenArchive]);
    this.current = Object.freeze([]);
    this.publish();
  }

  private publish(): void {
    this.publicSnapshot = freezeSnapshot(this.current, this.archives, this.resetTraces);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Evidence is already committed. A view observer cannot rewrite it into a partial trace.
      }
    }
  }
}
