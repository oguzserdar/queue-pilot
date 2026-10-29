# Building on the Buffer API: what we learned

Notes for the next person building a Buffer app, written while building Queue Pilot for Buffer Commit (October 2026). Each point names where it comes from in Buffer's docs or in this code, so you can check it rather than trust it. Buffer's API is young and changes often, so check the date and the [schema changelog](https://developers.buffer.com) before relying on anything here.

## Sign-in and scopes

- Apps sign people in with OAuth 2.0 and PKCE. The scopes are `posts:read posts:write ideas:read ideas:write account:read account:write snippets:read snippets:write offline_access`. Ask for `offline_access` to get a refresh token. Queue Pilot asks for `posts:read posts:write ideas:read ideas:write account:read offline_access` (`src/lib/buffer/oauth.ts`).
- Post results (likes, clicks, reach) are not readable by OAuth apps. Buffer's [post metrics guide](https://developers.buffer.com/guides/post-metrics.md) says "App Clients cannot read them". Only a personal API key can. Plan your product around that: Queue Pilot learns from the edits people make, not from metrics.
- During Buffer Commit everyone can create two extra app clients, and an app client's name can be changed after you create it (Buffer staff in the Buffer Community Discord, 22 Oct 2026).

## Staying inside the rate limits

- Limits are 100 requests per 15 minutes and 250 to 500 per day, depending on the plan ([API limits](https://developers.buffer.com/guides/api-limits)). There are no webhooks, so every update costs a request.
- Read the `RateLimit` header on every response. It carries each window as `"100-in-15min";r=98;t=897`. On HTTP 429, a short `Retry-After` is worth one retry. A long one means the daily window, so fail at once and show the reset time (`src/lib/buffer/client.ts`).
- Keep one saved copy of each person's account (channels, posting slots, posts from 7 days back to 14 ahead) and let every screen read the copy. Refresh it on purpose, one refresh per person at a time (`src/lib/buffer/snapshot.ts`). This is what keeps a busy screen from spending the daily budget.
- Combine top-level fields in one request, use aliases for repeated fields (up to 30 per request), and filter on Buffer's side ([efficient API usage](https://developers.buffer.com/guides/efficient-api-usage.md)).

## Writing drafts

- `createContentItem` writes one item and a post for each channel in a single all-or-nothing call, and each network's post can have its own text and time ([content items](https://developers.buffer.com/guides/content-items.md)). It is marked Experimental, so keep a `createPost`-per-channel fallback behind the same function (`src/lib/save-drafts.ts`).
- `saveToDraft: true` keeps a post as a draft. Buffer does not check posting limits for drafts, so check them yourself before saving.
- Set `aiAssisted: true` on drafts an AI wrote.
- Images go in as a public URL with alt text: `ImageAssetInput` takes `url` and requires `metadata.altText`. There is no upload endpoint yet.

## Daily posting limits

- `dailyPostingLimits(input: { channelIds, date })` returns `{ channelId isAtLimit limit scheduled sent }` evaluated at the intended posting time. Since 19 Oct 2026, for X it counts the busiest rolling 24-hour window that a post at that time touches, including later scheduled posts. Other networks use the channel's local calendar day. The proposed post is not counted (schema changelog, 19 Oct 2026). Ask at each draft's intended time and trust `isAtLimit` (`src/lib/save-drafts.ts`).

## Changing only your own drafts

- Every post has `via: api | buffer | network`. A draft someone typed in Buffer is `buffer`. Queue Pilot changes or deletes a draft only when it is `api` (`src/lib/edit-drafts.ts`), so a person's hand-written drafts are never touched. Note that `api` also covers other apps that use the API.
- `editPost` with `saveToDraft: true` keeps the post a draft at its slot. `deletePost` returns `DeletePostSuccess` or an error, so count only success.

## Reading failures

- A failed post carries `error { message supportUrl }`. Show Buffer's own words and link its help page rather than writing your own.
- Reminder posts (`schedulingType: notification`) are published by the person, not by Buffer. Treat them as sent only when `notificationStatus` is `markedAsPublished`.

## Watching for changes

- Buffer posts every schema change in the `api-notifications` channel of the Buffer Community Discord. Recent examples: `ChannelAction.approvePosts` (15 Oct), the daily posting limit definition (19 Oct), replies and reactions configuration (21 and 22 Oct).
- A test that checks the fields you query against Buffer's published reference catches a renamed field before it reaches people (`src/lib/buffer/schema-fields.test.ts`).
