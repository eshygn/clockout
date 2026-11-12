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
- **The resize validator reads `eventRecord`, not `record`.** At runtime, Bryntum 7.3.8 passes `eventRecord` (and sometimes no `endDate`) to `eventResize.validatorFn`, although the shipped `.d.ts` names the field `record`. Following the types refused every resize; that was found and fixed in the final pass.
- **Shifts are capped at 14 hours.** Because the axis hides 00:00–06:00, a small resize past 23:00 used to land at 09:00 the next day (a 20-hour, $800 shift). The cap is a hard rule, shared by the client and the server.
- **Features are imported explicitly** (`bryntumFeatures.ts`). Turbopack tree-shakes Bryntum's barrel entry, so features that are only named in config don't register, and the app fails with "Feature 'resourceTimeRanges' not available".
- **One source of truth.** Every mutation returns the full server state. The stores use `syncDataOnLoad`, so Bryntum applies only the differences and animates them. A drop or resize is validated client-side for instant feedback, then validated again on the server. If the server refuses, the bar snaps back.
- **Non-continuous time axis** from 06:00 to 24:00, because no shift runs overnight in the seed data. The week zoom fits all seven days. The detail zoom is readable at 3-hour ticks.

## AI

- **Two forced tool calls, not an open agent loop.** The Gemini free tier allows few requests per minute and per day. Building a week takes 2 calls and a sick call takes 2, instead of 20+ in a step-by-step tool loop. The model still makes every decision: it reads, picks and explains each pick.
- **The model proposes, deterministic guardrails decide.** Every AI assignment is re-checked against role, availability, clashes, hour caps and budget before it's applied. Rejections are logged, and their slots are filled legally by the deterministic planner.
- **A deterministic baseline plan is shown to the model.** It gives Gemini a known-valid starting point and makes the recorded fallback the same algorithm, so mock mode is never worse than "sensible".
- **Model choice.** The chain is fixed and short: the newest stable `gemini-N.N-flash` the API lists (or `AI_MODEL`), then `gemini-2.5-flash`, then recorded responses. A rate-limited model is parked for 5 minutes, an overloaded or timed-out one for 1 minute. An earlier version walked the whole Flash and Flash-Lite line; that was slower to fail and harder to explain on screen. The chip names what answered the last call. On 12 Nov 2026, `gemini-3.8-flash` was overloaded and `gemini-2.5-flash` answered.
- **Minimal thinking** (`thinkingLevel: "minimal"`). This is structured extraction, and the first unthrottled call took over 45 seconds without it.
- **The cache survives Reset,** so recording the demo several times doesn't burn the daily quota. It is keyed on the request, not the model.
- **Thinking settings differ by model.** Gemini 3.x accepts `thinkingLevel: "minimal"`. Some models reject it, and Gemini 2.5 needs `thinkingBudget: 0` instead. Clockout remembers which models reject `thinkingLevel` and retries them with a zero budget. A timeout also moves on to the next model.
- **Overload is not quota.** A 503 "high demand" parks that model for a minute and tries the next one, rather than falling straight back to recorded answers.
- **"Drop & find cover" records the drop as a constraint.** Without it, the agent re-booked the person the owner had just removed (found in the final pass). The dropped worker is now unavailable for that slot.
- **Recorded responses** for the six Monday messages are the tool-call arguments in the documented schema. A small rule-based reader handles unrecorded messages in mock mode, such as the Friday sick call or anything typed into the composer.

## PayPal

- **The server SDK for OAuth, REST for Payouts.** `@paypal/paypal-server-sdk` 2.5 has Orders, Payments, Vault, Subscriptions and Transaction Search controllers but no Payouts controller. Clockout uses the SDK's `clientCredentialsAuthManager` for tokens and calls Payouts v1 directly.
- **One item per shift,** with `sender_item_id = <shiftId>-a<attempt>`. Status maps back to exactly one shift, and a retry is a new attempt with a new id.
- **Idempotency.** `sender_batch_id` is unique per send and is also sent as `PayPal-Request-Id`. A repeated request is rejected by PayPal rather than paid twice.
- **Unclaimed retry cancels first.** In the live sandbox, `POST /v1/payments/payouts-item/{id}/cancel` returned `INTERNAL_SERVICE_ERROR` every time I tried (4 and 5 Nov 2026). Clockout then refuses to re-send and explains why, because re-sending while the first payout can still be claimed could pay twice. The mock implements the documented success path (`UNCLAIMED → RETURNED`).
- **Sandbox receivers.** Live payouts go to sandbox **personal** accounts from the environment. `SANDBOX_RECEIVER_<FIRSTNAME>` pays that worker; the rest of the crew is spread across all configured receivers in crew order, because the demo has six workers and usually fewer sandbox accounts. Jonah's typo'd address is always kept. Paying the API app's own business account fails with `SELF_PAY_NOT_ALLOWED`, so `PAYPAL_SANDBOX_BUYER_EMAIL` is no longer read.
- **The model's picks are applied hardest-to-staff first.** On 12 Nov 2026 Gemini booked Sam up to his 20-hour cap on easy shifts, which left the one shift only he could cover unfillable. Applying scarce shifts first keeps him on that one, and the guardrail planner refills the easy one.
- **Live versus mock.** At startup Clockout requests a sandbox token. Success means live. Otherwise, or if Payouts is refused with a 401/403, it switches to mock and the chip shows the reason.
- **USD by default** for sandbox safety, configurable with `CLOCKOUT_CURRENCY`.

## Known limitations (stated plainly)

- **Update, 5 Nov 2026: live payouts reach `SUCCESS`** with a funded sandbox business app and a sandbox personal receiver (batch `S3M64ZEMNW34C`: 9 SUCCESS, 1 UNCLAIMED by design). In that live run, Jonah's failed retry left his typo'd email in place, so his gala payout went `UNCLAIMED` too. The live demo ends with Jonah owed, not "Nothing owed". The note below is the earlier status.
- **Earlier: live payouts had not been seen reaching `SUCCESS`.** Every live call works: OAuth, batch create, polling and settlement. But this environment had no sandbox personal account to receive the money. The provided `PAYPAL_SANDBOX_BUYER_EMAIL` is the API app's own business account, so items failed with `SELF_PAY_NOT_ALLOWED`. Without it, they go to the fictional seeded emails and come back `UNCLAIMED`. Setting `PAYPAL_SANDBOX_RECEIVER_EMAIL` to a sandbox personal account should make them succeed, but that is untested.
- **A batch PayPal rejects outright sends nothing, so its shifts go back to "hours to approve".** On 5 Nov 2026 the sandbox business account returned `INSUFFICIENT_FUNDS`; earlier test runs had left about $3,800 in unclaimed payouts. That run exposed two bugs, both now fixed. First, the shifts were marked "failed" with no payout to retry, which left them stuck. Second, the Friday jump stopped before delivering the sick call.
- **Live unclaimed-retry is blocked by the sandbox.** `POST /v1/payments/payouts-item/{id}/cancel` returned `INTERNAL_SERVICE_ERROR` on every attempt (4 and 5 Nov 2026). Clockout refuses to re-send rather than risk paying twice. The full cancel-and-resend path is exercised only in mock mode and in tests.
- **The Gemini free tier is small and changes daily.** On this key the newest Flash models had no free quota left, and one call hit a 503 "high demand". The cascade and the recorded fallback keep the demo working, but which model answers on the day is not predictable. The chip shows what happened.
- **Mon–Thu are auto-approved by the Friday jump.** It's a demo shortcut, labelled as such in the payout history ("Mon–Thu hours (approved nightly)").
- **No two-person swap.** Swaps are drop + refill + preference. The agent never moves someone already booked to make room.
- **Phone layout is usable but not designed.** Columns stack and there's no horizontal page scroll, but Bryntum keeps the crew pane wide, so on a phone the timeline gets about half the screen.
- **The histogram adds little.** Double-booking is already blocked, so it can never show over-allocation; it mostly confirms the load is even.
- **No auth, single business.** Every visitor to the hosted demo shares one database. Reset affects everyone looking at it.

## Engineering

- **SQLite via better-sqlite3,** one file under `data/`, seeded on first boot. On Render's free plan the disk is ephemeral, which suits a demo that reseeds anyway.
- **No auth.** It's a single-owner demo; the brief doesn't ask for accounts.
- **Fonts are self-hosted** via `@fontsource` (Bricolage Grotesque, Inter, IBM Plex Mono). The build then needs no Google Fonts access, and the type is not the default template look.
- **Palette:** ink `#1B1F2A` and warm paper `#F5F1E8`, with clock-out orange `#FF5A1F` as the brand accent. Status colours are reserved for pay state: booked indigo, owed amber, paying blue, paid green, failed red.
- **Network.** Every host this build needed was reachable: npm, npm.bryntum.com, api-m.sandbox.paypal.com and generativelanguage.googleapis.com. Only the ai.google.dev pricing page (redirecting to aistudio.google.com) wasn't. No service had to be switched to mock because of the network.
