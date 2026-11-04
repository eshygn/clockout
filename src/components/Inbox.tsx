"use client";

import { useState } from "react";
import { hhmm, dayName } from "@/lib/time";
import type { AppState } from "@/lib/types";
import { Avatar, Icon, SourceTag } from "./ui";

export function Inbox({
  state,
  busy,
  onRun,
  onSend,
}: {
  state: AppState;
  busy: string | null;
  onRun: () => void;
  onSend: (workerId: string, body: string) => Promise<boolean>;
}) {
  const unread = state.messages.filter((m) => !m.processedAt);
  const openFuture = state.shifts.filter((s) => s.status === "open" && s.start > state.now).length;
  const [workerId, setWorkerId] = useState(state.workers[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const workers = new Map(state.workers.map((w) => [w.id, w]));
  const messages = [...state.messages].reverse();

  const canRun = unread.length > 0 || openFuture > 0;
  const runLabel = unread.length
    ? `Let the agent handle ${unread.length} new message${unread.length > 1 ? "s" : ""}`
    : openFuture
      ? `Fill ${openFuture} open shift${openFuture > 1 ? "s" : ""}`
      : "All caught up";

  return (
    <aside className="panel inbox">
      <div className="panel-head">
        <h2>Crew inbox {unread.length > 0 && <span className="badge">{unread.length} new</span>}</h2>
        <p>Plain-English texts from your crew. The agent turns them into rules and runs the rota.</p>
      </div>

      <button className={`btn btn-agent ${canRun ? "pulse" : ""}`} disabled={!canRun || !!busy} onClick={onRun}>
        {busy === "agent" ? <Icon name="spinner fa-spin" /> : <Icon name="wand-magic-sparkles" />}
        {busy === "agent" ? "Agent is working…" : runLabel}
      </button>

      <div className="messages">
        {messages.map((m) => {
          const w = workers.get(m.workerId);
          return (
            <article key={m.id} className={`msg ${m.processedAt ? "is-read" : "is-new"}`}>
              <Avatar worker={w} size={30} />
              <div className="msg-body">
                <header>
                  <strong>{w?.name}</strong>
                  <time>
                    {dayName(m.receivedAt)} {hhmm(m.receivedAt)}
                  </time>
                </header>
                <p className="msg-text">{m.body}</p>
                {m.summary && (
                  <p className="msg-summary">
                    <Icon name="arrow-turn-up fa-rotate-90" /> {m.summary}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <form
        className="composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          if (await onSend(workerId, draft.trim())) setDraft("");
        }}
      >
        <label className="sr-only" htmlFor="composer-worker">
          From
        </label>
        <select id="composer-worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          {state.workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Message"
          placeholder="e.g. can't do sun, can take sat eve"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
        />
        <button className="btn btn-icon" disabled={!draft.trim() || !!busy} title="Send as this worker">
          <Icon name="paper-plane" />
        </button>
      </form>
    </aside>
  );
}

export function AgentLog({ state }: { state: AppState }) {
  const workers = new Map(state.workers.map((w) => [w.id, w]));
  return (
    <section className="panel log">
      <div className="panel-head">
        <h2>What the agent did</h2>
        <p>Every change, with the reason. Guardrails check each one before it lands.</p>
      </div>
      <ol className="actions">
        {state.actions.map((a) => (
          <li key={a.id} className={`act act-${a.kind}`}>
            <span className="act-icon">
              <Icon
                name={
                  {
                    read: "envelope-open-text",
                    assign: "user-check",
                    unassign: "user-xmark",
                    swap: "right-left",
                    reject: "shield-halved",
                    summary: "list-check",
                    payout: "money-bill-transfer",
                    clock: "clock",
                  }[a.kind]
                }
              />
            </span>
            <div>
              <p>{a.text}</p>
              <footer>
                <time>
                  {dayName(a.at)} {hhmm(a.at)}
                </time>
                <SourceTag source={a.source} />
                {a.workerId && workers.get(a.workerId) && <span className="act-who">{workers.get(a.workerId)!.name.split(" ")[0]}</span>}
              </footer>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
