import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS, DEMO_STEPS, MONDAY_MESSAGES, SHIFTS, WORKERS } from "./seed";

const DB_PATH = process.env.CLOCKOUT_DB || path.join(process.cwd(), "data", "clockout.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS business (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, sort INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY, event_name TEXT NOT NULL, venue TEXT NOT NULL, role TEXT NOT NULL,
  start TEXT NOT NULL, end TEXT NOT NULL, worker_id TEXT, status TEXT NOT NULL, pay_minor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS constraints_ (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, message_id TEXT, kind TEXT NOT NULL,
  start TEXT, end TEXT, hours REAL, role TEXT, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, body TEXT NOT NULL, received_at TEXT NOT NULL,
  processed_at TEXT, summary TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
  shift_id TEXT, worker_id TEXT, message_id TEXT, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_batches (
  id TEXT PRIMARY KEY, sender_batch_id TEXT NOT NULL UNIQUE, paypal_batch_id TEXT, status TEXT NOT NULL,
  total_minor INTEGER NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL, mode TEXT NOT NULL, label TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, shift_id TEXT NOT NULL, worker_id TEXT NOT NULL,
  sender_item_id TEXT NOT NULL, paypal_item_id TEXT, transaction_id TEXT, receiver TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
-- Survives demo resets so repeated runs do not spend AI quota.
CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
-- Mock PayPal's own state, so the mock behaves like a remote service across requests.
CREATE TABLE IF NOT EXISTS mock_paypal (id TEXT PRIMARY KEY, json TEXT NOT NULL);
`;

const RESETTABLE = [
  "business",
  "settings",
  "workers",
  "shifts",
  "constraints_",
  "messages",
  "actions",
  "payout_batches",
  "payout_items",
  "mock_paypal",
];

declare global {
  var __clockoutDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (!globalThis.__clockoutDb) {
    if (DB_PATH !== ":memory:") fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const conn = new Database(DB_PATH);
    conn.pragma("journal_mode = WAL");
    conn.exec(SCHEMA);
    globalThis.__clockoutDb = conn;
    const seeded = conn.prepare("SELECT 1 FROM business LIMIT 1").get();
    if (!seeded) seed(conn);
  }
  return globalThis.__clockoutDb;
}

export function seed(conn: Database.Database = db()) {
  const tx = conn.transaction(() => {
    for (const t of RESETTABLE) conn.exec(`DELETE FROM ${t}`);
    conn.exec("DELETE FROM sqlite_sequence WHERE name = 'actions'");
    conn.prepare("INSERT INTO business (id, json) VALUES (?, ?)").run(BUSINESS.id, JSON.stringify(BUSINESS));
    const setting = conn.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    setting.run("now", DEMO_STEPS[0].at);
    setting.run("step", "0");
    const w = conn.prepare("INSERT INTO workers (id, sort, json) VALUES (?, ?, ?)");
    WORKERS.forEach((worker, i) => w.run(worker.id, i, JSON.stringify(worker)));
    const s = conn.prepare(
      "INSERT INTO shifts (id, event_name, venue, role, start, end, worker_id, status, pay_minor) VALUES (?, ?, ?, ?, ?, ?, NULL, 'open', 0)",
    );
    for (const shift of SHIFTS) s.run(shift.id, shift.eventName, shift.venue, shift.role, shift.start, shift.end);
    const m = conn.prepare(
      "INSERT INTO messages (id, worker_id, body, received_at, processed_at, summary) VALUES (?, ?, ?, ?, NULL, NULL)",
    );
    for (const msg of MONDAY_MESSAGES) m.run(msg.id, msg.workerId, msg.body, msg.receivedAt);
    conn
      .prepare(
        "INSERT INTO actions (at, kind, text, shift_id, worker_id, message_id, source) VALUES (?, 'clock', ?, NULL, NULL, NULL, 'system')",
      )
      .run(DEMO_STEPS[0].at, "Demo ready: 18 open shifts across 5 events, 6 messages waiting.");
  });
  tx();
}
