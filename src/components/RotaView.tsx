"use client";

import { BryntumResourceHistogram, BryntumSchedulerPro } from "@bryntum/schedulerpro-react-thin";
import type { SchedulerPro } from "@bryntum/schedulerpro-thin";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dateToWall, wallToDate } from "@/lib/time";
import type { AppState } from "@/lib/types";
import {
  eventInnerHtml,
  OPEN_ROW,
  resourceCellHtml,
  toEvents,
  toResources,
  toResourceTimeRanges,
  toTimeRanges,
  tooltipHtml,
  validateMove,
} from "./bryntumData";
import { Icon } from "./ui";

type Zoom = "detail" | "week";

// Narrower crew column on phones so the timeline keeps most of the screen.
const CREW_COL = typeof window !== "undefined" && window.innerWidth < 600 ? 128 : 196;

const PRESETS = {
  detail: {
    base: "hourAndDay",
    id: "co-detail",
    tickWidth: 62,
    shiftUnit: "day",
    timeResolution: { unit: "minute", increment: 30 },
    headers: [
      { unit: "day", dateFormat: "ddd D MMM" },
      { unit: "hour", increment: 3, dateFormat: "HH:mm" },
    ],
  },
  week: {
    base: "hourAndDay",
    id: "co-week",
    tickWidth: 34,
    shiftUnit: "day",
    timeResolution: { unit: "minute", increment: 30 },
    headers: [
      { unit: "day", dateFormat: "ddd D" },
      { unit: "hour", increment: 6, dateFormat: "HH" },
    ],
  },
};

export function RotaView({
  state,
  onMove,
  onRefill,
}: {
  state: AppState;
  onMove: (shiftId: string, patch: { workerId?: string | null; start?: string; end?: string }) => void;
  onRefill: (shiftId: string) => void;
}) {
  const schedRef = useRef<BryntumSchedulerPro>(null);
  const [scheduler, setScheduler] = useState<SchedulerPro | null>(null);
  const [zoom, setZoom] = useState<Zoom>("week");
  // Bryntum callbacks are created once; they read the latest state through refs.
  const stateRef = useRef(state);
  const onRefillRef = useRef(onRefill);
  useLayoutEffect(() => {
    stateRef.current = state;
    onRefillRef.current = onRefill;
  });

  const resources = useMemo(() => toResources(state), [state]);
  const events = useMemo(() => toEvents(state), [state]);
  const resourceTimeRanges = useMemo(() => toResourceTimeRanges(state), [state]);
  const timeRanges = useMemo(() => toTimeRanges(state), [state]);

  useEffect(() => {
    setScheduler((schedRef.current?.instance as SchedulerPro) ?? null);
  }, []);

  // Follow the demo clock: keep "now" in view.
  useEffect(() => {
    const s = schedRef.current?.instance as SchedulerPro | undefined;
    if (!s) return;
    const t = setTimeout(() => s.scrollToDate(wallToDate(state.now), { block: "start", animate: 400 } as never), 50);
    return () => clearTimeout(t);
  }, [state.now, zoom]);

  const config = useMemo(
    () => ({
      startDate: wallToDate(state.business.weekStart),
      endDate: new Date(wallToDate(state.business.weekStart).getTime() + 7 * 86400000),
      // Shifts run 06:00–24:00, so the night hours are folded out of the timeline.
      timeAxis: { continuous: false, include: { hour: { from: 6, to: 24 } } },
      rowHeight: 62,
      barMargin: 7,
      resourceImagePath: undefined,
      eventStyle: "tonal",
      zoomOnMouseWheel: false,
      columns: [
        {
          text: "Crew",
          field: "name",
          width: CREW_COL,
          htmlEncode: false,
          renderer: ({ record }: { record: { get: (f: string) => unknown; name: string } }) => resourceCellHtml(record),
        },
      ],
      project: {
        eventStore: { syncDataOnLoad: true },
        resourceStore: { syncDataOnLoad: true },
        resourceTimeRangeStore: { syncDataOnLoad: true },
      },
      eventRenderer: ({
        eventRecord,
        renderData,
      }: {
        eventRecord: { name: string; get: (f: string) => unknown; startDate: Date; endDate: Date };
        renderData: { width: number };
      }) => eventInnerHtml(eventRecord, renderData.width),
      // React wrapper takes features as <name>Feature props.
      taskEditFeature: false,
      cellEditFeature: false,
      dependenciesFeature: false,
      eventDragCreateFeature: false,
      scheduleMenuFeature: false,
      resourceTimeRangesFeature: true,
      timeRangesFeature: { showHeaderElements: true },
      eventTooltipFeature: {
        align: "b-t",
        template: ({ eventRecord }: { eventRecord: { id: unknown; startDate: Date; endDate: Date } }) =>
          tooltipHtml(stateRef.current, eventRecord),
      },
      eventDragFeature: {
        constrainDragToTimeline: true,
        validatorFn: ({
          eventRecords,
          newResource,
          startDate,
          endDate,
        }: {
          eventRecords?: { id: unknown }[];
          newResource?: { id: unknown };
          startDate: Date;
          endDate: Date;
        }) =>
          // Bryntum calls this while the pointer is outside any row too; there is nothing to validate then.
          eventRecords?.[0] && newResource
            ? validateMove(stateRef.current, String(eventRecords[0].id), String(newResource.id), startDate, endDate)
            : false,
      },
      eventResizeFeature: {
        // At runtime (7.3.8) the context carries `eventRecord`, not the `record` the .d.ts names,
        // and `endDate` can be missing while only the start edge moves. Accept both.
        validatorFn: (ctx: {
          eventRecord?: { id: unknown; startDate: Date | string; endDate: Date | string };
          record?: { id: unknown; startDate: Date | string; endDate: Date | string };
          startDate?: Date;
          endDate?: Date;
        }) => {
          const rec = ctx.eventRecord ?? ctx.record;
          if (!rec) return false;
          const shift = stateRef.current.shifts.find((s) => s.id === rec.id);
          const start = ctx.startDate ?? new Date(rec.startDate);
          const end = ctx.endDate ?? new Date(rec.endDate);
          return validateMove(stateRef.current, String(rec.id), shift?.workerId ?? OPEN_ROW, start, end).valid;
        },
      },
      eventMenuFeature: {
        items: {
          editEvent: false,
          deleteEvent: false,
          unassignEvent: false,
          splitEvent: false,
          copyEvent: false,
          cutEvent: false,
          co_refill: {
            text: "Drop & let the agent find cover",
            icon: "fa-solid fa-wand-magic-sparkles",
            weight: 100,
            onItem: ({ eventRecord }: { eventRecord: { id: unknown } }) => onRefillRef.current(String(eventRecord.id)),
          },
        },
        processItems: ({
          eventRecord,
          items,
        }: {
          eventRecord: { get: (f: string) => unknown };
          items: Record<string, { hidden?: boolean }>;
        }) => {
          if (eventRecord.get("status") !== "booked") items.co_refill.hidden = true;
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="rota">
      <div className="rota-tools">
        <div className="legend">
          <span className="lg lg-open">Open</span>
          <span className="lg lg-booked">Booked</span>
          <span className="lg lg-completed">Hours to approve</span>
          <span className="lg lg-paying">Paying</span>
          <span className="lg lg-paid">Paid</span>
          <span className="lg lg-failed">Needs attention</span>
          <span className="lg lg-unavail">Can&apos;t work</span>
          <span className="lg lg-pref">Asked for</span>
        </div>
        <div className="seg-ctl" role="group" aria-label="Zoom">
          <button className={zoom === "week" ? "on" : ""} onClick={() => setZoom("week")}>
            <Icon name="calendar-week" /> Week
          </button>
          <button className={zoom === "detail" ? "on" : ""} onClick={() => setZoom("detail")}>
            <Icon name="magnifying-glass-plus" /> Detail
          </button>
        </div>
      </div>
      <div className="rota-sched">
        <BryntumSchedulerPro
          ref={schedRef}
          {...(config as object)}
          viewPreset={PRESETS[zoom] as never}
          resources={resources}
          events={events}
          resourceTimeRanges={resourceTimeRanges}
          timeRanges={timeRanges}
          onAfterEventDrop={({ eventRecords, assignmentRecords, valid }) => {
            if (!valid) return;
            const ev = eventRecords[0];
            const rid = String(assignmentRecords[0]?.resourceId ?? OPEN_ROW);
            onMove(String(ev.id), {
              workerId: rid === OPEN_ROW ? null : rid,
              start: dateToWall(new Date(ev.startDate)),
              end: dateToWall(new Date(ev.endDate)),
            });
          }}
          onEventResizeEnd={({ eventRecord, changed }) => {
            if (changed)
              onMove(String(eventRecord.id), {
                start: dateToWall(new Date(eventRecord.startDate)),
                end: dateToWall(new Date(eventRecord.endDate)),
              });
          }}
        />
      </div>
      <div className="rota-hist">
        {scheduler && (
          <BryntumResourceHistogram
            project={scheduler.project}
            partner={scheduler}
            rowHeight={34}
            showBarTip
            showBarText={false}
            showMaxEffort={false}
            hideHeaders
            columns={[
              {
                text: "Load",
                field: "name",
                width: CREW_COL,
                htmlEncode: false,
                renderer: ({ record }: { record: { name: string; get: (f: string) => unknown } }) =>
                  `<span class="co-hist-name"><i style="background:${record.get("color")}"></i>${record.name}</span>`,
              },
            ]}
            getBarClass={(_series: unknown, _dom: unknown, datum: { isOverallocated: boolean }) => (datum.isOverallocated ? "co-over" : "")}
          />
        )}
      </div>
    </div>
  );
}
