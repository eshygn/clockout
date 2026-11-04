import { approveAndPay, refreshPayouts } from "./payouts";
import { addMessage, applyTransition, getMessages, getSetting, getShifts, logAction, setSetting } from "./repo";
import { DEMO_STEPS, SICK_CALL } from "./seed";
import { toMin } from "./time";

/** Moves booked shifts whose end has passed to "completed" (awaiting the owner's approval). */
export function completeEndedShifts(at: string) {
  const ended = getShifts().filter((s) => s.status === "booked" && toMin(s.end) <= toMin(at));
  for (const s of ended) applyTransition(s.id, "complete");
  return ended;
}

/**
 * Jumps the demo clock to a story step. Going to Friday morning fast-forwards
 * Monday–Thursday: those hours are approved and paid (as the owner would have done
 * each evening), and Diego's sick call lands in the inbox.
 */
export async function jumpTo(stepIndex: number) {
  const step = DEMO_STEPS[stepIndex];
  if (!step) throw new Error("No such step");
  const current = Number(getSetting("step") ?? 0);
  if (stepIndex < current) throw new Error("The demo clock only moves forward. Use Reset demo to start over.");
  setSetting("now", step.at);
  setSetting("step", String(stepIndex));
  const ended = completeEndedShifts(step.at);
  logAction("clock", `Clock → ${step.label}.`, "system");

  if (step.id === "friday") {
    const earlier = ended.filter((s) => toMin(s.end) <= toMin("2026-11-13T00:00")).map((s) => s.id);
    if (earlier.length) {
      await approveAndPay(earlier, "Mon–Thu hours (approved nightly)");
      // Give the batch a moment to settle so Friday opens with Mon–Thu already paid.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const r = await refreshPayouts();
        if (!r.pending) break;
      }
    }
    if (!getMessages().some((m) => m.id === SICK_CALL.id)) addMessage(SICK_CALL);
  }
  return step;
}
