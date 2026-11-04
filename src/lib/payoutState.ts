/**
 * Maps PayPal Payouts item statuses (transaction_status) onto what Clockout shows and does.
 * Statuses from the Payouts API reference: SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED,
 * ONHOLD, BLOCKED, REFUNDED, REVERSED.
 */
export type PayPalItemStatus = "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED" | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";

export type PayoutOutcome = "in_flight" | "paid" | "needs_attention";

export function outcomeOf(status: string): PayoutOutcome {
  switch (status) {
    case "SUCCESS":
      return "paid";
    case "PENDING":
    case "ONHOLD":
      return "in_flight";
    default:
      // FAILED, UNCLAIMED, RETURNED, BLOCKED, REFUNDED, REVERSED (and anything unknown)
      return "needs_attention";
  }
}

/** UNCLAIMED items still hold the money; they must be cancelled before re-sending. */
export function needsCancelBeforeRetry(status: string): boolean {
  return status === "UNCLAIMED";
}

export function isTerminalBatch(status: string): boolean {
  return status === "SUCCESS" || status === "DENIED" || status === "CANCELED";
}

export function describeItemStatus(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "Paid";
    case "PENDING":
      return "Sending";
    case "ONHOLD":
      return "On hold at PayPal";
    case "UNCLAIMED":
      return "Unclaimed: no PayPal account at this address";
    case "RETURNED":
      return "Returned to you";
    case "BLOCKED":
      return "Blocked by PayPal";
    case "FAILED":
      return "Failed";
    case "REFUNDED":
      return "Refunded";
    case "REVERSED":
      return "Reversed";
    default:
      return status;
  }
}
