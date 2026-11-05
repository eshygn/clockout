/**
 * Shift lifecycle. Every status change in the app goes through `transition`, so an
 * illegal move (paying an open shift, editing a paid one) is impossible by construction.
 *
 *   open ──assign──▶ booked ──complete──▶ completed ──approve──▶ approved ──send──▶ paying
 *     ▲                │                                                           │   │
 *     └────unassign────┘                                        payout_succeeded ◀─┘   └─▶ payout_failed
 *                                                                     ▼                         ▼
 *                                                                    paid           failed ──retry──▶ paying
 */
export const SHIFT_STATUSES = ["open", "booked", "completed", "approved", "paying", "paid", "failed"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export type ShiftAction =
  | "assign"
  | "unassign"
  | "reassign"
  | "complete"
  | "reopen"
  | "approve"
  | "send"
  | "payout_succeeded"
  | "payout_failed"
  | "retry"
  /** PayPal refused the whole batch, so nothing was sent: back to awaiting approval. */
  | "batch_rejected";

const TABLE: Record<ShiftStatus, Partial<Record<ShiftAction, ShiftStatus>>> = {
  open: { assign: "booked" },
  booked: { unassign: "open", reassign: "booked", complete: "completed" },
  completed: { approve: "approved", reopen: "booked" },
  approved: { send: "paying" },
  paying: { payout_succeeded: "paid", payout_failed: "failed", batch_rejected: "completed" },
  failed: { retry: "paying" },
  paid: {},
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ShiftStatus,
    public readonly action: ShiftAction,
  ) {
    super(`Cannot ${action} a shift that is ${from}`);
  }
}

export function canTransition(from: ShiftStatus, action: ShiftAction): boolean {
  return TABLE[from][action] !== undefined;
}

export function transition(from: ShiftStatus, action: ShiftAction): ShiftStatus {
  const to = TABLE[from][action];
  if (!to) throw new IllegalTransitionError(from, action);
  return to;
}

/** Shifts whose times and worker may still be edited by drag, drop or resize. */
export function isEditable(status: ShiftStatus): boolean {
  return status === "open" || status === "booked" || status === "completed";
}

/** Money the business owes for work done but not yet successfully paid. */
export function isOwed(status: ShiftStatus): boolean {
  return status === "completed" || status === "approved" || status === "paying" || status === "failed";
}
