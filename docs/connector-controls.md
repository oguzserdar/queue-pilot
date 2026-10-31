# Connector controls

The connector exposes 39 tools. OAuth supplies the account ID; tool inputs cannot select another account. The browser and connector share the built-in writer and the signed-in setup-step builder.

| Area | Tools |
| --- | --- |
| Setup and account reads | `get_setup_status`, `list_channels`, `refresh_buffer`, `get_ai_usage`, `list_ai_models`, `set_ai_model` |
| Voice | `get_my_voice`, `save_my_voice_note`, `add_voice_example`, `remove_voice_example` |
| Playbook | `get_playbook`, `add_rule`, `remove_rule`, `read_rule`, `check_draft`, `get_effective_rules`, `set_rule_override`, `set_rule_inheritance` |
| Learning | `list_rule_suggestions`, `keep_suggestion`, `dismiss_suggestion`, `propose_rule_fixes` |
| Review | `share_for_review`, `list_review_comments`, `turn_off_review`, `propose_review_changes` |
| Material | `list_sources`, `add_source`, `remove_source`, `add_material`, `remove_material`, `list_new_material`, `read_material` |
| Drafts and delivery | `list_open_slots`, `write_my_week`, `save_drafts`, `list_my_drafts`, `update_draft`, `delete_draft`, `show_next_week`, `show_last_week_delivery` |

`write_my_week` calls the same service as the app button. It reads real material, voice and rules, uses the person's key or the metered built-in key, and saves only Buffer drafts. Each run handles at most ten empty slots next week and rewrites refused drafts once. It reports saved drafts, flags and refusals. More slots may remain; never claim the entire week is full unless readback proves it.

`check_draft` uses the same judge and AI allowance without saving anything. It distinguishes passed, refused, flagged, uncertain and not checked. Checks are repeated when saving. AI actions share the existing three-per-minute burst allowance; a rule reading plus two draft checks can require a pause before writing.

Learning offers have four modes: small repeated fixes from the saved queue, AI inference from larger rewrites, AI inference from past posts, and AI inference from review comments. Inferred proposals use existing evidence-verifying routines. Queue Pilot's own generated posts are excluded from past-post learning. Keeping a suggestion requires its signed account-bound token, valid for one hour. The evidence is stored in the existing rule JSON. Long evidence is clearly marked as an excerpt. Older and manually added rules may have no recorded evidence.

Setup progress uses exactly the same helper as the signed-in home screen. Its fifth step is human approval, not keeping a rule. A drafts-only run can reach 4/5 after channel, AI, voice and source setup; it must not claim 5/5. The existing approval-step behavior is preserved.

Only drafts recorded as Queue Pilot's own are returned by `list_my_drafts`. Stored verdicts are hidden when the text has changed since the recorded check. Rule, source, example and research cleanup is scoped to the token owner. Removing sources or research leaves existing drafts intact; research usage history remains.

Approve, scheduling, publishing, account deletion, AI keys and model settings, revoking apps, admin, sign-out and echo destinations are not connector tools.

## Verification

- 88 test files, 581 tests passed.
- Type checking, copy checks and diff whitespace checks passed.
- Connector integration exercises refusal, correction, Buffer draft save and verdict readback with simulated AI and Buffer responses.
- Cross-account removal/read tests, signed-proposal tampering and expiry tests, real Postgres-compatible material cleanup checks, and AI settlement/refund checks pass.
- This verifies the local implementation. Production deployment, connector tool refresh, and the real ChatGPT-to-Buffer rehearsal remain separate live checks.

Review links share drafts the person picks with anyone, without an account. The drafts are copied when shared, so a reviewer never reaches Buffer, and the person can turn a link off at any time. Reviewers comment on highlighted words. `list_rule_suggestions` with mode `comments` reads those comments as notes: only a request meant for every future post becomes a suggestion, and the drafts themselves never teach a style. After a rule is kept, `propose_rule_fixes` checks the drafts Queue Pilot wrote against it and returns a rewrite for each one that breaks it, judged to follow the rule. Nothing changes until the person picks a rewrite and it is applied with `update_draft`, which checks the playbook again.


### Accounts and review feedback

- `get_effective_rules`: use an exact channel ID to see which shared, network and account rules apply, including exclusions. Two LinkedIn accounts may have different rules.
- `set_rule_override`: include, exclude or reset an inherited rule on a network or account only when requested. Includes do not cross an inheritance boundary.
- `set_rule_inheritance`: show the affected rules, then change shared/network inheritance when the person requests it. Restoring inheritance restores the saved exceptions.
- `propose_review_changes`: read `list_review_comments`, choose one comment and the draft IDs the person wants changed, and show the returned before/after proposals. A fact correction is not a writing preference. Apply chosen edits with `update_draft` and the exact `before` as `expectedText`. A returned preference token can be kept with `keep_suggestion` only as a separate choice.

Review links expire after 1, 7 (default), or 30 days and can be turned off earlier. A rewrite re-reads the individual Buffer draft after checking the playbook; changed text or status stops the write. Buffer does not provide an atomic conditional edit, so the tiny read/write race with another Buffer client remains. A stored verdict is shown only while its text and playbook revision still match.


Account boundaries also apply to learning: repeated edits, rewrite evidence and past-post inference are grouped by exact connected account. Two LinkedIn profiles cannot pool their examples to meet the evidence minimum. The resulting suggestions keep that account scope. Saved repeat verdicts include the account ID in their key.

A review comment produces proposals, not automatic writes. `propose_review_changes` checks selected Queue Pilot drafts against their effective rules. Apply a chosen edit with `update_draft`, including its `expected_text`; keep a lasting preference with its signed suggestion token in a separate call. Facts and unclear requests have no rule token. A fresh Buffer read immediately before the mutation detects intervening text/status/account changes, but Buffer has no atomic conditional-write operation: a concurrent external write between that read and the mutation remains possible.
