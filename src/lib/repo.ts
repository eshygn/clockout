import { db } from "./db";
import { payForShift } from "./money";
import { transition, type ShiftAction, type ShiftStatus } from "./shiftState";
import type {
  AgentAction,
  AgentActionKind,
  AgentSource,
  Business,
  Constraint,
  Message,
  PayoutBatch,
  PayoutItem,
  Shift,
  Worker,
} from "./types";

type Row = Record<string, unknown>;

export function getBusiness(): Business {
  const row = db().prepare("SELECT json FROM business LIMIT 1").get() as { json: string };
  return JSON.parse(row.json);
}

export function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function now(): string {
  return getSetting("now")!;
}

export function getWorkers(): Worker[] {
  return (db().prepare("SELECT json FROM workers ORDER BY sort").all() as { json: string }[]).map((r) => JSON.parse(r.json));
}

export function getWorker(id: string): Worker | undefined {
  const row = db().prepare("SELECT json FROM workers WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : undefined;
}

export function updateWorker(worker: Worker) {
  db().prepare("UPDATE workers SET json = ? WHERE id = ?").run(JSON.stringify(worker), worker.id);
}

const shiftFrom = (r: Row): Shift => ({
  id: r.id as string,
  eventName: r.event_name as string,
  venue: r.venue as string,
  role: r.role as Shift["role"],
  start: r.start as string,
  end: r.end as string,
  workerId: (r.worker_id as string) ?? null,
  status: r.status as ShiftStatus,
  payMinor: r.pay_minor as number,
});

export function getShifts(): Shift[] {
  return (db().prepare("SELECT * FROM shifts ORDER BY start, id").all() as Row[]).map(shiftFrom);
}

export function getShift(id: string): Shift | undefined {
  const r = db().prepare("SELECT * FROM shifts WHERE id = ?").get(id) as Row | undefined;
  return r ? shiftFrom(r) : undefined;
}

/** Recomputes pay from the assigned worker's agreed rates on every write. */
export function saveShift(shift: Shift) {
  const worker = shift.workerId ? getWorker(shift.workerId) : undefined;
  const pay = worker ? payForShift(shift.start, shift.end, worker.rates).totalMinor : 0;
  db()
    .prepare("UPDATE shifts SET start = ?, end = ?, worker_id = ?, status = ?, pay_minor = ? WHERE id = ?")
    .run(shift.start, shift.end, shift.workerId, shift.status, pay, shift.id);
  return { ...shift, payMinor: pay };
}

export function applyTransition(shiftId: string, action: ShiftAction, patch: Partial<Shift> = {}): Shift {
  const shift = getShift(shiftId);
  if (!shift) throw new Error(`No shift ${shiftId}`);
  const status = transition(shift.status, action);
  return saveShift({ ...shift, ...patch, status });
}

const constraintFrom = (r: Row): Constraint => ({
  id: r.id as string,
  workerId: r.worker_id as string,
  messageId: (r.message_id as string) ?? null,
  kind: r.kind as Constraint["kind"],
  start: (r.start as string) ?? null,
  end: (r.end as string) ?? null,
  hours: (r.hours as number) ?? null,
  role: (r.role as Constraint["role"]) ?? null,
  note: r.note as string,
});

export function getConstraints(): Constraint[] {
  return (db().prepare("SELECT * FROM constraints_ ORDER BY id").all() as Row[]).map(constraintFrom);
}

export function addConstraint(c: Constraint) {
  db()
    .prepare(
      "INSERT OR REPLACE INTO constraints_ (id, worker_id, message_id, kind, start, end, hours, role, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(c.id, c.workerId, c.messageId, c.kind, c.start, c.end, c.hours, c.role, c.note);
}

export function deleteConstraintsForMessage(messageId: string) {
  db().prepare("DELETE FROM constraints_ WHERE message_id = ?").run(messageId);
}

const messageFrom = (r: Row): Message => ({
  id: r.id as string,
  workerId: r.worker_id as string,
  body: r.body as string,
  receivedAt: r.received_at as string,
  processedAt: (r.processed_at as string) ?? null,
  summary: (r.summary as string) ?? null,
});

export function getMessages(): Message[] {
  return (db().prepare("SELECT * FROM messages ORDER BY received_at, id").all() as Row[]).map(messageFrom);
}

export function addMessage(m: Message) {
  db()
    .prepare("INSERT OR IGNORE INTO messages (id, worker_id, body, received_at, processed_at, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .run(m.id, m.workerId, m.body, m.receivedAt, m.processedAt, m.summary);
}

export function markMessageProcessed(id: string, summary: string) {
  db().prepare("UPDATE messages SET processed_at = ?, summary = ? WHERE id = ?").run(now(), summary, id);
}

export function logAction(
  kind: AgentActionKind,
  text: string,
  source: AgentSource,
  refs: { shiftId?: string | null; workerId?: string | null; messageId?: string | null } = {},
) {
  db()
    .prepare("INSERT INTO actions (at, kind, text, shift_id, worker_id, message_id, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(now(), kind, text, refs.shiftId ?? null, refs.workerId ?? null, refs.messageId ?? null, source);
}

export function getActions(): AgentAction[] {
  return (db().prepare("SELECT * FROM actions ORDER BY id DESC LIMIT 200").all() as Row[]).map((r) => ({
    id: r.id as number,
    at: r.at as string,
    kind: r.kind as AgentActionKind,
    text: r.text as string,
    shiftId: (r.shift_id as string) ?? null,
    workerId: (r.worker_id as string) ?? null,
    messageId: (r.message_id as string) ?? null,
    source: r.source as AgentSource,
  }));
}

const batchFrom = (r: Row): PayoutBatch => ({
  id: r.id as string,
  senderBatchId: r.sender_batch_id as string,
  paypalBatchId: (r.paypal_batch_id as string) ?? null,
  status: r.status as string,
  totalMinor: r.total_minor as number,
  currency: r.currency as string,
  createdAt: r.created_at as string,
  mode: r.mode as PayoutBatch["mode"],
  label: r.label as string,
});

export function getBatches(): PayoutBatch[] {
  return (db().prepare("SELECT * FROM payout_batches ORDER BY created_at DESC, rowid DESC").all() as Row[]).map(batchFrom);
}

export function insertBatch(b: PayoutBatch) {
  db()
    .prepare(
      "INSERT INTO payout_batches (id, sender_batch_id, paypal_batch_id, status, total_minor, currency, created_at, mode, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(b.id, b.senderBatchId, b.paypalBatchId, b.status, b.totalMinor, b.currency, b.createdAt, b.mode, b.label);
}

export function updateBatch(id: string, patch: { paypalBatchId?: string | null; status?: string }) {
  const row = db().prepare("SELECT * FROM payout_batches WHERE id = ?").get(id) as Row | undefined;
  if (!row) return;
  const cur = batchFrom(row);
  db()
    .prepare("UPDATE payout_batches SET paypal_batch_id = ?, status = ? WHERE id = ?")
    .run(patch.paypalBatchId ?? cur.paypalBatchId, patch.status ?? cur.status, id);
}

const itemFrom = (r: Row): PayoutItem => ({
  id: r.id as string,
  batchId: r.batch_id as string,
  shiftId: r.shift_id as string,
  workerId: r.worker_id as string,
  senderItemId: r.sender_item_id as string,
  paypalItemId: (r.paypal_item_id as string) ?? null,
  transactionId: (r.transaction_id as string) ?? null,
  receiver: r.receiver as string,
  amountMinor: r.amount_minor as number,
  currency: r.currency as string,
  status: r.status as string,
  error: (r.error as string) ?? null,
  attempt: r.attempt as number,
  updatedAt: r.updated_at as string,
});

export function getItems(): PayoutItem[] {
  return (db().prepare("SELECT * FROM payout_items ORDER BY rowid").all() as Row[]).map(itemFrom);
}

export function getItem(id: string): PayoutItem | undefined {
  const r = db().prepare("SELECT * FROM payout_items WHERE id = ?").get(id) as Row | undefined;
  return r ? itemFrom(r) : undefined;
}

export function insertItem(i: PayoutItem) {
  db()
    .prepare(
      "INSERT INTO payout_items (id, batch_id, shift_id, worker_id, sender_item_id, paypal_item_id, transaction_id, receiver, amount_minor, currency, status, error, attempt, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      i.id,
      i.batchId,
      i.shiftId,
      i.workerId,
      i.senderItemId,
      i.paypalItemId,
      i.transactionId,
      i.receiver,
      i.amountMinor,
      i.currency,
      i.status,
      i.error,
      i.attempt,
      i.updatedAt,
    );
}

export function updateItem(id: string, patch: Partial<Pick<PayoutItem, "paypalItemId" | "transactionId" | "status" | "error">>) {
  const cur = getItem(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  db()
    .prepare("UPDATE payout_items SET paypal_item_id = ?, transaction_id = ?, status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(next.paypalItemId, next.transactionId, next.status, next.error, new Date().toISOString(), id);
}

export function inTransaction<T>(fn: () => T): T {
  return db().transaction(fn)();
}
