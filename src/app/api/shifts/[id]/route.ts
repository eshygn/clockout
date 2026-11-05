import { z } from "zod";
import { handle } from "@/lib/http";
import { formatMoney } from "@/lib/money";
import { applyTransition, getBusiness, getConstraints, getShift, getShifts, getWorker, getWorkers, logAction, saveShift } from "@/lib/repo";
import { checkAssignment, checkShiftLength } from "@/lib/scheduling";
import { isEditable } from "@/lib/shiftState";
import { formatRange, isWall } from "@/lib/time";

const body = z.object({
  workerId: z.string().nullable().optional(),
  start: z.string().refine(isWall).optional(),
  end: z.string().refine(isWall).optional(),
});

/** Owner drag, drop or resize on the Scheduler. Same hard rules as the agent. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const patch = body.parse(await req.json());
    const shift = getShift(id);
    if (!shift) throw new Error("No such shift");
    if (!isEditable(shift.status)) throw new Error(`This shift is ${shift.status} and can no longer be changed.`);
    const next = { ...shift, ...patch, workerId: patch.workerId === undefined ? shift.workerId : patch.workerId };
    const length = checkShiftLength(next.start, next.end);
    if (length) throw new Error(`Can't save: ${length}.`);
    if (next.workerId) {
      const worker = getWorker(next.workerId);
      if (!worker) throw new Error("Unknown worker");
      const check = checkAssignment(next, worker, { workers: getWorkers(), shifts: getShifts(), constraints: getConstraints() });
      if (!check.ok) throw new Error(check.reasons.join("; "));
    }
    let saved;
    if (!shift.workerId && next.workerId) saved = applyTransition(id, "assign", next);
    else if (shift.workerId && !next.workerId) saved = applyTransition(id, "unassign", next);
    else saved = saveShift({ ...next, status: shift.status });
    const w = saved.workerId ? getWorker(saved.workerId) : undefined;
    const biz = getBusiness();
    logAction(
      "assign",
      `Owner set ${saved.eventName} to ${w ? w.name.split(" ")[0] : "open"}, ${formatRange(saved.start, saved.end)}${w ? ` (${formatMoney(saved.payMinor, biz.currency)})` : ""}.`,
      "owner",
      { shiftId: id, workerId: saved.workerId },
    );
    return saved;
  });
}
