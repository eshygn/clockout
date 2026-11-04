"use client";

import { dayName, hhmm } from "@/lib/time";
import type { AppState } from "@/lib/types";
import { Icon } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TopBar({
  state,
  busy,
  onJump,
  onReset,
}: {
  state: AppState;
  busy: string | null;
  onJump: (step: number) => void;
  onReset: () => void;
}) {
  const { now, steps, step, status, business } = state;
  const next = steps[step + 1];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" aria-label="Clockout">
          <span className="logo-dial" aria-hidden>
            <span className="logo-hand" />
          </span>
          <span>
            clock<span className="logo-out">out</span>
          </span>
        </div>
        <div className="biz">
          <strong>{business.name}</strong>
          <span>{business.city}</span>
        </div>
      </div>

      <div className="story">
        <div className="clock" title="Demo clock">
          <span className="clock-day">
            {dayName(now)} {Number(now.slice(8, 10))} {MONTHS[Number(now.slice(5, 7)) - 1]}
          </span>
          <span className="clock-time">{hhmm(now)}</span>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id} className={i === step ? "is-now" : i < step ? "is-done" : ""}>
              <span className="dot">{i < step ? <Icon name="check" /> : i + 1}</span>
              {s.label.split(" · ")[1]}
            </li>
          ))}
        </ol>
        {next ? (
          <button className="btn btn-clock" disabled={!!busy} onClick={() => onJump(step + 1)}>
            {busy === "clock" ? <Icon name="spinner fa-spin" /> : <Icon name="forward" />} {next.label.split(" · ")[0]}
          </button>
        ) : (
          <span className="story-end">End of story</span>
        )}
      </div>

      <div className="chips">
        <span className={`chip chip-${status.ai.mode}`} title={status.ai.detail}>
          <span className="chip-dot" />
          AI · {status.ai.mode === "live" ? (status.ai.model ?? "Gemini") : "recorded"}
        </span>
        <span className={`chip chip-${status.paypal.mode}`} title={status.paypal.detail}>
          <span className="chip-dot" />
          PayPal · {status.paypal.mode === "live" ? "sandbox" : "mock"}
        </span>
        <span className="chip chip-live" title={status.bryntum.detail}>
          <span className="chip-dot" />
          Bryntum · trial
        </span>
        <button className="btn btn-ghost" disabled={!!busy} onClick={onReset} title="Reset demo data">
          <Icon name="rotate-left" /> Reset
        </button>
      </div>
    </header>
  );
}
