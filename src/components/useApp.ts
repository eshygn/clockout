"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/types";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

/** One source of truth: every mutation returns the full server state. */
export function useApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    setState(await res.json());
  }, []);

  const act = useCallback(
    async <T = unknown>(label: string, url: string, body?: unknown, method = "POST"): Promise<T | null> => {
      setBusy(label);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json();
        if (json.state) setState(json.state);
        if (!json.ok) {
          toast("error", json.error ?? "Something went wrong");
          return null;
        }
        return json.result as T;
      } catch (e) {
        toast("error", (e as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  useEffect(() => {
    let live = true;
    fetch("/api/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: AppState) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  // While PayPal still has items in flight, poll for their status.
  const pending = state?.items.some((i) => i.status === "PENDING") ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/payouts/refresh", { method: "POST" });
      const json = await res.json();
      if (json.state) setState(json.state);
    }, 1500);
    return () => clearInterval(t);
  }, [pending]);

  return { state, busy, act, toast, toasts, reload: load };
}
