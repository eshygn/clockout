# Decisions

These are the choices made while building Clockout, and why. Where the brief was ambiguous, I picked whichever option made the demo strongest.

## Product

- **Event staffing as the scenario.** "Lanternfly Event Crew", Austin TX, is fictional, and so are all six workers and five events. Event work has everything the story needs: evening and weekend rates, multi-person shifts, last-minute sick calls and clear end times.
- **Contractors, paid per shift.** Each approved shift is one PayPal Payouts item at the worker's agreed hourly rate. Agreed rates are stored per worker as three explicit hourly amounts (base, night, weekend) rather than multipliers, because that's how freelancers quote.
- **Night = 22:00–06:00. Weekend = Saturday and Sunday.** When a minute is both night and weekend, the higher agreed rate applies. Pay is summed per minute in integers and rounded once, half up.
- **The week is Mon 9 – Sun 15 Nov 2026,** and all times are wall-clock in the business's zone (`YYYY-MM-DDTHH:mm`). Server, browser and Bryntum therefore agree without time-zone maths. That's fine for a single-site business, and it would be the first thing to change for multi-region.
- **Demo clock in three story steps.** It only moves forward. **Reset** reseeds everything except the AI cache.
- **Jumping to Friday "fast-forwards" Monday to Thursday:** those hours are approved and paid in one batch, as the owner would have done each evening. This keeps the video under three minutes while still showing a real batch, a real unclaimed payout and the retry. The live payment moment in the story stays the three-person gala crew.
- **Jonah's PayPal email is deliberately typo'd** (`gmial.com`), so the failure-and-retry path appears naturally in the story rather than being faked. The retry box suggests the corrected address.
- **"Owed now"** counts work done but not yet paid: shifts that are completed, approved, paying or failed. Future booked shifts are budget commitments, not debts. So "nothing owed" on Friday night is true even with the weekend still booked.
- **No PayPal JS SDK buttons.** The brief asks for buttons "wherever a person pays". In Clockout no person pays through a checkout: the business pays out of its PayPal balance by API. Adding a checkout just to have buttons would be a fake flow, so `@paypal/react-paypal-js` is not used.
- **AG Grid is not used.** `AG_GRID_LICENSE_KEY` is in `.env.example` only for parity with the hackathon environment. Bryntum's own grid covers every table-like view.

## Bryntum

- **Thin packages** (`*-thin-trial` via npm aliases) instead of the regular bundles. Scheduler Pro and Calendar can then share one page and one core, which the regular packages forbid ("bundle loaded multiple times").
- **Scheduler Pro rather than Scheduler.** It brings the Resource Histogram (partnered and sharing the project), which the basic Scheduler lacks. Events are `manuallyScheduled` so the engine never moves a shift.
- **Features are imported explicitly** (`bryntumFeatures.ts`). Turbopack tree-shakes Bryntum's barrel entry, so features that are only named in config don't register, and the app fails with "Feature 'resourceTimeRanges' not available".
- **One source of truth.** Every mutation returns the full server state. The stores use `syncDataOnLoad`, so Bryntum applies only the differences and animates them. A drop or resize is validated client-side for instant feedback, then validated again on the server. If the server refuses, the bar snaps back.
- **Non-continuous time axis** from 06:00 to 24:00, because no shift runs overnight in the seed data. The week zoom fits all seven days. The detail zoom is readable at 3-hour ticks.

## AI

- **Two forced tool calls, not an open agent loop.** The Gemini free tier allows few requests per minute and per day. Building a week takes 2 calls and a sick call takes 2, instead of 20+ in a step-by-step tool loop. The model still makes every decision: it reads, picks and explains each pick.
- **The model proposes, deterministic guardrails decide.** Every AI assignment is re-checked against role, availability, clashes, hour caps and budget before it's applied. Rejections are logged, and their slots are filled legally by the deterministic planner.
- **A deterministic baseline plan is shown to the model.** It gives Gemini a known-valid starting point and makes the recorded fallback the same algorithm, so mock mode is never worse than "sensible".
- **Model choice.** `AI_MODEL` wins when set. Otherwise Clockout lists models from the Gemini API and ranks the stable `gemini-N.N-flash` ids newest first, then the `-flash-lite` line. On a quota error it parks that model for 5 minutes and tries the next one. (ai.google.dev's pricing page redirects to a host this build environment couldn't reach, so free-tier eligibility is discovered at runtime instead of hard-coded.) In testing on 4 Nov 2026, `gemini-3.8-flash` and `gemini-3.7-flash` returned `GenerateRequestsPerDayPerProjectPerModel-FreeTier` errors on this project, and `gemini-3.6-flash` and `gemini-3.5-flash` answered.
- **Minimal thinking** (`thinkingLevel: "minimal"`). This is structured extraction, and the first unthrottled call took over 45 seconds without it.
- **The cache survives Reset,** so recording the demo several times doesn't burn the daily quota. It is keyed on the request, not the model.
- **Recorded responses** for the six Monday messages are the tool-call arguments in the documented schema. A small rule-based reader handles unrecorded messages in mock mode, such as the Friday sick call or anything typed into the composer.

## PayPal

- **The server SDK for OAuth, REST for Payouts.** `@paypal/paypal-server-sdk` 2.5 has Orders, Payments, Vault, Subscriptions and Transaction Search controllers but no Payouts controller. Clockout uses the SDK's `clientCredentialsAuthManager` for tokens and calls Payouts v1 directly.
- **One item per shift,** with `sender_item_id = <shiftId>-a<attempt>`. Status maps back to exactly one shift, and a retry is a new attempt with a new id.
- **Idempotency.** `sender_batch_id` is unique per send and is also sent as `PayPal-Request-Id`. A repeated request is rejected by PayPal rather than paid twice.
- **Unclaimed retry cancels first.** In the live sandbox, `POST /v1/payments/payouts-item/{id}/cancel` returned `INTERNAL_SERVICE_ERROR` every time I tried (4 Nov 2026). Clockout then refuses to re-send and explains why, because re-sending while the first payout can still be claimed could pay twice. The mock implements the documented success path (`UNCLAIMED → RETURNED`).
- **Sandbox receiver.** In live testing, the provided `PAYPAL_SANDBOX_BUYER_EMAIL` was a business account: the same account as the API app. Every item failed with `SELF_PAY_NOT_ALLOWED`. Clockout now pays a sandbox **personal** account when `PAYPAL_SANDBOX_RECEIVER_EMAIL` is set, and ignores `@business.example.com` buyer emails. Otherwise it pays the workers' own (fictional) emails, which PayPal holds as `UNCLAIMED`. The plain-English error and the Retry box let the owner correct a receiver from the UI.
- **Live versus mock.** At startup Clockout requests a sandbox token. Success means live. Otherwise, or if Payouts is refused with a 401/403, it switches to mock and the chip shows the reason.
- **USD by default** for sandbox safety, configurable with `CLOCKOUT_CURRENCY`.

## Engineering

- **SQLite via better-sqlite3,** one file under `data/`, seeded on first boot. On Render's free plan the disk is ephemeral, which suits a demo that reseeds anyway.
- **No auth.** It's a single-owner demo; the brief doesn't ask for accounts.
- **Fonts are self-hosted** via `@fontsource` (Bricolage Grotesque, Inter, IBM Plex Mono). The build then needs no Google Fonts access, and the type is not the default template look.
- **Palette:** ink `#1B1F2A` and warm paper `#F5F1E8`, with clock-out orange `#FF5A1F` as the brand accent. Status colours are reserved for pay state: booked indigo, owed amber, paying blue, paid green, failed red.
- **Network.** Every host this build needed was reachable: npm, npm.bryntum.com, api-m.sandbox.paypal.com and generativelanguage.googleapis.com. Only the ai.google.dev pricing page (redirecting to aistudio.google.com) wasn't. No service had to be switched to mock because of the network.
