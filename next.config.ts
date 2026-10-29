import type { NextConfig } from "next";

/**
 * Security headers on every response.
 * Pages refuse to be framed, which protects the OAuth consent screen and /admin from clickjacking; /embed/* shows only
 * example data and stays embeddable. HSTS is sent in production only, without preload, so a self-hosted copy on plain
 * http during setup is not locked out.
 */
const BASE = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  // A self-contained server for the Docker image (node server.js); Vercel ignores it.
  output: "standalone",
  // The admin "Set up tables" action reads the migration files at runtime, so they ship with that function.
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: [...BASE, ...NO_FRAMING] },
      { source: "/embed/:path*", headers: BASE },
    ];
  },
  outputFileTracingIncludes: { "/admin": ["./drizzle/**/*"], "/*": ["./scripts/migrate-on-deploy.mjs"] },
};

export default nextConfig;
