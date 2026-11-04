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
 * In live sandbox mode, pay a real sandbox account so payouts settle as SUCCESS:
 * PAYPAL_SANDBOX_BUYER_EMAIL stands in for every worker, except a deliberately
 * typo'd address (kept as-is so the unclaimed → retry flow is real too).
 */
export function receiverFor(email: string, mode: "live" | "mock", looksBad: boolean): string {
  const sandbox = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (mode === "live" && sandbox && !looksBad) return sandbox;
  return email;
}
