import type { Rates } from "./money";
import type { ShiftStatus } from "./shiftState";
import type { Wall } from "./time";

export const ROLES = ["bartender", "server", "setup", "host"] as const;
export type Role = (typeof ROLES)[number];

export interface Business {
  id: string;
  name: string;
  city: string;
  currency: string;
  weekStart: Wall;
  weeklyBudgetMinor: number;
}

export interface Worker {
  id: string;
  name: string;
  initials: string;
  roles: Role[];
  rates: Rates;
  paypalEmail: string;
  color: string;
  maxHours: number;
  blurb: string;
}

export interface Shift {
  id: string;
  eventName: string;
  venue: string;
  role: Role;
  start: Wall;
  end: Wall;
  workerId: string | null;
  status: ShiftStatus;
  /** Pay at the assigned worker's agreed rates (0 when open). */
  payMinor: number;
}

export type ConstraintKind = "unavailable" | "preferred" | "max_hours" | "preferred_role";

export interface Constraint {
  id: string;
  workerId: string;
  messageId: string | null;
  kind: ConstraintKind;
  start: Wall | null;
  end: Wall | null;
  hours: number | null;
  role: Role | null;
  note: string;
}

export interface Message {
  id: string;
  workerId: string;
  body: string;
  receivedAt: Wall;
  processedAt: Wall | null;
  summary: string | null;
}

export type AgentActionKind = "read" | "assign" | "unassign" | "swap" | "reject" | "summary" | "payout" | "clock";
export type AgentSource = "gemini" | "recorded" | "guardrail" | "owner" | "system";

export interface AgentAction {
  id: number;
  at: Wall;
  kind: AgentActionKind;
  text: string;
  shiftId: string | null;
  workerId: string | null;
  messageId: string | null;
  source: AgentSource;
}

export interface PayoutBatch {
  id: string;
  senderBatchId: string;
  paypalBatchId: string | null;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: Wall;
  mode: "live" | "mock";
  label: string;
}

export interface PayoutItem {
  id: string;
  batchId: string;
  shiftId: string;
  workerId: string;
  senderItemId: string;
  paypalItemId: string | null;
  transactionId: string | null;
  receiver: string;
  amountMinor: number;
  currency: string;
  status: string;
  error: string | null;
  attempt: number;
  updatedAt: string;
}

export interface ServiceStatus {
  ai: { mode: "live" | "recorded"; model: string | null; detail: string };
  paypal: { mode: "live" | "mock"; detail: string };
  bryntum: { mode: "trial"; detail: string };
}

export interface DemoStep {
  id: string;
  at: Wall;
  label: string;
  hint: string;
}

export interface AppState {
  business: Business;
  now: Wall;
  step: number;
  steps: DemoStep[];
  workers: Worker[];
  shifts: Shift[];
  constraints: Constraint[];
  messages: Message[];
  actions: AgentAction[];
  batches: PayoutBatch[];
  items: PayoutItem[];
  status: ServiceStatus;
}
