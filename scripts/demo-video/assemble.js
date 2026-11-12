// usage: node assemble.js <runDir> <partsDir> <out.mp4>
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const [runDir, partsDir, out] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(`${runDir}/run.json`, "utf8"));
const video = `${runDir}/screen.mkv`;
const v0 = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", video]).toString());
const M = Object.fromEntries(run.marks.map((m) => [m.name, m]));
const origin = M.step1.t / 1000; // output t=0
const raw = (name) => M[name].t / 1000 - origin;
// Trim silent waits on live services: from the end of a step's narration to just before the result lands.
const cuts = [];
const addCut = (step, doneMark) => {
  const a = raw(`step${step}`) + run.lead + run.durations[step - 1] + 0.3, b = raw(doneMark) - 0.7;
  if (b - a > 2) cuts.push([a, b]);
};
addCut(5, "sick-done");
addCut(6, M["pay-settled"] ? "pay-settled" : "pay-not-settled");
const shift = (t) => t - cuts.reduce((n, [a, b]) => n + (t >= b ? b - a : t > a ? t - a : 0), 0);
const at = (name) => shift(raw(name));
const rawTotal = raw("end");
const total = shift(rawTotal);

// captions on the PayPal moments, worded from what actually happened in this run
const live = run.status.paypal.mode === "live";
const where = live ? "PayPal sandbox" : "PayPal (mock)";
const monThu = run.batches.find((b) => /Mon/.test(b.label));
const gala = run.batches.find((b) => !/Mon/.test(b.label));
const caps = [];
if (monThu)
  caps.push({ a: at("fri0730-click") + 0.3, b: Math.min(at("step5") - 0.2, at("fri0730-done") + 4), text: `${where} · one Payouts batch · ${monThu.items.length} shifts · batch ${monThu.paypalBatchId}` });
if (gala) {
  const ok = gala.items.every((s) => s === "SUCCESS");
  caps.push({ a: at("pay-click") + 0.2, b: Math.min(at("step7") - 0.2, at("pay-click") + 9), text: `${where} · Approve & pay · ${gala.items.length} workers · batch ${gala.paypalBatchId}${ok ? " · PENDING → SUCCESS" : ""}` });
}
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${String(m).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`; };
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 900

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,26,&H00FFFFFF,&H00FFFFFF,&H1A201A14,&H1A201A14,-1,0,0,0,100,100,0,0,3,10,0,2,40,40,34,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${caps.map((c) => `Dialogue: 0,${ts(c.a)},${ts(c.b)},Cap,,0,0,0,,{\\fad(250,250)}${c.text}`).join("\n")}
`;
fs.writeFileSync(`${runDir}/captions.ass`, ass);

const args = ["-nostdin", "-y", "-loglevel", "error", "-ss", String(origin - v0), "-t", String(rawTotal), "-i", video];
const fl = [];
for (let i = 1; i <= 8; i++) {
  args.push("-i", `${partsDir}/part${i}.wav`);
  const ms = Math.round((at(`step${i}`) + run.lead) * 1000);
  fl.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}:all=1[a${i}]`);
}
fl.push(`${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `[a${i}]`).join("")}amix=inputs=8:normalize=0:duration=longest,apad[a]`);
fl.push(`[0:v]fps=30,setpts=PTS-STARTPTS${cuts.length ? `,select='not(${cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+")})',setpts=N/30/TB` : ""},ass=${runDir}/captions.ass,fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p[v]`);
args.push("-filter_complex", fl.join(";"), "-map", "[v]", "-map", "[a]", "-t", String(total), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log("captions:", caps.map((c) => `${c.a.toFixed(1)}–${c.b.toFixed(1)}s ${c.text}`).join("\n          "));
console.log("cuts:", cuts.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}s`).join(", ") || "none");
console.log(`length ${total.toFixed(1)}s ${total < 180 ? "(under 3:00)" : "!! OVER 3:00"}`);
