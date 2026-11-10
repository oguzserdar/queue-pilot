/**
 * @fileoverview What the in-app writer is given to write from: items from the last 14 days first, and for a feed
 * never drafted from, its single newest item when nothing is that recent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "./feeds";

const state = vi.hoisted(() => ({ sources: [] as { id: string; title: string; url: string }[], used: new Set<string>(), feeds: {} as Record<string, FeedItem[] | Error>, material: [] as { key: string; title: string; link?: string; text: string }[] }));
vi.mock("./sources-store", () => ({ postgresSourceStore: () => ({ list: async () => state.sources, usedKeys: async () => state.used }) }));
vi.mock("./material-store", () => ({ postgresMaterialStore: () => ({ list: async () => state.material }) }));
vi.mock("./feeds", async (original) => ({
  ...await original<typeof import("./feeds")>(),
  readFeed: async (url: string) => { const f = state.feeds[url]; if (!f || f instanceof Error) throw f ?? new Error("no feed"); return { title: null, items: f }; },
}));

import { newMaterial } from "./new-material";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const item = (key: string, published: string | null, body = `Body of ${key}`): FeedItem => ({ key, title: key, url: `https://a.example/${key}`, published, summary: body, body });

beforeEach(() => {
  state.sources = [{ id: "s1", title: "Blog", url: "https://a.example/feed" }];
  state.used = new Set();
  state.material = [];
  state.feeds = {};
});

describe("material for the in-app writer", () => {
  it("offers items from the last 14 days and leaves older ones out", async () => {
    state.feeds["https://a.example/feed"] = [item("new", daysAgo(2)), item("old", daysAgo(40))];
    expect((await newMaterial("u")).map((m) => m.key)).toEqual(["s1:new"]);
  });

  it("gives a quiet feed's newest item, marked as older, when nothing is recent", async () => {
    state.feeds["https://a.example/feed"] = [item("latest", daysAgo(30)), item("older", daysAgo(90))];
    const got = await newMaterial("u");
    expect(got.map((m) => m.key)).toEqual(["s1:latest"]);
    expect(got[0].title).toContain("older, nothing new in 14 days");
  });

  it("does not fall back for a feed something was already drafted from", async () => {
    state.feeds["https://a.example/feed"] = [item("latest", daysAgo(30)), item("older", daysAgo(90))];
    state.used = new Set(["s1:latest"]);
    expect(await newMaterial("u")).toEqual([]);
  });

  it("does not fall back while saved research is waiting", async () => {
    state.feeds["https://a.example/feed"] = [item("latest", daysAgo(30))];
    state.material = [{ key: "material:1", title: "Notes", text: "Research text" }];
    expect((await newMaterial("u")).map((m) => m.key)).toEqual(["material:1"]);
  });

  it("skips a feed that cannot be read and an item with no text", async () => {
    state.sources.push({ id: "s2", title: "Broken", url: "https://b.example/feed" });
    state.feeds["https://a.example/feed"] = [item("empty", daysAgo(30), ""), item("real", daysAgo(60))];
    state.feeds["https://b.example/feed"] = new Error("down");
    expect((await newMaterial("u")).map((m) => m.key)).toEqual(["s1:real"]);
  });
});
