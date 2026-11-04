import { payForShift } from "./money";
import { durationMinutes, formatRange, overlaps } from "./time";
import type { Constraint, Shift, Worker } from "./types";

/**
 * Hard rules (a shift can never break these) and soft scoring (who is the best pick).
 * The same functions run on the server to validate every AI or drag-and-drop change,
 * and in the browser to stop an illegal drop before it lands.
 */
export interface RotaContext {
  workers: Worker[];
  shifts: Shift[];
  constraints: Constraint[];
}

export interface Check {
  ok: boolean;
  reasons: string[];
}

export function hoursFor(workerId: string, shifts: Shift[], excludeShiftId?: string): number {
  const mins = shifts
    .filter((s) => s.workerId === workerId && s.id !== excludeShiftId)
    .reduce((a, s) => a + durationMinutes(s.start, s.end), 0);
  return mins / 60;
}

export function maxHoursFor(worker: Worker, constraints: Constraint[]): number {
  const caps = constraints.filter((c) => c.workerId === worker.id && c.kind === "max_hours" && c.hours != null);
  return caps.length ? Math.min(worker.maxHours, ...caps.map((c) => c.hours as number)) : worker.maxHours;
}

/** Can `worker` take `shift` at `shift.start`–`shift.end`, given everything else in the rota? */
export function checkAssignment(shift: Pick<Shift, "id" | "role" | "start" | "end">, worker: Worker, ctx: RotaContext): Check {
  const reasons: string[] = [];
  if (!worker.roles.includes(shift.role)) {
    reasons.push(`${worker.name.split(" ")[0]} isn't on the books as ${shift.role}`);
  }
  for (const c of ctx.constraints) {
    if (c.workerId !== worker.id || c.kind !== "unavailable" || !c.start || !c.end) continue;
    if (overlaps(shift.start, shift.end, c.start, c.end)) {
      reasons.push(`${worker.name.split(" ")[0]} is unavailable ${formatRange(c.start, c.end)}${c.note ? ` (${c.note})` : ""}`);
    }
  }
  for (const other of ctx.shifts) {
    if (other.id === shift.id || other.workerId !== worker.id) continue;
    if (overlaps(shift.start, shift.end, other.start, other.end)) {
      reasons.push(`clashes with ${other.eventName} ${formatRange(other.start, other.end)}`);
    }
  }
  const cap = maxHoursFor(worker, ctx.constraints);
  const total = hoursFor(worker.id, ctx.shifts, shift.id) + durationMinutes(shift.start, shift.end) / 60;
  if (total > cap + 1e-9) {
    reasons.push(`would take ${worker.name.split(" ")[0]} to ${total}h (cap ${cap}h)`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface Candidate {
  workerId: string;
  name: string;
  ok: boolean;
  reasons: string[];
  costMinor: number;
  hoursSoFar: number;
  cap: number;
  score: number;
  pros: string[];
}

/** Soft score: cheaper, preferred windows, preferred roles and fair hours rank higher. */
export function candidatesFor(shift: Shift, ctx: RotaContext): Candidate[] {
  return ctx.workers
    .map((w) => {
      const check = checkAssignment(shift, w, ctx);
      const cost = payForShift(shift.start, shift.end, w.rates).totalMinor;
      const hoursSoFar = hoursFor(w.id, ctx.shifts, shift.id);
      const cap = maxHoursFor(w, ctx.constraints);
      const pros: string[] = [];
      let score = -cost / 100; // dollars
      const pref = ctx.constraints.find(
        (c) => c.workerId === w.id && c.kind === "preferred" && c.start && c.end && overlaps(shift.start, shift.end, c.start, c.end),
      );
      if (pref) {
        score += 40;
        pros.push(`asked for this slot${pref.note ? ` (“${pref.note}”)` : ""}`);
      }
      const roleCon = ctx.constraints.find((c) => c.workerId === w.id && c.kind === "preferred_role" && c.role === shift.role);
      if (roleCon) {
        score += 25;
        pros.push(`prefers ${shift.role} work`);
      }
      score -= hoursSoFar * 6; // spread the work across the crew
      if (hoursSoFar === 0) pros.push("no hours yet this week");
      return {
        workerId: w.id,
        name: w.name,
        ok: check.ok,
        reasons: check.reasons,
        costMinor: cost,
        hoursSoFar,
        cap,
        score: Math.round(score * 10) / 10,
        pros,
      };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || b.score - a.score || a.workerId.localeCompare(b.workerId));
}

export interface PlannedAssignment {
  shiftId: string;
  workerId: string;
  reason: string;
}

/**
 * Deterministic baseline planner: fill the hardest-to-staff shifts first with the
 * best-scoring legal candidate, staying within budget. Used as the agent's
 * recorded fallback and as the starting point we show the model.
 */
export function greedyPlan(ctx: RotaContext, budgetMinor: number, onlyShiftIds?: string[]): PlannedAssignment[] {
  const shifts = ctx.shifts.map((s) => ({ ...s }));
  const work: RotaContext = { ...ctx, shifts };
  const open = shifts.filter((s) => s.status === "open" && (!onlyShiftIds || onlyShiftIds.includes(s.id)));
  let spent = shifts.filter((s) => s.workerId).reduce((a, s) => a + s.payMinor, 0);
  const plan: PlannedAssignment[] = [];
  const remaining = new Set(open.map((s) => s.id));
  while (remaining.size) {
    // Pick the open shift with the fewest legal candidates right now.
    let best: { shift: Shift; cands: Candidate[] } | null = null;
    for (const id of remaining) {
      const shift = shifts.find((s) => s.id === id)!;
      const cands = candidatesFor(shift, work).filter((c) => c.ok && spent + c.costMinor <= budgetMinor);
      if (!best || cands.length < best.cands.length || (cands.length === best.cands.length && shift.start < best.shift.start)) {
        best = { shift, cands };
      }
    }
    if (!best) break;
    remaining.delete(best.shift.id);
    const pick = best.cands[0];
    if (!pick) continue;
    best.shift.workerId = pick.workerId;
    best.shift.status = "booked";
    best.shift.payMinor = pick.costMinor;
    spent += pick.costMinor;
    const first = pick.name.split(" ")[0];
    const cheapest = best.cands.every((c) => c.costMinor >= pick.costMinor);
    const parts = [...pick.pros];
    if (best.cands.length === 1) parts.unshift("the only qualified person free");
    else if (cheapest) parts.push(`lowest cost of ${best.cands.length} free`);
    if (!parts.length) parts.push(`fewest hours of ${best.cands.length} free`);
    const why = parts.join(", ");
    plan.push({ shiftId: best.shift.id, workerId: pick.workerId, reason: `${first}: ${why}.` });
  }
  return plan;
}
