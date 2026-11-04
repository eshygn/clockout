import { assignShifts, extractConstraints } from "./ai";
import { recordedUpdate } from "./ai/recorded";
import type { AssignShiftsInput, ConstraintUpdate } from "./ai/schemas";
import { formatMoney, payForShift } from "./money";
import {
  addConstraint,
  applyTransition,
  deleteConstraintsForMessage,
  getBusiness,
  getConstraints,
  getMessages,
  getShifts,
  getWorkers,
  inTransaction,
  logAction,
  markMessageProcessed,
  now,
} from "./repo";
import { candidatesFor, checkAssignment, greedyPlan, type RotaContext } from "./scheduling";
import { addMinutes, formatRange, isWall, toMin } from "./time";
import type { Shift, Worker } from "./types";

const first = (w: Worker) => w.name.split(" ")[0];

function weekCalendar(weekStart: string): string {
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return names.map((n, i) => `${n} = ${addMinutes(weekStart, i * 1440).slice(0, 10)}`).join("; ");
}

const EXTRACT_INSTRUCTIONS = `You are the scheduling assistant for a small event-staffing business whose crew are freelance contractors.
Turn each worker's plain-English message into structured constraints by calling record_constraints exactly once with one update per message.
Rules:
- Times are local wall-clock, format YYYY-MM-DDTHH:mm. Ends are exclusive; "all day Saturday" is Saturday 00:00 to Sunday 00:00.
- Interpret: morning 06:00-12:00, afternoon 12:00-17:00, evening/eve/night 17:00-24:00, "all day" 00:00-24:00, "from 3" = 15:00.
- "can't / not / out / busy / sick" → unavailable. "can do / free / happy to / works / would love" → preferred.
- "around Wed thru Sun" means unavailable on the other days of the week.
- If the worker states an hour cap, set maxHours. If they prefer a type of work, set preferredRoles (bartender for bar work).
- dropShiftIds: only shifts already assigned to THIS worker that the message says they can no longer do. Never invent ids.
- Keep notes to a few words in the worker's own terms. Keep summaries short and owner-facing.`;

function describeShift(s: Shift, workers: Worker[]): string {
  const w = workers.find((x) => x.id === s.workerId);
  return `${s.id}: ${s.eventName}, ${s.role}, ${s.start} to ${s.end}${w ? `, assigned to ${w.name} (${w.id})` : ", open"}`;
}

/** Validates an AI constraint update against our own data before anything is stored. */
export function sanitizeUpdate(u: ConstraintUpdate, workerId: string, shifts: Shift[]): ConstraintUpdate {
  const okWindow = (x: { start: string; end: string }) => isWall(x.start) && isWall(x.end) && toMin(x.end) > toMin(x.start);
  return {
    ...u,
    unavailable: u.unavailable.filter(okWindow),
    preferred: u.preferred.filter(okWindow),
    dropShiftIds: u.dropShiftIds.filter((id) => shifts.some((s) => s.id === id && s.workerId === workerId && s.status === "booked")),
  };
}

/** Step 1: read unprocessed messages into constraints. Returns shifts that were dropped. */
export async function readMessages(): Promise<{ dropped: string[]; source: string; read: number }> {
  const messages = getMessages().filter((m) => !m.processedAt);
  if (!messages.length) return { dropped: [], source: "none", read: 0 };
  const workers = getWorkers();
  const shifts = getShifts();
  const biz = getBusiness();
  const clock = now();

  const prompt = [
    `Current time: ${clock}. Week: ${weekCalendar(biz.weekStart)}.`,
    `Workers: ${workers.map((w) => `${w.id} ${w.name} (${w.roles.join("/")})`).join("; ")}.`,
    `Shifts this week:\n${shifts.map((s) => describeShift(s, workers)).join("\n")}`,
    `Messages:\n${messages.map((m) => `[${m.id}] from ${m.workerId} at ${m.receivedAt}: "${m.body}"`).join("\n")}`,
  ].join("\n\n");

  const result = await extractConstraints({
    instructions: EXTRACT_INSTRUCTIONS,
    prompt,
    fallback: () => ({
      updates: messages.map((m) => recordedUpdate(m, workers.find((w) => w.id === m.workerId)!, shifts, clock, biz.weekStart)),
    }),
  });

  const dropped: string[] = [];
  inTransaction(() => {
    for (const m of messages) {
      const worker = workers.find((w) => w.id === m.workerId)!;
      const raw =
        result.value.updates.find((u) => u.messageId === m.id) ??
        recordedUpdate(m, worker, shifts, clock, biz.weekStart);
      const u = sanitizeUpdate(raw, worker.id, shifts);
      deleteConstraintsForMessage(m.id);
      let n = 0;
      const id = () => `${m.id}_${++n}`;
      for (const x of u.unavailable)
        addConstraint({ id: id(), workerId: worker.id, messageId: m.id, kind: "unavailable", start: x.start, end: x.end, hours: null, role: null, note: x.note });
      for (const x of u.preferred)
        addConstraint({ id: id(), workerId: worker.id, messageId: m.id, kind: "preferred", start: x.start, end: x.end, hours: null, role: null, note: x.note });
      for (const r of u.preferredRoles)
        addConstraint({ id: id(), workerId: worker.id, messageId: m.id, kind: "preferred_role", start: null, end: null, hours: null, role: r, note: `prefers ${r}` });
      if (u.maxHours)
        addConstraint({ id: id(), workerId: worker.id, messageId: m.id, kind: "max_hours", start: null, end: null, hours: u.maxHours, role: null, note: `max ${u.maxHours}h` });
      markMessageProcessed(m.id, u.summary);
      logAction("read", `${first(worker)}: ${u.summary}`, result.source, { workerId: worker.id, messageId: m.id });
      for (const sid of u.dropShiftIds) {
        const s = shifts.find((x) => x.id === sid)!;
        applyTransition(sid, "unassign", { workerId: null });
        dropped.push(sid);
        logAction("unassign", `Took ${first(worker)} off ${s.eventName} (${formatRange(s.start, s.end)}). Finding cover.`, result.source, {
          shiftId: sid,
          workerId: worker.id,
          messageId: m.id,
        });
      }
    }
  });
  return { dropped, source: result.source, read: messages.length };
}

const ASSIGN_INSTRUCTIONS = `You run the rota for a small event-staffing business. The crew are freelance contractors paid per shift at agreed hourly rates (higher at night and weekends).
Call assign_shifts exactly once. For each open shift, choose one worker from that shift's ELIGIBLE list only.
Goals in order: (1) never break a hard rule (eligible lists already respect availability, role, clashes and hour caps, but two shifts you assign to the same person must not overlap and their caps still apply across your picks); (2) stay within the weekly budget; (3) honour what workers asked for (preferred times and roles); (4) spread hours fairly; (5) keep cost down.
The baseline plan is a valid starting point; improve on it if you can, otherwise use it.
Each reason is one plain sentence for a busy owner, naming the worker and the deciding factor (their message, cost, hours). No jargon.`;

/** Step 2: fill open future shifts. The model proposes; hard rules decide what is applied. */
export async function fillOpenShifts(opts: { onlyShiftIds?: string[] } = {}) {
  const biz = getBusiness();
  const workers = getWorkers();
  const shifts = getShifts();
  const constraints = getConstraints();
  const clock = now();
  const ctx: RotaContext = { workers, shifts, constraints };

  const open = shifts.filter(
    (s) => s.status === "open" && toMin(s.start) > toMin(clock) && (!opts.onlyShiftIds || opts.onlyShiftIds.includes(s.id)),
  );
  if (!open.length) return { filled: 0, rejected: 0, source: "none", summary: "No open shifts to fill." };

  const committed = shifts.filter((s) => s.workerId).reduce((a, s) => a + s.payMinor, 0);
  const baseline = greedyPlan(ctx, biz.weeklyBudgetMinor, open.map((s) => s.id));

  const lines = open.map((s) => {
    const cands = candidatesFor(s, ctx)
      .filter((c) => c.ok)
      .slice(0, 5)
      .map(
        (c) =>
          `${c.workerId} (${c.name}, ${formatMoney(c.costMinor, biz.currency)}, ${c.hoursSoFar}h of ${c.cap}h${c.pros.length ? `, ${c.pros.join("; ")}` : ""})`,
      );
    return `${s.id} ${s.eventName}, ${s.role}, ${s.start}–${s.end}. ELIGIBLE: ${cands.join(" | ") || "nobody"}`;
  });
  const notes = getMessages()
    .filter((m) => m.summary)
    .map((m) => `${workers.find((w) => w.id === m.workerId)?.name}: ${m.summary}`);

  const prompt = [
    `Now: ${clock}. Weekly budget ${formatMoney(biz.weeklyBudgetMinor, biz.currency)}, already committed ${formatMoney(committed, biz.currency)}.`,
    `What workers told us:\n${notes.join("\n") || "nothing yet"}`,
    `Open shifts:\n${lines.join("\n")}`,
    `Baseline plan:\n${baseline.map((p) => `${p.shiftId} → ${p.workerId}`).join("\n")}`,
  ].join("\n\n");

  const result = await assignShifts({
    instructions: ASSIGN_INSTRUCTIONS,
    prompt,
    fallback: (): AssignShiftsInput => ({
      assignments: baseline,
      summary: opts.onlyShiftIds
        ? "Picked the best available cover from who is free, qualified and under their hours."
        : "Built the week from everyone's messages: honoured every 'can't', gave people the slots they asked for, and kept within budget.",
    }),
  });

  return inTransaction(() => {
    let filled = 0;
    let rejected = 0;
    let spent = committed;
    const live = getShifts();
    const ctxNow: RotaContext = { workers, shifts: live, constraints };
    const tryAssign = (shiftId: string, workerId: string, reason: string, source: "gemini" | "recorded" | "guardrail") => {
      const shift = live.find((s) => s.id === shiftId);
      const worker = workers.find((w) => w.id === workerId);
      if (!shift || !worker || shift.status !== "open" || !open.some((o) => o.id === shiftId)) return false;
      const check = checkAssignment(shift, worker, ctxNow);
      const cost = payForShift(shift.start, shift.end, worker.rates).totalMinor;
      if (!check.ok || spent + cost > biz.weeklyBudgetMinor) {
        rejected++;
        logAction(
          "reject",
          `Blocked ${first(worker)} for ${shift.eventName}: ${check.ok ? "over budget" : check.reasons.join("; ")}.`,
          "guardrail",
          { shiftId, workerId },
        );
        return false;
      }
      const saved = applyTransition(shiftId, "assign", { workerId });
      Object.assign(shift, saved);
      spent += saved.payMinor;
      filled++;
      logAction("assign", `${first(worker)} → ${shift.eventName}, ${shift.role} ${formatRange(shift.start, shift.end)}. ${reason}`, source, {
        shiftId,
        workerId,
      });
      return true;
    };

    for (const a of result.value.assignments) tryAssign(a.shiftId, a.workerId, a.reason, result.source);

    // Anything the model left unfilled or got blocked on: the guardrail planner fills it legally.
    const stillOpen = live.filter((s) => s.status === "open" && open.some((o) => o.id === s.id));
    if (stillOpen.length) {
      const repair = greedyPlan({ workers, constraints, shifts: live }, biz.weeklyBudgetMinor, stillOpen.map((s) => s.id));
      for (const p of repair) tryAssign(p.shiftId, p.workerId, p.reason, "guardrail");
    }
    const left = live.filter((s) => s.status === "open" && open.some((o) => o.id === s.id)).length;
    const summary = `${result.value.summary}${left ? ` ${left} shift${left > 1 ? "s" : ""} still need someone.` : ""}`;
    logAction("summary", summary, result.source);
    return { filled, rejected, source: result.source, summary };
  });
}

/** "Let the agent handle it": read new messages, then fill whatever is open. */
export async function runAgent() {
  const started = Date.now();
  const read = await readMessages();
  const fill = await fillOpenShifts(read.dropped.length && read.read === 1 ? { onlyShiftIds: read.dropped } : {});
  return { ...read, ...fill, ms: Date.now() - started };
}
