import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  agentRules: false,
  reactStrictMode: false, // Bryntum widgets are imperative; avoid double-mount in dev.
};

export default nextConfig;
