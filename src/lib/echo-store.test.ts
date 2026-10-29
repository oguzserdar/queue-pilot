import { describe, expect, it } from "vitest";
import { memoryEchoStore, memoryTelegramCodes } from "./echo-store";

describe("echo store rules", () => {
  it("keeps one destination per kind and gives a replacement a new id and time", async () => {
    let t = new Date("2026-11-01T00:00:00Z");
    const s = memoryEchoStore(() => t);
    const first = await s.setDestination("u1", { kind: "telegram", label: "Old", target: "-1" });
    t = new Date("2026-11-02T00:00:00Z");
    const second = await s.setDestination("u1", { kind: "telegram", label: "New", target: "-2" });
    const all = await s.destinations("u1");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ label: "New", target: "-2", connectedAt: "2026-11-02T00:00:00.000Z" });
    expect(second.id).not.toBe(first.id);
  });

  it("keeps users apart", async () => {
    const s = memoryEchoStore();
    await s.setDestination("u1", { kind: "discord", label: "#a", target: "c1", guildId: "g1" });
    await s.record("u1", { postId: "p", destinationId: "d", status: "sent", attempts: 1, messageId: "m" });
    expect(await s.destinations("u2")).toEqual([]);
    expect(await s.records("u2", ["p"])).toEqual([]);
    expect(await s.records("u1", ["p"])).toHaveLength(1);
  });

  it("removes only the given kind", async () => {
    const s = memoryEchoStore();
    await s.setDestination("u1", { kind: "telegram", label: "T", target: "-1" });
    await s.setDestination("u1", { kind: "discord", label: "D", target: "c" });
    await s.removeDestination("u1", "telegram");
    expect((await s.destinations("u1")).map((d) => d.kind)).toEqual(["discord"]);
  });
});

describe("telegram connect codes", () => {
  it("keep the first chat that carried a code, so a replay elsewhere cannot take it over", async () => {
    const codes = memoryTelegramCodes();
    await codes.save([{ code: "maple-orbit-4821", chatId: -1001, title: "Pennyrow news" }]);
    await codes.save([{ code: "maple-orbit-4821", chatId: -666, title: "Someone else" }]);
    expect(await codes.find("maple-orbit-4821")).toEqual({ chatId: -1001, title: "Pennyrow news" });
  });

  it("within one batch, the earlier message wins", async () => {
    const codes = memoryTelegramCodes();
    await codes.save([{ code: "a-b-1234", chatId: 1, title: "First" }, { code: "a-b-1234", chatId: 2, title: "Second" }]);
    expect((await codes.find("a-b-1234"))?.chatId).toBe(1);
  });
});
