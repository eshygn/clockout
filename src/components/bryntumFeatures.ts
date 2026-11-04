/**
 * The bundler tree-shakes Bryntum's barrel entry, so features that are only named in
 * config (never imported) would not register. Importing and referencing them here
 * guarantees they are in the bundle.
 */
import { ResourceTimeRanges, TimeRanges } from "@bryntum/scheduler-thin";
import { EventMenu, EventTooltip, ScheduleTooltip } from "@bryntum/scheduler-thin";
import { EventDrag, EventResize } from "@bryntum/schedulerpro-thin";

export const BRYNTUM_FEATURES = [ResourceTimeRanges, TimeRanges, EventMenu, EventTooltip, ScheduleTooltip, EventDrag, EventResize];
