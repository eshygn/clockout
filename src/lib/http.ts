import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { IllegalTransitionError } from "./shiftState";
import { appState } from "./state";

/** Every mutating route returns the fresh app state so the UI re-renders from one source of truth. */
export async function handle(fn: () => Promise<unknown> | unknown) {
  try {
    const result = await fn();
    return NextResponse.json({ ok: true, result, state: appState() });
  } catch (e) {
    const status = e instanceof ZodError || e instanceof IllegalTransitionError || e instanceof RangeError ? 400 : 422;
    const message = e instanceof ZodError ? e.issues.map((i) => i.message).join("; ") : (e as Error).message;
    console.error("[api]", message);
    return NextResponse.json({ ok: false, error: message, state: appState() }, { status });
  }
}
