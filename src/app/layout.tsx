import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clockout: rotas that run themselves, crews paid at clock-out",
  description:
    "An AI agent turns your crew's texts into a rota on a Bryntum Scheduler, and pays each freelancer with PayPal Payouts the moment you approve their hours.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1B1F2A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
