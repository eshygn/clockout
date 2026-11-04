"use client";

import dynamic from "next/dynamic";

// Bryntum widgets touch the DOM on import, so the whole dashboard renders client-side only.
const Dashboard = dynamic(() => import("./Dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => (
    <div className="boot">
      <div className="boot-mark">
        clock<span>out</span>
      </div>
      <p>Loading the week…</p>
    </div>
  ),
});

export function ClientApp() {
  return <Dashboard />;
}
