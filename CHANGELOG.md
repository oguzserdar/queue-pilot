# Changelog

All notable changes to Queue Pilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

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
