/**
 * Request and response shapes for PayPal Payouts v1, as documented at
 * https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
 * Only the fields Clockout reads or writes are typed; the mock returns the full shape.
 */
export interface PayPalAmount {
  currency: string;
  value: string;
}

export interface CreatePayoutRequest {
  sender_batch_header: {
    sender_batch_id: string;
    email_subject?: string;
    email_message?: string;
    recipient_type?: "EMAIL" | "PHONE" | "PAYPAL_ID";
  };
  items: {
    recipient_type: "EMAIL" | "PHONE" | "PAYPAL_ID";
    amount: PayPalAmount;
    note?: string;
    sender_item_id: string;
    receiver: string;
    recipient_wallet?: "PAYPAL" | "VENMO";
  }[];
}

export interface Link {
  href: string;
  rel: string;
  method: string;
  encType?: string;
}

export interface CreatePayoutResponse {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    sender_batch_header: CreatePayoutRequest["sender_batch_header"];
  };
  links: Link[];
}

export interface PayoutItemDetail {
  payout_item_id: string;
  transaction_id?: string;
  activity_id?: string;
  transaction_status: string;
  payout_item_fee?: PayPalAmount;
  payout_batch_id: string;
  payout_item: {
    recipient_type: string;
    amount: PayPalAmount;
    note?: string;
    receiver: string;
    sender_item_id: string;
    recipient_wallet?: string;
  };
  time_processed?: string;
  errors?: { name: string; message: string; information_link?: string };
  links: Link[];
}

export interface PayoutBatchDetail {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    time_created?: string;
    time_completed?: string;
    time_closed?: string;
    sender_batch_header: CreatePayoutRequest["sender_batch_header"];
    funding_source?: string;
    amount: PayPalAmount;
    fees: PayPalAmount;
  };
  items: PayoutItemDetail[];
  links: Link[];
}

export interface PayPalErrorBody {
  name: string;
  message: string;
  debug_id?: string;
  details?: { field?: string; location?: string; issue: string; description?: string }[];
}

export class PayPalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: PayPalErrorBody | null,
  ) {
    super(body ? `${body.name}: ${body.message}` : `PayPal HTTP ${status}`);
  }
}

export interface PayoutsAdapter {
  readonly mode: "live" | "mock";
  createBatch(req: CreatePayoutRequest): Promise<CreatePayoutResponse>;
  getBatch(payoutBatchId: string): Promise<PayoutBatchDetail>;
  getItem(payoutItemId: string): Promise<PayoutItemDetail>;
  /** Cancels an UNCLAIMED item so the money returns to the sender (POST /v1/payments/payouts-item/{id}/cancel). */
  cancelItem(payoutItemId: string): Promise<PayoutItemDetail>;
}
