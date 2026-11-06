/**
 * @fileoverview How a connected AI app is named in records. Browser-safe: no database import here.
 *
 * A brand ("Claude") is shown only when the app's registered address proves it, the same check the consent page uses.
 * Any other name is the app's own claim, so records word it as "an unverified app named …".
 */

/** The longest app name shown on the consent page or kept in a record, ellipsis included. */
export const MAX_APP_NAME = 60;

/** A connected app as records keep it: its shown name, and whether its address proved that name. */
export type ConnectedApp = { name: string; verified: boolean };

/**
 * Trims a self-declared app name and cuts it to MAX_APP_NAME characters with an ellipsis.
 *
 * @param name - The name the app gave itself
 * @returns The trimmed name, at most MAX_APP_NAME characters
 */
export function capAppName(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length > MAX_APP_NAME ? `${chars.slice(0, MAX_APP_NAME - 1).join("").trimEnd()}…` : chars.join("");
}

/**
 * The words for a connected app in a record: its brand when verified, else "an unverified app named "X"".
 *
 * @param app - The app's name, and false for verified when its address did not prove the name. Older records carry
 *   no flag and are shown by name, as they were.
 * @returns A short phrase to put after "Connected", "By" or "Last approved through Queue Pilot: by"
 */
export function appWords(app: { name: string; verified?: boolean }): string {
  return app.verified === false ? `an unverified app named "${capAppName(app.name)}"` : app.name;
}
