// Drives the Clockout demo in a headed Chromium on an X display and captures it with ffmpeg.
// usage: xvfb-run -a -s "-screen 0 1440x900x24" node record.js <baseUrl> <outDir> <durations.json> [--expect-live] [--no-capture]
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [base, outDir, durFile, ...flags] = process.argv.slice(2);
const EXPECT_LIVE = flags.includes("--expect-live");
const CAPTURE = !flags.includes("--no-capture");
const D = JSON.parse(fs.readFileSync(durFile, "utf8")); // seconds of narration per step (8)
const LEAD = 0.1; // narration starts this long after the step starts
const TAIL = 0.2; // breathing room after narration
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = [];
const mark = (name, extra = {}) => {
  marks.push({ name, t: Date.now(), ...extra });
  console.log(`[mark] ${name}`, extra.note ?? "");
};

const OVERLAY = () => {
  const css = document.createElement("style");
  css.textContent = `
  .rec-ripple{position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
    background:rgba(255,122,26,.45);box-shadow:0 0 0 2px rgba(255,122,26,.9);animation:rec-rip .65s ease-out forwards}
  @keyframes rec-rip{from{transform:scale(.5);opacity:1}to{transform:scale(3.6);opacity:0}}
  .rec-ring{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid rgba(255,122,26,.42);
    box-shadow:0 0 0 4px rgba(255,122,26,.10);opacity:0;transition:opacity .15s ease}`;
  const ring = document.createElement("div");
  ring.className = "rec-ring";
  const mount = () => {
    if (!document.documentElement) return;
    document.documentElement.append(css, ring);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  const SEL = "button, [role=tab], .b-sch-event, .msg, summary, .b-cal-event";
  let target = null;
  let down = false;
  window.addEventListener(
    "mousedown",
    (e) => {
      down = true;
      const r = document.createElement("div");
      r.className = "rec-ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.append(r);
      setTimeout(() => r.remove(), 700);
    },
    true,
  );
  window.addEventListener("mouseup", () => (down = false), true);
  window.addEventListener(
    "mousemove",
    (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      target = el && el.closest ? el.closest(SEL) : null;
      if (target && target.disabled) target = null;
    },
    true,
  );
  const tick = () => {
    if (target && target.isConnected && !down) {
      const b = target.getBoundingClientRect();
      const rad = parseFloat(getComputedStyle(target).borderRadius) || 6;
      ring.style.left = b.left - 4 + "px";
      ring.style.top = b.top - 4 + "px";
      ring.style.width = b.width + 4 + "px";
      ring.style.height = b.height + 4 + "px";
      ring.style.borderRadius = rad + 4 + "px";
      ring.style.opacity = "1";
    } else ring.style.opacity = "0";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  const state = async () => (await fetch(`${base}/api/state`)).json();
  await fetch(`${base}/api/demo/reset`, { method: "POST" });

  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: null,
    args: [`--app=${base}/`, "--window-size=1440,900", "--window-position=0,0", "--hide-scrollbars", "--disable-infobars", "--force-device-scale-factor=1"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  await ctx.addInitScript(OVERLAY);
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent("page"));
  await page.goto(`${base}/`, { waitUntil: "networkidle" }); // reload so the init script is in
  await page.waitForSelector(".b-sch-event", { timeout: 30000 });
  await sleep(1500);
  const size = await page.evaluate(() => [innerWidth, innerHeight]);
  if (size[0] !== 1440 || size[1] !== 900) throw new Error(`viewport is ${size}, want 1440x900`);

  const chip = async () => (await page.locator(".chips .chip").first().innerText()).trim();
  const assertChip = async (when) => {
    const c = await chip();
    console.log(`[chip] ${when}: ${c}`);
    if (EXPECT_LIVE && /recorded/i.test(c)) throw new Error(`AI chip reads "${c}" ${when}; aborting`);
    return c;
  };
  await assertChip("before recording");

  // ---- mouse helpers -------------------------------------------------------
  let mx = 720,
    my = 880;
  await page.mouse.move(mx, my);
  const glide = async (x, y, ms = 450) => {
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e);
      if (k >= 1) break;
      await sleep(12);
    }
    mx = x;
    my = y;
  };
  const center = async (loc) => {
    const b = await loc.boundingBox();
    if (!b) throw new Error("no box for " + loc);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const hoverClick = async (loc, dwell = 550) => {
    await loc.scrollIntoViewIfNeeded();
    const [x, y] = await center(loc);
    await glide(x, y);
    await sleep(dwell);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
  };
  const park = () => glide(700, 52, 350); // rest somewhere with nothing to ring

  // ---- capture -------------------------------------------------------------
  let ff = null;
  const video = path.join(outDir, "screen.mkv");
  if (CAPTURE) {
    ff = spawn(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", "1440x900",
        "-i", process.env.DISPLAY + "+0,0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", "-copyts", video],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    await sleep(1500);
  }

  // ---- pacing --------------------------------------------------------------
  let stepStart = 0;
  let stepIdx = -1;
  const begin = (i) => {
    stepIdx = i;
    stepStart = Date.now();
    mark(`step${i + 1}`);
  };
  /** wait until `frac` of this step's narration has been spoken */
  const until = async (sec) => {
    const due = stepStart + (LEAD + sec) * 1000;
    if (due > Date.now()) await sleep(due - Date.now());
  };
  const finish = async () => {
    const due = stepStart + (LEAD + D[stepIdx] + TAIL) * 1000;
    const over = Date.now() - due;
    if (over > 0) console.log(`[pace] step${stepIdx + 1} ran ${(over / 1000).toFixed(1)}s past its narration`);
    else await sleep(-over);
  };

  // 1 · opening hold
  begin(0);
  await finish();

  // 2 · agent handles the six messages
  begin(1);
  const agentBtn = page.locator(".btn-agent");
  const hoverMsg = async (re) => {
    const m = page.locator(".msg", { hasText: re }).first();
    await m.scrollIntoViewIfNeeded();
    await sleep(150);
    const [x, y] = await center(m);
    await glide(x, y, 500);
  };
  await until(0.8);
  await hoverMsg(/./);
  await until(2.6);
  await hoverMsg(/wedding/i);
  await until(5.4);
  await hoverMsg(/exam/i);
  await until(7.9);
  await hoverClick(agentBtn);
  mark("agent6-click");
  await page.waitForFunction(() => /working/i.test(document.querySelector(".btn-agent")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !/working/i.test(document.querySelector(".btn-agent")?.textContent ?? ""), null, { timeout: 120000 });
  mark("agent6-done");
  await park();
  await assertChip("after the agent run");
  await finish();

  // 3 · drag a Saturday shift onto Maya (refused), then onto someone who can take it
  begin(2);
  const s3 = await state();
  const plan = pickDrag(s3);
  console.log("[drag]", JSON.stringify(plan));
  await page.evaluate((iso) => {
    const s = window.bryntum.query("schedulerpro");
    return s.scrollToDate(new Date(iso), { block: "center", animate: 700 });
  }, plan.mid);
  await sleep(1100);
  const bar = page.locator(`.b-sch-event-wrap[data-event-id="${plan.shiftId}"] .b-sch-event`);
  const rowY = async (wid) => {
    const b = await page.locator(`.rota-sched .b-grid-sub-grid-normal .b-grid-row[data-id="${wid}"]`).boundingBox();
    return b.y + b.height / 2;
  };
  const dragTo = async (wid, holdMs) => {
    const [bx, by] = await center(bar);
    await glide(bx, by);
    await sleep(500);
    await page.mouse.down();
    await sleep(150);
    await glide(bx + 6, by + 4, 120);
    await glide(bx, await rowY(wid), 900);
    await sleep(holdMs);
    await page.mouse.up();
  };
  await until(3.0);
  await dragTo("w_maya", 2900);
  mark("drag-refused", { note: plan.refusal });
  await sleep(600);
  await until(9.4);
  await dragTo(plan.to, 700);
  mark("drag-ok", { note: plan.to });
  await sleep(500);
  await park();
  await finish();

  // 4 · Friday 07:30
  begin(3);
  await until(0.2);
  await hoverClick(page.locator(".btn-clock"));
  mark("fri0730-click");
  await page.waitForFunction(() => document.querySelector(".clock-time")?.textContent?.trim() === "07:30" && !document.querySelector(".btn-clock")?.disabled, null, { timeout: 120000 });
  mark("fri0730-done");
  await park();
  await finish();

  // 5 · sick call
  begin(4);
  await until(1.2);
  await hoverMsg(/./);
  await until(5.9);
  await hoverClick(agentBtn);
  mark("sick-click");
  await page.waitForFunction(() => /working/i.test(document.querySelector(".btn-agent")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !/working/i.test(document.querySelector(".btn-agent")?.textContent ?? ""), null, { timeout: 120000 });
  mark("sick-done");
  await park();
  await assertChip("after the sick call");
  await finish();

  // 6 · Friday 23:45, hover a gala bar, approve & pay
  begin(5);
  await until(0.1);
  await hoverClick(page.locator(".btn-clock"));
  mark("fri2345-click");
  await page.waitForFunction(() => document.querySelector(".clock-time")?.textContent?.trim() === "23:45", null, { timeout: 60000 });
  await page.waitForSelector(".b-sch-event.co-completed", { timeout: 20000 });
  await sleep(900);
  await until(3.2);
  const gala = page.locator(".b-sch-event.co-completed").first();
  const [gx, gy] = await center(gala);
  await glide(gx, gy, 600);
  await glide(gx + 3, gy + 1, 100);
  mark("gala-hover");
  await sleep(2500);
  await until(8.3);
  const pay = page.locator(".btn-pay");
  const payLabel = (await pay.innerText()).trim();
  await hoverClick(pay, 700);
  mark("pay-click", { note: payLabel });
  await page.waitForFunction(() => !document.querySelector(".b-sch-event.co-completed"), null, { timeout: 60000 });
  await park();
  const paidWait = Date.now();
  let settled = false;
  let settledAll = false;
  while (Date.now() - paidWait < 30000) {
    const s = await state();
    const last = s.batches[0];
    const mine = s.items.filter((i) => i.batchId === last?.id);
    if (mine.length && mine.every((i) => !/PENDING|PROCESSING|SENDING|NEW|ONHOLD/i.test(i.status || "NEW"))) {
      settledAll = mine.every((i) => i.status === "SUCCESS");
      settled = true;
      break;
    }
    await sleep(700);
  }
  mark(settled ? "pay-settled" : "pay-not-settled", { note: settledAll ? "all SUCCESS" : "not all SUCCESS" });
  await sleep(600);
  await finish();

  // 7 · Worker's week
  begin(6);
  await until(0.2);
  await hoverClick(page.locator('[role=tab]:has-text("Worker")').first());
  mark("week-tab");
  await sleep(900);
  const maya = page.locator('.ww-pick button:has-text("Maya")');
  if ((await maya.getAttribute("aria-selected")) !== "true") await hoverClick(maya);
  await park();
  await finish();

  // 8 · back to the rota, hold
  begin(7);
  await until(0.2);
  await hoverClick(page.locator('.tabs [role=tab]:has-text("Rota")').first());
  mark("rota-tab");
  await park();
  await finish();
  await sleep(1200);
  mark("end");

  const final = await state();
  if (ff) {
    ff.stdin.write("q");
    await new Promise((r) => ff.on("close", r));
  }
  fs.writeFileSync(
    path.join(outDir, "run.json"),
    JSON.stringify(
      {
        marks,
        durations: D,
        lead: LEAD,
        chip: await chip(),
        status: final.status,
        plan,
        batches: final.batches.map((b) => ({ label: b.label, status: b.status, mode: b.mode, paypalBatchId: b.paypalBatchId, items: final.items.filter((i) => i.batchId === b.id).map((i) => i.status) })),
        sources: [...new Set(final.actions.map((a) => a.source))],
      },
      null,
      1,
    ),
  );
  await ctx.close();
  console.log("done");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

// Mirror of src/lib/scheduling.ts checkAssignment, to choose a drag the app will refuse for Maya and accept for someone else.
function pickDrag(s) {
  const min = (iso) => Date.parse(iso + ":00Z") / 60000;
  const overlaps = (a1, a2, b1, b2) => min(a1) < min(b2) && min(b1) < min(a2);
  const hours = (wid, skip) => s.shifts.filter((x) => x.workerId === wid && x.id !== skip).reduce((a, x) => a + (min(x.end) - min(x.start)) / 60, 0);
  const cap = (w) => Math.min(w.maxHours, ...s.constraints.filter((c) => c.workerId === w.id && c.kind === "max_hours" && c.hours != null).map((c) => c.hours));
  const ok = (sh, w) =>
    w.roles.includes(sh.role) &&
    !s.constraints.some((c) => c.workerId === w.id && c.kind === "unavailable" && c.start && c.end && overlaps(sh.start, sh.end, c.start, c.end)) &&
    !s.shifts.some((o) => o.id !== sh.id && o.workerId === w.id && overlaps(sh.start, sh.end, o.start, o.end)) &&
    hours(w.id, sh.id) + (min(sh.end) - min(sh.start)) / 60 <= cap(w);
  const maya = s.workers.find((w) => w.id === "w_maya");
  const sat = s.shifts.filter((x) => x.start.startsWith("2026-11-14") && x.workerId && x.workerId !== "w_maya" && x.status === "booked");
  // Prefer a shift Maya is qualified for, so the refusal on screen is about her Saturday, not her role.
  sat.sort((a, b) => Number(maya.roles.includes(b.role)) - Number(maya.roles.includes(a.role)));
  for (const sh of sat) {
    if (ok(sh, maya)) continue;
    const to = s.workers.find((w) => w.id !== "w_maya" && w.id !== sh.workerId && ok(sh, w));
    if (to) {
      const mid = new Date((Date.parse(sh.start + ":00") + Date.parse(sh.end + ":00")) / 2).toISOString();
      return { shiftId: sh.id, from: sh.workerId, to: to.id, role: sh.role, mid, refusal: "Maya can't take it" };
    }
  }
  throw new Error("No Saturday shift fits the drag story (refused for Maya, accepted for another worker)");
}
