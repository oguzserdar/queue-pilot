/**
 * Queue Pilot's /auth.md: the instructions an agent reads to sign itself up, work at once, and help its person
 * claim the account later (sign-up contract §2, adapted to Queue Pilot).
 *
 * Why a text file for agents. An agent that lands on a site cannot click through a sign-up form, and should not have
 * to wait for its person to do it. This file gives it one call to register, one to get a working token, and a fixed
 * list of what it may and may not do before a person takes responsibility for the account.
 *
 * What is different from the contract's draft, and why:
 * - The host is not fixed. Queue Pilot is self-hosted, so the file is a function of the server's own address, and
 *   the saved-credential locations are keyed by host so one computer can hold accounts on two servers.
 * - People sign in with Buffer, so every claim route ends with a Buffer sign-in.
 * - The list of what an unclaimed agent may do is Queue Pilot's own. It may save and read its own material and
 *   drafts. Everything that touches another system or spends money waits for the claim: reading or writing Buffer,
 *   approving, scheduling, publishing, sending posts, replies or DMs, connecting accounts, the built-in AI budget,
 *   and admin tools. An unclaimed account has no person behind it, so there is nobody to post as. These are enforced
 *   by the server (there is no route for them; every other /v1/ address answers not_found), not by this text; the
 *   text tells an honest agent what to expect.
 * - A claim never grants admin access, whoever claims.
 * - The operator can turn agent sign-up off; registering then returns registration_disabled.
 * - The error table is generated from the server's own error list (envelope.ts), so the two cannot disagree.
 */
import { AGENT_ERRORS } from "./envelope";

function errorRows(): string {
  return Object.entries(AGENT_ERRORS)
    .map(([code, e]) => `| ${code} | ${e.status} | ${e.retryable ? "yes" : "no"} | ${e.action}: ${e.description} |`)
    .join("\n");
}

/** The /auth.md text for the Queue Pilot server at `baseURL`. Serve it as text/markdown. */
export function authMd(baseURL: string): string {
  const origin = new URL(baseURL).origin;
  const host = new URL(baseURL).host;

  return registerPart(origin, host) + workPart(origin) + claimPart(origin) + errorsPart(origin);
}

/** Who the file is for, then Steps 1 to 3: a saved credential, registering, and the short-lived token. */
function registerPart(origin: string, host: string): string {
  return `# auth.md

Not an agent? Sign in at ${origin} with Buffer.

You are an agent. This file tells you how to get a Queue Pilot account on ${host}
with no person present, use it straight away, and help your person claim it
later. Follow the steps in order.

Everything is on ${origin}. The public signing keys are at
${origin}/api/auth/jwks.

## Pick a method

| You are                                         | Use                              | You get                          |
| ----------------------------------------------- | -------------------------------- | -------------------------------- |
| An AI app your person already connected to      | That connection. Do not          | Their account, with what they    |
| Queue Pilot                                     | register.                        | allowed                          |
| A coding agent on your person's computer        | Step 1, then Step 2              | Your own account, claimed later  |

## Step 1. Look for a saved credential first

Check in this order and stop at the first hit:

1. The environment variable QUEUE_PILOT_IDENTITY_ASSERTION.
2. The system keychain: service "${host}", account "queue-pilot-agent".
   macOS:  security find-generic-password -s ${host} -a queue-pilot-agent -w
   Linux:  secret-tool lookup service ${host} account queue-pilot-agent
3. The file ~/.queue-pilot/${host}.json (mode 600).

Found one? Skip to Step 3. Do not register again: a second registration is a
second account, and your person would have two to claim.

## Step 2. Register (one call, no person needed)

    POST ${origin}/v1/agent/identity
    Content-Type: application/json

    {"type": "anonymous", "tool": "my-agent", "label": "{computer name}"}

All fields but type are optional:

- tool: what you are. Lowercase, 1 to 36 characters of a-z 0-9 . _ -
- label: a name your person will recognise, usually the computer's name.
  At most 40 characters. We show it to your person when they claim, as plain
  text.
- login_hint: your person's email address, only if they gave it to you.
  It is a hint, never proof, and it gives you nothing. It lets your person
  claim by email or simply by signing in.
- source: the skill or page that sent you here, for our counts.

Reply (201):

    {
      "registration_id": "reg_...",
      "identity_assertion": "{a signed token: your lasting secret}",
      "assertion_expires": "{365 days from now}",
      "account": {
        "id": "reg_...",
        "state": "unclaimed",
        "claimed": false,
        "claim_url": "${origin}/claim/ct_...",
        "freeze_at": "{72 hours from now}",
        "delete_at": "{30 days after freeze_at}",
        "claimed_by": null
      },
      "capabilities": [
        {"capability": "save_material", "granted": true},
        {"capability": "save_drafts", "granted": true},
        {"capability": "read_buffer", "granted": false, "reason": "requires_claim"}
      ]
    }

Save it now, before anything else, as one JSON value
{registration_id, identity_assertion, claim_url} in the keychain entry from
Step 1 (or the file, mode 600). Never print identity_assertion, never put it in
a commit, a log or your reply. Any 2xx means success. Anything else: read the
error (see Errors) and do what its "next" says.

If this server's operator has turned agent sign-up off, you get
registration_disabled. Ask your person to sign in and connect you instead.

## Step 3. Trade the credential for a short-lived token

    POST ${origin}/v1/oauth2/token
    Content-Type: application/x-www-form-urlencoded

    grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
    &assertion={identity_assertion}
    &resource=${origin}/v1/

Reply: {"access_token": "...", "token_type": "Bearer", "expires_in": 3600}.
Send it as Authorization: Bearer {access_token}. Keep it in memory only. There
is no refresh token: when it expires (error token_expired), trade again with
the same identity_assertion and repeat your call.

`;
}

/** Step 4: what the account may do before and after it is claimed, and its deadlines. */
function workPart(origin: string): string {
  return `## Step 4. Work, and read the account block

Every reply to you, success or error, carries the "account" block shown in
Step 2. Read the deadlines from it; do not hard-code them.

- Show your person claim_url and freeze_at the first time, and again when a
  new session starts and the account is still unclaimed. One line is enough:
  "Your Queue Pilot account is ready. Claim it here before {freeze_at}:
  {claim_url}"
- Never wait for the claim. Keep working.

### What you can do straight away

- Save your person's material (notes, links, transcripts, sources) and read
  back what you saved.
- Write drafts, save them, and read them back.
- Read the account block, and start a claim.

The calls, each with Authorization: Bearer {access_token}:

    GET  ${origin}/v1/agent/account      your account block and capabilities
    GET  ${origin}/v1/agent/material     the 50 newest items you saved
    POST ${origin}/v1/agent/material     {"title": "...", "text": "...", "link": "https://..."}
    GET  ${origin}/v1/agent/drafts       the 50 newest drafts you saved
    POST ${origin}/v1/agent/drafts       {"title": "...", "text": "..."}

Saving the same item twice keeps one. Each account holds at most 200 of each.
On claim, your material is added to your person's material; drafts stay
private on their account.

That is the whole list. Anything else waits for the claim, including public
review links, automatic copies, and anyone's voice, sources, inbox, contacts or
credentials.

### Not until your person claims the account

There is no call for any of these until then; any other /v1/ address
answers not_found:

- read anyone's Buffer: queues, posts, channels, notes or tags
- write to Buffer, including drafts, notes and tags
- approve, schedule or publish a post
- send posts, replies or DMs on any network
- connect accounts, whether Buffer, a social network or anything else
- use the built-in AI budget (write drafts with your own model meanwhile)
- use admin tools

An unclaimed account has no person behind it, so there is nobody to post as.
Claiming gives you what your person allows on their own account, and
never admin access, whoever claims it.

### Deadlines

- 72 hours after you register: frozen. Hidden from everyone. Reads still work;
  saving returns account_frozen. The same link still claims it.
- 30 days after the freeze: deleted, with everything you saved. The link stops
  working and every call returns account_deleted.

`;
}

/** Step 5: the ways a person claims the account. */
function claimPart(origin: string): string {
  return `## Step 5. Help your person claim (four ways)

Tell them whichever fits. All four end with them signed in to Queue Pilot with
Buffer.

| Way          | What you do                          | What to say                        |
| ------------ | ------------------------------------ | ---------------------------------- |
| 1. Link      | Show claim_url.                      | "Open {claim_url}. It works until  |
|              |                                      | {delete_at}."                      |
| 2. Computer  | When your person says "claim my      | "Open the page I just opened and   |
|              | Queue Pilot account", call           | check it shows code {user_code}."  |
|              | POST /v1/agent/identity/claim        |                                    |
| 3. Email     | Only if they ask, and only to the    | "I've emailed you a link. Sign in  |
|              | address they gave you.               | with that same address to finish." |
| 4. Sign in   | Nothing, if you sent a login_hint.   | "Sign in to Queue Pilot with       |
|              |                                      | {address}. The claim is waiting."  |

Today this server offers Way 1, the link, and only that. The other three
ways, the claim status call in Step 6 and Revoke are not built yet: until they
are, those calls answer not_found. Show your person claim_url.

### Way 2: a claim started at this computer

    POST ${origin}/v1/agent/identity/claim
    Authorization: Bearer {access_token}

Reply: {"verification_uri": "${origin}/claim",
"verification_uri_complete": "${origin}/claim?user_code=XXXX-XXXX",
"user_code": "XXXX-XXXX", "expires_in": 600, "interval": 5}

Open verification_uri_complete in the browser on this computer, or show it.
Show user_code too: the page asks your person to check it matches. Five wrong
codes cancel it. If expires_in passes, POST again; the old code is cancelled.

### Way 3: ask for the claim email

    POST ${origin}/v1/agent/identity/claim/email
    Authorization: Bearer {access_token}
    Content-Type: application/json

    {"login_hint": "{address}"}    (leave it out if you gave it at Step 2)

Reply (202): {"sent_at": "...", "kind": "asked", "emails_left": 2}

The email names you, the computer and the time, in text we write; nothing you
send appears in it except your label, as plain text. It carries no code and
cannot hand over the account: the claim finishes only after your person signs
in with a Buffer account that uses that same address. It has a "this isn't
mine" link. If they use it, we send nothing more to that address and you get
claim_email_refused: offer the link instead. We send at most three emails per
account, only to the login_hint address: the one you ask for, a reminder one
day before freeze_at, and a last call 7 days before delete_at. The reminder and
last call go out whenever you gave a login_hint, even if you never asked for an
email, so your person hears about the account even if they missed your message.

`;
}

/** Step 6, the error shape and table, and revoking. */
function errorsPart(origin: string): string {
  return `## Step 6. Learn that you were claimed

You do not need to poll. The account block in every reply tells you. If you
started Way 2 and want to know sooner, poll every "interval" seconds:

    GET ${origin}/v1/agent/identity/claim
    Authorization: Bearer {access_token}

    {"state": "claimed", "claimed": true, "route": "link",
     "claimed_by": "j***@e*****.com", "claimed_at": "..."}

Stop after 5 minutes and keep working; the claim can finish later. When
claimed, tell your person "This account was claimed by {claimed_by}. If that
wasn't you, tell me." Then carry on. Your credential keeps working with no new
setup, unless your person removes you (agent_revoked).

## Errors

Every error has the same shape, on every call:

    {"error": "account_frozen",
     "error_description": "This account is frozen until it is claimed. Reads still work.",
     "origin": "request",
     "retryable": false,
     "next": {"action": "show_claim_url",
              "say": "Your Queue Pilot account is frozen until you claim it. Claim it here: {claim_url}",
              "url": "{claim_url}"},
     "trace_id": "tr_...",
     "account": { ... }}

- origin: "request" (fix what you sent), "server" (our side, not your fault) or
  "upstream" (a provider we use failed).
- retryable: true means the same call may work later. Honour retry_after when
  present; it is also sent as the Retry-After header.
- next.action is one of: fix_request, retry_later, re_exchange, register,
  show_claim_url, ask_person, use_other_route, drop_credential, stop.
- next.say is a line you can show your person as it is.

Only three errors mean the credential is dead: invalid_grant, account_deleted and agent_revoked.
Only then delete what you saved. For anything else, including timeouts, 5xx
and errors you do not recognise, keep the credential: it is the only key to an
account your person may still want.

| error | HTTP | retry | next |
| ----- | ---- | ----- | ---- |
${errorRows()}

## Revoke

When your person asks you to disconnect:

    POST ${origin}/v1/oauth2/revoke
    Content-Type: application/x-www-form-urlencoded

    token_type_hint=identity_assertion&token={identity_assertion}

200 means this agent is gone (also for an unknown or already revoked token).
Delete what you saved only after the 200. On 5xx nothing changed: retry later.
`;
}
