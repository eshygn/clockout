# Architecture

Clockout is one Next.js 16 service: React on the client, API routes on the server, and SQLite on disk.

**How a request flows.** The browser holds no business logic of its own. Every button calls an API route, the route changes SQLite, and it returns the **entire app state**. Bryntum's stores then diff that state (`syncDataOnLoad`) and animate only what changed. That one rule ("the server returns everything") is why the scheduler, histogram, calendar, inbox and payouts panel can never disagree.

```
browser (Dashboard)                 server (API routes)                       outside
 ├─ RotaView (Bryntum) ── drag ───▶ PATCH /api/shifts/:id ─▶ scheduling.ts (hard rules)
 ├─ Inbox ─────────── agent ──────▶ POST /api/agent/run ──▶ agent.ts ─▶ ai/index.ts ─────▶ Gemini
 └─ PayoutsPanel ──── approve ────▶ POST /api/payouts/pay ─▶ payouts.ts ─▶ paypal/live.ts ─▶ PayPal sandbox
                                                                       └▶ paypal/mock.ts (SQLite)
```

These five files carry the product.

## 1. `src/lib/agent.ts`: the agent

**What it does:** turns crew texts into a staffed rota.

- **`readMessages()`** sends every unread message to Gemini in **one** forced tool call, `record_constraints`.
  - Before anything is stored, `sanitizeUpdate()` validates the answer: well-formed time windows, and only shift ids that really belong to the sender.
  - The answer becomes rows in `constraints_` (unavailable, preferred, preferred role, hour cap).
  - Any `dropShiftIds` (a sick call, or a swap away) unassign those shifts.
- **`fillOpenShifts()`** builds a prompt for one forced `assign_shifts` call. It includes each open shift's *eligible* candidates (from `scheduling.ts`), the budget, what each worker said, and a deterministic baseline plan.
  - The model's picks are applied **one at a time through the same hard rules** as a drag and drop. A blocked pick is logged as *Guardrail*.
  - Anything still open is filled by the deterministic planner.
- **`runAgent()`** is the inbox button: read, then fill. A single sick call refills only the dropped shift.
- **`dropAndRefill()`** is the right-click menu action. It records the drop as a constraint, so the same person can't be re-booked.

**Key decisions**

- **Two forced tool calls, not an open agent loop.** The Gemini free tier allows only a handful of requests per minute and per day, so building a week costs 2 calls instead of 20+.
- **The model proposes; code decides.** The model's freedom is in *choosing* and *explaining*. It can never apply anything that breaks a rule.
- **The baseline plan is shown to the model** and is also the recorded fallback, so mock mode is never worse than "sensible".

## 2. `src/lib/scheduling.ts`: the rules

**What it does:** pure functions, with no I/O. They run on the server (to validate the AI and the owner) **and in the browser** (Bryntum's drag and resize validators import the same code).

- **`checkAssignment()`** holds the hard rules:
  - the shift is at most 14 hours;
  - the worker has the role;
  - it doesn't overlap any of their `unavailable` windows;
  - it doesn't clash with another of their shifts;
  - it stays under their hour cap (the stricter of their profile cap and what they texted).
  - It returns human sentences ("Maya is unavailable all day Sat (sister's wedding)"), which the drag tooltip and the agent log show verbatim.
- **`candidatesFor()`** handles soft scoring: cost, requested windows, preferred roles, and fairness (fewer hours ranks higher).
- **`greedyPlan()`** fills the hardest-to-staff shift first with its best legal, in-budget candidate.

**Key decisions**

- **One implementation of the rules.** It is shared by the client validator, the server route, the AI guardrail and the fallback planner. A rule can't drift between the screen and the database.
- **Reasons, not booleans.** Every refusal is a sentence a busy owner can act on.

## 3. `src/lib/payouts.ts` (with `src/lib/paypal/*`): the money

**What it does:** takes approved hours to PayPal and back.

- **`approveAndPay()`** moves shifts `completed → approved → paying` in one SQLite transaction, then calls `sendBatch()`. That builds one Payouts batch with one item per shift. The amount is integer minor units, converted to a decimal string without floats. `sender_item_id = <shift>-a<attempt>`, and `sender_batch_id` is unique per send.
- **`refreshPayouts()`** polls `GET /v1/payments/payouts/{id}` while anything is `PENDING`. It maps each item's `transaction_status` (via `payoutState.ts`) to the shift state machine (`shiftState.ts`): `paying → paid` or `paying → failed`.
- **`retryPayout()`** handles failures. For `UNCLAIMED` it **cancels first** (`POST …/payouts-item/{id}/cancel`) and refuses to re-send if the cancel fails. Then it optionally updates the worker's email and sends a new attempt.
- **`paypal/index.ts`** chooses live or mock: live when the sandbox issues a token, otherwise mock. If Payouts is refused (401/403), it falls back to mock, and the status chip shows the reason. It also chooses who actually receives the money in live sandbox mode.
- **`paypal/live.ts`** uses `@paypal/paypal-server-sdk` for OAuth (it has no Payouts controller yet) and calls Payouts v1 over REST with that token.
- **`paypal/mock.ts`** keeps state in SQLite and returns the documented response shapes. Batches settle after about 1.8s, and unknown addresses come back `UNCLAIMED` / `RECEIVER_UNREGISTERED`, as the real sandbox does.

**Key decisions**

- **Every status change goes through `transition()`.** Illegal moves, such as paying an open shift or editing a paid one, throw instead of corrupting data.
- **Idempotency comes from PayPal's own key** (`sender_batch_id`), not a local flag. A repeated send is rejected by PayPal rather than paid twice.
- **Safety beats the happy path.** The sandbox's cancel endpoint errors, so live unclaimed retries are blocked, with an explanation on screen. The alternative risked a double payment.

## 4. `src/lib/ai/index.ts`: getting a reliable answer from a free tier

**What it does:** the only place the app talks to Gemini.

- **`callTool()`** forces one named tool (`toolChoice: { type: "tool" }`) and parses the input with zod. It uses minimal thinking for speed and a 30s timeout.
- **Cache:** a SQLite table keyed by a hash of the request. The cache survives **Reset**, so re-running the demo costs no quota.
- **Model choice:** the newest stable Flash the API lists (or `AI_MODEL`), then the next two Flash models the API lists (`gemini-2.5-flash` only if the listing is unavailable).
  - On a 429 (quota), that model is parked for 5 minutes; on a 503 (overload) or a timeout, for 1 minute. Either way Clockout tries the next model.
  - There's also a local per-minute cap.
- **Fallback:** if neither answers, the caller's recorded fallback is used. `aiStatus().using` names what answered the last call, and the status chip shows it.

**Key decisions**

- **Free-tier eligibility is discovered at runtime.** It changes per model and per day; on this key the newest Flash models had no free quota.
- **Every result says where it came from:** Gemini, recorded, or cached. Every agent log line shows its source, so the demo never claims live AI it didn't use.

## 5. `src/components/RotaView.tsx`: Bryntum Scheduler Pro and the histogram

**What it does:** the owner's main screen.

- **`BryntumSchedulerPro`** takes resources (an *Open shifts* row plus each worker), events (shifts), resource time ranges (each worker's texted availability) and time ranges (the demo clock's *Now*). It gets them as React props built in `bryntumData.ts`.
- **A custom `eventRenderer`** draws role, time, pay and a status badge; at week zoom it collapses to an avatar and a status icon.
- **The tooltip** shows the base, night and weekend pay split and the PayPal ids.
- **The drag and resize `validatorFn`s** call `validateMove()`, which uses `scheduling.ts`. On drop or resize end, the component `PATCH`es the server; if the server refuses, the returned state snaps the bar back.
- **A right-click menu item** hands a shift to the agent.
- **The timeline hides 00:00–06:00** (`timeAxis: { continuous: false, include: { hour: { from: 6, to: 24 } } }`).
- **`BryntumResourceHistogram`** is partnered with the scheduler (`partner`, plus a shared `project`), so it follows the same axis and scroll.

**Key decisions**

- **Thin packages** (`@bryntum/*-thin` aliased to the `-thin-trial` packages), so Scheduler Pro and Calendar (`WorkerWeek.tsx`) can share one page and one core.
- **Features are imported explicitly** in `bryntumFeatures.ts`, because the bundler tree-shakes Bryntum's barrel entry.
- **Config is created once.** Callbacks read the latest state through refs, so React re-renders never rebuild the widget; only data props change.
- **Trust the runtime over the `.d.ts`.** The resize validator receives `eventRecord`, not the `record` its types name. An end-to-end browser test caught this.

## Supporting files worth knowing

- **`money.ts`:** pay per minute across base, night (22:00–06:00) and weekend bands, with the higher of night and weekend winning. It sums in integers, rounds once (half up), and converts to and from PayPal decimal strings without floats.
- **`shiftState.ts` / `payoutState.ts`:** the two state machines.
- **`clock.ts`:** the demo clock. Jumping to Friday fast-forwards Mon–Thu (auto-approve and pay) and delivers the sick call.
- **`db.ts` / `seed.ts`:** schema and the fictional, deterministic demo week.
- **`tests/story.test.ts`:** the whole demo story in mock mode against an in-memory database.
