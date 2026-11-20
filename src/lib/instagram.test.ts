/**
 * @fileoverview The Instagram reply client: the call it makes, what each refusal means (wait, sign-in gone, never),
 * how long a throttle waits, the 1000-byte limit, and that the token never reaches an address or an error.
 */
import { describe, expect, it } from "vitest";
import { InstagramError, TEXT_LIMIT_BYTES, refusalKind, sendReply, textProblem, waitSecondsFrom } from "./instagram";
import type { HttpAnswer } from "./safe-fetch";

type Call = { url: string; headers: Record<string, string>; body: unknown };

function fakePost(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const post = async (url: URL, init: { headers: Record<string, string>; body: string }): Promise<HttpAnswer> => {
    calls.push({ url: url.toString(), headers: init.headers, body: JSON.parse(init.body) });
    return {
      status, ok: status >= 200 && status < 300,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => body, text: async () => JSON.stringify(body), body: null,
    };
  };
  return { post, calls };
}

const refusalOf = async (p: Promise<unknown>) => {
  const e: unknown = await p.catch((err: unknown) => err);
  if (!(e instanceof InstagramError)) throw new Error(`expected an InstagramError, got ${String(e)}`);
  return e;
};

describe("sendReply", () => {
  it("answers a comment privately by its id, with the token in the header only", async () => {
    const { post, calls } = fakePost(200, { recipient_id: "u1", message_id: "m1" });
    expect(await sendReply("1784", "secret-token", { commentId: "c9" }, "Thanks!", post)).toEqual({ messageId: "m1" });
    expect(calls).toEqual([{ url: "https://graph.instagram.com/v27.0/1784/messages", headers: { "content-type": "application/json", authorization: "Bearer secret-token" }, body: { recipient: { comment_id: "c9" }, message: { text: "Thanks!" } } }]);
  });

  it("answers in a conversation by the person's id", async () => {
    const { post, calls } = fakePost(200, { message_id: "m2" });
    await sendReply("1784", "t", { userId: "p7" }, "Hi", post);
    expect(calls[0]?.body).toEqual({ recipient: { id: "p7" }, message: { text: "Hi" } });
  });

  it("reads a throttle as a wait, using Meta's minutes", async () => {
    const usage = JSON.stringify({ "1784": [{ type: "instagram", call_count: 100, estimated_time_to_regain_access: 7 }] });
    const { post } = fakePost(400, { error: { code: 80002, message: "too many calls" } }, { "x-business-use-case-usage": usage });
    const e = await refusalOf(sendReply("1784", "t", { commentId: "c" }, "x", post));
    expect([e.kind, e.retryAfterSeconds]).toEqual(["wait", 420]);
  });

  it("still waits a minute on a throttle without a usable header", async () => {
    const { post } = fakePost(400, { error: { code: 613, error_subcode: 2534040 } }, { "x-business-use-case-usage": "not json" });
    const e = await refusalOf(sendReply("1784", "t", { commentId: "c" }, "x", post));
    expect([e.kind, e.retryAfterSeconds]).toEqual(["wait", 60]);
  });

  it("reads a refused token as sign-in gone and a closed window as never, without the token in the message", async () => {
    const gone = await refusalOf(sendReply("1784", "secret-token", { userId: "p" }, "x", fakePost(401, { error: { code: 190, message: "Invalid OAuth access token." } }).post));
    const closed = await refusalOf(sendReply("1784", "secret-token", { userId: "p" }, "x", fakePost(400, { error: { code: 10, error_subcode: 2018278, message: "outside of allowed window" } }).post));
    expect([gone.kind, closed.kind]).toEqual(["signIn", "never"]);
    expect(closed.message).toContain("10/2018278");
    for (const e of [gone, closed]) expect(e.message).not.toContain("secret-token");
  });

  it("never treats an answer without a message id as sent-and-retryable", async () => {
    const e = await refusalOf(sendReply("1784", "t", { commentId: "c" }, "x", fakePost(200, {}).post));
    expect(e.kind).toBe("never");
  });
});

describe("refusalKind", () => {
  it("knows the documented waits by code and subcode", () => {
    expect([refusalKind(4, null), refusalKind(9, 2018352), refusalKind(613, 2534040), refusalKind(80002, null)]).toEqual(["wait", "wait", "wait", "wait"]);
  });

  it("does not wait on another subcode of code 9, on 551, or on an unknown code", () => {
    expect([refusalKind(9, 1), refusalKind(551, null), refusalKind(12345, null), refusalKind(null, null)]).toEqual(["never", "never", "never", "never"]);
  });
});

describe("waitSecondsFrom", () => {
  it("takes the longest wait across the header's entries, and a minute at least", () => {
    expect(waitSecondsFrom(JSON.stringify({ a: [{ estimated_time_to_regain_access: 2 }], b: [{ estimated_time_to_regain_access: 5 }] }))).toBe(300);
    expect(waitSecondsFrom(JSON.stringify({ a: [{ estimated_time_to_regain_access: 0 }] }))).toBe(60);
    expect(waitSecondsFrom(null)).toBe(60);
  });
});

describe("textProblem", () => {
  it("counts bytes, not characters: Turkish letters and emoji take more than one", () => {
    const turkish = "ş".repeat(TEXT_LIMIT_BYTES / 2);
    expect(textProblem(turkish)).toBeNull();
    expect(textProblem(`${turkish}a`)).toContain("1001");
    expect(textProblem("🙂".repeat(250))).toBeNull();
    expect(textProblem("🙂".repeat(251))).toContain("1004");
  });

  it("refuses an empty reply", () => {
    expect(textProblem("  ")).toBe("The reply is empty.");
  });
});
