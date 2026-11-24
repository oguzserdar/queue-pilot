/**
 * @fileoverview The replies run's own refusals, shared by the run and the per-network senders.
 */
import * as mastodon from "./mastodon";
import * as bluesky from "./bluesky";
import { InstagramError } from "./instagram";

/** The run refused a reply itself, before it reached the network; nothing was sent. */
export class ReplyRefused extends Error {}

/** Bluesky's session could not be renewed before the reply call, so nothing was posted; the reply is tried later. */
export class RenewFailed extends Error {
  constructor(cause: unknown) {
    super(`Bluesky's session could not be renewed, so nothing was posted: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** True when the network refused the account's sign-in (401 or 403): the account is marked broken and the person reconnects. */
export const signInRefused = (e: unknown) => (e instanceof mastodon.MastodonError || e instanceof bluesky.BlueskyError) && (e.status === 401 || e.status === 403)
  || (e instanceof InstagramError && e.kind === "signIn");
