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

  it("returns a rejected batch to awaiting approval", () => {
    expect(transition("paying", "batch_rejected")).toBe("completed");
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

describe("PayPal error wording", async () => {
  const { describeItemError } = await import("@/lib/payoutState");
  it("explains self-pay and unregistered receivers", () => {
    expect(describeItemError("SELF_PAY_NOT_ALLOWED: Payment to self is not allowed.")).toMatch(/pay itself/);
    expect(describeItemError("RECEIVER_UNREGISTERED: x")).toMatch(/No PayPal account/);
    expect(describeItemError(null)).toBeNull();
  });
});

describe("sandbox receivers and AI fallback chain", async () => {
  const { receiverFor } = await import("@/lib/paypal");
  const { fallbackChain } = await import("@/lib/ai");
  const env = { SANDBOX_RECEIVER_SAM: "sam@personal.example.com", SANDBOX_RECEIVER_AVA: "ava@personal.example.com" };
  it("pays a named worker their own receiver and spreads the rest", () => {
    expect(receiverFor({ name: "Sam Whitfield", paypalEmail: "x@crew.example" }, 3, "live", false, env)).toBe("sam@personal.example.com");
    expect(receiverFor({ name: "Maya Chen", paypalEmail: "x@crew.example" }, 0, "live", false, env)).toBe("ava@personal.example.com");
    expect(receiverFor({ name: "Diego Ramírez", paypalEmail: "x@crew.example" }, 1, "live", false, env)).toBe("sam@personal.example.com");
  });
  it("ignores the fallback receiver once named receivers exist", () => {
    const withExtra = { ...env, PAYPAL_SANDBOX_RECEIVER_EMAIL: "other@personal.example.com" };
    for (let i = 0; i < 6; i++) {
      expect(receiverFor({ name: "Maya Chen", paypalEmail: "x@crew.example" }, i, "live", false, withExtra)).not.toBe(
        "other@personal.example.com",
      );
    }
    const only = { PAYPAL_SANDBOX_RECEIVER_EMAIL: "other@personal.example.com" };
    expect(receiverFor({ name: "Maya Chen", paypalEmail: "x@crew.example" }, 0, "live", false, only)).toBe("other@personal.example.com");
  });

  it("redirects the typo'd address live when receivers exist, keeps it otherwise", () => {
    expect(receiverFor({ name: "Jonah Brooks", paypalEmail: "j@gmial.com" }, 4, "live", true, env)).toBe("ava@personal.example.com");
    expect(receiverFor({ name: "Jonah Brooks", paypalEmail: "j@gmial.com" }, 4, "live", true, {})).toBe("j@gmial.com");
    expect(receiverFor({ name: "Jonah Brooks", paypalEmail: "j@gmial.com" }, 4, "mock", true, env)).toBe("j@gmial.com");
    expect(receiverFor({ name: "Maya Chen", paypalEmail: "x@crew.example" }, 0, "mock", false, env)).toBe("x@crew.example");
  });
  it("tries the newest Flash, then gemini-2.5-flash", () => {
    expect(fallbackChain("gemini-3.8-flash")).toEqual(["gemini-3.8-flash", "gemini-2.5-flash"]);
    expect(fallbackChain(null)).toEqual(["gemini-2.5-flash"]);
    const listed = ["models/gemini-2.5-flash", "models/gemini-3.8-flash", "models/gemini-3.7-flash", "models/gemini-3.5-flash-lite"];
    expect(fallbackChain(null, listed)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash"]);
    expect(fallbackChain("gemini-3.5-flash-lite", listed)).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]);
  });
});
