# Clockout

**Rotas that run themselves. Crews paid at clock-out.**

![Clockout: the week's rota on a Bryntum Scheduler Pro, the crew inbox and the agent's log on the left, PayPal payouts on the right](docs/screenshot.png)

Small businesses that run crews of freelancers (event staffing agencies, cleaning contractors, film and production crews) lose their Sunday nights rebuilding the rota in a spreadsheet, and their crews wait two weeks or more for invoices to clear. Clockout fixes both ends of the week. Workers text availability and swaps in plain English ("can't do Sat, can take Tues eve"). An AI agent turns those texts into scheduling rules and runs the rota itself on a Bryntum Scheduler: it builds the week within budget, refills a sick call with the best available person in seconds, and explains every change. When a shift ends and the owner approves the hours, Clockout pays each worker straight away with **PayPal Payouts**, at their agreed rate with night and weekend rates, and the shift's bar on the schedule turns from *booked* to *paid*.

**Why Payouts and not payroll?** The crew are independent contractors, not employees. They're self-employed freelancers who invoice per shift. PayPal positions Payouts for exactly this: paying many recipients at once, such as gig workers and freelancers. There's no payroll run to wait for. Approve hours, and the money moves.

---

## Judge quickstart

**Hosted demo:** `https://clockout.onrender.com` *(placeholder: replace with the deployed URL)*
The free Render instance sleeps when idle. **The first load can take about a minute to wake up**; after that it's instant.

**Run it locally in mock mode (no API keys needed)** with Node 20+. Bryntum's trial packages come from Bryntum's own npm registry, so the only thing you need is the email you registered a [Bryntum trial](https://bryntum.com/download/) with:

```bash
BRYNTUM_EMAIL=you@example.com bash scripts/bryntum-auth.sh && npm install && npm run dev:mock
```

Open http://localhost:3000. `npm run dev` also works with no keys at all: every external service falls back to its mock automatically, and the chips in the top bar say which mode each one is in.

### The three-minute story

| Step | Click | What happens |
| --- | --- | --- |
| **Mon 06:00** | **Let the agent handle 6 new messages** | Gemini reads six messy texts into constraints (hatched red = can't work, green = asked for). Then it assigns all 18 shifts within the $4,200 budget, one sentence of reasoning per pick. Guardrails re-check every assignment. |
| **Fri 07:30** | **Jump** (top bar) | Mon–Thu hours are approved and paid in one PayPal batch. Jonah's payout comes back **UNCLAIMED** (typo: `gmial.com`). Fix the email and hit **Retry**. Diego texts in sick. Click **Let the agent handle 1 new message**: he's taken off tonight's gala and the best free, qualified, under-cap person is booked in seconds. |
| **Fri 23:45** | **Jump**, then **Approve & pay 3 with PayPal** | The gala crew's bars stripe blue (*paying*), then turn green (*paid*). The payouts panel reconciles to **Nothing owed**. |

**Reset** in the top bar puts everything back to Monday morning.

---

## How PayPal is used

All PayPal calls are server-side, in [`src/lib/paypal`](src/lib/paypal), behind one `PayoutsAdapter` interface with a live and a mock implementation.

| Moment in the app | PayPal API | Code |
| --- | --- | --- |
| Get an access token | OAuth2 client credentials via the official **`@paypal/paypal-server-sdk`** (`Client`, `clientCredentialsAuthManager.fetchToken()`) | `paypal/live.ts` |
| Owner clicks **Approve & pay** | `POST /v1/payments/payouts`: one batch, one item per shift, amounts from integer minor units. `sender_batch_id` is unique per send, so a double-click can't pay twice. | `payouts.ts → sendBatch` |
| Bars go *paying → paid* | `GET /v1/payments/payouts/{payout_batch_id}`, polled every 1.5s while items are `PENDING`. Each item's `transaction_status` drives the shift's state machine. | `payouts.ts → refreshPayouts` |
| A payout fails or goes unclaimed | Shown with PayPal's error (`RECEIVER_UNREGISTERED`, `SELF_PAY_NOT_ALLOWED`, …) in plain English. **Retry**: `POST /v1/payments/payouts-item/{id}/cancel` for `UNCLAIMED` items first (so money can't go out twice), then a new batch. | `payouts.ts → retryPayout` |
| Payouts panel history | Every batch and item with PayPal's batch id, transaction id and status, reconciled against the weekly budget: paid, in flight, owed now, headroom. | `components/PayoutsPanel.tsx` |

The server SDK has no Payouts controller yet, so Payouts v1 is called over REST with the SDK-issued token. The mock ([`paypal/mock.ts`](src/lib/paypal/mock.ts)) keeps its state in SQLite and returns the documented response shapes: batches start `PENDING`, settle about 2 seconds later, and an address with no PayPal account comes back `UNCLAIMED` with `RECEIVER_UNREGISTERED`, just as the real sandbox does.

Currency defaults to **USD** for sandbox safety and is configurable (`CLOCKOUT_CURRENCY`). Money is integer minor units end to end, converted to PayPal's decimal strings without floating point, and the currency code is always shown.

## How AI is used

Two Gemini tool calls (Vercel AI SDK + `@ai-sdk/google`), each forced with `toolChoice` and validated with zod. No free-text parsing anywhere ([`src/lib/ai/schemas.ts`](src/lib/ai/schemas.ts)).

1. **`record_constraints`** turns every unread message into hard and soft rules: `unavailable` windows, `preferred` windows, preferred roles, an hour cap, and `dropShiftIds` (shifts the sender can no longer do, e.g. a sick call or a swap away). Times are resolved against the real week ("sat", "tues eve", "tonight").
2. **`assign_shifts`** gets each open shift's eligible candidates (cost, hours so far, what they asked for) plus the budget and a deterministic baseline. It returns one assignment per shift, each with a one-sentence reason for the owner.

**The model proposes; the code decides.** Every assignment is re-checked against the same hard rules as a drag and drop: role, unavailability, clashes, hour caps and budget ([`scheduling.ts`](src/lib/scheduling.ts)). A rejected pick is logged as *Guardrail*, and the slot is filled legally by the deterministic planner. Swaps work the same way: "can't do Thu, I'll take a Sat bar shift" drops one shift and adds a preference the refill honours.

**Free-tier engineering** ([`src/lib/ai/index.ts`](src/lib/ai/index.ts)):

- **Model:** `AI_MODEL` if set. Otherwise Clockout lists models from the Gemini API and tries the newest stable Flash first. If that model's free quota is spent, it cascades down the Flash line.
- **Cache:** responses are cached in SQLite by request hash, and the cache survives **Reset**, so re-running the demo costs no quota.
- **Rate limit:** calls are capped locally per minute.
- **Fallback:** on a 429 or quota error, a timeout, or no key, Clockout replays recorded responses and the **AI chip says so** (*AI · recorded*, with the reason on hover). The agent log tags every action *Gemini*, *Recorded AI*, *Guardrail* or *You*.

## Bryntum depth

Clockout uses the **thin** trial packages, so **Scheduler Pro and Calendar run on the same page** with one shared core:

- **Scheduler Pro** rota, one row per worker plus an *Open shifts* row.
  - Drag, drop and resize, with a `validatorFn` that runs the same hard rules as the server and explains a refusal while you drag ("Maya is unavailable Sat (sister's wedding)").
  - A resize re-prices the shift at the agreed night and weekend rates.
- **Custom event renderer:** the bar's colour is its pay status (*open → booked → hours to approve → paying (animated stripes) → paid → needs attention*). Each bar shows role, time and pay. At week zoom it collapses to the worker's avatar and a status icon.
- **Rich tooltip:** the base, night and weekend split, plus the PayPal batch and transaction ids.
- **Resource time ranges** draw each worker's unavailability (hatched) and requested windows (green), straight from their texts.
- **Time ranges** show the demo clock's *Now* line, and the view follows it.
- **Non-continuous time axis** (`timeAxis.include` 06:00–24:00) folds out the night hours no one works.
- **Partnered Resource Histogram** under the Scheduler, sharing its project and time axis. It shows each worker's load live as shifts move, with over-allocation in red. The resource column carries an hours-vs-cap bar.
- **Event menu:** right-click a booked shift and choose **Drop & let the agent find cover**.
- **Bryntum Calendar** (*Worker's week* tab): each worker's own week as they'd see it, with their shifts, pay status and blocked-out times, next to their agreed rates and what they've been paid so far.

## Live sandbox keys

Copy `.env.example` to `.env.local` and fill in what you have. Each service goes live independently when its key works:

```bash
cp .env.example .env.local
```

- **PayPal**
  1. In the [developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), create a sandbox REST app with **Payouts** enabled.
  2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
  3. Set `PAYPAL_SANDBOX_RECEIVER_EMAIL` to a sandbox **personal** account (*Testing Tools → Sandbox Accounts*). In live mode every worker is paid there, so payouts settle as `SUCCESS`. Without it, payouts go to the seeded workers' fictional emails, and PayPal holds them as `UNCLAIMED`.
  4. Don't use your business account as the receiver: PayPal rejects paying yourself (`SELF_PAY_NOT_ALLOWED`).
- **Gemini:** set `GOOGLE_GENERATIVE_AI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey). Leave `AI_MODEL` empty to auto-pick.
- **Bryntum:** `BRYNTUM_EMAIL` is only needed to install packages, not at runtime.

## Deploying to Render

[`render.yaml`](render.yaml) defines one free web service. In Render, choose **New → Blueprint**, point it at this repo, and set the secret env vars it asks for (at minimum `BRYNTUM_EMAIL`). The build runs the same three steps as a local install:

```bash
bash scripts/bryntum-auth.sh && npm ci && npm run build
```

`scripts/bryntum-auth.sh` writes `@bryntum:registry=https://npm.bryntum.com` and a legacy-auth login to `~/.npmrc` on the build machine, never to the repo. The username is your email with `@` replaced by `..`, and the password is `trial`. The packages are installed through npm aliases (for example `"@bryntum/schedulerpro-thin": "npm:@bryntum/schedulerpro-thin-trial@7.3.8"`), so a licensed build is a one-line change per package. SQLite lives on the instance's disk and is re-seeded on boot.

## Under the hood

- **Next.js 16 (App Router) + TypeScript**, one Node service. Bryntum renders client-side only (`dynamic(..., { ssr: false })`).
- **SQLite** via `better-sqlite3`, seeded on boot with a deterministic, fictional scenario.
- **State machines:**
  - Shifts move `open → booked → completed → approved → paying → paid | failed → paying` ([`shiftState.ts`](src/lib/shiftState.ts)). An illegal move, such as paying an open shift or editing a paid one, throws.
  - PayPal item statuses map to *in flight*, *paid* or *needs attention* ([`payoutState.ts`](src/lib/payoutState.ts)).
- **Money** ([`money.ts`](src/lib/money.ts)): per-minute rate bands (base, night 22:00–06:00, weekend, with the higher of night and weekend winning), summed in integers and rounded once, half up.
- **Tests (Vitest):** money maths, both state machines, AI tool schemas and recorded responses, the hard rules and planner, and the entire demo story end to end in mock mode.

```bash
npm run check   # lint + typecheck + tests + production build
```

```
src/
  app/              Next.js pages and API routes (state, agent, shifts, payouts, demo clock)
  components/       Dashboard, Bryntum Scheduler Pro + Histogram, Calendar, inbox, payouts panel
  lib/
    ai/             Gemini adapter (cache, rate limit, model cascade, fallback), zod schemas, recordings
    paypal/         Payouts adapter: live (server SDK OAuth + REST) and mock
    agent.ts        read messages → constraints; fill open shifts; guardrails
    payouts.ts      approve → batch → poll → paid/failed → retry
    scheduling.ts   hard rules, candidate scoring, baseline planner
tests/              Vitest
```

See [DECISIONS.md](DECISIONS.md) for the trade-offs, [DEMO.md](DEMO.md) for the video script and [SUBMISSION.md](SUBMISSION.md) for the Devpost write-up.

## License

[MIT](LICENSE). Bryntum trial packages are under Bryntum's own trial licence and are not part of this repository.
