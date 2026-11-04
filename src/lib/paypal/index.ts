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
 * So when PAYPAL_SANDBOX_RECEIVER_EMAIL (a sandbox *personal* account) is set, every
 * worker is paid there and payouts settle as SUCCESS. PAYPAL_SANDBOX_BUYER_EMAIL is used
 * the same way unless it is a business account (paying yourself fails with
 * SELF_PAY_NOT_ALLOWED). A deliberately typo'd address is always kept as-is, so the
 * unclaimed → cancel → retry flow is real too.
 */
export function sandboxReceiver(): string | null {
  const explicit = process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL?.trim();
  if (explicit) return explicit;
  const buyer = process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim();
  if (buyer && !/@business\.example\.com$/i.test(buyer)) return buyer;
  return null;
}

export function receiverFor(email: string, mode: "live" | "mock", looksBad: boolean): string {
  const sandbox = sandboxReceiver();
  if (mode === "live" && sandbox && !looksBad) return sandbox;
  return email;
}
