import { describe, expect, it } from "vitest";
import { authMd } from "./auth-md";
import { AGENT_ERRORS } from "./envelope";

const text = authMd("https://qp.example");

/** The lines under a heading, up to the next heading of the same or higher level. */
function section(heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  expect(start, `heading "${heading}" is missing`).toBeGreaterThanOrEqual(0);
  const level = heading.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && l.match(/^#+/)![0].length <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

describe("/auth.md", () => {
  it("names this server, not a fixed host", () => {
    expect(text).toContain("https://qp.example/v1/agent/identity");
    expect(text).toContain("https://qp.example/v1/oauth2/token");
    expect(authMd("https://other.example/x")).toContain("https://other.example/v1/agent/identity");
  });

  // Written out here, not imported from the module, so the test fails if the file stops saying any of them.
  const FORBIDDEN_BEFORE_CLAIM = [
    /read anyone's Buffer/i,
    /write to Buffer/i,
    /\bapprove\b/i,
    /\bschedule\b/i,
    /\bpublish\b/i,
    /send posts/i,
    /\breplies\b/i,
    /\bDMs\b/i,
    /connect accounts/i,
    /built-in AI budget/i,
    /admin tools/i,
  ];

  it.each(FORBIDDEN_BEFORE_CLAIM.map((r) => [r.source, r] as const))("lists %s as forbidden until claimed", (_name, pattern) => {
    expect(section("### Not until your person claims the account")).toMatch(pattern);
  });

  it("says what an unclaimed agent may do: save and read its own material and drafts", () => {
    const allowed = section("### What you can do straight away");
    expect(allowed).toMatch(/save/i);
    expect(allowed).toMatch(/read/i);
    expect(allowed).toMatch(/material/i);
    expect(allowed).toMatch(/drafts/i);
  });

  it("says the allowed list is the whole list, so nothing unlisted is implied to work", () => {
    const allowed = section("### What you can do straight away");
    expect(allowed).toMatch(/That is the whole list\. Anything else waits for the claim/);
    for (const item of [/public\s+review links/, /automatic copies/, /voice/, /inbox/, /contacts/, /credentials/]) expect(allowed).toMatch(item);
  });

  it("says the reminder and last call go out whenever a login_hint was given, asked or not", () => {
    expect(text).toMatch(/reminder and\s+last call go out whenever you gave a login_hint, even if you never asked/);
  });

  it("gives the four claim routes", () => {
    const claim = section("## Step 5. Help your person claim (four ways)");
    for (const way of ["Link", "Computer", "Email", "Sign in"]) expect(claim).toMatch(new RegExp(`\\| \\d\\. ${way} `));
  });

  it("gives both deadlines, measured the contract's way", () => {
    expect(text).toMatch(/72 hours after you register/);
    expect(text).toMatch(/30 days after the freeze/);
  });

  it("documents every error the server can return", () => {
    for (const code of Object.keys(AGENT_ERRORS)) expect(text).toContain(`| ${code} `);
  });

  it("says only invalid_grant, account_deleted and agent_revoked discard the credential", () => {
    const rule = section("## Errors");
    expect(rule).toMatch(/Only three errors mean the credential is dead: invalid_grant, account_deleted and agent_revoked/);
    const dropRows = text.split("\n").filter((l) => /^\| [a-z_]+ .*\| drop_credential/.test(l)).map((l) => l.split("|")[1].trim()).sort();
    expect(dropRows).toEqual(["account_deleted", "agent_revoked", "invalid_grant"]);
  });

  it("promises that a claim never grants admin access", () => {
    expect(text).toMatch(/never admin access/i);
  });

  // No other product is named. Rather than list names to ban (which would put them in this file), every capitalised
  // word must be one of these. A new one fails here and has to be added on purpose, after checking it is not a name.
  const ALLOWED_CAPITALISED = new Set([
    // Queue Pilot, the one integration it is built on, and the standards it cites.
    "Queue", "Pilot", "Buffer", "RFC", "JSON", "JWT", "HTTP", "OAuth", "URL", "DMs", "AI", "API",
    "POST", "GET", "Authorization", "Bearer", "Content", "Type", "Retry", "After", "macOS", "Linux",
    "QUEUE_PILOT_IDENTITY_ASSERTION", "XXXX",
    // Ordinary words that start a sentence, a heading, a list item or a table cell.
    "Not", "You", "This", "Follow", "Everything", "Pick", "Use", "An", "That", "Your", "Step", "Look", "Check",
    "The", "Found", "Skip", "Do", "Register", "All", "Reply", "Save", "Never", "Any", "Anything", "Trade", "Send",
    "Keep", "There", "When", "Work", "Every", "Read", "What", "Each", "Write", "Start", "Ask", "Deadlines", "Frozen",
    "Deleted", "Show", "Help", "Tell", "Way", "Link", "Computer", "Email", "Sign", "Nothing", "Open", "It", "If",
    "Claim", "Learn", "Stop", "Errors", "Only", "For", "Revoke", "Delete", "On", "None", "Claiming", "A", "Whichever",
    "Way", "Account", "Already", "Too", "No", "Which", "That's", "I", "I've", "Hidden", "Reads", "Wait", "Poll",
    "Fix", "Nobody", "We", "Then", "Give", "Error", "HTTP", "Drop", "Notes", "Unclaimed", "Agent", "Means", "One",
    "Their", "Lowercase", "At", "Five", "Honour", "Offer", "Try", "Saving", "Today",
  ]);

  it("names no other product", () => {
    const words = new Set(text.match(/\b[A-Z][A-Za-z_']*\b/g) ?? []);
    const unknown = [...words].filter((w) => !ALLOWED_CAPITALISED.has(w));
    expect(unknown).toEqual([]);
  });
});
