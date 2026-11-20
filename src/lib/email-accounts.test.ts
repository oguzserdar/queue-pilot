/**
 * @fileoverview Email accounts through the real Better Auth handlers: sign-up with verification, sign-in, password
 * reset, and what each answer reveals. Mail is captured instead of sent; every link is followed the way a person would.
 */
import { describe, expect, it, vi } from "vitest";
import type { Mail, Mailer } from "./mail";

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({ db: () => ({}), schema: {} }));
const tables: Record<string, unknown[]> = {};
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  for (const t of ["user", "session", "account", "verification", "jwks", "rateLimit", "oauthClient", "oauthResource", "oauthConsent", "oauthAccessToken", "oauthRefreshToken"]) tables[t] = [];
  return { drizzleAdapter: () => memoryAdapter(tables) };
});
vi.mock("./starting-rule", () => ({ seedStartingRuleSafely: async () => {} }));
// The one-inbox lookup runs on the real database in canonical-email.test.ts; here it answers from the memory tables.
vi.mock("./canonical-email", async (orig) => {
  const real = await orig<typeof import("./canonical-email")>();
  return { ...real, inboxTaken: async (email: string, except: string) => (tables.user as { id: string; email: string; emailVerified: boolean }[]).some((u) => u.id !== except && u.emailVerified && real.canonicalEmail(u.email) === real.canonicalEmail(email)) };
});
vi.mock("./security-events", () => ({ recordSecurityEvent: async () => {} }));
const { buildAuth } = await import("./auth");
// Password hashing is slow on purpose (scrypt), and these tests hash many times; a busy machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

const baseURL = "https://qp.example";
const secret = "email-accounts-test-".padEnd(40, "x");
const sent: Mail[] = [];
const mailer: Mailer = { key: "test", send: async (m) => { sent.push(m); } };
const auth = buildAuth({ clientId: "test", secret, baseURL, mail: mailer });
const noMail = buildAuth({ clientId: "test", secret, baseURL, mail: null });

const post = (a: typeof auth, path: string, body: unknown, headers: Record<string, string> = {}) =>
  a.handler(new Request(`${baseURL}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: baseURL, ...headers }, body: JSON.stringify(body) }));
const linkIn = (m: Mail) => m.text.match(/https?:\/\/\S+/)![0];
const lastTo = (to: string) => [...sent].reverse().find((m) => m.to === to)!;
const signIn = (email: string, password: string) => post(auth, "/sign-in/email", { email, password });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe("email accounts", () => {
  it("are off when the server has no mail sender", async () => {
    const res = await post(noMail, "/sign-up/email", { email: "nomail@example.com", password: "a-long-password-1", name: "No Mail" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Control: the refusal is "email accounts are off", not some other check; the same request works with a sender.
    expect(JSON.stringify(await res.json())).toMatch(/not enabled|disabled/i);
    expect((await post(auth, "/sign-up/email", { email: "withmail@example.com", password: "a-long-password-1", name: "With Mail" })).status).toBe(200);
  });

  it("sign up, verify by the mailed link, then sign in; sign-in before verifying is refused", async () => {
    const email = "ada@example.com", password = "correct-horse-battery";
    const up = await post(auth, "/sign-up/email", { email, password, name: "Ada" });
    expect(up.status).toBe(200);
    const verify = lastTo(email);
    expect(verify.subject).toMatch(/Confirm your email/);
    expect(linkIn(verify).startsWith(`${baseURL}/api/auth/verify-email?token=`)).toBe(true);
    expect((await signIn(email, password)).status).toBe(403);
    const followed = await auth.handler(new Request(linkIn(verify)));
    expect(followed.status).toBeLessThan(400);
    expect((await signIn(email, password)).status).toBe(200);
  });

  it("answers a sign-up with a used email the same way, mails the owner a notice, and makes no second account", async () => {
    const email = "used@example.com";
    const first = await post(auth, "/sign-up/email", { email, password: "first-password-123", name: "First" });
    const again = await post(auth, "/sign-up/email", { email, password: "other-password-456", name: "Someone" });
    expect(again.status).toBe(first.status);
    expect(Object.keys(await again.json()).sort()).toEqual(Object.keys(await first.json()).sort());
    expect(lastTo(email).subject).toMatch(/already have a Queue Pilot account/);
    expect(tables.user.filter((u) => (u as { email: string }).email === email)).toHaveLength(1);
  });

  it("answers a reset for an unknown email like a known one, and mails only the known one", async () => {
    const before = sent.length;
    const unknown = await post(auth, "/request-password-reset", { email: "nobody@example.com", redirectTo: "/reset-password" });
    const known = await post(auth, "/request-password-reset", { email: "ada@example.com", redirectTo: "/reset-password" });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    const mails = sent.slice(before);
    expect(mails.map((m) => m.to)).toEqual(["ada@example.com"]);
  });

  it("builds mailed links from the configured address, not a forged Host or X-Forwarded-Host", async () => {
    const before = sent.length;
    await post(auth, "/request-password-reset", { email: "ada@example.com", redirectTo: "/reset-password" }, { host: "evil.example", "x-forwarded-host": "evil.example" });
    const link = linkIn(sent[before]);
    expect(new URL(link).origin).toBe(baseURL);
    expect(link).not.toContain("evil.example");
  });

  it("a reset by the mailed link sets the new password and ends the other sessions", async () => {
    const email = "ada@example.com";
    const other = await signIn(email, "correct-horse-battery");
    expect(other.status).toBe(200);
    const otherCookie = cookieOf(other);
    await post(auth, "/request-password-reset", { email, redirectTo: "/reset-password" });
    const link = new URL(linkIn(lastTo(email)));
    const landed = await auth.handler(new Request(link));
    const token = new URL(landed.headers.get("location")!, baseURL).searchParams.get("token");
    expect(token).toBeTruthy();
    expect((await post(auth, "/reset-password", { token, newPassword: "a-new-long-password" })).status).toBe(200);
    expect((await signIn(email, "correct-horse-battery")).status).toBe(401);
    expect((await signIn(email, "a-new-long-password")).status).toBe(200);
    const session = await auth.handler(new Request(`${baseURL}/api/auth/get-session`, { headers: { cookie: otherCookie } }));
    expect(await session.json()).toBeNull();
    // The same link works once.
    expect((await post(auth, "/reset-password", { token, newPassword: "yet-another-password" })).status).toBeGreaterThanOrEqual(400);
  });

  it("lets a Buffer-only account set a password only through the link mailed to its own address", async () => {
    const id = "buffer-user";
    tables.user.push({ id, name: "Buffer Person", email: "buffer@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    tables.account.push({ id: "acc-b", userId: id, providerId: "buffer", accountId: "b-1", createdAt: new Date(), updatedAt: new Date() });
    expect((await signIn("buffer@example.com", "any-password-123")).status).toBe(401);
    await post(auth, "/request-password-reset", { email: "buffer@example.com", redirectTo: "/reset-password" });
    const landed = await auth.handler(new Request(linkIn(lastTo("buffer@example.com"))));
    const token = new URL(landed.headers.get("location")!, baseURL).searchParams.get("token");
    expect((await post(auth, "/reset-password", { token, newPassword: "buffer-person-pass" })).status).toBe(200);
    expect((await signIn("buffer@example.com", "buffer-person-pass")).status).toBe(200);
    expect(tables.user.filter((u) => (u as { email: string }).email === "buffer@example.com")).toHaveLength(1);
  });

  it("will not verify a second account for the same inbox (a Gmail dot or + variant of a verified one)", async () => {
    await post(auth, "/sign-up/email", { email: "grace.h@gmail.com", password: "first-inbox-pass", name: "Grace" });
    await auth.handler(new Request(linkIn(lastTo("grace.h@gmail.com"))));
    expect((await signIn("grace.h@gmail.com", "first-inbox-pass")).status).toBe(200);
    await post(auth, "/sign-up/email", { email: "graceh+2@gmail.com", password: "second-inbox-pass", name: "Grace 2" });
    const verify = await auth.handler(new Request(linkIn(lastTo("graceh+2@gmail.com"))));
    expect(verify.status === 403 || (verify.headers.get("location") ?? "").includes("error")).toBe(true);
    expect((await signIn("graceh+2@gmail.com", "second-inbox-pass")).status).toBe(403);
  });
});
