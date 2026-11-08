import type { NextConfig } from "next";

/**
 * Security headers on every response.
 * Pages refuse to be framed, which protects the OAuth consent screen and /admin from clickjacking; /embed/* shows only
 * example data and stays embeddable. HSTS is sent in production only, without preload, so a self-hosted copy on plain
 * http during setup is not locked out.
 *
 * The Content-Security-Policy baseline, the same on every page: no plugins, no <base> pointing elsewhere, forms post
 * only to this site, scripts only from this site. Every native form here posts to this site (server actions and
 * /auth/signout); Buffer sign-in and the OAuth consent answer go through fetch and a page navigation, so form-action
 * never meets a third-party redirect. Vercel Analytics loads /_vercel/insights/script.js from this site. Inline
 * scripts stay allowed because a nonce would make every page render per request; development adds eval for React's
 * debugging stacks and Vercel Analytics' debug script.
 */
const BASE = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];
const DEV = process.env.NODE_ENV === "development";
const SCRIPT_SRC = ["'self'", "'unsafe-inline'", ...(DEV ? ["'unsafe-eval'", "https://va.vercel-scripts.com"] : [])].join(" ");
const POLICY = [`script-src ${SCRIPT_SRC}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'"];
const csp = (extra: string[] = []) => ({ key: "Content-Security-Policy", value: [...POLICY, ...extra].join("; ") });
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  csp(["frame-ancestors 'none'"]),
];

const nextConfig: NextConfig = {
  devIndicators: false,
  // A self-contained server for the Docker image (node server.js); Vercel ignores it.
  output: "standalone",
  // The admin "Set up tables" action reads the migration files at runtime, so they ship with that function.
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: [...BASE, ...NO_FRAMING] },
      { source: "/embed/:path*", headers: [...BASE, csp()] },
    ];
  },
  outputFileTracingIncludes: { "/admin": ["./drizzle/**/*"], "/*": ["./scripts/migrate-on-deploy.mjs"] },
};

export default nextConfig;
