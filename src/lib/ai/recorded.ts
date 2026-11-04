import { addMinutes, dayOfWeek, toMin, type Wall } from "../time";
import type { Message, Role, Shift, Worker } from "../types";
import { ROLES } from "../types";
import type { ConstraintUpdate } from "./schemas";

/**
 * Recorded responses: the tool-call arguments Gemini returned for the seeded demo
 * messages, replayed when no API key is set or the free tier is rate-limited.
 * Messages we have no recording for go through a small rule-based reader instead.
 */
const D = {
  mon: "2026-11-09",
  tue: "2026-11-10",
  wed: "2026-11-11",
  thu: "2026-11-12",
  fri: "2026-11-13",
  sat: "2026-11-14",
  sun: "2026-11-15",
  nextMon: "2026-11-16",
};
const w = (start: string, end: string, note: string) => ({ start, end, note });

export const RECORDED: Record<string, Omit<ConstraintUpdate, "messageId">> = {
  m01: {
    summary: "Off all Saturday (sister's wedding). Offered Tue evening, all Wed, Fri night.",
    unavailable: [w(`${D.sat}T00:00`, `${D.sun}T00:00`, "sister's wedding")],
    preferred: [
      w(`${D.tue}T17:00`, `${D.wed}T00:00`, "tues eve"),
      w(`${D.wed}T00:00`, `${D.thu}T00:00`, "wed all day"),
      w(`${D.fri}T17:00`, `${D.sat}T02:00`, "fri night"),
    ],
    preferredRoles: [],
    dropShiftIds: [],
  },
  m02: {
    summary: "Mornings Mon–Wed. Out all Thursday. Friday from 3pm.",
    unavailable: [w(`${D.thu}T00:00`, `${D.fri}T00:00`, "kids thing"), w(`${D.fri}T00:00`, `${D.fri}T15:00`, "free from 3")],
    preferred: [
      w(`${D.mon}T06:00`, `${D.mon}T12:00`, "mornings"),
      w(`${D.tue}T06:00`, `${D.tue}T12:00`, "mornings"),
      w(`${D.wed}T06:00`, `${D.wed}T12:00`, "mornings"),
      w(`${D.fri}T15:00`, `${D.sat}T00:00`, "free from 3"),
    ],
    preferredRoles: [],
    dropShiftIds: [],
  },
  m03: {
    summary: "Free all week except Friday before 2pm. Offered to host Wednesday's summit.",
    unavailable: [w(`${D.fri}T00:00`, `${D.fri}T14:00`, "busy fri morning")],
    preferred: [w(`${D.wed}T08:00`, `${D.wed}T16:00`, "host the summit wed")],
    preferredRoles: ["host"],
    dropShiftIds: [],
  },
  m04: {
    summary: "Offered Tue evening. Can't do Sunday. Max 20 hours (exams).",
    unavailable: [w(`${D.sun}T00:00`, `${D.nextMon}T00:00`, "not sunday")],
    preferred: [w(`${D.tue}T17:00`, `${D.wed}T00:00`, "tues eve")],
    preferredRoles: [],
    maxHours: 20,
    dropShiftIds: [],
  },
  m05: {
    summary: "Dentist Thu until 11am. Wants Monday setup and a Saturday bar shift.",
    unavailable: [w(`${D.thu}T00:00`, `${D.thu}T11:00`, "dentist")],
    preferred: [w(`${D.mon}T06:00`, `${D.mon}T13:00`, "mon setup"), w(`${D.sat}T10:00`, `${D.sun}T00:00`, "sat bar shift")],
    preferredRoles: ["bartender"],
    dropShiftIds: [],
  },
  m06: {
    summary: "Around Wed–Sun only, prefers bar work, nothing before 10am at the weekend.",
    unavailable: [
      w(`${D.mon}T00:00`, `${D.wed}T00:00`, "only around wed–sun"),
      w(`${D.sat}T00:00`, `${D.sat}T10:00`, "nothing before 10 on weekends"),
      w(`${D.sun}T00:00`, `${D.sun}T10:00`, "nothing before 10 on weekends"),
    ],
    preferred: [],
    preferredRoles: ["bartender"],
    dropShiftIds: [],
  },
};

const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(day)?\b/i, 0],
  [/\bmon(day)?\b/i, 1],
  [/\btue(s|sday)?\b/i, 2],
  [/\bwed(nesday)?\b/i, 3],
  [/\bthu(r|rs|rsday)?\b/i, 4],
  [/\bfri(day)?\b/i, 5],
  [/\bsat(urday)?\b/i, 6],
];

function dateFor(dow: number, weekStart: Wall): Wall {
  // weekStart is a Monday 00:00
  const offset = (dow + 6) % 7;
  return addMinutes(weekStart, offset * 1440);
}

/** Small rule-based reader for unrecorded messages in mock mode. */
export function readHeuristically(
  msg: Message,
  worker: Worker,
  shifts: Shift[],
  now: Wall,
  weekStart: Wall,
): Omit<ConstraintUpdate, "messageId"> {
  const text = msg.body.toLowerCase();
  const negative = /(can'?t|cannot|can not|not|sick|fever|ill|unwell|out|no\b|won'?t)/i.test(text);
  const today = now.slice(0, 10) + "T00:00";
  const days: Wall[] = [];
  if (/\b(today|tonight|this (morning|evening))\b/.test(text)) days.push(today);
  if (/\btomorrow\b/.test(text)) days.push(addMinutes(today, 1440));
  for (const [re, dow] of DAY_WORDS) if (re.test(text)) days.push(dateFor(dow, weekStart));
  const sick = /(sick|fever|ill\b|unwell|flu|covid|emergency)/i.test(text);
  if (sick && days.length === 0) days.push(today);

  const windows = days.map((d) => w(d, addMinutes(d, 1440), sick ? "unwell" : "said so"));
  const roles = ROLES.filter((r) => text.includes(r === "bartender" ? "bar" : r)) as Role[];
  const unavailable = negative ? windows : [];
  const preferred = negative ? [] : windows;
  const dropShiftIds = shifts
    .filter((s) => s.workerId === worker.id && s.status === "booked" && toMin(s.end) > toMin(now))
    .filter((s) => unavailable.some((u) => toMin(s.start) < toMin(u.end) && toMin(u.start) < toMin(s.end)))
    .map((s) => s.id);
  const first = worker.name.split(" ")[0];
  const dayLabel = days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek(toMin(d))]).join(", ");
  const summary = sick
    ? `${first} is unwell${dayLabel ? ` (${dayLabel})` : ""}${dropShiftIds.length ? `: dropping ${dropShiftIds.length} shift${dropShiftIds.length > 1 ? "s" : ""}` : ""}.`
    : negative
      ? `${first} can't work ${dayLabel || "the times mentioned"}.`
      : `${first} offered ${dayLabel || "extra availability"}.`;
  return { summary, unavailable, preferred, preferredRoles: roles, dropShiftIds };
}

/** Recorded constraint update for a message, or the heuristic reading. */
export function recordedUpdate(msg: Message, worker: Worker, shifts: Shift[], now: Wall, weekStart: Wall): ConstraintUpdate {
  const rec = RECORDED[msg.id];
  if (rec) return { messageId: msg.id, ...rec };
  return { messageId: msg.id, ...readHeuristically(msg, worker, shifts, now, weekStart) };
}
