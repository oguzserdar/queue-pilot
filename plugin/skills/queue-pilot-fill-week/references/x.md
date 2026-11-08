# Writing for X

Checked: 2026-11-08
Source: X's open-source ranking code, https://github.com/xai-org/x-algorithm at commit 3b6919f87532e57063bb3f1e85c2f509323b513e
Last weight change in that code: 2026-11-05

Read this file only when a slot is on an X channel. The person's voice and playbook still come first. This file
never adds a rule to their playbook and never overrides one.

## Is this file still current?

Compare "Checked" with today's date before you use anything below.

- 30 days old or less: use it.
- Older than 30 days: tell the person these notes are dated and may be out of date. Write the X drafts from their
  voice and playbook alone. If they ask you to refresh it, read `home-mixer/params/param.rs` and the history of the
  files cited below at the repository's latest commit, and write a new version of this file with the new date and
  commit. Replace this file; never keep two dated versions side by side.

Every number here is a published default. The code's own header says the values are copied from a config that X can
change per test group, and a second ranking service in the same repository still carries older values. Say "X's
published defaults", never "what X does". These are weights on predicted reactions, not counts.

## What this means for a draft

- Write to be read to the end. Time spent on a post is weighted 0.0075, up from 0.006 on 5 Nov and 0.004 in early
  October. A like is 0.708, its highest yet. A tap into the post fell to 0.274.
- Make the opening carry the post. Opening a video now scores 0, so a clip has to hold attention from its first
  seconds, and clips shorter than 10 seconds are left out of the video lists.
- Stay on the person's topic. A likely "not interested" costs -53.07, and "report" costs -234.
- Prefer originals. People who do not follow the account are shown originals; replies and reposts stay with
  followers by default.
- Space X posts out. A second post by the same author in one feed is scored at 62.5%, the third lower again.
  Never put two X drafts in neighbouring slots when the person has other open times.
- Fresh posts get their chance early. For accounts with up to 50,000 followers, one original under 2 hours old with
  fewer than 200 views can be lifted to about the 16th place in a feed. A post is not shown in For You after 48
  hours. Posting times are the person's Buffer schedule: point out a slot in the middle of their night, never move it.
- No engagement bait ("like if", "repost to"). It is labelled for every author, whatever their standing.
- Never reuse the person's own earlier wording word for word. Duplicate text is labelled as copypasta.
- Links: a link to a site X rates as low quality or bad, in a pinned post, can label the whole account for a week.
  Flag such a link to the person instead of deciding for them.

## The numbers

| Signal | Published default | Changed |
|---|---|---|
| Like | 0.708 | 0.66 → 0.708 on 5 Nov (0.5 early Oct) |
| Time spent on the post | 0.0075 | 0.006 → 0.0075 on 5 Nov |
| Time spent after tapping in | 0.385 | 0.4 → 0.385 on 5 Nov |
| Tap into the post | 0.274 | 0.3 → 0.274 on 5 Nov |
| Video open | 0 | 0.02 → 0 on 5 Nov |
| Share | 2.118 | 2 → 2.118 on 5 Nov |
| Not interested | -53.07 | -52.272 → -53.07 on 5 Nov |
| Copy link | 20 | unchanged, the largest |
| Reply, quote, DM share | 5 each | unchanged |
| Reply between mutual follows, on an original | 5 + 15 | unchanged |
| Likely new follow | 4 | unchanged |
| Repost | 1 | unchanged |
| Report / mute / block | -234 / -58.8 / -31.2 | unchanged |

Bookmarks have no weight in the score at all.

Switched on 5 Nov but weighted 0, so they do not move the score yet: how long someone keeps watching after opening
a video, and how long they spend on a profile after tapping it.

## Replies under other accounts

Queue Pilot drafts posts, not replies, so this matters only when the person asks about replying. Replies are checked
by a model: under accounts with more than 250,000 followers by one, under smaller accounts by another. A reply
flagged as AI slop is labelled for 30 days. Since 6 Nov, a labelled reply or mention does not reach the other
person's notifications unless they follow the author. Grey-badge and highly rated accounts are exempt.

## Not confirmed

- Which of the two ranking services' defaults serve real traffic.
- Which actions are limited on posts labelled low quality or misleading. That list lives in a private config.
- How much the two new watch and profile predictions will be worth once they are weighted.

Do not state any of these as fact.
