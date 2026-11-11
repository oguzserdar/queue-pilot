/**
 * @fileoverview The words Settings shows for each security event: what happened and who did it, a connected AI app
 * by name or the person in Queue Pilot, and never post text.
 */
import { describe, expect, it } from "vitest";
import { showSecurityEvent } from "./security-event-words";
import type { SecurityEvent } from "./security-events";

const at = "2026-11-05T09:30:00.000Z";
const ev = (event: SecurityEvent["event"], detail: Record<string, string> | null = null, extra: Partial<SecurityEvent> = {}): SecurityEvent => ({ event, detail, ip: null, userAgent: null, createdAt: at, ...extra });
const byClaude = { by: "Claude", via: "ai" };

describe("security event words", () => {
  it("words a sign-in with the browser and address, dated in UTC", () => {
    expect(showSecurityEvent(ev("sign_in", null, { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Macintosh) Chrome/140" }))).toEqual({ what: "Signed in", where: "Chrome on Mac, 203.0.113.7", when: "5 Nov, 09:30 UTC" });
  });

  it("names the connected app for each action", () => {
    expect(showSecurityEvent(ev("app_connected", byClaude))).toMatchObject({ what: "Connected Claude", where: null });
    expect(showSecurityEvent(ev("drafts_approved", { ...byClaude, count: "3", ids: "a,b,c" }))).toMatchObject({ what: "Scheduled 3 drafts", where: "By Claude, a connected AI app" });
    expect(showSecurityEvent(ev("drafts_approved", { ...byClaude, count: "1", ids: "a" })).what).toBe("Scheduled 1 draft");
    expect(showSecurityEvent(ev("draft_deleted", { ...byClaude, count: "1", ids: "a" })).what).toBe("Deleted a draft");
    expect(showSecurityEvent(ev("content_item_deleted", { ...byClaude, count: "2", ids: "ci,p" })).what).toBe("Deleted a post kept before choosing accounts");
    expect(showSecurityEvent(ev("tag_deleted", { ...byClaude, count: "1", ids: "t", name: "launch" })).what).toBe('Deleted the tag "launch"');
    expect(showSecurityEvent(ev("snippet_deleted", { ...byClaude, count: "1", ids: "s" })).what).toBe("Deleted a hashtag set");
    expect(showSecurityEvent(ev("note_deleted", { ...byClaude, count: "1", ids: "n" })).what).toBe("Deleted a note");
  });

  it("says the person did it in Queue Pilot for the app's own buttons", () => {
    expect(showSecurityEvent(ev("drafts_approved", { by: "Queue Pilot", via: "app", count: "2", ids: "a,b" }))).toMatchObject({ what: "Scheduled 2 drafts", where: "You, in Queue Pilot" });
  });

  it("keeps the older events' words", () => {
    expect(showSecurityEvent(ev("app_revoked", { app: "ChatGPT" })).what).toBe("Removed ChatGPT");
    expect(showSecurityEvent(ev("account_deleted")).what).toBe("Account deleted");
  });

  it("words a removed app by the identity kept when it was removed", () => {
    expect(showSecurityEvent(ev("app_revoked", { app: "Claude", verified: "false" })).what).toBe('Removed an unverified app named "Claude"');
    expect(showSecurityEvent(ev("app_revoked", { app: "Claude", verified: "true" })).what).toBe("Removed Claude");
  });

  it("folds the same action by the same app in the same minute into one line, keeping order", async () => {
    const { showSecurityEvents } = await import("./security-event-words");
    const del = (by: string, via: string, at: string) => ({ event: "draft_deleted" as const, detail: { by, via, count: "1" }, ip: null, userAgent: null, createdAt: at });
    const lines = showSecurityEvents([
      ...Array.from({ length: 9 }, () => del("Claude", "ai", "2026-11-10T03:10:20.000Z")),
      del("Queue Pilot", "app", "2026-11-10T03:09:40.000Z"),
      del("Queue Pilot", "app", "2026-11-10T03:09:10.000Z"),
      del("Queue Pilot", "app", "2026-11-10T03:08:50.000Z"),
      { event: "drafts_approved" as const, detail: { by: "Claude", via: "ai", count: "3" }, ip: null, userAgent: null, createdAt: "2026-11-09T06:00:10.000Z" },
      { event: "drafts_approved" as const, detail: { by: "Claude", via: "ai", count: "2" }, ip: null, userAgent: null, createdAt: "2026-11-09T06:00:40.000Z" },
      { event: "content_item_deleted" as const, detail: { by: "Claude", via: "ai", count: "2", ids: "ci,p" }, ip: null, userAgent: null, createdAt: "2026-11-09T05:30:00.000Z" },
      { event: "app_connected" as const, detail: { by: "Claude", via: "ai" }, ip: null, userAgent: null, createdAt: "2026-11-09T05:19:00.000Z" },
    ]);
    expect(lines.map((l) => l.what)).toEqual(["Deleted 9 drafts", "Deleted 2 drafts", "Deleted a draft", "Scheduled 5 drafts", "Deleted a post kept before choosing accounts", "Connected Claude"]);
    expect(lines[0].where).toBe("By Claude, a connected AI app");
  });
});
