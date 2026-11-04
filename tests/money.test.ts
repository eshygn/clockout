import { describe, expect, it } from "vitest";
import { bandFor, divRoundHalfUp, formatMoney, fromDecimalString, payForShift, sumMinor, toDecimalString } from "@/lib/money";
import { toMin } from "@/lib/time";

const rates = { baseMinor: 2400, nightMinor: 3000, weekendMinor: 3200 };

describe("payForShift", () => {
  it("pays a weekday daytime shift at the base rate", () => {
    const p = payForShift("2026-11-09T07:00", "2026-11-09T13:00", rates);
    expect(p.totalMinor).toBe(6 * 2400);
    expect(p.minutes).toEqual({ base: 360, night: 0, weekend: 0 });
  });

  it("splits a Friday evening shift at 22:00 into base and night", () => {
    const p = payForShift("2026-11-13T16:00", "2026-11-13T23:30", rates);
    expect(p.minutes).toEqual({ base: 360, night: 90, weekend: 0 });
    expect(p.totalMinor).toBe(6 * 2400 + 1.5 * 3000);
  });

  it("pays early-morning minutes before 06:00 as night", () => {
    const p = payForShift("2026-11-10T04:00", "2026-11-10T08:00", rates);
    expect(p.minutes).toEqual({ base: 120, night: 120, weekend: 0 });
  });

  it("pays Saturday at the weekend rate, including Saturday night", () => {
    const p = payForShift("2026-11-14T13:00", "2026-11-14T23:00", rates);
    expect(p.minutes.weekend).toBe(600);
    expect(p.totalMinor).toBe(10 * 3200);
  });

  it("uses the higher of night and weekend when both apply", () => {
    const nightHigher = { baseMinor: 2000, nightMinor: 4000, weekendMinor: 3000 };
    expect(bandFor(toMin("2026-11-14T23:30"), nightHigher)).toBe("night");
    expect(bandFor(toMin("2026-11-14T23:30"), rates)).toBe("weekend");
  });

  it("crosses midnight from Friday night into Saturday", () => {
    const p = payForShift("2026-11-13T21:00", "2026-11-14T02:00", rates);
    // 21-22 base, 22-24 night (Fri), 00-02 Saturday night → weekend (3200 > 3000)
    expect(p.minutes).toEqual({ base: 60, night: 120, weekend: 120 });
    expect(p.totalMinor).toBe(2400 + 2 * 3000 + 2 * 3200);
  });

  it("rounds once, half up, on odd minutes", () => {
    // 7 minutes at 2401/h = 16807/60 = 280.116… → 280
    expect(payForShift("2026-11-09T09:00", "2026-11-09T09:07", { ...rates, baseMinor: 2401 }).totalMinor).toBe(280);
    // 30 minutes at 2401/h = 1200.5 → 1201
    expect(payForShift("2026-11-09T09:00", "2026-11-09T09:30", { ...rates, baseMinor: 2401 }).totalMinor).toBe(1201);
  });

  it("rejects fractional rates and reversed shifts", () => {
    expect(() => payForShift("2026-11-09T09:00", "2026-11-09T10:00", { ...rates, baseMinor: 24.5 })).toThrow();
    expect(() => payForShift("2026-11-09T10:00", "2026-11-09T09:00", rates)).toThrow();
  });

  it("returns zero for a zero-length shift", () => {
    expect(payForShift("2026-11-09T10:00", "2026-11-09T10:00", rates).totalMinor).toBe(0);
  });
});

describe("decimal conversion", () => {
  it("round-trips minor units and PayPal value strings without floats", () => {
    for (const n of [0, 1, 5, 99, 100, 18950, 123456789]) {
      expect(fromDecimalString(toDecimalString(n, "USD"), "USD")).toBe(n);
    }
    expect(toDecimalString(18950, "USD")).toBe("189.50");
    expect(toDecimalString(7, "USD")).toBe("0.07");
    expect(toDecimalString(1500, "JPY")).toBe("1500");
    expect(fromDecimalString("0.1", "USD")).toBe(10);
  });

  it("rejects too many decimals", () => {
    expect(() => fromDecimalString("1.005", "USD")).toThrow();
  });

  it("formats with the currency code always shown", () => {
    expect(formatMoney(18950, "USD")).toBe("$189.50 USD");
    expect(formatMoney(420000, "USD", { compact: true })).toBe("$4,200 USD");
    expect(formatMoney(1050, "EUR")).toContain("EUR");
  });

  it("divides with half-up rounding and sums integers only", () => {
    expect(divRoundHalfUp(90, 60)).toBe(2);
    expect(divRoundHalfUp(89, 60)).toBe(1);
    expect(sumMinor([100, 250, 1])).toBe(351);
    expect(() => sumMinor([1.5])).toThrow();
  });
});
