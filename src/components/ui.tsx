"use client";

import { formatMoney } from "@/lib/money";
import type { Worker } from "@/lib/types";

export function Money({ minor, currency, compact }: { minor: number; currency: string; compact?: boolean }) {
  const s = formatMoney(minor, currency, { compact });
  const [amount, code] = [s.slice(0, s.lastIndexOf(" ")), s.slice(s.lastIndexOf(" ") + 1)];
  return (
    <span className="money">
      {amount}
      <span className="money-ccy">{code}</span>
    </span>
  );
}

export function Avatar({ worker, size = 28 }: { worker?: Worker; size?: number }) {
  if (!worker)
    return (
      <span className="avatar avatar-open" style={{ width: size, height: size }}>
        ?
      </span>
    );
  return (
    <span className="avatar" style={{ width: size, height: size, background: worker.color, fontSize: size * 0.4 }}>
      {worker.initials}
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  gemini: "Gemini",
  recorded: "Recorded AI",
  guardrail: "Guardrail",
  owner: "You",
  system: "Clockout",
};

export function SourceTag({ source }: { source: string }) {
  return <span className={`src src-${source}`}>{SOURCE_LABEL[source] ?? source}</span>;
}

export function Icon({ name }: { name: string }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden />;
}
