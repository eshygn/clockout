import crypto from "node:crypto";
import { formatMoney, sumMinor, toDecimalString } from "./money";
import { fallBackToMock, payouts, receiverFor } from "./paypal";
import { looksUnregistered } from "./paypal/mock";
import { PayPalApiError, type CreatePayoutRequest } from "./paypal/types";
import { describeItemStatus, isTerminalBatch, needsCancelBeforeRetry, outcomeOf } from "./payoutState";
import {
  applyTransition,
  getBatches,
  getBusiness,
  getItem,
  getItems,
  getShift,
  getWorker,
  inTransaction,
  insertBatch,
  insertItem,
  logAction,
  now,
  updateBatch,
  updateItem,
  updateWorker,
} from "./repo";
import { formatRange } from "./time";
import type { PayoutItem, Shift } from "./types";

const shortId = () => crypto.randomBytes(4).toString("hex");

interface Line {
  shift: Shift;
  attempt: number;
}

/** Creates one PayPal Payouts batch for the given approved/failed shifts. */
async function sendBatch(lines: Line[], label: string) {
  const biz = getBusiness();
  let adapter = await payouts();
  const batchId = `pb_${shortId()}`;
  // sender_batch_id is unique per send; PayPal rejects a duplicate, so a double-click can never pay twice.
  const senderBatchId = `clockout-${now().slice(0, 10)}-${shortId()}`;
  const items: PayoutItem[] = lines.map(({ shift, attempt }) => {
    const worker = getWorker(shift.workerId!)!;
    return {
      id: `pi_${shortId()}`,
      batchId,
      shiftId: shift.id,
      workerId: worker.id,
      senderItemId: `${shift.id}-a${attempt}`,
      paypalItemId: null,
      transactionId: null,
      receiver: receiverFor(worker.paypalEmail, adapter.mode, looksUnregistered(worker.paypalEmail)),
      amountMinor: shift.payMinor,
      currency: biz.currency,
      status: "PENDING",
      error: null,
      attempt,
      updatedAt: new Date().toISOString(),
    };
  });
  const request = (): CreatePayoutRequest => ({
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      recipient_type: "EMAIL",
      email_subject: `${biz.name} paid you`,
      email_message: "Thanks for your shift. This payment is for the hours your crew lead approved.",
    },
    items: items.map((i) => {
      const s = getShift(i.shiftId)!;
      return {
        recipient_type: "EMAIL",
        receiver: i.receiver,
        sender_item_id: i.senderItemId,
        recipient_wallet: "PAYPAL",
        amount: { currency: i.currency, value: toDecimalString(i.amountMinor, i.currency) },
        note: `${s.eventName}, ${s.role}, ${formatRange(s.start, s.end)}`,
      };
    }),
  });

  let res;
  try {
    res = await adapter.createBatch(request());
  } catch (e) {
    // Sandbox account without Payouts permission, or the host is unreachable: degrade to mock, say so.
    const status = e instanceof PayPalApiError ? e.status : 0;
    if (adapter.mode === "live" && (status === 0 || status === 401 || status === 403)) {
      fallBackToMock(`live Payouts refused (${(e as Error).message.slice(0, 50)})`);
      adapter = await payouts();
      for (const i of items) i.receiver = getWorker(i.workerId)!.paypalEmail;
      res = await adapter.createBatch(request());
    } else {
      throw e;
    }
  }

  const total = sumMinor(items.map((i) => i.amountMinor));
  inTransaction(() => {
    insertBatch({
      id: batchId,
      senderBatchId,
      paypalBatchId: res.batch_header.payout_batch_id,
      status: res.batch_header.batch_status,
      totalMinor: total,
      currency: biz.currency,
      createdAt: now(),
      mode: adapter.mode,
      label,
    });
    for (const i of items) insertItem(i);
  });
  logAction(
    "payout",
    `Sent PayPal payout batch ${res.batch_header.payout_batch_id}: ${items.length} worker${items.length > 1 ? "s" : ""}, ${formatMoney(total, biz.currency)}.`,
    "system",
  );
  return { batchId, paypalBatchId: res.batch_header.payout_batch_id, total, count: items.length };
}

/** Owner approves hours → shifts move approved → paying, and one batch goes to PayPal. */
export async function approveAndPay(shiftIds: string[], label = "Approved hours") {
  const lines: Line[] = [];
  inTransaction(() => {
    for (const id of shiftIds) {
      const s = getShift(id);
      if (!s || !s.workerId) continue;
      if (s.status === "completed") applyTransition(id, "approve");
      const approved = getShift(id)!;
      if (approved.status !== "approved") continue;
      lines.push({ shift: applyTransition(id, "send"), attempt: 1 });
    }
  });
  if (!lines.length) return null;
  try {
    return await sendBatch(lines, label);
  } catch (e) {
    inTransaction(() => {
      for (const l of lines) applyTransition(l.shift.id, "payout_failed");
    });
    logAction("payout", `PayPal rejected the batch: ${(e as Error).message}`, "system");
    throw e;
  }
}

/** Polls PayPal for every batch that is not settled and moves shifts to paid / failed. */
export async function refreshPayouts() {
  const adapter = await payouts();
  const items = getItems();
  const open = getBatches().filter(
    (b) => b.paypalBatchId && b.mode === adapter.mode && (!isTerminalBatch(b.status) || items.some((i) => i.batchId === b.id && i.status === "PENDING")),
  );
  let changed = 0;
  for (const b of open) {
    const detail = await adapter.getBatch(b.paypalBatchId!);
    inTransaction(() => {
      updateBatch(b.id, { status: detail.batch_header.batch_status });
      for (const d of detail.items) {
        const mine = items.find((i) => i.batchId === b.id && i.senderItemId === d.payout_item.sender_item_id);
        if (!mine || mine.status === d.transaction_status) continue;
        changed++;
        updateItem(mine.id, {
          paypalItemId: d.payout_item_id,
          transactionId: d.transaction_id ?? null,
          status: d.transaction_status,
          error: d.errors ? `${d.errors.name}: ${d.errors.message}` : null,
        });
        const shift = getShift(mine.shiftId)!;
        const worker = getWorker(mine.workerId)!;
        const outcome = outcomeOf(d.transaction_status);
        if (outcome === "paid" && shift.status === "paying") {
          applyTransition(shift.id, "payout_succeeded");
          logAction("payout", `Paid ${worker.name.split(" ")[0]} ${formatMoney(mine.amountMinor, mine.currency)} for ${shift.eventName}.`, "system", {
            shiftId: shift.id,
            workerId: worker.id,
          });
        } else if (outcome === "needs_attention" && shift.status === "paying") {
          applyTransition(shift.id, "payout_failed");
          logAction(
            "payout",
            `${worker.name.split(" ")[0]}'s payout needs attention: ${describeItemStatus(d.transaction_status)} (${mine.receiver}).`,
            "system",
            { shiftId: shift.id, workerId: worker.id },
          );
        }
      }
    });
  }
  return { changed, pending: getItems().some((i) => i.status === "PENDING") };
}

/** Retry a failed or unclaimed payout, optionally to a corrected PayPal email. */
export async function retryPayout(itemId: string, newEmail?: string) {
  const item = getItem(itemId);
  if (!item) throw new Error("No such payout");
  if (outcomeOf(item.status) !== "needs_attention") throw new Error(`Payout is ${item.status}; nothing to retry`);
  const adapter = await payouts();
  if (needsCancelBeforeRetry(item.status) && item.paypalItemId) {
    // Unclaimed money is still out with PayPal: cancel it first so it returns before we resend.
    const cancelled = await adapter.cancelItem(item.paypalItemId);
    updateItem(item.id, { status: cancelled.transaction_status, error: "Cancelled and re-sent" });
  } else {
    updateItem(item.id, { error: `${item.error ?? item.status}; re-sent` });
  }
  if (newEmail) {
    const w = getWorker(item.workerId)!;
    updateWorker({ ...w, paypalEmail: newEmail.trim() });
    logAction("payout", `Updated ${w.name.split(" ")[0]}'s PayPal email to ${newEmail.trim()}.`, "owner", { workerId: w.id });
  }
  const shift = applyTransition(item.shiftId, "retry");
  const attempts = getItems().filter((i) => i.shiftId === item.shiftId).length;
  return sendBatch([{ shift, attempt: attempts + 1 }], "Retry");
}
