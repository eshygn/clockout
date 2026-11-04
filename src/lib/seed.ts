import type { Business, DemoStep, Message, Shift, Worker } from "./types";

/**
 * The demo scenario. Everyone and everything here is fictional.
 * Week of Monday 9 November 2026, wall-clock times in the business's zone.
 */
export const BUSINESS: Business = {
  id: "biz_lanternfly",
  name: "Lanternfly Event Crew",
  city: "Austin, TX",
  currency: process.env.CLOCKOUT_CURRENCY || "USD",
  weekStart: "2026-11-09T00:00",
  weeklyBudgetMinor: 420000,
};

export const WORKERS: Worker[] = [
  {
    id: "w_maya",
    name: "Maya Chen",
    initials: "MC",
    roles: ["bartender", "server"],
    rates: { baseMinor: 2800, nightMinor: 3500, weekendMinor: 3800 },
    paypalEmail: "maya.chen@crew.example",
    color: "#E4572E",
    maxHours: 40,
    blurb: "Cocktail bartender, 6 yrs",
  },
  {
    id: "w_diego",
    name: "Diego Ramírez",
    initials: "DR",
    roles: ["setup", "server"],
    rates: { baseMinor: 2400, nightMinor: 3000, weekendMinor: 3200 },
    paypalEmail: "diego.ramirez@crew.example",
    color: "#2E86AB",
    maxHours: 40,
    blurb: "Rigging & service",
  },
  {
    id: "w_priya",
    name: "Priya Nair",
    initials: "PN",
    roles: ["host", "server", "bartender"],
    rates: { baseMinor: 3000, nightMinor: 3700, weekendMinor: 4000 },
    paypalEmail: "priya.nair@crew.example",
    color: "#7B4B94",
    maxHours: 40,
    blurb: "Front of house lead",
  },
  {
    id: "w_sam",
    name: "Sam Whitfield",
    initials: "SW",
    roles: ["setup", "server"],
    rates: { baseMinor: 2200, nightMinor: 2800, weekendMinor: 3000 },
    paypalEmail: "sam.whitfield@crew.example",
    color: "#3B8B5A",
    maxHours: 40,
    blurb: "Student, evenings",
  },
  {
    id: "w_jonah",
    name: "Jonah Brooks",
    initials: "JB",
    roles: ["setup", "bartender"],
    rates: { baseMinor: 2600, nightMinor: 3200, weekendMinor: 3500 },
    // Deliberate typo (gmial): this payout comes back unclaimed so the demo can show a retry.
    paypalEmail: "jonah.brooks@gmial.com",
    color: "#C08A1E",
    maxHours: 40,
    blurb: "Load-in & bar backup",
  },
  {
    id: "w_lena",
    name: "Lena Novak",
    initials: "LN",
    roles: ["bartender", "server", "host"],
    rates: { baseMinor: 2700, nightMinor: 3400, weekendMinor: 3600 },
    paypalEmail: "lena.novak@crew.example",
    color: "#D1495B",
    maxHours: 40,
    blurb: "Bar & hosting",
  },
];

type SeedShift = Omit<Shift, "workerId" | "status" | "payMinor">;
const S = (id: string, eventName: string, venue: string, role: Shift["role"], start: string, end: string): SeedShift => ({
  id,
  eventName,
  venue,
  role,
  start,
  end,
});

export const SHIFTS: SeedShift[] = [
  S("s01", "Brightwater Tech Summit", "Palmer Events Center", "setup", "2026-11-09T07:00", "2026-11-09T13:00"),
  S("s02", "Brightwater Tech Summit", "Palmer Events Center", "setup", "2026-11-09T07:00", "2026-11-09T13:00"),
  S("s03", "Brightwater Tech Summit", "Palmer Events Center", "server", "2026-11-09T11:00", "2026-11-09T17:00"),
  S("s04", "Brightwater Tech Summit", "Palmer Events Center", "server", "2026-11-10T08:00", "2026-11-10T14:00"),
  S("s05", "Summit Reception", "Palmer Events Center", "bartender", "2026-11-10T17:00", "2026-11-10T23:00"),
  S("s06", "Summit Reception", "Palmer Events Center", "server", "2026-11-10T17:00", "2026-11-10T23:00"),
  S("s07", "Brightwater Tech Summit", "Palmer Events Center", "host", "2026-11-11T08:00", "2026-11-11T16:00"),
  S("s08", "Summit Teardown", "Palmer Events Center", "setup", "2026-11-11T12:00", "2026-11-11T18:00"),
  S("s09", "Harbor Lights Gala: setup", "Lakeshore Pavilion", "setup", "2026-11-12T09:00", "2026-11-12T15:00"),
  S("s10", "Kessler & Co. Client Dinner", "The Larkspur Room", "bartender", "2026-11-12T18:00", "2026-11-12T23:30"),
  S("s11", "Harbor Lights Gala", "Lakeshore Pavilion", "bartender", "2026-11-13T16:00", "2026-11-13T23:30"),
  S("s12", "Harbor Lights Gala", "Lakeshore Pavilion", "server", "2026-11-13T16:00", "2026-11-13T23:30"),
  S("s13", "Harbor Lights Gala", "Lakeshore Pavilion", "server", "2026-11-13T16:00", "2026-11-13T23:30"),
  S("s14", "Okafor–Lindqvist Wedding", "Laurel Hill Barn", "bartender", "2026-11-14T13:00", "2026-11-14T23:00"),
  S("s15", "Okafor–Lindqvist Wedding", "Laurel Hill Barn", "server", "2026-11-14T13:00", "2026-11-14T23:00"),
  S("s16", "Okafor–Lindqvist Wedding", "Laurel Hill Barn", "host", "2026-11-14T13:00", "2026-11-14T23:00"),
  S("s17", "Riverside Market Pop-up", "Riverside Green", "setup", "2026-11-15T06:00", "2026-11-15T12:00"),
  S("s18", "Riverside Market Pop-up", "Riverside Green", "server", "2026-11-15T08:00", "2026-11-15T14:00"),
];

/** Six messy Monday-morning messages that become the week's constraints. */
export const MONDAY_MESSAGES: Message[] = [
  {
    id: "m01",
    workerId: "w_maya",
    body: "hey!! cant do sat at all (sisters wedding lol) but tues eve + wed all day r good. fri night fine too",
    receivedAt: "2026-11-08T18:12",
    processedAt: null,
    summary: null,
  },
  {
    id: "m02",
    workerId: "w_diego",
    body: "Morning. I can do mornings Mon to Wed, Thursday is out (kids thing). Friday I'm free from 3",
    receivedAt: "2026-11-08T19:03",
    processedAt: null,
    summary: null,
  },
  {
    id: "m03",
    workerId: "w_priya",
    body: "free basically whenever except fri before 2pm. happy to host the summit wed if u need me!",
    receivedAt: "2026-11-08T19:41",
    processedAt: null,
    summary: null,
  },
  {
    id: "m04",
    workerId: "w_sam",
    body: "can take tues eve. not sunday tho. max 20 hrs this wk pls, exams",
    receivedAt: "2026-11-08T20:26",
    processedAt: null,
    summary: null,
  },
  {
    id: "m05",
    workerId: "w_jonah",
    body: "dentist thurs morning till 11 so cant do the thurs setup, sorry. mon setup works and id love a sat bar shift",
    receivedAt: "2026-11-08T21:15",
    processedAt: null,
    summary: null,
  },
  {
    id: "m06",
    workerId: "w_lena",
    body: "around wed thru sun! prefer bar work if theres any going. nothing before 10am on the weekend pls",
    receivedAt: "2026-11-09T05:48",
    processedAt: null,
    summary: null,
  },
];

/** Arrives when the demo clock reaches Friday morning. */
export const SICK_CALL: Message = {
  id: "m07",
  workerId: "w_diego",
  body: "so sorry, woke up with a fever 🤒 can't make tonight's gala. really sorry",
  receivedAt: "2026-11-13T07:12",
  processedAt: null,
  summary: null,
};

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "monday",
    at: "2026-11-09T06:00",
    label: "Mon 06:00 · Build the week",
    hint: "Six messages are in. Let the agent build the rota.",
  },
  {
    id: "friday",
    at: "2026-11-13T07:30",
    label: "Fri 07:30 · Sick call",
    hint: "Mon–Thu are done and paid. Diego just called in sick for tonight.",
  },
  {
    id: "gala-ends",
    at: "2026-11-13T23:45",
    label: "Fri 23:45 · Gala wraps",
    hint: "The gala crew has clocked out. Approve their hours to pay them now.",
  },
];
