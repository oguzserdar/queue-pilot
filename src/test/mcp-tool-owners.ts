/**
 * @fileoverview Which test file owns the proof that each MCP tool returns typed data on a successful call. Every tool
 * has exactly one owner. Each src/app/api/mcp/route-*.test.ts file checks, at its end, that every tool it owns
 * answered with typed data; route-typed-results.test.ts checks that the owners together list every tool the route
 * serves, each once, so a new tool without an owner fails.
 */
/** The tools each route-*.test.ts file proves, keyed by the file's name after "route-". */
export const TOOL_OWNERS: Record<string, string[]> = {
  "voice-writes": ["delete_snippet", "get_channel_settings", "get_post_template", "list_buffer_ideas", "list_draft_notes", "list_post_templates", "list_snippets", "save_idea", "save_snippet", "tag_draft"],
  "content-items": ["check_draft", "delete_content_item", "get_content_item", "link_post_to_content_item", "list_content_items", "promote_to_draft_posts", "save_channel_less_draft", "unlink_post_from_content_item", "update_content_item"],
  "notes-and-tools": ["delete_tag", "get_buffer_limits", "list_sources_to_check", "move_back_to_draft", "remove_voice_example", "rename_tag", "save_my_voice_note", "set_rule_inheritance", "set_rule_override", "show_last_week_delivery"],
  "drafts-and-controls": ["add_material", "add_rule", "delete_draft", "dismiss_suggestion", "fill_post_template", "get_setup_status", "list_sources", "remove_rule", "remove_source", "write_my_week"],
  "account-and-approve": ["approve_drafts", "get_ai_usage", "list_ai_models", "list_channels", "list_review_comments", "propose_rule_fixes", "refresh_buffer", "remove_material", "set_ai_model", "turn_off_review"],
  "feedback": ["get_effective_rules", "get_transcript", "keep_suggestion", "list_rule_suggestions", "propose_note_changes", "propose_review_changes", "read_rule", "share_for_review", "show_next_week", "update_draft"],
  "sources": ["add_source", "add_web_page", "list_my_drafts", "list_new_material", "list_open_slots", "read_material", "report_source_version", "save_drafts", "search_context"],
  "requests": ["add_draft_note", "add_voice_example", "create_tag", "delete_draft_note", "get_my_voice", "get_playbook", "list_tags", "list_team_members", "update_draft_note"],
}
/** Tools proven in their own files on a real MCP server and the migrated database, with the same recorder. */
export const PROVEN_ELSEWHERE: Record<string, string[]> = {
  "src/lib/mcp-reply-automations.test.ts": ["list_reply_automations", "save_reply_automation", "delete_reply_automation", "try_reply_automation"],
  "src/lib/mcp-social-accounts.test.ts": ["list_social_accounts", "set_replies"],
}
