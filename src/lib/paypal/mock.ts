import { db } from "../db";
import { fromDecimalString, sumMinor, toDecimalString } from "../money";
import type { CreatePayoutRequest, CreatePayoutResponse, PayoutBatchDetail, PayoutItemDetail, PayoutsAdapter } from "./types";
import { PayPalApiError } from "./types";

/**
 * A stand-in for the PayPal sandbox that behaves like it: batches start PENDING,
 * settle a moment later, and an address PayPal has no account for comes back
 * UNCLAIMED (as the real sandbox does for unknown emails). State lives in SQLite.
 */
const BASE = "https://api-m.sandbox.paypal.com";
const SETTLE_MS = Number(process.env.CLOCKOUT_MOCK_SETTLE_MS ?? 1800);

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function pid(len: number, seed: string): string {
  // Deterministic, PayPal-looking ids derived from our own ids.
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < len; i++) {
    h = Math.imul(h ^ (h >>> 13), 1597334677) >>> 0;
    out += ALPHA[h % ALPHA.length];
  }
  return out;
}

/** Addresses PayPal will not have an account for (typo'd domains, .invalid). */
export function looksUnregistered(email: string): boolean {
  return /@(gmial|gmal|gamil|hotmial|yaho)\.|\.invalid$/i.test(email);
}

interface Stored {
  created_ms: number;
  request: CreatePayoutRequest;
  batch_id: string;
  cancelled: string[];
}

function load(id: string): Stored | undefined {
  const row = db().prepare("SELECT json FROM mock_paypal WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : undefined;
}
function store(s: Stored) {
  db().prepare("INSERT OR REPLACE INTO mock_paypal (id, json) VALUES (?, ?)").run(s.batch_id, JSON.stringify(s));
}

function render(s: Stored): PayoutBatchDetail {
  const settled = Date.now() - s.created_ms >= SETTLE_MS;
  const currency = s.request.items[0]?.amount.currency ?? "USD";
  const created = new Date(s.created_ms).toISOString().replace(/\.\d+Z$/, "Z");
  const items: PayoutItemDetail[] = s.request.items.map((it, idx) => {
    const itemId = pid(13, `${s.batch_id}:${idx}`);
    let status = "PENDING";
    if (settled) status = looksUnregistered(it.receiver) ? "UNCLAIMED" : "SUCCESS";
    if (s.cancelled.includes(itemId)) status = "RETURNED";
    const detail: PayoutItemDetail = {
      payout_item_id: itemId,
      transaction_status: status,
      payout_item_fee: { currency, value: "0.00" },
      payout_batch_id: s.batch_id,
      payout_item: {
        recipient_type: it.recipient_type,
        amount: it.amount,
        note: it.note,
        receiver: it.receiver,
        sender_item_id: it.sender_item_id,
        recipient_wallet: it.recipient_wallet ?? "PAYPAL",
      },
      links: [{ href: `${BASE}/v1/payments/payouts-item/${itemId}`, rel: "item", method: "GET", encType: "application/json" }],
    };
    if (status !== "PENDING") {
      detail.transaction_id = pid(17, `tx:${itemId}`);
      detail.activity_id = pid(17, `act:${itemId}`);
      detail.time_processed = new Date(s.created_ms + SETTLE_MS).toISOString().replace(/\.\d+Z$/, "Z");
    }
    if (status === "UNCLAIMED") {
      detail.errors = {
        name: "RECEIVER_UNREGISTERED",
        message: "Receiver is unregistered",
        information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors",
      };
    }
    return detail;
  });
  const total = sumMinor(s.request.items.map((i) => fromDecimalString(i.amount.value, currency)));
  return {
    batch_header: {
      payout_batch_id: s.batch_id,
      batch_status: settled ? "SUCCESS" : "PENDING",
      time_created: created,
      ...(settled ? { time_completed: new Date(s.created_ms + SETTLE_MS).toISOString().replace(/\.\d+Z$/, "Z") } : {}),
      sender_batch_header: s.request.sender_batch_header,
      funding_source: "BALANCE",
      amount: { currency, value: toDecimalString(total, currency) },
      fees: { currency, value: "0.00" },
    },
    items,
    links: [
      { href: `${BASE}/v1/payments/payouts/${s.batch_id}?page_size=1000&page=1`, rel: "self", method: "GET", encType: "application/json" },
    ],
  };
}

export class MockPayouts implements PayoutsAdapter {
  readonly mode = "mock" as const;

  async createBatch(req: CreatePayoutRequest): Promise<CreatePayoutResponse> {
    const existing = db().prepare("SELECT json FROM mock_paypal").all() as { json: string }[];
    if (
      existing.some(
        (r) => (JSON.parse(r.json) as Stored).request.sender_batch_header.sender_batch_id === req.sender_batch_header.sender_batch_id,
      )
    ) {
      throw new PayPalApiError(400, {
        name: "USER_BUSINESS_ERROR",
        message: "User business error.",
        details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists" }],
      });
    }
    const batch_id = pid(13, req.sender_batch_header.sender_batch_id);
    store({ created_ms: Date.now(), request: req, batch_id, cancelled: [] });
    return {
      batch_header: { payout_batch_id: batch_id, batch_status: "PENDING", sender_batch_header: req.sender_batch_header },
      links: [{ href: `${BASE}/v1/payments/payouts/${batch_id}`, rel: "self", method: "GET", encType: "application/json" }],
    };
  }

  async getBatch(id: string): Promise<PayoutBatchDetail> {
    const s = load(id);
    if (!s) throw new PayPalApiError(404, { name: "INVALID_RESOURCE_ID", message: "Requested resource ID was not found." });
    return render(s);
  }

  async getItem(itemId: string): Promise<PayoutItemDetail> {
    const rows = db().prepare("SELECT json FROM mock_paypal").all() as { json: string }[];
    for (const r of rows) {
      const found = render(JSON.parse(r.json)).items.find((i) => i.payout_item_id === itemId);
      if (found) return found;
    }
    throw new PayPalApiError(404, { name: "INVALID_RESOURCE_ID", message: "Requested resource ID was not found." });
  }

  async cancelItem(itemId: string): Promise<PayoutItemDetail> {
    const item = await this.getItem(itemId);
    if (item.transaction_status !== "UNCLAIMED") {
      throw new PayPalApiError(400, { name: "ITEM_CANCELLATION_FAILED", message: "Only unclaimed items can be cancelled." });
    }
    const s = load(item.payout_batch_id)!;
    s.cancelled.push(itemId);
    store(s);
    return render(s).items.find((i) => i.payout_item_id === itemId)!;
  }
}
