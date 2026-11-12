/**
 * @fileoverview Plain words for a Buffer sign-in that came back with an OAuth error (?error=<code>), and a helper
 * that strips that error from an address so a later sign-in does not carry it back.
 */

/** What to tell the person about a failed sign-in. */
export type SignInProblem = { title: string; text: string };

const WORDS: Record<string, SignInProblem> = {
  invalid_scope: {
    title: "Buffer did not let Queue Pilot in",
    text: "Buffer refused a permission Queue Pilot asked for. That is a setup problem on our side, not your account. Try again in a little while.",
  },
  access_denied: {
    title: "Sign-in cancelled",
    text: "You stopped the Buffer sign-in. Nothing was connected.",
  },
  state_mismatch: {
    title: "Sign-in expired",
    text: "The sign-in took too long or was started in another tab. Try again.",
  },
};

/**
 * The message for an OAuth error code from the sign-in return address.
 *
 * @param code - The `error` query value, or null when there is none
 * @returns Words for the person, or null when there was no error
 */
export function signInProblem(code: string | null): SignInProblem | null {
  if (!code) return null;
  return WORDS[code] ?? { title: "Buffer sign-in did not finish", text: `Buffer said "${code}". Try again.` };
}

/**
 * The same address without `error` and `error_description`, so returning there after a successful sign-in does
 * not show an old failure.
 *
 * @param url - The address to clean; not changed
 * @returns A new URL
 */
export function withoutSignInError(url: URL): URL {
  const clean = new URL(url);
  clean.searchParams.delete("error");
  clean.searchParams.delete("error_description");
  return clean;
}
