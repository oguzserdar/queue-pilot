# Roadmap

Where Queue Pilot is heading. What has shipped is in [CHANGELOG.md](CHANGELOG.md).

Free and open source, from the first draft to the post going out. Nothing goes out until you approve it.

Queue Pilot is meant to be where you start when you want to build something on Buffer. Take it, run your own copy, change what you like. It's MIT, and nothing is held back for a paid version.

A lot of the machinery is already here for whoever runs a copy: Sign in with Buffer, an admin page for the keys, the AI budget and the daily limits, Vercel or Docker from one guide, and a test behind every write to Buffer. The rest of this page is the plan. I'll keep building it, and keep it current as Buffer's API grows.

## All along: a starting point for Buffer apps

- **Parts you can swap.** Buffer, the AI, the sources and the places to publish each live in their own part of the code, and the work is to keep them that way, so you can change one without touching the rest.
- **Following Buffer's API.** When Buffer adds or changes something, Queue Pilot follows, and the changelog says what changed and why.
- **A guide to building your own.** How to start a new Buffer app from this one: what to keep, what to change, and where each piece lives.

## Shipped

Sign in with Buffer and see your real week. Drafts from the AI you already use: Claude, ChatGPT, Grok, and coding agents in your terminal and editor. A playbook that learns from your edits, your team's notes in Buffer and the posts already there. Delivery with Buffer's own reasons, and copies to Telegram and Discord after Buffer publishes. Every step is in [CHANGELOG.md](CHANGELOG.md).

## Now: 1.0

- **Proven on a brand-new account.** Every step, end to end, on an account that has never used Queue Pilot.
- **Runs anywhere.** Vercel and Docker both start from the README, and every change is checked by starting the Docker copy.

## Next: teams and clients

- **Workspaces.** One per team or client, each with its own accounts, playbook and voice.
- **Roles.** Invite people as admin, writer or reviewer.
- **Client approval.** Review links already take comments. Next, the client approves their drafts from the link, and nothing is scheduled until they do.
- **Activity per workspace.** Who wrote, changed, approved or deleted what, and through which AI.

## Next: plans for your copy

- **Plans and limits.** Whoever runs a copy sets plans: accounts, drafts and AI use per month.
- **Payments.** Add your payment keys in the admin page. Without them, every feature stays open.
- **Sign-up with a trial.** A new person signs in, gets a trial and picks a plan, all on their own.
- **Usage you can see.** Each workspace sees what it has used this month. The admin sees every workspace.
- **AI on any plan.** The copy's own AI with a monthly allowance, or each workspace's own key.

## Next: for the people who run a copy

- **An admin page for the whole copy.** Workspaces, plans, usage, and pause or restore.
- **The admin side through your AI.** The same connector, for whoever runs the copy: settings, budget and usage, with the same checks as the admin page.
- **Export and delete per workspace.** Account export and deletion ship today. Each workspace gets the same.
- **An API and webhooks,** next to the AI connector.

## Later

- Learn from results: what performed, as well as what you changed
- Your own name, logo and domain on the app
- Starting setups for a type of work: a newsletter, a product team, an agency, a local shop
- More places to publish. Telegram and Discord today, more destinations next, each with the same approval step
