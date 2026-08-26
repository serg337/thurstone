export const CHECKOUT_FIXTURE_ID = "checkout-seed-v1";
export const CHECKOUT_DOMAIN_VERSION = "checkout-domain@0.1.0";

export type CartItemId = "field-notebook" | "stoneware-mug";

export interface CartLine {
  readonly itemId: CartItemId;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface CheckoutState {
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly revision: number;
  readonly lines: readonly CartLine[];
  readonly pendingCheckout: null;
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

export function createCheckoutFixture(): CheckoutState {
  return {
    fixtureId: CHECKOUT_FIXTURE_ID,
    revision: 0,
    lines: SEEDED_LINES.map((line) => ({ ...line })),
    pendingCheckout: null
  };
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
