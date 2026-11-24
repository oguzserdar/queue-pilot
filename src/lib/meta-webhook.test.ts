/**
 * @fileoverview Meta webhooks, from Meta's own documentation (instagram-platform/webhooks setup and examples, read
 * 15 Nov 2026): the signature over the raw body with the app secret, the one-time verification, and the comment and
 * message payloads, including text Meta sends escaped and the account's own messages (is_echo), which are dropped.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeFor, parseInstagramEvents, signatureValid } from "./meta-webhook";

const secret = "app-secret-123";
const sign = (raw: string, key = secret) => `sha256=${createHmac("sha256", key).update(raw, "utf8").digest("hex")}`;

// The examples page's comment payload, filled in. Meta sends non-ASCII text escaped, as \\u sequences.
const commentBody = String.raw`[{"object":"instagram","entry":[{"id":"17841400000000001","time":1763200000,"field":"comments","value":{"id":"18000000000000001","from":{"id":"9001","username":"ana"},"text":"Qu\u00e9 precio? \ud83d\ude0a","media":{"id":"17900000000000001","media_product_type":"FEED"}}}]}]`;
const dmBody = JSON.stringify([{ object: "instagram", entry: [{ id: "17841400000000001", time: 1763200001, messaging: [
  { sender: { id: "9002" }, recipient: { id: "17841400000000001" }, timestamp: 1763200001000, message: { mid: "mid-1", text: "hi" } },
  { sender: { id: "17841400000000001" }, recipient: { id: "9002" }, timestamp: 1763200002000, message: { mid: "mid-2", text: "our reply", is_echo: true } },
] }] }]);

describe("signatureValid", () => {
  it("accepts the signature Meta computes over the exact raw body, escapes and all", () => {
    expect(signatureValid(commentBody, sign(commentBody), secret)).toBe(true);
  });
  it("refuses a body that was changed, re-serialized, signed with another secret, or unsigned", () => {
    expect(signatureValid(commentBody.replace("precio", "PRECIO"), sign(commentBody), secret)).toBe(false);
    expect(signatureValid(JSON.stringify(JSON.parse(commentBody)), sign(commentBody), secret)).toBe(false);
    expect(signatureValid(commentBody, sign(commentBody, "other"), secret)).toBe(false);
    expect(signatureValid(commentBody, null, secret)).toBe(false);
    expect(signatureValid(commentBody, "sha256=zz", secret)).toBe(false);
    expect(signatureValid(commentBody, sign(commentBody), "")).toBe(false);
  });
});

describe("challengeFor", () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  it("echoes the challenge only for subscribe with the matching token", () => {
    expect(challengeFor(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1158201444" }), "tok")).toBe("1158201444");
    expect(challengeFor(q({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(challengeFor(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(challengeFor(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), "")).toBeNull();
  });
});

describe("parseInstagramEvents", () => {
  it("reads a comment with its account, author, decoded text and post", () => {
    expect(parseInstagramEvents(JSON.parse(commentBody))).toEqual([{
      accountId: "17841400000000001", kind: "comment", externalId: "18000000000000001", from: { id: "9001", username: "ana" },
      text: "Qué precio? 😊", postId: "17900000000000001", at: new Date(1763200000 * 1000),
    }]);
  });
  it("reads a DM and drops the account's own sent messages (is_echo)", () => {
    expect(parseInstagramEvents(JSON.parse(dmBody))).toEqual([{
      accountId: "17841400000000001", kind: "dm", externalId: "mid-1", from: { id: "9002", username: null }, text: "hi", postId: null, at: new Date(1763200001000),
    }]);
  });
  it("drops a comment written by the account itself, and anything it does not understand", () => {
    const own = JSON.parse(commentBody);
    own[0].entry[0].value.from.id = "17841400000000001";
    expect(parseInstagramEvents(own)).toEqual([]);
    expect(parseInstagramEvents({ object: "page", entry: [] })).toEqual([]);
    expect(parseInstagramEvents([{ object: "instagram", entry: [{ id: "1", field: "mentions", value: {} }] }])).toEqual([]);
    expect(parseInstagramEvents("nonsense")).toEqual([]);
  });

  it("reads comments sent inside entry.changes too, every change in the entry", () => {
    const body = [{ object: "instagram", entry: [{ id: "17841400000000001", time: 1763200000, changes: [
      { field: "comments", value: { id: "c-a", from: { id: "9001", username: "ana" }, text: "price?", media: { id: "m-1" } } },
      { field: "comments", value: { id: "c-b", from: { id: "9003", username: "bo" }, text: "link?", media: { id: "m-1" } } },
      { field: "mentions", value: { comment_id: "x" } },
    ] }] }];
    expect(parseInstagramEvents(body).map((e) => [e.kind, e.externalId, e.from.id, e.postId])).toEqual([["comment", "c-a", "9001", "m-1"], ["comment", "c-b", "9003", "m-1"]]);
  });
});
