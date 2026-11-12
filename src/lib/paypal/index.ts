import { LivePayouts } from "./live";
import { MockPayouts } from "./mock";
import type { PayoutsAdapter } from "./types";

/**
 * Live when PAYPAL_CLIENT_ID/SECRET are set and the sandbox issues a token; otherwise mock.
 * If the sandbox refuses Payouts for this account, we drop to mock and say why in the status chip.
 */
interface PayPalState {
  adapter: PayoutsAdapter;
  detail: string;
  probed: boolean;
}

declare global {
  var __clockoutPayPal: PayPalState | undefined;
}

function initial(): PayPalState {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (process.env.CLOCKOUT_FORCE_MOCK === "1" || !id || !secret) {
    return { adapter: new MockPayouts(), detail: id && secret ? "Mock (forced)" : "Mock: no PayPal keys set", probed: true };
  }
  return { adapter: new LivePayouts(id, secret), detail: "Sandbox", probed: false };
}

export async function payouts(): Promise<PayoutsAdapter> {
  if (!globalThis.__clockoutPayPal) globalThis.__clockoutPayPal = initial();
  const st = globalThis.__clockoutPayPal;
  if (!st.probed && st.adapter instanceof LivePayouts) {
    st.probed = true;
    try {
      await st.adapter.accessToken();
      st.detail = "PayPal Sandbox";
    } catch (e) {
      globalThis.__clockoutPayPal = {
        adapter: new MockPayouts(),
        detail: `Mock: sandbox unreachable (${(e as Error).message.slice(0, 60)})`,
        probed: true,
      };
    }
  }
  return globalThis.__clockoutPayPal!.adapter;
}

export function fallBackToMock(reason: string) {
  globalThis.__clockoutPayPal = { adapter: new MockPayouts(), detail: `Mock: ${reason}`, probed: true };
}

export function paypalStatus(): { mode: "live" | "mock"; detail: string } {
  const st = globalThis.__clockoutPayPal ?? initial();
  return { mode: st.adapter.mode, detail: st.detail };
}

/**
 * Who actually receives a payout in live sandbox mode. The seeded workers' emails are
 * fictional, and PayPal holds money sent to an address with no account as UNCLAIMED.
 * So live payouts go to real sandbox *personal* accounts taken from the environment:
 *   - SANDBOX_RECEIVER_<FIRSTNAME> pays that worker (SANDBOX_RECEIVER_SAM pays Sam);
 *   - everyone else is spread across the SANDBOX_RECEIVER_* accounts, in crew order;
 *   - PAYPAL_SANDBOX_RECEIVER_EMAIL is used only when no SANDBOX_RECEIVER_* is set.
 * A deliberately typo'd address is always kept as-is, so the unclaimed flow is real too.
 */
export function sandboxReceivers(env: Record<string, string | undefined> = process.env): {
  byName: Record<string, string>;
  pool: string[];
} {
  const byName: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^SANDBOX_RECEIVER_([A-Z]+)$/.exec(k);
    if (m && v?.trim()) byName[m[1]] = v.trim();
  }
  // PAYPAL_SANDBOX_RECEIVER_EMAIL is only a fallback: it is ignored as soon as any SANDBOX_RECEIVER_* is set.
  const named = [
    ...new Set(
      Object.keys(byName)
        .sort()
        .map((k) => byName[k]),
    ),
  ];
  const extra = env.PAYPAL_SANDBOX_RECEIVER_EMAIL?.trim();
  const pool = named.length ? named : extra ? [extra] : [];
  return { byName, pool };
}

export function receiverFor(
  worker: { name: string; paypalEmail: string },
  workerIndex: number,
  mode: "live" | "mock",
  looksBad: boolean,
  env: Record<string, string | undefined> = process.env,
): string {
  if (mode !== "live" || looksBad) return worker.paypalEmail;
  const { byName, pool } = sandboxReceivers(env);
  const first = worker.name.split(" ")[0].toUpperCase();
  if (byName[first]) return byName[first];
  return pool.length ? pool[workerIndex % pool.length] : worker.paypalEmail;
}
