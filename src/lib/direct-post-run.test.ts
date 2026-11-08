/**
 * @fileoverview A post goes only to the place it was written for: a Telegram channel or Discord server disconnected or
 * replaced before the time gets nothing, is marked not sent with the reason, and its link never names another server.
 */
import { describe, expect, it, vi } from "vitest";

let connected: { kind: "telegram" | "discord"; target: string; guildId: string | null }[] = [];
const calls: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("./echo-store", () => ({ postgresEchoStore: () => ({ destinations: async () => connected }) }));
vi.mock("./direct-post-store", async () => ({ postgresDirectPostStore: (await import("./direct-posts")).memoryDirectPostStore }));
vi.mock("./telegram", async (orig) => ({ ...(await orig<typeof import("./telegram")>()), postText: async (_t: string, chat: number) => (calls.push(`tg:${chat}`), { messageId: 7, username: "qp" }) }));
vi.mock("./discord", async (orig) => ({ ...(await orig<typeof import("./discord")>()), postText: async (_t: string, ch: string) => (calls.push(`dc:${ch}`), { messageId: "m1" }) }));

const { directPostDeps } = await import("./direct-post-run");
const { scheduleDirectPost, runDue, sendDirectPost } = await import("./direct-posts");

const AT = new Date("2026-11-08T18:00:00Z");
function deps(now: Date) {
  const d = directPostDeps(async () => ({ telegram: "T", discord: "D" }));
  return { ...d, now: () => now };
}

describe("a scheduled post and its place", () => {
  it("is not sent to a Discord server connected after it was scheduled", async () => {
    calls.length = 0;
    connected = [{ kind: "discord", target: "a-chan", guildId: "server-a" }];
    const d = deps(new Date("2026-11-08T10:00:00Z"));
    const { postId } = await scheduleDirectPost("u1", "form-0001", [{ kind: "discord", target: "a-chan", label: "A #news", text: "Hi", guildId: "server-a" }], AT, d);
    connected = [{ kind: "discord", target: "b-chan", guildId: "server-b" }];
    const out = await runDue({ ...d, now: () => new Date(AT.getTime() + 1_000) });
    expect(calls).toEqual([]);
    expect(out[0]).toMatchObject({ postId, status: "failed" });
    expect(out[0].error).toMatch(/disconnected/);
  });

  it("is not sent to a Telegram channel that was disconnected", async () => {
    calls.length = 0;
    connected = [{ kind: "telegram", target: "-100", guildId: null }];
    const d = deps(new Date("2026-11-08T10:00:00Z"));
    await scheduleDirectPost("u1", "form-0002", [{ kind: "telegram", target: "-100", label: "News", text: "Hi" }], AT, d);
    connected = [];
    const out = await runDue({ ...d, now: () => new Date(AT.getTime() + 1_000) });
    expect(calls).toEqual([]);
    expect(out[0].status).toBe("failed");
  });

  it("is sent, with a link to its own server, when the place is unchanged", async () => {
    calls.length = 0;
    connected = [{ kind: "discord", target: "a-chan", guildId: "server-a" }];
    const d = deps(new Date("2026-11-08T10:00:00Z"));
    await scheduleDirectPost("u1", "form-0003", [{ kind: "discord", target: "a-chan", label: "A #news", text: "Hi", guildId: "server-a" }], AT, d);
    const out = await runDue({ ...d, now: () => new Date(AT.getTime() + 1_000) });
    expect(calls).toEqual(["dc:a-chan"]);
    expect(out[0]).toMatchObject({ status: "sent", link: "https://discord.com/channels/server-a/a-chan/m1" });
  });

  it("never sends a Discord post that has no server recorded (written before servers were)", async () => {
    calls.length = 0;
    connected = [{ kind: "discord", target: "a-chan", guildId: "server-b" }];
    const d = deps(new Date("2026-11-08T10:00:00Z"));
    const { results } = await sendDirectPost("u1", "form-0004", [{ kind: "discord", target: "a-chan", label: "A #news", text: "Hi" }], d);
    expect(calls).toEqual([]);
    expect(results[0]).toMatchObject({ status: "failed" });
    expect(results[0].error).toMatch(/before Queue Pilot recorded the Discord server/);
  });
});
