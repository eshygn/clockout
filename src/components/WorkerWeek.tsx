"use client";

import { BryntumCalendar } from "@bryntum/calendar-react-thin";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { hoursFor, maxHoursFor } from "@/lib/scheduling";
import { wallToDate } from "@/lib/time";
import type { AppState } from "@/lib/types";
import { STATUS_META } from "./bryntumData";
import { Avatar, Money } from "./ui";

/** Bryntum Calendar: one worker's own week, as they'd see it on their phone. */
export function WorkerWeek({ state }: { state: AppState }) {
  const [workerId, setWorkerId] = useState(state.workers[0].id);
  const worker = state.workers.find((w) => w.id === workerId)!;
  const ccy = state.business.currency;

  const events = useMemo(() => {
    const shifts = state.shifts
      .filter((s) => s.workerId === workerId)
      .map((s) => ({
        id: s.id,
        name: `${s.eventName}`,
        startDate: wallToDate(s.start),
        endDate: wallToDate(s.end),
        resourceId: workerId,
        eventColor: s.status === "paid" ? "#0F8A58" : worker.color,
        cls: `co-cal co-${s.status}`,
        readOnly: true,
        status: s.status,
        detail: `${s.role} · ${formatMoney(s.payMinor, ccy)} · ${STATUS_META[s.status].label}`,
      }));
    const blocks = state.constraints
      .filter((c) => c.workerId === workerId && c.kind === "unavailable" && c.start && c.end)
      .map((c) => ({
        id: `blk_${c.id}`,
        name: `Can't work: ${c.note}`,
        startDate: wallToDate(c.start!),
        endDate: wallToDate(c.end!),
        resourceId: workerId,
        eventColor: "gray",
        cls: "co-cal-block",
        readOnly: true,
        allDay: false,
        detail: "from their message",
      }));
    return [...shifts, ...blocks];
  }, [state, workerId, worker.color, ccy]);

  const mine = state.shifts.filter((s) => s.workerId === workerId);
  const earned = mine.filter((s) => s.status === "paid").reduce((a, s) => a + s.payMinor, 0);
  const booked = mine.reduce((a, s) => a + s.payMinor, 0);

  return (
    <div className="worker-week">
      <div className="ww-side">
        <div className="ww-pick" role="tablist" aria-label="Crew member">
          {state.workers.map((w) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={w.id === workerId}
              className={w.id === workerId ? "on" : ""}
              onClick={() => setWorkerId(w.id)}
            >
              <Avatar worker={w} size={26} />
              <span>{w.name}</span>
            </button>
          ))}
        </div>
        <div className="ww-card">
          <Avatar worker={worker} size={44} />
          <h3>{worker.name}</h3>
          <p>{worker.blurb}</p>
          <dl>
            <div>
              <dt>Agreed rate</dt>
              <dd>
                <Money minor={worker.rates.baseMinor} currency={ccy} />
                /h
              </dd>
            </div>
            <div>
              <dt>Night (22–06)</dt>
              <dd>
                <Money minor={worker.rates.nightMinor} currency={ccy} />
                /h
              </dd>
            </div>
            <div>
              <dt>Weekend</dt>
              <dd>
                <Money minor={worker.rates.weekendMinor} currency={ccy} />
                /h
              </dd>
            </div>
            <div>
              <dt>This week</dt>
              <dd>
                {hoursFor(workerId, state.shifts)}h of {maxHoursFor(worker, state.constraints)}h
              </dd>
            </div>
            <div>
              <dt>Paid so far</dt>
              <dd>
                <Money minor={earned} currency={ccy} /> of <Money minor={booked} currency={ccy} />
              </dd>
            </div>
            <div>
              <dt>Paid to</dt>
              <dd>
                <code>{worker.paypalEmail}</code>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="ww-cal">
        <BryntumCalendar
          date={wallToDate(state.now)}
          mode="week"
          sidebar={false}
          readOnly
          weekStartDay={1}
          events={events}
          resources={[{ id: workerId, name: worker.name, eventColor: worker.color }]}
          modes={{
            day: null,
            month: null,
            year: null,
            agenda: null,
            week: {
              dayStartTime: 6,
              dayEndTime: 24,
              hourHeight: 44,
              showAllDayHeader: false,
              eventRenderer: ({ eventRecord }: { eventRecord: { name: string; get: (f: string) => unknown } }) =>
                `<div class="co-cal-name">${eventRecord.name}</div><div class="co-cal-detail">${eventRecord.get("detail") ?? ""}</div>`,
            },
          }}
          eventTooltipFeature={false}
          eventEditFeature={false}
          dragFeature={false}
          scheduleMenuFeature={false}
          eventMenuFeature={false}
        />
      </div>
    </div>
  );
}
