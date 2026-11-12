// Split a narration file into N parts at its N-1 longest pauses. usage: node split.js <audio> <outDir> [parts=8]
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [src, out, nArg] = process.argv.slice(2);
const N = Number(nArg || 8);
fs.mkdirSync(out, { recursive: true });
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString());
const log = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", src, "-af", "silencedetect=noise=-38dB:d=0.35", "-f", "null", "-"]).stderr.toString();
const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
let sil = starts.map((s, i) => ({ s, e: ends[i] ?? dur })).map((x) => ({ ...x, d: x.e - x.s }));
const head = sil.find((x) => x.s < 0.05);
const tail = sil.find((x) => x.e > dur - 0.05);
const inner = sil.filter((x) => x !== head && x !== tail).sort((a, b) => b.d - a.d);
console.log("pauses (longest first):", inner.slice(0, N + 4).map((x) => `${x.s.toFixed(2)}s/${x.d.toFixed(2)}s`).join("  "));
if (inner.length < N - 1) throw new Error(`only ${inner.length} pauses found, need ${N - 1}`);
const cuts = inner.slice(0, N - 1).sort((a, b) => a.s - b.s);
console.log(`shortest chosen pause ${cuts.reduce((m, x) => Math.min(m, x.d), 9).toFixed(2)}s, longest rejected ${(inner[N - 1]?.d ?? 0).toFixed(2)}s`);
const PAD = 0.06;
const edges = [head ? head.e : 0, ...cuts.flatMap((c) => [c.s, c.e]), tail ? tail.s : dur];
const durations = [];
for (let i = 0; i < N; i++) {
  const a = Math.max(0, edges[2 * i] - PAD), b = Math.min(dur, edges[2 * i + 1] + PAD);
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", src, "-ss", String(a), "-to", String(b), "-c:a", "pcm_s16le", "-ar", "48000", `${out}/part${i + 1}.wav`]);
  durations.push(Number((b - a).toFixed(3)));
  console.log(`part${i + 1}: ${a.toFixed(2)} → ${b.toFixed(2)}  (${(b - a).toFixed(2)}s)`);
}
fs.writeFileSync(`${out}/durations.json`, JSON.stringify(durations));
console.log("speech total", durations.reduce((a, b) => a + b, 0).toFixed(1), "s of", dur.toFixed(1), "s");
