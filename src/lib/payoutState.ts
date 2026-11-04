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

/** Plain-English reason for a PayPal item error name. */
export function describeItemError(error: string | null): string | null {
  if (!error) return null;
  if (error.startsWith("SELF_PAY_NOT_ALLOWED")) return "PayPal won't let an account pay itself: use the worker's own PayPal email";
  if (error.startsWith("RECEIVER_UNREGISTERED")) return "No PayPal account at this address yet";
  if (error.startsWith("RECEIVER_UNCONFIRMED")) return "Receiver hasn't confirmed their PayPal account";
  if (error.startsWith("RECEIVER_ACCOUNT_LOCKED")) return "Receiver's PayPal account is locked";
  return error.split(":")[0].replace(/_/g, " ").toLowerCase();
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
