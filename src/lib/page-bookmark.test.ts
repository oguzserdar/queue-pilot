/**
 * @fileoverview Page bookmarks from a URL: a real Postgres time and a key are read, and anything else, including a
 * time that only looks right, opens the newest page instead of breaking it.
 */
import { describe, expect, it } from "vitest";
import { readBookmark } from "./page-bookmark";

describe("readBookmark", () => {
  it("reads a bookmark Postgres wrote, microseconds kept", () => {
    expect(readBookmark("2026-11-10 03:10:12.123456+00~abc")).toEqual({ at: "2026-11-10 03:10:12.123456+00", key: "abc" });
  });
  it("refuses a time that matches the pattern but does not exist, so Postgres never throws on it", () => {
    for (const at of ["2026-13-01 00:00:00+00", "2026-11-40 00:00:00+00", "2026-02-30 00:00:00+00", "2026-11-10 25:00:00+00", "2026-11-10 03:10:12+99"]) {
      expect(readBookmark(`${at}~x`)).toBeNull();
    }
  });
});
