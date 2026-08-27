export const CHECKOUT_FIXTURE_ID = "checkout-seed-v1";
export const CHECKOUT_FIXTURE_VERSION = "checkout-fixture@1.0.0";
export const CHECKOUT_FIXTURE_SEED = "toolproof-checkout-seed-001";
export const CHECKOUT_DOMAIN_VERSION = "checkout-domain@1.0.0";
export const CHECKOUT_CURRENCY = "USD";

export type CartItemId = "field-notebook" | "stoneware-mug";
export type MutationToolName = "cart_update" | "checkout_request" | "checkout_cancel";

export interface CartLine {
  readonly itemId: CartItemId;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface Fulfillment {
  readonly shippingMethod: "standard";
  readonly shippingLabel: "Standard shipping";
  readonly shippingCents: 700;
  readonly deliveryWindow: "3-5-business-days";
  readonly deliveryNotice: "Simulated estimate; no shipment occurs.";
}

export interface PendingCheckout {
  readonly status: "pending_human_approval";
  readonly pendingId: string;
  readonly requestOperationId: string;
  readonly requestedFromRevision: number;
  readonly cartSnapshotHash: string;
  readonly orderTotalCents: number;
}

export interface CheckoutState {
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly fixtureVersion: typeof CHECKOUT_FIXTURE_VERSION;
  readonly seed: typeof CHECKOUT_FIXTURE_SEED;
  readonly revision: number;
  readonly currency: typeof CHECKOUT_CURRENCY;
  readonly lines: readonly CartLine[];
  readonly fulfillment: Fulfillment;
  readonly pendingCheckout: PendingCheckout | null;
}

export interface CartGetResult {
  readonly ok: true;
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly stateRevision: number;
  readonly lines: readonly {
    readonly itemId: CartItemId;
    readonly name: string;
    readonly quantity: number;
  }[];
}

export interface OrderReviewResult {
  readonly ok: true;
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly stateRevision: number;
  readonly currency: typeof CHECKOUT_CURRENCY;
  readonly lines: readonly {
    readonly itemId: CartItemId;
    readonly name: string;
    readonly quantity: number;
    readonly unitPriceCents: number;
    readonly lineTotalCents: number;
  }[];
  readonly subtotalCents: number;
  readonly shipping: Fulfillment;
  readonly totalCents: number;
  readonly checkoutStatus: "ready_for_review" | "pending_human_approval";
}

export interface CartUpdateCommand {
  readonly operationId: string;
  readonly operation: "set_quantity";
  readonly itemId: CartItemId;
  readonly quantity: number;
}

export interface CheckoutOperationCommand {
  readonly operationId: string;
}

interface MutationReceiptBase {
  readonly operationId: string;
  readonly replayed: boolean;
  readonly stateRevision: number;
}

export interface CartUpdatedResult extends MutationReceiptBase {
  readonly ok: true;
  readonly code: "updated" | "no_change";
  readonly itemId: CartItemId;
  readonly previousQuantity: number;
  readonly quantity: number;
}

export interface CheckoutRequestedResult extends MutationReceiptBase {
  readonly ok: true;
  readonly code: "pending_human_approval";
  readonly pendingId: string;
  readonly requestedFromRevision: number;
  readonly orderTotalCents: number;
}

export interface CheckoutCanceledResult extends MutationReceiptBase {
  readonly ok: true;
  readonly code: "checkout_canceled";
  readonly pendingId: string;
}

export type CheckoutErrorCode =
  | "invalid_arguments"
  | "invalid_operation_id"
  | "invalid_item"
  | "invalid_operation"
  | "invalid_quantity"
  | "checkout_pending"
  | "already_pending"
  | "no_pending_checkout"
  | "operation_id_conflict"
  | "operation_ledger_full"
  | "session_halted";

export interface CheckoutErrorResult {
  readonly ok: false;
  readonly code: CheckoutErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly replayed: boolean;
  readonly stateRevision: number;
}

export type MutationResult =
  CartUpdatedResult | CheckoutRequestedResult | CheckoutCanceledResult | CheckoutErrorResult;

export interface DomainMutation<Result extends MutationResult = MutationResult> {
  readonly state: CheckoutState;
  readonly result: Result;
  readonly effectApplied: boolean;
}

const SEEDED_LINES: readonly CartLine[] = [
  {
    itemId: "field-notebook",
    name: "Field notebook",
    quantity: 1,
    unitPriceCents: 1800
  },
  {
    itemId: "stoneware-mug",
    name: "Stoneware mug",
    quantity: 2,
    unitPriceCents: 2400
  }
];

const FULFILLMENT: Fulfillment = {
  shippingMethod: "standard",
  shippingLabel: "Standard shipping",
  shippingCents: 700,
  deliveryWindow: "3-5-business-days",
  deliveryNotice: "Simulated estimate; no shipment occurs."
};

function freezeState(state: CheckoutState): CheckoutState {
  state.lines.forEach(Object.freeze);
  Object.freeze(state.lines);
  Object.freeze(state.fulfillment);
  if (state.pendingCheckout) Object.freeze(state.pendingCheckout);
  return Object.freeze(state);
}

function errorResult(
  state: CheckoutState,
  operationId: string,
  code: CheckoutErrorCode,
  message: string,
  retryable: boolean
): CheckoutErrorResult {
  return Object.freeze({
    ok: false,
    code,
    message,
    retryable,
    operationId,
    replayed: false,
    stateRevision: state.revision
  });
}

export function createCheckoutFixture(): CheckoutState {
  return freezeState({
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    seed: CHECKOUT_FIXTURE_SEED,
    revision: 0,
    currency: CHECKOUT_CURRENCY,
    lines: SEEDED_LINES.map((line) => ({ ...line })),
    fulfillment: { ...FULFILLMENT },
    pendingCheckout: null
  });
}

export function cartGet(state: CheckoutState): CartGetResult {
  return {
    ok: true,
    fixtureId: state.fixtureId,
    stateRevision: state.revision,
    lines: state.lines.map(({ itemId, name, quantity }) => ({ itemId, name, quantity }))
  };
}

export function cartSubtotalCents(state: CheckoutState): number {
  return state.lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

export function orderTotalCents(state: CheckoutState): number {
  return cartSubtotalCents(state) + state.fulfillment.shippingCents;
}

export function orderReview(state: CheckoutState): OrderReviewResult {
  return {
    ok: true,
    fixtureId: state.fixtureId,
    stateRevision: state.revision,
    currency: state.currency,
    lines: state.lines.map(({ itemId, name, quantity, unitPriceCents }) => ({
      itemId,
      name,
      quantity,
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity
    })),
    subtotalCents: cartSubtotalCents(state),
    shipping: { ...state.fulfillment },
    totalCents: orderTotalCents(state),
    checkoutStatus: state.pendingCheckout ? "pending_human_approval" : "ready_for_review"
  };
}

export function cartUpdate(
  state: CheckoutState,
  command: CartUpdateCommand
): DomainMutation<CartUpdatedResult | CheckoutErrorResult> {
  if (state.pendingCheckout) {
    return {
      state,
      result: errorResult(
        state,
        command.operationId,
        "checkout_pending",
        "Cancel the simulated pending checkout before changing the cart.",
        false
      ),
      effectApplied: false
    };
  }

  const lineIndex = state.lines.findIndex(({ itemId }) => itemId === command.itemId);
  const line = state.lines[lineIndex];
  if (!line) {
    return {
      state,
      result: errorResult(
        state,
        command.operationId,
        "invalid_item",
        "The requested cart item is not available in this fixture.",
        true
      ),
      effectApplied: false
    };
  }

  if (line.quantity === command.quantity) {
    return {
      state,
      result: Object.freeze({
        ok: true,
        code: "no_change",
        operationId: command.operationId,
        replayed: false,
        itemId: command.itemId,
        previousQuantity: line.quantity,
        quantity: line.quantity,
        stateRevision: state.revision
      }),
      effectApplied: false
    };
  }

  const lines = state.lines.map((candidate, index) =>
    index === lineIndex ? { ...candidate, quantity: command.quantity } : { ...candidate }
  );
  const nextState = freezeState({
    ...state,
    revision: state.revision + 1,
    lines,
    fulfillment: { ...state.fulfillment },
    pendingCheckout: null
  });

  return {
    state: nextState,
    result: Object.freeze({
      ok: true,
      code: "updated",
      operationId: command.operationId,
      replayed: false,
      itemId: command.itemId,
      previousQuantity: line.quantity,
      quantity: command.quantity,
      stateRevision: nextState.revision
    }),
    effectApplied: true
  };
}

export function checkoutRequest(
  state: CheckoutState,
  command: CheckoutOperationCommand,
  cartSnapshotHash: string
): DomainMutation<CheckoutRequestedResult | CheckoutErrorResult> {
  if (state.pendingCheckout) {
    return {
      state,
      result: errorResult(
        state,
        command.operationId,
        "already_pending",
        "A simulated checkout is already pending human approval.",
        false
      ),
      effectApplied: false
    };
  }

  const pendingCheckout: PendingCheckout = {
    status: "pending_human_approval",
    pendingId: `pending_${cartSnapshotHash.slice(0, 12)}_${command.operationId.slice(-8)}`,
    requestOperationId: command.operationId,
    requestedFromRevision: state.revision,
    cartSnapshotHash,
    orderTotalCents: orderTotalCents(state)
  };
  const nextState = freezeState({
    ...state,
    revision: state.revision + 1,
    lines: state.lines.map((line) => ({ ...line })),
    fulfillment: { ...state.fulfillment },
    pendingCheckout
  });

  return {
    state: nextState,
    result: Object.freeze({
      ok: true,
      code: "pending_human_approval",
      operationId: command.operationId,
      replayed: false,
      pendingId: pendingCheckout.pendingId,
      requestedFromRevision: pendingCheckout.requestedFromRevision,
      orderTotalCents: pendingCheckout.orderTotalCents,
      stateRevision: nextState.revision
    }),
    effectApplied: true
  };
}

export function checkoutCancel(
  state: CheckoutState,
  command: CheckoutOperationCommand
): DomainMutation<CheckoutCanceledResult | CheckoutErrorResult> {
  if (!state.pendingCheckout) {
    return {
      state,
      result: errorResult(
        state,
        command.operationId,
        "no_pending_checkout",
        "There is no simulated pending checkout to cancel.",
        false
      ),
      effectApplied: false
    };
  }

  const pendingId = state.pendingCheckout.pendingId;
  const nextState = freezeState({
    ...state,
    revision: state.revision + 1,
    lines: state.lines.map((line) => ({ ...line })),
    fulfillment: { ...state.fulfillment },
    pendingCheckout: null
  });

  return {
    state: nextState,
    result: Object.freeze({
      ok: true,
      code: "checkout_canceled",
      operationId: command.operationId,
      replayed: false,
      pendingId,
      stateRevision: nextState.revision
    }),
    effectApplied: true
  };
}

export function withReplay(result: MutationResult): MutationResult {
  return Object.freeze({ ...result, replayed: true }) as MutationResult;
}

export function checkoutError(
  state: CheckoutState,
  operationId: string,
  code: CheckoutErrorCode,
  message: string,
  retryable: boolean
): CheckoutErrorResult {
  return errorResult(state, operationId, code, message, retryable);
}
