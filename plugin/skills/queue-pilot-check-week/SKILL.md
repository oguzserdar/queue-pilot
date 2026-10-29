---
name: queue-pilot-check-week
description: Use when the person asks what is in their Buffer queue or what happened to last week's posts, through the Queue Pilot connector. Triggers include "what's going out next week", "how many empty slots do I have", "did my posts go out", "why did a post fail", "check my queue". Read-only. Not for changing posts.
license: MIT
---

# Check my week

Tell the person what is coming up and what went out, using only what Queue Pilot returns.

## Before you start

The Queue Pilot tools must be connected. If they are missing, or a call says access was revoked, tell the person to add Queue Pilot as a connector and sign in with Buffer.

## Steps

1. `show_next_week` for next Monday to Sunday. List posts by day. Mark empty times and disconnected channels. Count drafts waiting for approval against approved posts.
2. `show_last_week_delivery` for the last 7 days. List what went out. For each failure, quote Buffer's reason exactly as given.
3. Pass on the "Buffer data as of" time.
4. If there are empty times, offer to fill them (the `queue-pilot-fill-week` skill). If a post failed because a channel is disconnected, say the fix is reconnecting it in Buffer.

## Never

- Change anything. This skill only reads.
- Guess a failure reason Buffer did not give.
- Claim reach, clicks or any other number. The connector has none.
