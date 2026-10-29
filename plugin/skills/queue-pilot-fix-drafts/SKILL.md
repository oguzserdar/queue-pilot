---
name: queue-pilot-fix-drafts
description: Use when the person wants to change or remove drafts Queue Pilot saved in their Buffer queue. Triggers include "shorten Tuesday's LinkedIn draft", "rewrite that post", "delete the Friday draft", "fix the draft that broke my rule". Only drafts Queue Pilot wrote can be changed. Not for approved, scheduled or sent posts, or posts the person wrote themselves.
license: MIT
---

# Fix drafts

Change or delete drafts Queue Pilot saved, with the person's okay for each one.

## Before you start

The Queue Pilot tools must be connected. If they are missing, or a call says access was revoked, tell the person to add Queue Pilot as a connector and sign in with Buffer.

## Steps

1. `show_next_week` to find the post id. Never guess an id.
2. To change a draft: call `get_playbook` and `get_my_voice` if you have not yet. Write the new text. Show the old and the new side by side. Once the person agrees, call `update_draft` with the post id and the new text.
3. To delete a draft: name it (day, time, channel, first line) and ask. Call `delete_draft` only after a yes for that draft.
4. Report the answer as given, including any playbook note after an update.

## When something is refused

`update_draft` and `delete_draft` return an error when they change nothing. The answer starts "Not changed:" or "Not deleted:" with the reason. Tell the person the reason. Common ones: the post is already approved, scheduled or sent, or Queue Pilot did not write it.

An updated draft stays a draft at the same time. The person still approves it.

## Never

- Delete without a yes for that specific draft.
- Touch a post Queue Pilot did not write.
- Work around a refusal through another tool or Buffer's own skill.
