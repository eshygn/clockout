import { formatMoney, payForShift } from "@/lib/money";
import { checkAssignment, checkShiftLength, hoursFor, maxHoursFor } from "@/lib/scheduling";
import { isEditable } from "@/lib/shiftState";
import { dateToWall, durationMinutes, hhmm, wallToDate } from "@/lib/time";
import type { AppState, Shift } from "@/lib/types";

export const OPEN_ROW = "open";

export const STATUS_META: Record<Shift["status"], { label: string; icon: string }> = {
  open: { label: "Open", icon: "circle-plus" },
  booked: { label: "Booked", icon: "calendar-check" },
  completed: { label: "Hours to approve", icon: "hourglass-half" },
  approved: { label: "Approved", icon: "thumbs-up" },
  paying: { label: "Paying via PayPal", icon: "spinner fa-spin" },
  paid: { label: "Paid", icon: "circle-check" },
  failed: { label: "Payout needs attention", icon: "triangle-exclamation" },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function toResources(state: AppState) {
  return [
    {
      id: OPEN_ROW,
      name: "Open shifts",
      initials: "+",
      color: "#9AA0AC",
      roles: "Drag a shift onto someone",
      hours: 0,
      cap: 0,
      isOpen: true,
    },
    ...state.workers.map((w) => ({
      id: w.id,
      name: w.name,
      initials: w.initials,
      color: w.color,
      roles: w.roles.join(" · "),
      hours: hoursFor(w.id, state.shifts),
      cap: maxHoursFor(w, state.constraints),
      isOpen: false,
    })),
  ];
}

export function toEvents(state: AppState) {
  const ccy = state.business.currency;
  return state.shifts.map((s) => {
    const editable = isEditable(s.status) && s.status !== "completed";
    return {
      id: s.id,
      name: s.eventName,
      startDate: wallToDate(s.start),
      endDate: wallToDate(s.end),
      resourceId: s.workerId ?? OPEN_ROW,
      manuallyScheduled: true,
      draggable: editable,
      resizable: isEditable(s.status),
      cls: `co-ev co-${s.status}`,
      eventColor: s.workerId ? state.workers.find((w) => w.id === s.workerId)?.color : "gray",
      // custom fields
      status: s.status,
      role: s.role,
      venue: s.venue,
      pay: s.workerId ? formatMoney(s.payMinor, ccy) : "",
      initials: s.workerId ? (state.workers.find((w) => w.id === s.workerId)?.initials ?? "") : "",
      workerColor: s.workerId ? (state.workers.find((w) => w.id === s.workerId)?.color ?? "") : "",
    };
  });
}

export function toResourceTimeRanges(state: AppState) {
  return state.constraints
    .filter((c) => (c.kind === "unavailable" || c.kind === "preferred") && c.start && c.end)
    .map((c) => ({
      id: c.id,
      resourceId: c.workerId,
      startDate: wallToDate(c.start!),
      endDate: wallToDate(c.end!),
      name: c.kind === "unavailable" ? `✕ ${c.note}` : `✓ ${c.note}`,
      cls: c.kind === "unavailable" ? "co-unavail" : "co-pref",
    }));
}

export function toTimeRanges(state: AppState) {
  return [{ id: "now", name: `Now ${hhmm(state.now)}`, startDate: wallToDate(state.now), cls: "co-now" }];
}

type EvLike = { startDate: Date; endDate: Date; id: unknown; get?: (f: string) => unknown };

/** Shared validator for drag and resize: the same hard rules the server enforces. */
export function validateMove(state: AppState, eventId: string, resourceId: string, startDate: Date, endDate: Date) {
  const shift = state.shifts.find((s) => s.id === eventId);
  if (!shift) return { valid: false, message: "Unknown shift" };
  const length = checkShiftLength(dateToWall(startDate), dateToWall(endDate));
  if (length) return { valid: false, message: length };
  if (resourceId === OPEN_ROW) return { valid: true, message: "Back to open shifts" };
  const worker = state.workers.find((w) => w.id === resourceId);
  if (!worker) return { valid: false, message: "Unknown worker" };
  const candidate = { ...shift, start: dateToWall(startDate), end: dateToWall(endDate) };
  const check = checkAssignment(candidate, worker, state);
  if (!check.ok) return { valid: false, message: check.reasons[0] };
  const pay = payForShift(candidate.start, candidate.end, worker.rates);
  return { valid: true, message: `${worker.name.split(" ")[0]} · ${formatMoney(pay.totalMinor, state.business.currency)}` };
}

export function tooltipHtml(state: AppState, ev: EvLike): string {
  const shift = state.shifts.find((s) => s.id === ev.id);
  if (!shift) return "";
  const ccy = state.business.currency;
  const w = state.workers.find((x) => x.id === shift.workerId);
  const meta = STATUS_META[shift.status];
  const hours = durationMinutes(shift.start, shift.end) / 60;
  let pay = "";
  if (w) {
    const pb = payForShift(shift.start, shift.end, w.rates);
    pay = `<table class="co-tip-pay">${pb.lines
      .map((l) => `<tr><td>${l.band}</td><td>${l.minutes / 60}h × ${esc(formatMoney(l.rateMinor, ccy))}</td></tr>`)
      .join("")}<tr class="co-tip-total"><td>total</td><td>${esc(formatMoney(pb.totalMinor, ccy))}</td></tr></table>`;
  }
  const item = state.items.filter((i) => i.shiftId === shift.id).sort((a, b) => b.attempt - a.attempt)[0];
  const batch = item ? state.batches.find((b) => b.id === item.batchId) : undefined;
  return `<div class="co-tip">
    <div class="co-tip-head"><strong>${esc(shift.eventName)}</strong><span class="co-tip-status co-st-${shift.status}"><i class="fa-solid fa-${meta.icon}"></i> ${meta.label}</span></div>
    <div class="co-tip-sub">${esc(shift.role)} · ${esc(shift.venue)}</div>
    <div class="co-tip-sub">${hhmm(shift.start)}–${hhmm(shift.end)} · ${hours}h${w ? ` · ${esc(w.name)}` : " · unassigned"}</div>
    ${pay}
    ${batch?.paypalBatchId ? `<div class="co-tip-pp">PayPal batch <code>${esc(batch.paypalBatchId)}</code>${item?.transactionId ? `<br/>Transaction <code>${esc(item.transactionId)}</code>` : ""}</div>` : ""}
  </div>`;
}

export function eventInnerHtml(ev: { name: string; get: (f: string) => unknown; startDate: Date; endDate: Date }, width: number): string {
  const status = ev.get("status") as Shift["status"];
  const meta = STATUS_META[status];
  const pay = ev.get("pay") as string;
  const role = ev.get("role") as string;
  const t = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const amount = pay ? pay.replace(/ [A-Z]{3}$/, "") : "";
  if (width < 90) {
    // Week view: who, and the status, at a glance.
    const initials = ev.get("initials") as string;
    return `<div class="co-ev-compact">${
      initials
        ? `<span class="co-ev-av" style="background:${esc(String(ev.get("workerColor")))}">${esc(initials)}</span>`
        : `<span class="co-ev-r">${esc(role.slice(0, 3))}</span>`
    }<i class="fa-solid fa-${meta.icon} co-st-${status}"></i></div>`;
  }
  return `<div class="co-ev-inner">
    <div class="co-ev-top"><span class="co-ev-role">${esc(role)}</span><span class="co-ev-badge co-st-${status}" title="${meta.label}"><i class="fa-solid fa-${meta.icon}"></i>${status === "paid" ? "<b>PAID</b>" : ""}</span></div>
    <div class="co-ev-name">${esc(ev.name)}</div>
    <div class="co-ev-meta"><span>${t(ev.startDate)}–${t(ev.endDate)}</span>${amount ? `<span class="co-ev-pay">${esc(amount)}</span>` : ""}</div>
  </div>`;
}

export function resourceCellHtml(r: { get: (f: string) => unknown; name: string }): string {
  const isOpen = r.get("isOpen") as boolean;
  const hours = r.get("hours") as number;
  const cap = r.get("cap") as number;
  const pct = cap ? Math.min(100, (hours / cap) * 100) : 0;
  const tone = pct >= 100 ? "full" : pct >= 80 ? "near" : "ok";
  return `<div class="co-res ${isOpen ? "co-res-open" : ""}">
    <span class="co-res-av" style="background:${esc(String(r.get("color")))}">${esc(String(r.get("initials")))}</span>
    <span class="co-res-main">
      <strong>${esc(r.name)}</strong>
      <span class="co-res-roles">${esc(String(r.get("roles")))}</span>
      ${isOpen ? "" : `<span class="co-res-hours co-${tone}"><span style="width:${pct}%"></span></span><span class="co-res-hl">${hours}h of ${cap}h</span>`}
    </span>
  </div>`;
}
