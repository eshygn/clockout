import { Client, Environment } from "@paypal/paypal-server-sdk";
import type {
  CreatePayoutRequest,
  CreatePayoutResponse,
  PayoutBatchDetail,
  PayoutItemDetail,
  PayoutsAdapter,
  PayPalErrorBody,
} from "./types";
import { PayPalApiError } from "./types";

const BASE = "https://api-m.sandbox.paypal.com";

/**
 * Live PayPal sandbox. The official server SDK (@paypal/paypal-server-sdk) handles
 * OAuth client-credentials; it has no Payouts controller yet, so Payouts v1 is called
 * over REST with the SDK-issued token.
 */
export class LivePayouts implements PayoutsAdapter {
  readonly mode = "live" as const;
  private client: Client;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
      environment: Environment.Sandbox,
      timeout: 15000,
    });
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const t = await this.client.clientCredentialsAuthManager.fetchToken();
    const ttl = t.expiresIn ? Number(t.expiresIn) * 1000 : 30 * 60_000;
    this.token = { value: t.accessToken, expiresAt: Date.now() + ttl };
    return t.accessToken;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new PayPalApiError(res.status, json as PayPalErrorBody | null);
    return json as T;
  }

  createBatch(req: CreatePayoutRequest) {
    // sender_batch_id is PayPal's idempotency key for Payouts: a repeat is rejected, never paid twice.
    return this.call<CreatePayoutResponse>("POST", "/v1/payments/payouts", req, req.sender_batch_header.sender_batch_id);
  }
  getBatch(id: string) {
    return this.call<PayoutBatchDetail>("GET", `/v1/payments/payouts/${encodeURIComponent(id)}?page_size=1000`);
  }
  getItem(id: string) {
    return this.call<PayoutItemDetail>("GET", `/v1/payments/payouts-item/${encodeURIComponent(id)}`);
  }
  cancelItem(id: string) {
    return this.call<PayoutItemDetail>("POST", `/v1/payments/payouts-item/${encodeURIComponent(id)}/cancel`);
  }
}
