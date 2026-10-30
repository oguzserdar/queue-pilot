# Connector controls

The connector exposes 31 tools. OAuth supplies the account ID; tool inputs cannot select another account. The browser and connector share the built-in writer and the signed-in setup-step builder.

| Area | Tools |
| --- | --- |
| Setup and account reads | `get_setup_status`, `list_channels`, `refresh_buffer`, `get_ai_usage` |
| Voice | `get_my_voice`, `save_my_voice_note`, `add_voice_example`, `remove_voice_example` |
| Playbook | `get_playbook`, `add_rule`, `remove_rule`, `read_rule`, `check_draft` |
| Learning | `list_rule_suggestions`, `keep_suggestion`, `dismiss_suggestion` |
| Material | `list_sources`, `add_source`, `remove_source`, `add_material`, `remove_material`, `list_new_material`, `read_material` |
| Drafts and delivery | `list_open_slots`, `write_my_week`, `save_drafts`, `list_my_drafts`, `update_draft`, `delete_draft`, `show_next_week`, `show_last_week_delivery` |

`write_my_week` calls the same service as the app button. It reads real material, voice and rules, uses the person's key or the metered built-in key, and saves only Buffer drafts. Each run handles at most ten empty slots next week and rewrites refused drafts once. It reports saved drafts, flags and refusals. More slots may remain; never claim the entire week is full unless readback proves it.

`check_draft` uses the same judge and AI allowance without saving anything. It distinguishes passed, refused, flagged, uncertain and not checked. Checks are repeated when saving. AI actions share the existing three-per-minute burst allowance; a rule reading plus two draft checks can require a pause before writing.

Learning offers have three modes: small repeated fixes from the saved queue, AI inference from larger rewrites, and AI inference from past posts. Inferred proposals use existing evidence-verifying routines. Queue Pilot's own generated posts are excluded from past-post learning. Keeping a suggestion requires its signed account-bound token, valid for one hour. The evidence is stored in the existing rule JSON. Long evidence is clearly marked as an excerpt. Older and manually added rules may have no recorded evidence.

Setup progress uses exactly the same helper as the signed-in home screen. Its fifth step is human approval, not keeping a rule. A drafts-only run can reach 4/5 after channel, AI, voice and source setup; it must not claim 5/5. The existing approval-step behavior is preserved.

Only drafts recorded as Queue Pilot's own are returned by `list_my_drafts`. Stored verdicts are hidden when the text has changed since the recorded check. Rule, source, example and research cleanup is scoped to the token owner. Removing sources or research leaves existing drafts intact; research usage history remains.

Approve, scheduling, publishing, account deletion, AI keys and model settings, revoking apps, admin, sign-out and echo destinations are not connector tools.

## Verification

- 88 test files, 581 tests passed.
- Type checking, copy checks and diff whitespace checks passed.
- Connector integration exercises refusal, correction, Buffer draft save and verdict readback with simulated AI and Buffer responses.
- Cross-account removal/read tests, signed-proposal tampering and expiry tests, real Postgres-compatible material cleanup checks, and AI settlement/refund checks pass.
- This verifies the local implementation. Production deployment, connector tool refresh, and the real ChatGPT-to-Buffer rehearsal remain separate live checks.
