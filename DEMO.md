# Demo video: script and shot list

**Target length:** 2:40 (hard limit 2:50). About 400 spoken words at a relaxed pace.
**Recording setup:** browser at **1440×900**, zoom 100%, in mock mode (`npm run dev:mock`) or with live keys. Click **Reset** before you start. With live keys, do one warm-up run so the AI cache is filled and every Gemini call is instant on the take. Hide the bookmarks bar. Record the screen and the voice-over together, or lay the voice over afterwards using the timings below.

On-screen captions are in **[brackets]**. Put a caption on every PayPal moment.

---

## 0:00–0:20 · The problem and who it's for

**Shot 1.** Black title card with the Clockout wordmark, then a slow push in on the empty rota (Monday 06:00, 18 grey open shifts).

> If you run a crew of freelancers (event staff, cleaners, a film crew), your Sunday night goes on rebuilding the rota in a spreadsheet from a pile of texts. And your crew? They wait two weeks or more for an invoice to clear. Clockout fixes both ends of the week.

**[For small businesses that pay self-employed crews: contractors, not payroll]**

## 0:20–0:55 · Monday: six messy texts become the week

**Shot 2.** Hover over the crew inbox and scroll the six messages slowly.

> These are real-sounding texts from my crew. "Can't do Sat at all, sister's wedding." "Max twenty hours this week, exams." "Dentist Thursday till eleven."

**Shot 3.** Click **Let the agent handle 6 new messages**. The rota fills, hatched red and green windows appear, and the agent log streams.

> One click. Gemini reads every message into rules with typed tool calls: red is "can't work", green is "asked for". Then it staffs all eighteen shifts inside the forty-two-hundred-dollar budget. Every pick comes with a reason, and every pick is re-checked by hard guardrails before it lands.

**Shot 4.** Drag a Saturday shift onto Maya's row. The drop is refused with "Maya is unavailable Sat (sister's wedding)". Then drag it onto Priya, and the drop succeeds.

> This is a Bryntum Scheduler Pro, so I can still drag things around myself, and it won't let me break a rule either.

**[Bryntum Scheduler Pro · resource time ranges · live load histogram]**

## 0:55–1:35 · Friday morning: a payout to fix, and a sick call

**Shot 5.** Click **Jump to Fri 07:30**. Monday to Thursday bars turn green, and the payouts panel fills in.

> Jump to Friday. Monday to Thursday were approved each night and paid in one PayPal Payouts batch.

**[PayPal moment 1 · one Payouts batch · 10 shifts paid · batch id shown]**

**Shot 6.** Zoom in on the red **Needs attention** card for Jonah.

> One came back unclaimed. Jonah typed "gmial". Clockout cancels the unclaimed payout first, so the money can't go out twice, and re-sends to the corrected address.

**Shot 7.** Click **Retry**. The item goes from *Sending* to *Paid*.

**[PayPal moment 2 · unclaimed → cancel → retry]**

**Shot 8.** Diego's sick text pulses in the inbox. Click **Let the agent handle 1 new message**.

> Then the call every crew lead dreads: Diego's sick, and tonight's the gala. The agent takes him off, and finds who's free, qualified and under their hour cap. Sam's out because he'd go over twenty hours. It books the best person left, and explains why. That took seconds.

**[Sick call refilled in seconds · reason in the log]**

## 1:35–2:15 · Friday night: three people paid at clock-out

**Shot 9.** Click **Jump to Fri 23:45**. The three gala bars turn amber (*hours to approve*). Hover one bar to show the tooltip with base and night hours.

> Eleven forty-five. The gala's done. Each bar knows what it's worth at that person's agreed rate. Six hours base, an hour and a half at the night rate after ten.

**Shot 10.** In the payouts panel, click **Approve & pay 3 with PayPal**. The bars stripe blue, then turn solid green with a **PAID** badge.

> I approve the hours, and that's it. One Payouts batch, three people paid tonight, not in two weeks.

**[PayPal moment 3 · Approve & pay · 3 workers · PENDING → SUCCESS]**

**Shot 11.** The panel reads **Nothing owed. Everyone who worked has been paid.**

> And the books reconcile themselves: budget, rota cost, paid, and nothing owed.

## 2:15–2:30 · The worker's view

**Shot 12.** Click the **Worker's week** tab and pick Maya. The Bryntum Calendar shows her week, blocked-out Saturday and paid shifts.

> Every worker gets their own week: their shifts, their rates, what's been paid.

**[Bryntum Calendar on the same page, via thin packages]**

## 2:30–2:42 · Impact

**Shot 13.** Pull back to the whole dashboard, then the closing card: **Clockout · rotas that run themselves, crews paid at clock-out**.

> Sunday night back for the owner. Pay on the night for the crew. Clockout: rotas that run themselves, and crews paid at clock-out.

---

## Shot list (quick reference)

| # | Time | Screen | Action | Caption |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Title → empty rota | Push in | For small businesses that pay self-employed crews |
| 2 | 0:20 | Crew inbox | Scroll messages | |
| 3 | 0:30 | Inbox → rota | **Let the agent handle 6 new messages** | |
| 4 | 0:45 | Rota | Drag a Sat shift onto Maya (refused), then onto Priya | Bryntum Scheduler Pro · resource time ranges · live load histogram |
| 5 | 0:55 | Top bar → payouts | **Jump to Fri 07:30** | PayPal moment 1 · Payouts batch |
| 6 | 1:05 | Needs attention | Zoom | |
| 7 | 1:12 | Needs attention | **Retry** | PayPal moment 2 · unclaimed → cancel → retry |
| 8 | 1:20 | Inbox → rota | **Let the agent handle 1 new message** | Sick call refilled in seconds |
| 9 | 1:35 | Top bar → rota | **Jump to Fri 23:45**, hover a gala bar | |
| 10 | 1:50 | Payouts | **Approve & pay 3 with PayPal** | PayPal moment 3 · PENDING → SUCCESS |
| 11 | 2:05 | Payouts | Hold on "Nothing owed" | |
| 12 | 2:15 | Worker's week tab | Pick Maya | Bryntum Calendar on the same page |
| 13 | 2:30 | Whole app → card | Pull back | |

**Before recording:** click **Reset**. Check the chips: *AI · Gemini* if you want the live model on camera (warm the cache first), or *AI · recorded*. Either way the chip tells the truth. In the agent log, the tags *Gemini*, *Recorded AI* and *Guardrail* show who did what.
