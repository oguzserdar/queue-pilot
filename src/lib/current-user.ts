/**
 * Who is signed in (Better Auth session), resolved once per request (React cache) and shared by the layout and every page.
 * Buffer data comes from the user's snapshot (buffer/snapshot.ts), keyed by the Better Auth user id like the AI connector's,
 * so a page view makes no Buffer call: an old copy is shown at once and synced in the background by the browser
 * (components/buffer-sync.tsx). Only a first visit, with no copy yet, asks Buffer. Any failure means "signed out" plus a server log.
 */
import { headers } from "next/headers";
import { cache } from "react";
import { getAuth } from "./auth";
import { isAdminRole, roleOf } from "./admin-role";
import { deviceName } from "./device-name";
import { displayName, storedPortrait } from "./profile-display";
import { approvedApps, type ApprovedApp } from "./ai-access";
import type { RateLimitWindow } from "./buffer/client";
import type { Channel, Post } from "./buffer/queries";
import { MIN_REFRESH_MS, refreshSnapshot, withScheduled } from "./buffer/snapshot";
import { postgresSnapshotStore } from "./buffer/snapshot-store";
import { knownRange } from "./open-slots";
import { bufferAccessToken } from "./buffer-token";
import { scheduleEcho } from "./echo-run";
import { hasDatabase } from "./db";
import { readConfig } from "./env";

export type BufferContext = {
  email: string;
  /** The timezone times are shown in: the first channel's, else the account's own in Buffer, else UTC. */
  timeZone: string;
  organizationIds: string[];
  channels: Channel[];
  /** Posts due from 7 days ago to 14 days ahead, as of fetchedAt. */
  posts: Post[];
  fetchedAt: Date;
  /** True when the copy is older than MIN_REFRESH_MS; the browser then syncs it in the background. */
  needsRefresh: boolean;
  /** Buffer's RateLimit windows as of fetchedAt. */
  rateLimit: RateLimitWindow[];
};

/**
 * The auth instance and this request's session, read once per request and shared by every helper below. Logs why
 * sign-in is closed when the deployment is not configured.
 */
const currentSession = cache(async () => {
  const auth = await getAuth();
  if (!auth) {
    const r = await readConfig();
    console.warn(JSON.stringify({ event: "qp-sign-in-closed", database: hasDatabase(), missing: r.ok ? [] : r.missing }));
    return { auth: null, session: null };
  }
  return { auth, session: await auth.api.getSession({ headers: await headers() }) };
});

/** The signed-in user id, or null, with the auth instance. */
async function sessionUser() {
  const { auth, session } = await currentSession();
  return { auth, userId: session?.user.id ?? null };
}

/**
 * The AI apps the signed-in user approved to use the connector, each with when it last called Queue Pilot. Null when
 * nobody is signed in or the records cannot be read, so the screen never claims what it cannot back.
 */
export const approvedAiApps = cache(async (): Promise<ApprovedApp[] | null> => {
  const { auth, userId } = await sessionUser();
  if (!auth || !userId) return null;
  try {
    return await approvedApps(userId);
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-consents-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
});

/** The signed-in person's name, email and picture for the account menu, or null. One read per request. */
export const signedInProfile = cache(async (): Promise<{ name: string; email: string; image: string | null; isAdmin: boolean } | null> => {
  const { session } = await currentSession();
  if (!session) return null;
  // Shown the way a person reads it: capitals for an email-derived name, initials when there is no real picture.
  return { name: displayName(session.user.name || session.user.email, session.user.email), email: session.user.email, image: await storedPortrait(session.user.image), isAdmin: isAdminRole(roleOf(session.user)) };
});

/**
 * Where this person is signed in to Queue Pilot, this browser first, or null when it could not be read. Reads the
 * session table directly: Better Auth's listSessions refuses sessions older than its one-day "fresh" age, which
 * would empty this list for most people.
 */
export async function signedInDevices(): Promise<{ id: string; device: string; lastActive: string; current: boolean }[] | null> {
  const { session: current } = await currentSession();
  if (!current) return [];
  try {
    const { db } = await import("../db");
    const { session } = await import("../db/auth-schema");
    const { and, eq, gt } = await import("drizzle-orm");
    const rows = await db()
      .select({ id: session.id, userAgent: session.userAgent, updatedAt: session.updatedAt })
      .from(session)
      .where(and(eq(session.userId, current.user.id), gt(session.expiresAt, new Date())));
    return rows
      .map((x) => ({ id: x.id, device: deviceName(x.userAgent), lastActive: x.updatedAt.toISOString(), current: x.id === current.session.id }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActive.localeCompare(a.lastActive));
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-devices-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/**
 * Who is looking at /admin: nobody signed in, a signed-in person who is not this deployment's admin, or the admin.
 * The role comes from Better Auth's admin plugin, granted with `pnpm admin:grant <email>`.
 */
export async function adminAccess(): Promise<"signed-out" | "not-admin" | "admin"> {
  const { session } = await currentSession();
  if (!session) return "signed-out";
  return isAdminRole(roleOf(session.user)) ? "admin" : "not-admin";
}

/** The signed-in person's Buffer email, or null when nobody is signed in. Shown on the setup steps. */
export async function signedInEmail(): Promise<string | null> {
  return (await currentSession()).session?.user.email ?? null;
}

/** The signed-in user's id, or null. For stores keyed by user (feeds); Buffer writes use freshBufferForCurrentUser. */
export async function signedInUserId(): Promise<string | null> {
  return (await sessionUser()).userId;
}

/**
 * For a write on the user's behalf: their Buffer token and a fresh read of their posts (a copy under 30 seconds old is
 * kept). Null when nobody is signed in. Writes check ids against these posts, so they only ever touch the user's own.
 */
export async function freshBufferForCurrentUser(): Promise<{ userId: string; token: string; posts: Post[]; markScheduled: (ids: string[]) => Promise<void> } | null> {
  const { auth, userId } = await sessionUser();
  if (!auth || !userId) return null;
  const token = await bufferAccessToken(auth, userId);
  const store = postgresSnapshotStore();
  const snap = await refreshSnapshot(userId, token, { store }, { force: true });
  if (!snap) return null;
  return {
    userId,
    token,
    posts: snap.data.posts,
    // Buffer confirmed these as scheduled; record that in the saved copy so the screens show it at once.
    markScheduled: async (ids) => {
      const latest = await store.get(userId);
      if (latest && ids.length) await store.save(userId, withScheduled(latest, ids));
    },
  };
}

/** A fresh read of the signed-in user's Buffer account, for actions that write drafts: id, token, channels, posts and range. */
export async function bufferForWriting(): Promise<{ userId: string; token: string; channels: Channel[]; posts: Post[]; range: { start: Date; end: Date } } | null> {
  const { auth, userId } = await sessionUser();
  if (!auth || !userId) return null;
  const token = await bufferAccessToken(auth, userId);
  const snap = await refreshSnapshot(userId, token, { store: postgresSnapshotStore() }, { force: true });
  if (!snap) return null;
  return { userId, token, channels: snap.data.channels, posts: snap.data.posts, range: knownRange(snap.data, new Date()) };
}

/** The Refresh button: re-reads Buffer now (a copy under 30 seconds old is kept). False when nobody is signed in. */
export async function forceRefreshCurrentUser(): Promise<boolean> {
  const { auth, userId } = await sessionUser();
  if (!auth || !userId) return false;
  const snap = await refreshSnapshot(userId, await bufferAccessToken(auth, userId), { store: postgresSnapshotStore() }, { force: true });
  if (snap) scheduleEcho(userId, snap.data.posts);
  return true;
}

export const getCurrentUser = cache(async (): Promise<{ signInOpen: boolean; user: BufferContext | null }> => {
  const { auth, userId } = await sessionUser();
  if (!auth) return { signInOpen: false, user: null };
  if (!userId) return { signInOpen: true, user: null };
  try {
    const store = postgresSnapshotStore();
    const snap = (await store.get(userId)) ?? (await refreshSnapshot(userId, await bufferAccessToken(auth, userId), { store }));
    if (!snap) return { signInOpen: true, user: null };
    const d = snap.data;
    return {
      signInOpen: true,
      user: {
        email: d.email, timeZone: d.channels[0]?.timezone || d.timezone || "UTC", organizationIds: d.organizationIds, channels: d.channels, posts: d.posts,
        fetchedAt: snap.fetchedAt, needsRefresh: Date.now() - snap.fetchedAt.getTime() > MIN_REFRESH_MS, rateLimit: snap.rateLimit,
      },
    };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-account-read-failed", message: e instanceof Error ? e.message : String(e) }));
    return { signInOpen: true, user: null };
  }
});
