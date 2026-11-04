import { z } from "zod";
import { fillOpenShifts } from "@/lib/agent";
import { handle } from "@/lib/http";
import { applyTransition, getShift, getWorker, logAction } from "@/lib/repo";
import { formatRange } from "@/lib/time";

const body = z.object({ shiftId: z.string() });

/** Owner right-clicks a booked shift: drop the worker and let the agent find cover. */
export async function POST(req: Request) {
  return handle(async () => {
    const { shiftId } = body.parse(await req.json());
    const shift = getShift(shiftId);
    if (!shift || shift.status !== "booked") throw new Error("Only a booked shift can be dropped.");
    const w = getWorker(shift.workerId!)!;
    applyTransition(shiftId, "unassign", { workerId: null });
    logAction(
      "unassign",
      `Owner took ${w.name.split(" ")[0]} off ${shift.eventName} (${formatRange(shift.start, shift.end)}). Finding cover.`,
      "owner",
      {
        shiftId,
        workerId: w.id,
      },
    );
    return fillOpenShifts({ onlyShiftIds: [shiftId] });
  });
}
