import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool } from "ai";
import crypto from "node:crypto";
import type { z } from "zod";
import { db } from "../db";
import { assignShiftsInput, recordConstraintsInput, type AssignShiftsInput, type RecordConstraintsInput } from "./schemas";

/**
 * Every model call goes through here: a cache (SQLite, survives demo resets), a
 * rate limiter sized for the Gemini free tier, and a fallback to recorded responses
 * when there is no key, the quota is spent, or the call fails. The status chip
 * reports which path the last call took.
 */
const FALLBACK_MODEL = "gemini-2.5-flash";
const RPM = Number(process.env.AI_RPM || 12);

interface AiState {
  model: string | null;
  /** Newest-first Flash models to try; free-tier quota differs per model and changes often. */
  candidates: string[] | null;
  /** Models that answered "quota exceeded", with the time to try them again. */
  exhausted: Record<string, number>;
  mode: "live" | "recorded";
  detail: string;
  calls: number[];
  /** Models that rejected thinkingLevel "minimal". */
  noMinimalThinking?: string[];
}

declare global {
  var __clockoutAi: AiState | undefined;
}

function state(): AiState {
  if (!globalThis.__clockoutAi) {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    globalThis.__clockoutAi =
      key && process.env.CLOCKOUT_FORCE_MOCK !== "1"
        ? { model: process.env.AI_MODEL || null, candidates: null, exhausted: {}, mode: "live", detail: "Gemini", calls: [] }
        : {
            model: null,
            candidates: [],
            exhausted: {},
            mode: "recorded",
            detail: key ? "Recorded (forced)" : "Recorded: no Gemini key set",
            calls: [],
          };
  }
  return globalThis.__clockoutAi!;
}

export function aiStatus() {
  const s = state();
  return { mode: s.mode, model: s.model, detail: s.detail };
}

/**
 * AI_MODEL wins. Otherwise ask the Gemini API which models exist and take the newest
 * stable "gemini-N.N-flash" that supports generateContent (the free-tier Flash line).
 */
/** Stable "gemini-N.N-flash" ids newest first, then the "-flash-lite" line as a last resort (separate free quota). */
export function rankFlashModels(names: string[]): string[] {
  const rank = (re: RegExp) =>
    names
      .map((n) => n.replace(/^models\//, ""))
      .map((n) => ({ n, m: re.exec(n) }))
      .filter((x) => x.m)
      .map((x) => ({ n: x.n, v: Number(x.m![1]) * 100 + Number(x.m![2] ?? 0) }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.n);
  return [...rank(/^gemini-(\d+)(?:\.(\d+))?-flash$/), ...rank(/^gemini-(\d+)(?:\.(\d+))?-flash-lite$/)];
}

export function pickNewestFlash(names: string[]): string | null {
  return rankFlashModels(names)[0] ?? null;
}

async function candidateModels(): Promise<string[]> {
  const s = state();
  if (process.env.AI_MODEL) return [process.env.AI_MODEL];
  if (!s.candidates) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        headers: { "x-goog-api-key": process.env.GOOGLE_GENERATIVE_AI_API_KEY! },
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const names = (json.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name);
      s.candidates = rankFlashModels(names).slice(0, 8);
    } catch {
      s.candidates = [];
    }
    if (!s.candidates.length) s.candidates = [FALLBACK_MODEL];
  }
  // Prefer the model that last worked, then newest first, skipping ones out of quota.
  const ordered = s.model ? [s.model, ...s.candidates.filter((m) => m !== s.model)] : s.candidates;
  return ordered.filter((m) => (s.exhausted[m] ?? 0) < Date.now());
}

function cacheKey(parts: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function cacheGet<T>(key: string): T | null {
  const row = db().prepare("SELECT value FROM ai_cache WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

function cachePut(key: string, value: unknown) {
  db()
    .prepare("INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), new Date().toISOString());
}

function takeToken(s: AiState): boolean {
  const cutoff = Date.now() - 60_000;
  s.calls = s.calls.filter((t) => t > cutoff);
  if (s.calls.length >= RPM) return false;
  s.calls.push(Date.now());
  return true;
}

/** Google's "model is overloaded" (503 / UNAVAILABLE): worth trying the next model, not a quota problem. */
export function isOverloaded(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string; lastError?: { statusCode?: number } };
  const code = err?.statusCode ?? err?.lastError?.statusCode;
  return code === 503 || /UNAVAILABLE|overloaded|high demand/i.test(String(err?.message ?? ""));
}

export function isRateLimit(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string; lastError?: { statusCode?: number }; cause?: unknown };
  const code = err?.statusCode ?? err?.lastError?.statusCode;
  return code === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(String(err?.message ?? ""));
}

export type AiSource = "gemini" | "recorded";

export interface AiResult<T> {
  value: T;
  source: AiSource;
  cached: boolean;
}

/**
 * Forces one tool call with a zod-validated input and returns that input.
 * `fallback` produces the recorded answer when the live path is unavailable.
 */
async function callTool<S extends z.ZodType, T = z.infer<S>>(opts: {
  name: string;
  description: string;
  schema: S;
  instructions: string;
  prompt: string;
  fallback: () => T;
}): Promise<AiResult<T>> {
  const s = state();
  if (s.mode !== "live") return { value: opts.fallback(), source: "recorded", cached: false };

  // Keyed on the request, not the model, so a cached answer is reused whichever model gave it.
  const key = cacheKey([opts.name, opts.instructions, opts.prompt]);
  const hit = cacheGet<T>(key);
  if (hit) return { value: hit, source: "gemini", cached: true };

  const models = (await candidateModels()).slice(0, 8);
  if (!models.length) {
    s.detail = "Recorded: Gemini free tier rate-limited";
    return { value: opts.fallback(), source: "recorded", cached: false };
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  for (const model of models) {
    if (!takeToken(s)) {
      s.detail = `Recorded: local limit of ${RPM} calls/min reached`;
      return { value: opts.fallback(), source: "recorded", cached: false };
    }
    const started = Date.now();
    try {
      const result = await generateText({
        model: google(model),
        instructions: opts.instructions,
        prompt: opts.prompt,
        tools: { [opts.name]: tool({ description: opts.description, inputSchema: opts.schema }) },
        toolChoice: { type: "tool", toolName: opts.name },
        maxRetries: 0,
        timeout: 30_000,
        // Structured extraction, not open reasoning: keep thinking minimal so the demo stays snappy.
        providerOptions: {
          google: {
            // Gemini 3.x takes thinkingLevel; older models (2.5) reject it and take a zero thinking budget instead.
            thinkingConfig: s.noMinimalThinking?.includes(model) ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" as const },
          },
        },
      });
      const call = result.toolCalls.find((c) => c.toolName === opts.name);
      if (!call) throw new Error("Model did not call the tool");
      console.info(`[ai] ${opts.name} answered by ${model} in ${Date.now() - started}ms`);
      const value = opts.schema.parse(call.input) as T;
      cachePut(key, value);
      s.model = model;
      s.detail = `Gemini · ${model}`;
      return { value, source: "gemini", cached: false };
    } catch (e) {
      if (isRateLimit(e)) {
        // Out of quota on this model: park it for a few minutes and try the next Flash model down.
        s.exhausted[model] = Date.now() + 5 * 60_000;
        s.detail = "Recorded: Gemini free tier rate-limited";
        const body = String((e as { responseBody?: string }).responseBody ?? (e as Error).message);
        const quota = /"quotaId":\s*"([^"]+)"/.exec(body)?.[1] ?? "";
        console.warn(`[ai] ${model} is rate-limited${quota ? ` (${quota})` : ""}; trying the next model`);
        continue;
      }
      if (/thinking level/i.test(String((e as Error).message)) && !s.noMinimalThinking?.includes(model)) {
        // Some models reject thinkingLevel "minimal": remember that and retry this model without it.
        s.noMinimalThinking = [...(s.noMinimalThinking ?? []), model];
        models.splice(models.indexOf(model) + 1, 0, model);
        console.warn(`[ai] ${model} rejects minimal thinking; retrying without it`);
        continue;
      }
      if (isOverloaded(e) || /aborted due to timeout|timed? ?out/i.test(String((e as Error).message))) {
        s.exhausted[model] = Date.now() + 60_000;
        s.detail = "Recorded: Gemini overloaded";
        console.warn(`[ai] ${model} is overloaded; trying the next model`);
        continue;
      }
      s.detail = `Recorded: Gemini error (${String((e as Error).message).slice(0, 60)})`;
      console.warn("[ai] falling back to recorded response:", (e as Error).message);
      return { value: opts.fallback(), source: "recorded", cached: false };
    }
  }
  return { value: opts.fallback(), source: "recorded", cached: false };
}

export function extractConstraints(args: {
  instructions: string;
  prompt: string;
  fallback: () => RecordConstraintsInput;
}): Promise<AiResult<RecordConstraintsInput>> {
  return callTool({
    name: "record_constraints",
    description: "Record the scheduling constraints stated in each worker message.",
    schema: recordConstraintsInput,
    ...args,
  });
}

export function assignShifts(args: {
  instructions: string;
  prompt: string;
  fallback: () => AssignShiftsInput;
}): Promise<AiResult<AssignShiftsInput>> {
  return callTool({
    name: "assign_shifts",
    description: "Assign workers to open shifts. Every assignment is checked against hard rules before it is applied.",
    schema: assignShiftsInput,
    ...args,
  });
}
