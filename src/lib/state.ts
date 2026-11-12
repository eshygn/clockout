import { aiStatus } from "./ai";
import { paypalStatus } from "./paypal";
import { getActions, getBatches, getBusiness, getConstraints, getItems, getMessages, getSetting, getShifts, getWorkers } from "./repo";
import { DEMO_STEPS } from "./seed";
import type { AppState } from "./types";

export function appState(): AppState {
  const ai = aiStatus();
  return {
    business: getBusiness(),
    now: getSetting("now")!,
    step: Number(getSetting("step") ?? 0),
    steps: DEMO_STEPS,
    workers: getWorkers(),
    shifts: getShifts(),
    constraints: getConstraints(),
    messages: getMessages(),
    actions: getActions(),
    batches: getBatches(),
    items: getItems(),
    status: {
      ai: { mode: ai.mode, model: ai.model, detail: ai.detail, using: ai.using },
      paypal: paypalStatus(),
      bryntum: { mode: "trial", detail: "Scheduler Pro + Calendar (thin trial packages)" },
    },
  };
}
