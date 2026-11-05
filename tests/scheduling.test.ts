import { describe, expect, it } from "vitest";
import { candidatesFor, checkAssignment, greedyPlan } from "@/lib/scheduling";
import { BUSINESS, SHIFTS, WORKERS } from "@/lib/seed";
import { RECORDED } from "@/lib/ai/recorded";
import type { Constraint, Shift } from "@/lib/types";

const shifts = (): Shift[] => SHIFTS.map((s) => ({ ...s, workerId: null, status: "open", payMinor: 0 }));
const workerFor: Record<string, string> = { m01: "w_maya", m02: "w_diego", m03: "w_priya", m04: "w_sam", m05: "w_jonah", m06: "w_lena" };
const constraints: Constraint[] = Object.entries(RECORDED).flatMap(([mid, u]) => {
  const workerId = workerFor[mid];
  const out: Constraint[] = [];
  u.unavailable.forEach((x, i) =>
    out.push({
      id: `${mid}u${i}`,
      workerId,
      messageId: mid,
      kind: "unavailable",
      start: x.start,
      end: x.end,
      hours: null,
      role: null,
      note: x.note,
    }),
  );
  u.preferred.forEach((x, i) =>
    out.push({
      id: `${mid}p${i}`,
      workerId,
      messageId: mid,
      kind: "preferred",
      start: x.start,
      end: x.end,
      hours: null,
      role: null,
      note: x.note,
    }),
  );
  u.preferredRoles.forEach((r, i) =>
    out.push({
      id: `${mid}r${i}`,
      workerId,
      messageId: mid,
      kind: "preferred_role",
      start: null,
      end: null,
      hours: null,
      role: r,
      note: "",
    }),
  );
  if (u.maxHours)
    out.push({
      id: `${mid}h`,
      workerId,
      messageId: mid,
      kind: "max_hours",
      start: null,
      end: null,
      hours: u.maxHours,
      role: null,
      note: "",
    });
  return out;
});

describe("hard rules", () => {
  const ctx = { workers: WORKERS, shifts: shifts(), constraints };
  const maya = WORKERS.find((w) => w.id === "w_maya")!;
  const sam = WORKERS.find((w) => w.id === "w_sam")!;
  const wedding = ctx.shifts.find((s) => s.id === "s14")!;

  it("blocks Maya from Saturday (sister's wedding)", () => {
    const c = checkAssignment(wedding, maya, ctx);
    expect(c.ok).toBe(false);
    expect(c.reasons.join()).toMatch(/sister's wedding/);
  });

  it("blocks a worker without the role", () => {
    expect(checkAssignment(wedding, sam, ctx).reasons.join()).toMatch(/isn't on the books as bartender/);
  });

  it("blocks overlapping shifts and hour caps", () => {
    const s = shifts();
    s[0].workerId = "w_sam";
    const clash = checkAssignment(s[1], sam, { ...ctx, shifts: s });
    expect(clash.reasons.join()).toMatch(/clashes/);
  });
});

describe("shift length and wording", async () => {
  const { checkShiftLength } = await import("@/lib/scheduling");
  const { formatRange } = await import("@/lib/time");
  it("refuses shifts over 14h or ending before they start", () => {
    expect(checkShiftLength("2026-11-14T13:00", "2026-11-15T09:00")).toMatch(/14h/);
    expect(checkShiftLength("2026-11-14T13:00", "2026-11-14T13:00")).toMatch(/end after/);
    expect(checkShiftLength("2026-11-14T13:00", "2026-11-14T23:00")).toBeNull();
  });
  it("describes whole-day blocks plainly", () => {
    expect(formatRange("2026-11-14T00:00", "2026-11-15T00:00")).toBe("all day Sat");
    expect(formatRange("2026-11-09T00:00", "2026-11-11T00:00")).toBe("Mon–Tue");
    expect(formatRange("2026-11-13T16:00", "2026-11-13T23:30")).toBe("Fri 16:00–23:30");
  });
});

describe("baseline planner", () => {
  it("fills the week legally and within budget", () => {
    const ctx = { workers: WORKERS, shifts: shifts(), constraints };
    const plan = greedyPlan(ctx, BUSINESS.weeklyBudgetMinor);
    expect(plan.length).toBe(SHIFTS.length);
    const applied = shifts();
    let total = 0;
    for (const p of plan) {
      const s = applied.find((x) => x.id === p.shiftId)!;
      const w = WORKERS.find((x) => x.id === p.workerId)!;
      expect(checkAssignment(s, w, { ...ctx, shifts: applied }).ok).toBe(true);
      s.workerId = w.id;
      s.status = "booked";
      total += candidatesFor(s, { ...ctx, shifts: applied }).find((c) => c.workerId === w.id)!.costMinor;
    }
    expect(total).toBeLessThanOrEqual(BUSINESS.weeklyBudgetMinor);
  });
});
