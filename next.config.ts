import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-mode indicator sits bottom-left, the same corner where the
  // chat composer's send button lands in this RTL layout — disable it so it never
  // blocks a click during local development.
  devIndicators: false,
  // Produces a minimal, self-contained server bundle (.next/standalone) for Docker.
  output: "standalone",
  // better-sqlite3 is a native module (compiled .node binary) — must stay external
  // rather than get bundled, and this also makes the standalone output tracer
  // copy its native binary into .next/standalone/node_modules correctly.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
