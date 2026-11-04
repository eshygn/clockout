import { beforeAll, describe, expect, it } from "vitest";

// The full demo story, end to end, in mock mode against an in-memory database.
process.env.CLOCKOUT_DB = ":memory:";
process.env.CLOCKOUT_FORCE_MOCK = "1";
process.env.CLOCKOUT_MOCK_SETTLE_MS = "0";

type Mods = {
  agent: typeof import("@/lib/agent");
  clock: typeof import("@/lib/clock");
  payouts: typeof import("@/lib/payouts");
  repo: typeof import("@/lib/repo");
  db: typeof import("@/lib/db");
};
let m: Mods;

beforeAll(async () => {
  m = {
    agent: await import("@/lib/agent"),
    clock: await import("@/lib/clock"),
    payouts: await import("@/lib/payouts"),
    repo: await import("@/lib/repo"),
    db: await import("@/lib/db"),
  };
  m.db.seed();
});

describe("demo story (mock mode)", () => {
  it("Monday: builds the rota from six messages", async () => {
    const r = await m.agent.runAgent();
    expect(r.read).toBe(6);
    const shifts = m.repo.getShifts();
    expect(shifts.every((s) => s.status === "booked")).toBe(true);
    // Maya is never on Saturday, Sam is under 20h.
    expect(shifts.filter((s) => s.start.startsWith("2026-11-14")).some((s) => s.workerId === "w_maya")).toBe(false);
    const total = shifts.reduce((a, s) => a + s.payMinor, 0);
    expect(total).toBeLessThanOrEqual(m.repo.getBusiness().weeklyBudgetMinor);
  });

  it("Friday: Mon–Thu are paid, the sick call is refilled", async () => {
    await m.clock.jumpTo(1);
    const items = m.repo.getItems();
    expect(items.length).toBeGreaterThan(0);
    const diegoGala = m.repo.getShifts().find((s) => s.start.startsWith("2026-11-13T16") && s.workerId === "w_diego");
    expect(diegoGala).toBeDefined();
    const r = await m.agent.runAgent();
    expect(r.dropped).toEqual([diegoGala!.id]);
    const refilled = m.repo.getShift(diegoGala!.id)!;
    expect(refilled.status).toBe("booked");
    expect(refilled.workerId).not.toBe("w_diego");
  });

  it("Friday: the unclaimed payout (typo'd email) is cancelled and re-sent", async () => {
    const unclaimed = m.repo.getItems().filter((i) => i.status === "UNCLAIMED");
    expect(unclaimed.length).toBeGreaterThan(0);
    expect(m.repo.getShift(unclaimed[0].shiftId)!.status).toBe("failed");
    for (const u of unclaimed) await m.payouts.retryPayout(u.id, "jonah.brooks@gmail.com");
    await m.payouts.refreshPayouts();
    expect(m.repo.getItems().filter((i) => i.status === "RETURNED").length).toBe(unclaimed.length);
    expect(m.repo.getShifts().filter((s) => s.status === "failed")).toEqual([]);
  });

  it("Gala ends: three workers paid, nothing owed", async () => {
    await m.clock.jumpTo(2);
    const gala = m.repo.getShifts().filter((s) => s.start === "2026-11-13T16:00");
    expect(gala.every((s) => s.status === "completed")).toBe(true);
    const sent = await m.payouts.approveAndPay(gala.map((s) => s.id));
    expect(sent?.count).toBe(3);
    await m.payouts.refreshPayouts();
    expect(m.repo.getShifts().filter((s) => s.start === "2026-11-13T16:00").every((s) => s.status === "paid")).toBe(true);

    const owed = m.repo.getShifts().filter((s) => ["completed", "approved", "paying", "failed"].includes(s.status));
    expect(owed).toEqual([]);
  });
});
