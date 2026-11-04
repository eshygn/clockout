"use client";

import { useMemo, useState } from "react";
import { payForShift } from "@/lib/money";
import { describeItemError, describeItemStatus, outcomeOf } from "@/lib/payoutState";
import { durationMinutes, formatRange } from "@/lib/time";
import type { AppState, PayoutItem } from "@/lib/types";
import { Avatar, Icon, Money } from "./ui";

export function PayoutsPanel({
  state,
  busy,
  onPay,
  onRetry,
}: {
  state: AppState;
  busy: string | null;
  onPay: (shiftIds: string[]) => void;
  onRetry: (itemId: string, email?: string) => void;
}) {
  const { business, shifts, items, batches } = state;
  const ccy = business.currency;
  const workers = new Map(state.workers.map((w) => [w.id, w]));

  const totals = useMemo(() => {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const scheduled = sum(shifts.filter((s) => s.workerId).map((s) => s.payMinor));
    const paid = sum(items.filter((i) => i.status === "SUCCESS").map((i) => i.amountMinor));
    const inFlight = sum(shifts.filter((s) => s.status === "paying").map((s) => s.payMinor));
    const owed = sum(shifts.filter((s) => ["completed", "approved", "failed"].includes(s.status)).map((s) => s.payMinor));
    return { scheduled, paid, inFlight, owed, left: business.weeklyBudgetMinor - scheduled };
  }, [shifts, items, business.weeklyBudgetMinor]);

  const awaiting = shifts.filter((s) => s.status === "completed" && s.workerId);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const selected = awaiting.filter((s) => !unticked.has(s.id));
  const selectedTotal = selected.reduce((a, s) => a + s.payMinor, 0);

  // Latest attempt per shift that still needs attention.
  const attention = shifts
    .filter((s) => s.status === "failed")
    .map((s) => items.filter((i) => i.shiftId === s.id).sort((a, b) => b.attempt - a.attempt)[0])
    .filter((i): i is PayoutItem => !!i && outcomeOf(i.status) === "needs_attention");

  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / business.weeklyBudgetMinor) * 100))}%`;
  const allSquare = totals.owed === 0 && totals.inFlight === 0 && totals.paid > 0;

  return (
    <aside className="panel payouts">
      <div className="panel-head">
        <h2>
          Payouts <span className="pp-mark">via PayPal</span>
        </h2>
        <p>Approve hours and each freelancer is paid at their agreed rate, straight away.</p>
      </div>

      <section className="recon" aria-label="Weekly reconciliation">
        <div className="recon-bar" role="img" aria-label="Budget usage">
          <span className="seg seg-paid" style={{ width: pct(totals.paid) }} />
          <span className="seg seg-flight" style={{ width: pct(totals.inFlight) }} />
          <span className="seg seg-owed" style={{ width: pct(totals.owed) }} />
          <span
            className="seg seg-sched"
            style={{ width: pct(Math.max(0, totals.scheduled - totals.paid - totals.inFlight - totals.owed)) }}
          />
        </div>
        <dl className="recon-grid">
          <div>
            <dt>Week budget</dt>
            <dd>
              <Money minor={business.weeklyBudgetMinor} currency={ccy} />
            </dd>
          </div>
          <div>
            <dt>Rota cost</dt>
            <dd>
              <Money minor={totals.scheduled} currency={ccy} />
            </dd>
          </div>
          <div>
            <dt>
              <i className="key key-paid" /> Paid
            </dt>
            <dd>
              <Money minor={totals.paid} currency={ccy} />
            </dd>
          </div>
          <div>
            <dt>
              <i className="key key-owed" /> Owed now
            </dt>
            <dd className={totals.owed ? "is-owed" : ""}>
              <Money minor={totals.owed + totals.inFlight} currency={ccy} />
            </dd>
          </div>
        </dl>
        {allSquare ? (
          <div className="square">
            <Icon name="circle-check" /> Nothing owed. Everyone who worked has been paid.
          </div>
        ) : (
          <div className="headroom">
            <Money minor={totals.left} currency={ccy} /> headroom left in this week&apos;s budget
          </div>
        )}
      </section>

      {awaiting.length > 0 && (
        <section className="approve">
          <h3>
            <Icon name="clock" /> Hours to approve
          </h3>
          <ul>
            {awaiting.map((s) => {
              const w = workers.get(s.workerId!)!;
              const pb = payForShift(s.start, s.end, w.rates);
              const checked = !unticked.has(s.id);
              return (
                <li key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setUnticked((u) => {
                          const n = new Set(u);
                          if (n.has(s.id)) n.delete(s.id);
                          else n.add(s.id);
                          return n;
                        })
                      }
                    />
                    <Avatar worker={w} size={26} />
                    <span className="ap-main">
                      <strong>{w.name}</strong>
                      <span>
                        {s.eventName} · {formatRange(s.start, s.end)} · {durationMinutes(s.start, s.end) / 60}h
                        {pb.minutes.night > 0 && <em className="rate-tag">night {pb.minutes.night / 60}h</em>}
                        {pb.minutes.weekend > 0 && <em className="rate-tag">weekend {pb.minutes.weekend / 60}h</em>}
                      </span>
                    </span>
                    <Money minor={s.payMinor} currency={ccy} />
                  </label>
                </li>
              );
            })}
          </ul>
          <button className="btn btn-pay" disabled={!selected.length || !!busy} onClick={() => onPay(selected.map((s) => s.id))}>
            {busy === "pay" ? <Icon name="spinner fa-spin" /> : <Icon name="paper-plane" />}
            Approve &amp; pay {new Set(selected.map((s) => s.workerId)).size} with PayPal · <Money minor={selectedTotal} currency={ccy} />
          </button>
        </section>
      )}

      {attention.length > 0 && (
        <section className="attention">
          <h3>
            <Icon name="triangle-exclamation" /> Needs attention
          </h3>
          {attention.map((i) => (
            <RetryRow key={i.id} item={i} worker={workers.get(i.workerId)!} busy={busy} onRetry={onRetry} />
          ))}
        </section>
      )}

      <section className="history">
        <h3>
          <Icon name="receipt" /> Payout history
        </h3>
        {batches.length === 0 && <p className="empty">No payouts yet this week. Approve hours when a shift ends.</p>}
        {batches.map((b) => {
          const its = items.filter((i) => i.batchId === b.id);
          return (
            <details key={b.id} className="batch" open={b === batches[0]}>
              <summary>
                <span className={`pill pill-${b.status.toLowerCase()}`}>{b.status}</span>
                <span className="batch-label">{b.label}</span>
                <Money minor={b.totalMinor} currency={b.currency} />
              </summary>
              <div className="batch-meta">
                PayPal batch <code>{b.paypalBatchId}</code> · {b.mode === "live" ? "sandbox" : "mock"} · {its.length} item
                {its.length > 1 ? "s" : ""}
              </div>
              <ul>
                {its.map((i) => {
                  const w = workers.get(i.workerId)!;
                  const o = outcomeOf(i.status);
                  return (
                    <li key={i.id} className={`item item-${o}`}>
                      <Avatar worker={w} size={20} />
                      <span className="item-who">{w.name.split(" ")[0]}</span>
                      <span className="item-status" title={i.error ?? undefined}>
                        {o === "paid" ? (
                          <Icon name="check" />
                        ) : o === "in_flight" ? (
                          <Icon name="spinner fa-spin" />
                        ) : (
                          <Icon name="circle-exclamation" />
                        )}{" "}
                        {describeItemStatus(i.status)}
                      </span>
                      <Money minor={i.amountMinor} currency={i.currency} />
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </section>
    </aside>
  );
}

function RetryRow({
  item,
  worker,
  busy,
  onRetry,
}: {
  item: PayoutItem;
  worker: AppState["workers"][number];
  busy: string | null;
  onRetry: (itemId: string, email?: string) => void;
}) {
  const suggestion = item.receiver.replace(/@gmial\./i, "@gmail.");
  const [email, setEmail] = useState(suggestion);
  return (
    <div className="retry">
      <div className="retry-head">
        <Avatar worker={worker} size={26} />
        <div>
          <strong>{worker.name}</strong>
          <span>
            {describeItemStatus(item.status)} · <code>{item.receiver}</code>
          </span>
          {item.error && item.status !== "UNCLAIMED" && <span className="retry-why">{describeItemError(item.error)}</span>}
        </div>
        <Money minor={item.amountMinor} currency={item.currency} />
      </div>
      <div className="retry-form">
        <input aria-label="PayPal email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-retry" disabled={!!busy} onClick={() => onRetry(item.id, email !== item.receiver ? email : undefined)}>
          {busy === "retry" ? <Icon name="spinner fa-spin" /> : <Icon name="rotate-right" />} Retry
        </button>
      </div>
      {item.status === "UNCLAIMED" && (
        <p className="retry-note">Clockout cancels the unclaimed payout first, so the money comes back before it re-sends.</p>
      )}
    </div>
  );
}
