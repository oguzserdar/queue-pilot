import { describe, expect, it } from "vitest";
import { toolErrorMessage } from "./tool-error";

const GENERIC = /hit a problem reading its own data/;

describe("toolErrorMessage", () => {
  it("keeps Queue Pilot's own readable messages", () => {
    expect(toolErrorMessage(new Error("Could not read your Buffer account yet; try again in a minute"))).toMatch(/Buffer account yet/);
  });
  it("hides a Drizzle query error, its SQL and the user id", () => {
    const e = new Error('Failed query: select "note" from "qp_voice_note" where "user_id" = $1\nparams: user_123');
    expect(toolErrorMessage(e)).toMatch(GENERIC);
    expect(toolErrorMessage(e)).not.toMatch(/user_123|select/);
  });
  it("hides a Postgres driver error by its SQLSTATE code, also when wrapped", () => {
    expect(toolErrorMessage(Object.assign(new Error("connection terminated"), { code: "57P01" }))).toMatch(GENERIC);
    expect(toolErrorMessage(Object.assign(new Error("wrapped"), { cause: { code: "08006" } }))).toMatch(GENERIC);
  });
  it("gives the generic line for non-errors and empty messages", () => {
    expect(toolErrorMessage("boom")).toMatch(GENERIC);
    expect(toolErrorMessage(new Error(""))).toMatch(GENERIC);
  });
});
