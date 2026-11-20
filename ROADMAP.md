# Roadmap

Where Queue Pilot is heading. What has shipped is in [CHANGELOG.md](CHANGELOG.md).

Free and open source, from the first draft to the post going out. You approve posts before they go out. You choose which accounts can send automatic replies.

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

## Right after 1.0: keeping up with Buffer's API

- **Team notes from the new field.** Buffer deprecated `Post.notes` on 9 Nov ("Legacy Notes. Use collaborationNotes."). Queue Pilot still reads it in one place, where it learns rules from the notes on your sent posts. That read moves to `collaborationNotes`, which every other notes feature already uses, one aliased request for all posts so it costs no more of Buffer's limit.
- **A check for deprecated fields.** The schema test already catches a renamed field. It will also flag any field Queue Pilot reads that Buffer marks deprecated, so the next one shows up in the tests, not in Discord.

## In 1.1

- **The posting machinery, used for messages.** The queue, playbook and checks that handle a post answer comments and messages, send a DM to someone who asked for a guide, a link or a code, and carry customer conversations. Every reply is checked against your rules first, and each person gets one DM per post, within the time the network allows.
- **Direct posting to more networks.** Just like Telegram and Discord in 1.0, more networks get their own direct path, with posting times per account, beside your Buffer queue.
- **Run your copy from chat.** With admin access, every action that changes your copy is going to be available through the MCP connector, so you manage it by chatting with ChatGPT or Claude. You can take that access away in Settings.

## Next: teams and clients

- **Workspaces.** One per team or client, each with its own accounts, playbook and voice.
- **Roles.** Invite people as admin, writer or reviewer.
- **Client approval.** Review links already take comments. Next, the client approves their drafts from the link, and nothing is scheduled until they do.
- **Activity per workspace.** Who wrote, changed, approved or deleted what, and through which AI.

## Next: plans for your copy

- **Plans and limits.** Whoever runs a copy sets plans: accounts, drafts and AI use per month.
- **Payments.** Add your payment keys in the admin page. Without them, every feature stays open.
- **Trials.** Email sign-up is in 1.1 for copies that can send mail. Starting a trial and choosing a plan come next.
- **Usage you can see.** Each workspace sees what it has used this month. The admin sees every workspace.
- **AI on any plan.** The copy's own AI with a monthly allowance, or each workspace's own key.

## Next: for the people who run a copy

- **An admin page for the whole copy.** Workspaces, plans, usage, and pause or restore.
- **Export and delete per workspace.** Account export and deletion ship today. Each workspace gets the same.
- **An API and webhooks,** next to the AI connector.

## Later

- Learn from results: what performed, as well as what you changed
- Your own name, logo and domain on the app
- Starting setups for a type of work: a newsletter, a product team, an agency, a local shop
- More places to publish, each with the same approval step
