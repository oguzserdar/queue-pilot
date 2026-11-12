# Changelog

All notable changes to Queue Pilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [1.0.0] - 2026-11-12 Stable enough

### Added
- Connect gives one message for each AI app. Pasted into a chat app, it walks you through adding Queue Pilot one step at a time, then shows one preview post and saves nothing. It carries the fill-week instructions, so an app that cannot install skills still writes the Queue Pilot way.
- The example account's Reviews page shows a shared link with comments from a client and a teammate, each pinned to the words it is about.
- A new account starts with one playbook rule that flags a draft about someone's private matters, such as health, a legal or immigration case, money, family, staff or customers, unless it is already public.
- Make the same fix to two drafts and the app offers it as a rule. Home lists it under Fixes you repeated, and the Playbook shows the edit with Keep as a rule and Not now.
- The first visit asks how to fill the week: with your own AI, or with Queue Pilot's built-in AI writing from a link. A choice of Not now holds on every device.
- Long lists page with Newer and Older: Reviews, the Channels post list, saved research and Security activity. Security activity folds repeats and names each draft by account and slot.
- A link can open the example on one of the app's own screens. Each copy serves its own robots.txt and sitemap.xml, and the footer links Privacy.
- Shared links show a new preview card with the Pilot.

### Changed
- Sources holds only your material. Whether each Buffer channel can post, and the Telegram and Discord copies, moved to a new Settings tab, Channels.
- Connect folds its setup steps behind Add another AI once an AI app has connected.
- Terms like inherited, blocks, flags and connector URL read as plain words, with the precise term one tap away.
- On the Week page the action buttons share one size, and a post that would fail shows as a status at the end of the row.
- On a phone, four tabs sit at the bottom of the screen and More opens the rest. Before, the tab row scrolled and hid seven pages.
- The example's New material dates follow the shown week, Connect names a disconnected channel as disconnected, finished setup steps read as done, and an empty Buffer time is called an empty time everywhere in the app.
- Posts are written from what you publish and follow. Email and chats are never a source, and your AI reads your own writing there only to learn your style, when you ask. A draft an AI saves with no source is flagged No source.
- A rule applies where it fits the post. An ending you add to posts about one subject, such as a project link, stays off posts about anything else.
- A draft over a network's limit is shortened once before saving, and one that still does not fit is left out. Fill next week used to show Not saved: Too long.
- Home counts every empty time ahead. It used to count only the ten that one run writes.
- An edited draft has one Check again button, which rechecks the playbook and the sources.
- Voice examples say three to five work best and stop at twelve, and each one says who added it. Every limit a person can reach says what it is.
- Once an AI app has connected, Home leads with it. The first visit is one page until you choose how to fill the week.
- Suggest changes starts with the commented draft only, and a dialog's buttons stay in view in a short window.
- The README says how to update a copy you run, back up its data, add an admin on Docker and run the published Docker image. It lists every startup value.

### Fixed
- A fill lost every draft when the AI answered an empty video timestamp for one post.
- A failed session lookup could sign a live person out. Only a session that is gone does now.
- After an account was deleted, its old sign-in showed an empty app. It goes to the home page.
- The only admin of a copy can no longer delete their account and leave nobody to manage its keys.
- Grok's sign-in pop-up keeps Allow and Deny in view.
- A draft Buffer did save could be marked failed after a fill that stopped halfway. Recovery reads the queue again before deciding.
- Settings stays up when a Telegram, Discord or channel read fails.
- On a phone, the approve bar and toasts sit above the tab bar.
- Links to Buffer's developer guides open again. Buffer moved them to addresses ending in .html.
- On a phone, Connect your AI shows Queue Pilot's address on its own line. A rule's setting reads Stops a draft or Flags a draft everywhere.
- A page link with a date that does not exist opens the newest page instead of an error. The sign-in notice no longer repeats free text from the address.
- Signing in could loop between the app and the expired-session page when sign-in was switched off on a copy. The app sends people there only when sign-in is set up.
- Opening the Playbook no longer reads Buffer, so it does not use the requests that saving and Approve need.
- A repeated added ending whose rule sentence came back too long was asked about again on every Playbook visit. The answer is kept and the rule reads "End with" and the words.
- Drafts over a network's limit are shortened together, each with a short time limit, so a slow AI leaves the fill time to save.
- When the connected AI changes a draft you had already fixed, your fix still counts toward the same-fix offer.
- On a phone, the Write a post window kept the send button inside the window and the preview above the footer. The setup window shows Queue Pilot's address on its own line instead of breaking it mid-word. In the example account, a sign-in message no longer covers the example card, and the failing-post row says it opens Next week.
- Deleting a draft that had just been approved in Buffer could delete the scheduled post. Queue Pilot reads the post again first and deletes it only while it is still a draft.
- A Telegram or Discord post sent with Send now stayed scheduled forever if the platform asked it to wait. It goes out once the wait is over.
- Disconnecting Telegram or Discord cancels the posts still waiting to go there, so reconnecting later does not send them.
- Download my data includes saved material, source snapshots, draft evidence, fill runs, Telegram and Discord posts, and AI app names.
- Typing in Japanese, Chinese or Korean, pressing Enter to pick a character could also submit the field. Enter now waits until the character is picked.
- On a copy with no AI allowance, the first screen promised Queue Pilot's AI needed no setup. It says why it cannot write yet. Several lines named a button that does not exist or a choice the sign-in screen does not offer. They now match the app.
- Pressing Check again after editing a draft erased the record of what Queue Pilot wrote, so the same fix made twice was never offered as a rule. What Queue Pilot wrote is now kept, and each check is stored beside it. The check that runs on every edit is kept too, so a draft you edited and that passes your playbook can be approved without checking again. An AI app revising its own draft no longer counts as your fix.
- After Approve, the draft window said Queue Pilot did not write the post. It now says the post is scheduled in Buffer, and Approve stays off for anything that is not a draft.
- Pressing Fill next week again while a fill was running could put two drafts in one time. Each run reads the empty times again just before saving.
- When Buffer refuses an Approve, for example because the time has passed, the open draft window says why.
- Cutting a hashtag or mention from two drafts offered a rule against the plain word. The offer keeps the # or @.
- A first visit shows only the welcome, without the setup list under it.
- Connect says an AI app is connected once it has called Queue Pilot. After Allow alone it says the app is allowed and not used yet.
- A Buffer account with no channels was shown with a check mark and "0 channels connected". Setup says to add a channel in Buffer.
- A week with a paused Buffer queue, or no posting times, said every time had a post and asked you to fill it. It says why there are no times and what to change in Buffer.
- A sign-in that failed, for example because Buffer was busy, ended on a blank error page. It comes back to the page it started from with the reason.
- The approval date in the draft window no longer splits "12 Nov." across two lines.
- The count of Buffer operations Queue Pilot uses was two too high. It uses 37 of the 49.

## [0.9.0] - 2026-11-10 Queue Pilot has a home page, and you can watch it write your week

### Added
- A home page at /: a pixel week with the Pilot, a pointer walking through a real draft, rules from your own edits and from a teammate's note, how Queue Pilot uses Buffer's API, questions, and how to run your own copy. The example account moved to /demo. Set `LANDING_PAGE=on` to show it on your own copy. Without it, signed-out visitors land on the example as before.
- Fill next week shows each draft in its slot as the AI finishes it. The button counts along and says when it is saving to Buffer.
- Fill this week, next to Fill next week. Only slots still ahead are written.
- Paste a site, a newsletter, a video channel or a releases page as a source, and Queue Pilot finds its feed and says what it read.
- A new account sees a start box on Home: add a feed, then fill next week, without leaving the page.
- A short hint after a run when something is missing: no feed, no voice, or no AI app connected. Each shows once.
- Connect opens with Finish setting up: pick your AI, copy `npx skills add https://getqueuepilot.com` for a terminal app, check the connection, then copy a first task that saves nothing.
- The example account replays a fill on its own week, writing nothing.

### Changed
- A run spreads its drafts across the week: one per day before any day gets a second. It used to take the first ten empty slots.
- Each draft a run writes is kept in Queue Pilot's database first, then the whole run is saved to Buffer in one go, as before. A run that stops halfway, or a Buffer save that never answers, is checked against your queue the next time you open the week. A draft is never saved twice.
- A slot that has passed says so, and a draft whose time passed is marked overdue and left out of the approve count.
- The AI gets up to two and a half minutes to write a week. A run that still times out says so, and the AI action is given back.
- Feeds up to 8 MB are read. A normal newsletter feed used to be refused as too large.
- The general Queue Pilot skill no longer competes with the fill-week skill.

### Fixed
- Approving several drafts stopped when one had been deleted in Buffer. The others are approved now, and the deleted one is named.
- When Buffer could not be read, the app looked signed out. It now says you are signed in and Buffer could not be read, with a way to try again.
- Your AI can approve the drafts it just saved, in any week, when you ask it to.

## [0.8.0] - 2026-11-08 Writing for X's latest algorithm, and optimized Buffer requests

### Added
- The fill-week skill reads a dated reference on writing for X, drawn from X's published ranking code and checked on 8 November. Your voice, playbook and Buffer posting times still come first. After 30 days without a new check, the assistant leaves the reference out and says so.
- A weekly check compares X's ranking code with the commit the reference was checked at, and opens one issue with the changed lines when something it relies on moves. It never edits the reference. A person verifies the change first.
- Skills can carry reference files, read only when a step needs them. Every install route carries them: the plugin, `npx skills add https://getqueuepilot.com`, and the setup prompt.
- Ask which drafts a teammate's Buffer Note affects: Queue Pilot shows the proposed edits on that account, you apply the ones you want, and keep a lasting preference for that account only. A one-off fact correction stays with the drafts it affects.
- @mention a teammate when writing or editing a Buffer Note, and let your AI edit or delete a note when your Buffer permissions allow it.
- Each rule a draft passed says where it came from: an edit you made twice, a teammate's note, a rule you added, or one your AI added, with the app's name. Posts show the last approval recorded through Queue Pilot.
- Settings, Security lists scheduling, deleting, connecting and removing an AI app next to sign-ins, with who did it. An app that only names itself shows as unverified.
- Write a post for your Telegram channel and Discord channels from Sources. Each place can get its own words, both previews show exactly what will be sent, and it goes now or at a time you pick. You can change the text or time, or cancel, until it goes out.
- On a Buffer draft, turn on Telegram and Discord, and Queue Pilot sends them once Buffer has published the post, with the text you set. If the post moves, they move. If Buffer deletes the post or fails to publish it, they say so and send nothing.
- The Telegram and Discord bots and the Exa key can be set in /admin, where a saved value wins over the server's environment.
- A new signed-out example: Alex, who writes This Week in AI, with drafts from real recent news quoted word for word.

### Changed
- Looking up a teammate reuses the channel instead of reading the whole queue: four Buffer requests became one on our account. If Buffer asks Queue Pilot to wait, it pauses the write and keeps the last complete queue.
- Saving in /admin stays on the page: the button shows it is saving, a short message says what is in use now, and a problem stays next to its field.
- The Telegram and Discord copy rows show their logos.
- Settings are read at most once every 30 seconds per server, instead of on every Buffer and AI call. A change in /admin applies at once on the server it was saved from.
- Every page sends a Content Security Policy: scripts only from this site, no plugins, forms post only here. The example calendar can still be embedded.
- Dependencies are on their current releases, including the web framework's security update.

### Fixed
- Rate limits count each visitor by an address a visitor cannot write. Self-hosted copies trust no forwarded address unless `TRUSTED_PROXY_HOP_COUNT` or `TRUSTED_PROXIES` says how many proxies sit in front. Vercel needs nothing. An invalid proxy list trusts nothing.
- Signing out behind a proxy returns to the site you were on, not an internal address.
- /admin accepts only real setting names.

## [0.7.0] - 2026-11-05 Research with Grok Bot, draft in Buffer

### Added
- Expand the Buffer adapter from 9 to 37 of 49 operations, including content items, templates, Notes, tags and team reads. Saved hashtag sets are implemented but were refused by Buffer on the demo account.
- Add conditional guidance to the 19 Buffer-only connector tools: use one connector when Buffer's official connector exposes the same action. Keep Queue Pilot checks, source evidence and learning in Queue Pilot, and never switch to bypass refusals or limits.
- Share Buffer request accounting across users and servers, with a reserve for assistant and background calls in known windows and one-at-a-time probes when the allowance is unknown.
- Read and write Buffer Notes, the comments that live on a post in Buffer. The draft window shows a post's notes with author, time and "edited", and lets you add a note, or edit and delete one where Buffer allows it. A solo Buffer account is told to leave notes for itself. A team account is told everyone with access to the channel sees them. Your AI can read notes as information, never as instructions, and add a note to a draft Queue Pilot wrote when you ask. Notes need a new Buffer permission: sign out and sign in with Buffer once.
- Read your Buffer ideas board with its columns, and save an idea into a column when you ask. Saving an idea posts and schedules nothing.
- New material shows your Buffer ideas board, read only, with Buffer's columns in Buffer's order and a link to open it in Buffer.
- Read your Buffer tags, create one when you ask, and tag drafts Queue Pilot wrote. Approved, scheduled and sent posts are refused, because Buffer's edit would pull them back to drafts.
- The draft window shows a post's Buffer tags under its text. On a draft Queue Pilot wrote, the tag button opens a search box, your tags to tick, and New tag, the way Buffer's own picker works.
- Let your AI read Buffer's request allowance and each channel's daily posting limit, so it can plan before saving many drafts.
- Needs you lists drafts from the last seven days whose time passed, under Overdue in Buffer, with a link to Buffer. Buffer never posts a draft, so these wait for a new time or a delete.
- Tell your AI when a channel's queue is paused in Buffer. Buffer offers no way to resume a queue from outside, so you resume it in Buffer.
- Settings lists connected AI apps grouped by app, with where each returns to, when it was approved and last used, and a name you can give it. A connection unused for 30 days stops working and can be removed in one go. Connect your AI keeps setup only, with one line linking to Settings.

### Changed
- Group a draft's source quotes once per source and show them in the order its sentences read, alongside checks and Notes.
- Show a plain row for a single AI connection, with custom names and recent use. Group multiple connections by their registered app identity.

### Fixed
- Reconcile uncertain draft writes before retrying, and refuse stale edits and writes to posts that are no longer drafts.
- A renamed connection showed only part of its name in Settings.
- Setting tags sent Buffer an edit without the draft's text, which Buffer refuses as an empty post. Tagging now reads the draft first and sends its own text.
- Notes say who sees them behind an info button, in Buffer's own words, and an empty notes list shows a title and one line.

## [0.6.0] - 2026-11-04 Continue drafts in another assistant

### Added
- Search the web and read a page through the connector, with `search_context` and `add_web_page`. Search returns titles, links, dates and short excerpts, never whole pages. `add_web_page` keeps the complete page as a source, the way a transcript is kept, and returns its text with a `snapshotId`, so drafts can quote it with evidence and a quote from the end of a long page still checks. Podcast searches return episodes whose pages are full transcripts. Both need an Exa key in Admin and do nothing without one. Test the key from Admin.
- Serve the plugin's task skills (fill week, check week, fix drafts, check sources) with the main skill, so every install route gets the same set. The setup line installs all five.
- Offer the fill-week skill a deeper-context step: search, show the results, save only the page the person picks.

### Fixed
- The served check-sources skill was out of date and lacked the snapshot validation the plugin copy had. Both now come from the plugin files, and a test fails when they differ.
- Codex setup no longer signs in twice, and installs skills in the current folder instead of the deprecated one.
- Claude Code setup skips a second connector when the Queue Pilot plugin already added one.
- Cursor setup says where to sign in. The README no longer promises an Add to Cursor button that does not exist.
- The plugin marketplace version follows the plugin version at release, so the plugin validator stops warning.
- Remove the old unauthenticated test connector code.
- Repair source quotes on an existing draft, checking its owner, current text and source before replacing evidence. Failed source judgments remain failed after repair.
- Keep Grok web and Grok Bot desktop under one setup card. Support native sign-in callbacks and show the return destination on consent, with provider logos only for matching addresses.
- Explain exact draft sentences and source quotations in the tool fields, and return specific mismatch messages.
- Show the Buffer allowance correctly when its response supplies a time window without a quota total.

## [0.5.0] - 2026-11-02 Drafts with source evidence

### Added
- Read native YouTube captions through Supadata and keep the full transcript with its timestamps. Long-running requests resume from their saved job. Read another passage from the saved transcript without fetching it again.
- Keep source evidence with a draft: the claim, an exact quote and a timestamp when available. Check quotations against the saved source and show links back to the cited moment. Open saved quotes from Needs you, including drafts whose evidence already passes.
- Check sources on request. When a source changes, check the affected drafts by meaning and propose corrections for review. Show the account, posting time, affected draft count and source comparison in Needs you. Applying a correction is a separate action.
- Add `get_transcript`, `list_sources_to_check` and `report_source_version`, bringing the connector to 45 tools. Add the check-sources skill and source citations to the fill-week guidance.
- Test the Supadata key from Admin and show whether the key comes from the environment or the saved setting.

### Fixed
- Validate complete saved transcripts by snapshot ID so an AI chat’s output limit cannot shorten the evidence. The first explicit validation judges meaning. Identical checks reuse the result. Stale snapshots cannot replace newer source versions.
- A wording replacement applies when its subject appears. It does not require unrelated posts to mention that subject. Required content rules still apply.
- Keep full podcast transcripts instead of cutting off the opening section. When a model rejects the full context, process every section and verify the extracted passages before using them.
- Label video-description fallback when captions are unavailable. Incomplete responses and source outages cannot replace a complete saved source.
- Keep successful drafts when another draft or source fails. Unmatched evidence is flagged rather than failing the whole batch. Queue Pilot approval requires the source evidence to pass its checks.
- Reuse unchanged source-check results, reject stale correction writes and renew source-check locks during slow operations.
- Update both plugin package versions when preparing a release.

## [0.4.0] - 2026-10-31 Rules for each account

### Added
- Share selected drafts through a review link that expires in 1, 7 or 30 days, or turn it off sooner. Guests can highlight text and comment without an account.
- Preview how one review comment changes selected drafts. Fact corrections and one-off requests stay separate from writing preferences. Apply edits individually or together. Keep a lasting preference separately, with its evidence and selected account scope.
- Shared, network and account rules, with explicit exceptions and inheritance controls. See which rules apply to an account and preview what changes before switching inheritance.
- Eleven additional connector tools: effective rules, exceptions, inheritance, proposed review changes, AI model choices and approval. The connector now exposes 42 tools.

### Changed
- Needs you groups drafts by what needs attention, with selection for bulk approval and a setup strip.
- Form problems show on the field that caused them and clear as you type. Add rule, Add feed and Save key confirm on the button itself.
- Approving on Needs you folds the row away and the count above rolls down.
- Next week and Needs you show placeholders in the page's own shape while Buffer is read.
- Playbook shows each rule once, where it came from and where it applies. Turn inherited rules off for one account and undo the change.
- Command search opens writing, sharing, approval and rule actions. Draft status marks are consistent across the app.
- A connected AI can schedule only under the permission set in Settings: ask first by default, allow directly, or turn off. Ask-first confirmations bind the exact draft content, account, time and attachments, expire after ten minutes and can be used once.
- Connect lists every tool by what it reads, changes or asks permission for.

### Fixed
- Approving a draft failed in Buffer with "Post must have either text or media". Approve now sends the draft's text with the schedule request.
- Edit text sits under the post and edits it in place, instead of opening below the fold.
- A review link that was turned off or expired can be turned on again from Reviews, with its comments kept. An expired link reopens for 7 days.
- Ready drafts on Needs you always show their tick box beside the first line, show two lines of text and are labelled as drafts.
- A draft that breaks a blocking rule reads "Blocked" on one line, and hovering it names the rule.
- Share for review lists each draft on one line, so the dialog fits a laptop screen without scrolling.
- Dropdown menus fit their longest item, and the post dialog is wider.
- A wording replacement accepts capitalization variants of the preferred phrase. Explicit case-only replacements still enforce their requested spelling. Review-plan reasons describe the classification without claiming later checks passed.
- Require complete current passing checks for applicable mandatory rules before approval. Missing or uncertain mandatory verdicts offer Check again. Warning-only failures remain approvable.
- Recheck reads the selected drafts freshly from Buffer. Changed content invalidates an approval confirmation, and an unconfirmed scheduling response cannot make it reusable.
- Respect the single-key shortcut setting on Needs you. Changing the drafts selected for review clears the previous preview.
- Keep the Connect setup prompt free of server-only imports so the production browser bundle builds.
- Re-read a Buffer draft after checking an edit and refuse the write if its text, account or draft status changed. Buffer does not offer an atomic conditional write, so a change between this read and the write remains possible.
- Mark stored checks stale when the playbook changes. Show the current effective rules in draft details.
- Keep learning evidence and saved AI answers separate for different accounts on the same network.
- Request OpenRouter usage details and use its published prices, including cache rates. Settings shows actual spend since the budget was set and spend today.

## [0.3.0] - 2026-10-31 Edits become rules

### Changed
- A fix you made in two drafts on one network is now checked by AI before it is offered as a rule. The check distinguishes lasting preferences from fact corrections and unclear matches. Each offer says why it looks like your preference, and you decide whether to keep it. Asking again about the same unchanged repeats reuses the answer and costs no action.

### Fixed

- Learn repeated emoji removals without producing an empty rule, and refresh Buffer before looking for edits.
- Include Queue Pilot's recorded drafts when Buffer labels them as created in Buffer.
- Show channel names and network logos in the sidebar's Buffer status card.
- Connection permissions describe voice, playbook, source and draft changes. Claude's consent card uses its logo, and expired requests have a compact recovery card.
- Connect puts the setup prompt for coding agents first, then the chat apps, and makes the scheduling boundary clear.

## [0.2.0] - 2026-10-29 Your AI runs your Buffer week

Built-in writing is free during Buffer Commit. I put in $100 of Anthropic AI credits as a shared budget, with a daily allowance per person. I'll top it up if it runs low. Bring your own key any time.

### Added
- Your AI can run Queue Pilot for you through 31 connector tools: learn your voice, add sources and research, add and remove playbook rules, check a draft before saving, keep or dismiss suggested rules, see setup progress, run Write my week, and list its drafts with their checks. Approving, scheduling and account settings stay with you.
- Teach your voice without past posts: paste what you wrote on the Voice screen, or let your AI read your writing and save examples.
- A GitHub releases page works as a source, and research your AI finds can be handed over as material.
- Your AI can remove a voice example it saved.
- Connector metadata includes Queue Pilot's logo and website. The ChatGPT and Claude packages include the fill-week skill.
- Vercel Web Analytics for page-view counts in the deployment's Vercel dashboard.

### Fixed
- Approve checks that Queue Pilot wrote a draft before scheduling it. AI tools save drafts. Scheduling stays with you.
- Check draft returns a playbook refusal as a normal verdict with the rule and the reason. Invalid inputs still return errors.
- New feed material is limited to dated items from the last 14 days. GitHub releases feeds offer only their newest eligible release. Older items remain available as background.
- Fill next week uses built-in AI when available, shows the draft count, and writes into the week shown. A late empty slot can be written too.
- Missing mandatory playbook checks stop saves and edits, with a reason to retry.
- The Docker migration step includes its database packages. CI checks self-hosted startup, migrations and readiness.
- The page scrolls with a pinned desktop sidebar and a compact phone navigation bar.
- Phones: setup buttons fill their row and the account row has room.
- Fill next week and Approve sit in one aligned row.
- The page where you allow an AI to connect is a clear card: both apps, your account, and what it can and cannot do.
- Opening the connector address in a browser shows how to connect your AI instead of an error.

## [0.1.2] - 2026-10-29 Security updates

### Security
- undici 8.12.3, the HTTP client behind the guard on feed addresses you add, fixing nine high-severity issues in 7.16.0.
- The MCP SDK, Vercel functions and two packages they pull in (body-parser, zod) moved to versions with their fixes.

## [0.1.1] - 2026-10-29 Security fix and link previews

### Added
- Link previews: shared links to Queue Pilot show its name, a short description and a picture of the week.

### Security
- Next.js 16.4.3, which fixes a critical issue in 16.3.5 (GHSA-2464-fhr4-w9xw).
- The Docker image no longer ships npm or corepack, which the app never uses.

## [0.1.0] - 2026-10-29 Sign in with Buffer

### Added
- First public version: sign in with Buffer, see the week from your Buffer queue, and write drafts into Buffer with your
  own AI key or the hosted one. Drafts only, and changes only to drafts Queue Pilot wrote.
- Connect shows each AI app you approved with when it last used Queue Pilot, or "approved, not used yet". The setup
  step for your AI counts as done only after an app has really called Queue Pilot.
- Settings shows your security activity: each sign-in with its browser and address, and every AI app you removed.
  Deleting your account deletes this history and keeps only an anonymous record that an account was deleted.
- Connect has setup cards for Claude Code and Codex (commands with a Copy button) and for Cursor (an Add to Cursor
  button that installs the connector in one click).
