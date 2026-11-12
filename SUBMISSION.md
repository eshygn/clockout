# Devpost submission (draft)

**Project name:** Clockout
**Tagline:** Rotas that run themselves. Crews paid at clock-out.

---

## Inspiration

Talk to anyone who runs a freelance crew (an event staffing agency, a cleaning contractor, a film production) and two complaints come up straight away. The owner spends Sunday night rebuilding next week's rota in a spreadsheet from a pile of texts like "can't do Sat, can take Tues eve". And the crew, who are self-employed, wait two weeks or more for an invoice to clear before they see a cent for a shift they finished on Friday night.

Both problems sit between a message and a payment. AI is now good at the message half. PayPal Payouts was built for the payment half: paying many recipients, such as gig workers and freelancers, at once. These are contractors, not employees, so there's no payroll run to wait for. We wanted a product where the rota runs itself and the money moves the moment the work is approved.

## What it does

- The owner sees the week on a **Bryntum Scheduler Pro**, one row per worker.
- **Workers text in plain English.** An AI agent (Gemini, through the Vercel AI SDK) reads the texts into structured rules: who can't work when, who asked for what, hour caps and dropped shifts.
- **The agent runs the rota.** It staffs the whole week within the budget and explains every pick in a sentence. When someone calls in sick, it takes them off and books the best free, qualified, under-cap person in seconds.
- **Guardrails decide what lands.** Every AI change is re-checked against hard rules before it's applied, and so is every drag, drop and resize the owner makes.
- **The demo clock** jumps through the week in three steps. Moving to Friday fast-forwards Monday to Thursday, approving and paying those shifts in one batch, so the story fits in three minutes.
- **Approving hours pays the worker immediately** with **PayPal Payouts**, at their agreed rate, including night and weekend rates. The shift's bar on the schedule goes from *booked* to *paying* to **paid**.
- **Failures are visible and retryable** (demonstrated in mock mode). An unclaimed payout (a typo'd email) is cancelled first, then re-sent to the corrected address. Clockout never re-sends until PayPal confirms the cancel. In our sandbox tests the cancel endpoint itself kept erroring, so this path is shown in mock mode.
- **The books reconcile themselves.** A weekly payouts panel reconciles everything against the budget, down to *Nothing owed*.
- **Each worker has their own week** on a **Bryntum Calendar**: shifts, blocked-out times, rates and what's been paid.

## How we built it

- **Next.js 16 (App Router) + TypeScript** as a single Node service, with **SQLite** (better-sqlite3) seeded with a deterministic, fictional demo week.
- **Bryntum thin trial packages.** Scheduler Pro and Calendar share one core on the same page.
  - Custom event renderers show pay status on every bar.
  - Resource time ranges draw availability from the texts; time ranges show the demo clock's *Now* line.
  - A non-continuous time axis folds out the night hours no one works.
  - Drag, drop and resize validators share the server's rules.
  - A partnered Resource Histogram shows live load.
  - An event menu action hands a shift to the agent.
- **AI: two forced tool calls, `record_constraints` and `assign_shifts`,** each validated by a zod schema. The model proposes; deterministic guardrails (role, unavailability, clashes, hour caps, budget) decide what's applied.
  - Responses are cached in SQLite, and calls are rate-limited for the free tier.
  - When the chosen Flash model is rate-limited or overloaded, Clockout retries once, falls back to the next Flash models the API lists for the key, then to recorded responses. A status chip names which one answered.
- **PayPal:** the official `@paypal/paypal-server-sdk` handles OAuth, and Payouts v1 handles the money.
  - Batch create, status polling, item cancel for unclaimed payouts, and retry.
  - `sender_batch_id` provides idempotency.
  - Every external service sits behind an adapter with a live and a mock implementation. The mock returns the documented response shapes.
- **Money** is integer minor units everywhere, converted to PayPal's decimal strings without floats, and the currency is always shown.
- **Vitest** covers the money maths, the shift and payout state machines, the AI schemas, the hard rules and planner, and the full demo story end to end.

## Challenges we ran into

- **Free-tier quotas.** Gemini's free tier differs per model and per day. Clockout tries the newest Flash model, then the next Flash models the API lists, then recorded responses. It caches every answer so a re-run costs nothing, and falls back gracefully when the quota is gone.
- **Two Bryntum products on one page.** The regular bundles refuse to load twice. Switching to the thin packages fixed that. Then the bundler tree-shook features we only named in config, and importing them explicitly fixed that too.
- **Sandbox realism.** In live testing, payouts to our own business account failed with `SELF_PAY_NOT_ALLOWED`, and unknown addresses came back `UNCLAIMED`. We turned both into first-class, plain-English states with a retry. We also refused to re-send an unclaimed payout until PayPal confirms the cancel, so nobody gets paid twice. The sandbox's cancel endpoint returned `INTERNAL_SERVICE_ERROR` every time we tried, so in the sandbox that retry stays blocked, with an explanation on screen.
- **Bryntum types versus runtime.** The resize validator receives `eventRecord` at runtime, while the type definitions say `record`. Following the types silently refused every resize until an end-to-end browser test caught it.
- **Trusting an AI with a schedule.** The answer was letting the model decide and explain, while deterministic code verifies every change, the same way it verifies the owner's own drag and drop.

## Accomplishments that we're proud of

- A sick call goes from text to covered shift in seconds, with a human-readable reason.
- One "approve" click sends a PayPal Payouts batch to three freelancers on a Friday night, and the schedule shows each payment land.
- The whole story runs with zero API keys, and every chip tells the truth about what's live and what's recorded.
- Money is never a float, anywhere.

## What we learned

- Forcing a single tool call with a strict schema beats free-text parsing, and beats a long agent loop on a rate-limited tier.
- The most useful thing an AI scheduler can do is explain itself; the second most useful is be checkable.
- Payouts is the right primitive for contractor crews: there's no payroll calendar to wait for, just approve and pay.

## What's next for Clockout

- Real inbound texts via SMS and WhatsApp, and a worker-side app built from the Calendar view.
- Venmo as a recipient wallet for US crews, and multi-currency crews.
- Clock-in and clock-out from the worker's phone, so approved hours start from real times.
- Tax-year summaries per contractor.

## Built with

`bryntum-scheduler-pro` · `bryntum-calendar` · `paypal-payouts` · `paypal-server-sdk` · `gemini` · `vercel-ai-sdk` · `zod` · `next.js` · `react` · `typescript` · `sqlite` · `better-sqlite3` · `vitest` · `render`

**Links:** hosted demo (placeholder) · GitHub repo: https://github.com/eshygn/clockout · demo video: https://youtu.be/_yPhB6Wesl8
