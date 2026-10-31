# Changelog

All notable changes to Queue Pilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

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
