import { describe, expect, it } from "vitest";
import { pickNewestFlash } from "@/lib/ai";
import { RECORDED, readHeuristically } from "@/lib/ai/recorded";
import { assignShiftsInput, recordConstraintsInput } from "@/lib/ai/schemas";
import { MONDAY_MESSAGES, SICK_CALL, WORKERS } from "@/lib/seed";
import type { Shift } from "@/lib/types";

describe("AI tool schemas", () => {
  it("accepts every recorded response", () => {
    const updates = Object.entries(RECORDED).map(([messageId, u]) => ({ messageId, ...u }));
    expect(() => recordConstraintsInput.parse({ updates })).not.toThrow();
  });

  it("has a recording for each Monday message", () => {
    for (const m of MONDAY_MESSAGES) expect(RECORDED[m.id]).toBeDefined();
  });

  it("rejects malformed times and unknown roles", () => {
    const bad = {
      updates: [
        { messageId: "x", summary: "", unavailable: [{ start: "Saturday", end: "2026-11-15T00:00", note: "" }], preferred: [], preferredRoles: [], dropShiftIds: [] },
      ],
    };
    expect(recordConstraintsInput.safeParse(bad).success).toBe(false);
    const badRole = { updates: [{ messageId: "x", summary: "", unavailable: [], preferred: [], preferredRoles: ["dj"], dropShiftIds: [] }] };
    expect(recordConstraintsInput.safeParse(badRole).success).toBe(false);
  });

  it("rejects absurd hour caps", () => {
    const u = { messageId: "x", summary: "", unavailable: [], preferred: [], preferredRoles: [], dropShiftIds: [], maxHours: 500 };
    expect(recordConstraintsInput.safeParse({ updates: [u] }).success).toBe(false);
  });

  it("validates assign_shifts input", () => {
    expect(assignShiftsInput.safeParse({ assignments: [{ shiftId: "s01", workerId: "w_maya", reason: "ok" }], summary: "done" }).success).toBe(true);
    expect(assignShiftsInput.safeParse({ assignments: [{ shiftId: "s01" }], summary: "done" }).success).toBe(false);
  });
});

describe("recorded fallback reader", () => {
  it("turns a sick call into an unavailable window and drops tonight's shift", () => {
    const diego = WORKERS.find((w) => w.id === "w_diego")!;
    const shifts: Shift[] = [
      { id: "s12", eventName: "Gala", venue: "", role: "server", start: "2026-11-13T16:00", end: "2026-11-13T23:30", workerId: "w_diego", status: "booked", payMinor: 0 },
      { id: "s99", eventName: "Other", venue: "", role: "server", start: "2026-11-14T16:00", end: "2026-11-14T20:00", workerId: "w_diego", status: "booked", payMinor: 0 },
    ];
    const u = readHeuristically(SICK_CALL, diego, shifts, "2026-11-13T07:30", "2026-11-09T00:00");
    expect(u.unavailable[0]).toMatchObject({ start: "2026-11-13T00:00", end: "2026-11-14T00:00" });
    expect(u.dropShiftIds).toEqual(["s12"]);
  });
});

describe("model selection", () => {
  it("picks the newest stable Flash model", () => {
    expect(
      pickNewestFlash(["models/gemini-2.5-flash", "models/gemini-3-flash-preview", "models/gemini-3.5-flash", "models/gemini-3.5-flash-lite", "models/gemini-2.0-flash"]),
    ).toBe("gemini-3.5-flash");
    expect(pickNewestFlash(["models/gemini-pro"])).toBeNull();
  });
});
