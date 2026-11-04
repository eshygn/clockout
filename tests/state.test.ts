import { describe, expect, it } from "vitest";
import { describeItemStatus, isTerminalBatch, needsCancelBeforeRetry, outcomeOf } from "@/lib/payoutState";
import { canTransition, IllegalTransitionError, isEditable, isOwed, SHIFT_STATUSES, transition } from "@/lib/shiftState";

describe("shift state machine", () => {
  it("walks the happy path from open to paid", () => {
    let s = transition("open", "assign");
    s = transition(s, "complete");
    s = transition(s, "approve");
    s = transition(s, "send");
    s = transition(s, "payout_succeeded");
    expect(s).toBe("paid");
  });

  it("supports drop and refill (sick call)", () => {
    expect(transition("booked", "unassign")).toBe("open");
    expect(transition("open", "assign")).toBe("booked");
  });

  it("supports failed payout and retry", () => {
    expect(transition("paying", "payout_failed")).toBe("failed");
    expect(transition("failed", "retry")).toBe("paying");
  });

  it("refuses illegal moves", () => {
    expect(() => transition("open", "send")).toThrow(IllegalTransitionError);
    expect(() => transition("paid", "unassign")).toThrow(/Cannot unassign a shift that is paid/);
    expect(() => transition("booked", "approve")).toThrow();
    expect(canTransition("paid", "retry")).toBe(false);
  });

  it("paid is terminal", () => {
    for (const a of ["assign", "unassign", "complete", "approve", "send", "retry"] as const) {
      expect(canTransition("paid", a)).toBe(false);
    }
  });

  it("knows what is editable and what is owed", () => {
    expect(SHIFT_STATUSES.filter(isEditable)).toEqual(["open", "booked", "completed"]);
    expect(SHIFT_STATUSES.filter(isOwed)).toEqual(["completed", "approved", "paying", "failed"]);
  });
});

describe("PayPal payout item status mapping", () => {
  it("maps statuses to outcomes", () => {
    expect(outcomeOf("SUCCESS")).toBe("paid");
    expect(outcomeOf("PENDING")).toBe("in_flight");
    expect(outcomeOf("ONHOLD")).toBe("in_flight");
    for (const s of ["FAILED", "UNCLAIMED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]) {
      expect(outcomeOf(s)).toBe("needs_attention");
    }
  });

  it("cancels unclaimed items before retrying", () => {
    expect(needsCancelBeforeRetry("UNCLAIMED")).toBe(true);
    expect(needsCancelBeforeRetry("FAILED")).toBe(false);
  });

  it("recognises terminal batches and describes items", () => {
    expect(isTerminalBatch("SUCCESS")).toBe(true);
    expect(isTerminalBatch("PROCESSING")).toBe(false);
    expect(describeItemStatus("UNCLAIMED")).toMatch(/no PayPal account/);
  });
});
