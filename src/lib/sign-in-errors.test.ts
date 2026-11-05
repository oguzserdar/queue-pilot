/**
 * @fileoverview A Buffer sign-in that fails comes back as ?error=<code>. These tests pin the plain words shown for
 * each code, and that a new sign-in never carries an old error back with it.
 */
import { describe, expect, it } from "vitest";
import { signInProblem, withoutSignInError } from "./sign-in-errors";

describe("signInProblem", () => {
  it("explains a refused permission as our setup problem, not the person's account", () => {
    const p = signInProblem("invalid_scope");
    expect(p?.title).toBe("Buffer did not let Queue Pilot in");
    expect(p?.text).toContain("not your account");
  });

  it("treats cancelling as a choice, not a failure", () => {
    expect(signInProblem("access_denied")?.text).toContain("Nothing was connected");
  });

  it("explains an expired or crossed sign-in", () => {
    expect(signInProblem("state_mismatch")?.text).toContain("Try again");
  });

  it("says something for any other code, and nothing when there is none", () => {
    expect(signInProblem("server_error")?.title).toBe("Buffer sign-in did not finish");
    expect(signInProblem(null)).toBeNull();
    expect(signInProblem("")).toBeNull();
  });
});

describe("withoutSignInError", () => {
  it("drops the error and its description and keeps everything else", () => {
    const url = new URL("https://getqueuepilot.com/week?tab=a&error=invalid_scope&error_description=requested+scope+is+not+allowed");
    expect(withoutSignInError(url).toString()).toBe("https://getqueuepilot.com/week?tab=a");
  });

  it("leaves a clean address alone", () => {
    expect(withoutSignInError(new URL("https://getqueuepilot.com/")).toString()).toBe("https://getqueuepilot.com/");
  });
});
