"use client";

import "./bryntum.css";
import { BRYNTUM_FEATURES } from "./bryntumFeatures";

void BRYNTUM_FEATURES;
import { useState } from "react";
import { AgentLog, Inbox } from "./Inbox";
import { PayoutsPanel } from "./PayoutsPanel";
import { RotaView } from "./RotaView";
import { TopBar } from "./TopBar";
import { useApp } from "./useApp";
import { Icon } from "./ui";
import { WorkerWeek } from "./WorkerWeek";

type Tab = "rota" | "week";

export function Dashboard() {
  const { state, busy, act, toast, toasts } = useApp();
  const [tab, setTab] = useState<Tab>("rota");

  if (!state) {
    return (
      <div className="boot">
        <div className="boot-mark">
          clock<span>out</span>
        </div>
        <p>Loading the week…</p>
      </div>
    );
  }

  const hint = state.steps[state.step]?.hint;
  const openCount = state.shifts.filter((s) => s.status === "open").length;

  return (
    <div className="app">
      <TopBar
        state={state}
        busy={busy}
        onJump={async (step) => {
          const r = await act("clock", "/api/demo/clock", { step });
          if (r) toast("info", state.steps[step].hint);
        }}
        onReset={async () => {
          if (await act("reset", "/api/demo/reset")) toast("info", "Demo reset to Monday morning.");
        }}
      />
      <div className="hint" role="status">
        <Icon name="lightbulb" /> {hint}
      </div>
      <main className="grid">
        <div className="col-left">
          <Inbox
            state={state}
            busy={busy}
            onRun={async () => {
              const r = await act<{ filled: number; dropped: string[]; ms: number; source: string }>("agent", "/api/agent/run");
              if (r)
                toast(
                  "success",
                  r.dropped.length
                    ? `Cover found in ${(r.ms / 1000).toFixed(1)}s.`
                    : `Agent filled ${r.filled} shift${r.filled === 1 ? "" : "s"} in ${(r.ms / 1000).toFixed(1)}s.`,
                );
            }}
            onSend={async (workerId, body) => !!(await act("send", "/api/messages", { workerId, body }))}
          />
          <AgentLog state={state} />
        </div>

        <section className="col-main panel">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "rota"} className={tab === "rota" ? "on" : ""} onClick={() => setTab("rota")}>
              <Icon name="table-cells" /> Rota <span className="tab-sub">Scheduler Pro + load histogram</span>
            </button>
            <button role="tab" aria-selected={tab === "week"} className={tab === "week" ? "on" : ""} onClick={() => setTab("week")}>
              <Icon name="user-clock" /> Worker&apos;s week <span className="tab-sub">Calendar</span>
            </button>
            <span className="tab-kpi">
              {openCount > 0 ? (
                <>
                  <b>{openCount}</b> open shift{openCount === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  <Icon name="check" /> Fully staffed
                </>
              )}
            </span>
          </div>
          <div className="tab-body">
            {tab === "rota" ? (
              <RotaView
                state={state}
                onMove={(shiftId, patch) => act("move", `/api/shifts/${shiftId}`, patch, "PATCH")}
                onRefill={async (shiftId) => {
                  if (await act("agent", "/api/agent/refill", { shiftId })) toast("success", "Agent found cover.");
                }}
              />
            ) : (
              <WorkerWeek state={state} />
            )}
          </div>
        </section>

        <div className="col-right">
          <PayoutsPanel
            state={state}
            busy={busy}
            onPay={async (shiftIds) => {
              const r = await act<{ count: number; paypalBatchId: string } | null>("pay", "/api/payouts/pay", { shiftIds });
              if (r) toast("success", `PayPal batch ${r.paypalBatchId} sent: ${r.count} payout${r.count > 1 ? "s" : ""}.`);
            }}
            onRetry={async (itemId, email) => {
              if (await act("retry", "/api/payouts/retry", { itemId, email })) toast("success", "Payout re-sent.");
            }}
          />
        </div>
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === "error" ? "circle-exclamation" : t.kind === "success" ? "circle-check" : "circle-info"} /> {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
