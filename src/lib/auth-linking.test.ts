/**
 * @fileoverview A Buffer login never attaches to an existing user by email. Pins our option and the installed Better
 * Auth check that honours it, so an upgrade that changes either fails here instead of in production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_OPTIONS } from "./auth";

describe("account linking", () => {
  it("turns off linking by email", () => {
    expect(ACCOUNT_OPTIONS.accountLinking.disableImplicitLinking).toBe(true);
  });
  it("is still honoured by the installed Better Auth", () => {
    const src = readFileSync(join(__dirname, "../../node_modules/better-auth/dist/oauth2/link-account.mjs"), "utf8");
    expect(src).toContain("accountLinking?.disableImplicitLinking === true");
  });
});
