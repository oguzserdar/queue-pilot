# Changelog

All notable changes to Queue Pilot are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.2.0] - 2026-10-30 Your AI runs your Buffer week

Built-in writing is free during Buffer Commit, with $100 of Anthropic AI credits I put in. I'll top it up if it runs low. Bring your own key any time.

### Added
- Your AI can run Queue Pilot for you through 31 connector tools: learn your voice, add sources and research, add and remove playbook rules, check a draft before saving, keep or dismiss suggested rules, see setup progress, run Write my week, and list its drafts with their checks. Approving, scheduling and account settings stay with you.
- Teach your voice without past posts: paste what you wrote on the Voice screen, or let your AI read your writing and save examples.
- A GitHub releases page works as a source, and research your AI finds can be handed over as material.
- Your AI can remove a voice example it saved.
- The ChatGPT and Claude packages carry Queue Pilot's logo, website and the skill they use.
- Cookie-free page-view counts for the deployment's own Vercel dashboard.

### Fixed
- Approve schedules only drafts Queue Pilot wrote, and every screen and tool says so: AI tools save drafts, only your Approve schedules.
- A draft refused by a playbook rule comes back as a normal refusal with the rule and the reason, not as a failed call.
- Only recent feed items count as news, so drafts no longer re-announce old releases.
- Fill next week uses built-in AI when available, shows the draft count, and writes into the week shown. A late empty slot can be written too.
- Missing mandatory playbook checks stop saves and edits, with a reason to retry.
- The Docker image starts: the migration step now has its database packages, and CI runs the full self-host path on every push.
- One layout at every screen size: the page scrolls and the sidebar stays pinned. No blank space below the page on phones or desktop.
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
