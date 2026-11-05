/**
 * What a connected AI app can do through Queue Pilot, in the person's words, grouped by how much it asks of them.
 * Shown on Connect your AI. connector-catalog.test.ts fails if a tool is added without a place here.
 */
export type CatalogGroup = { key: "reads" | "writes" | "asks"; title: string; note: string; items: { label: string; tools: string[] }[] };

export const CONNECTOR_CATALOG: CatalogGroup[] = [
  {
    key: "reads", title: "Reads", note: "Changes nothing.",
    items: [
      { label: "Your week, open times and channels", tools: ["show_next_week", "list_open_slots", "list_channels", "list_my_drafts", "refresh_buffer"] },
      { label: "Last week's results", tools: ["show_last_week_delivery"] },
      { label: "Your voice, playbook and rules", tools: ["get_my_voice", "get_playbook", "read_rule", "get_effective_rules"] },
      { label: "New material and feeds", tools: ["list_new_material", "list_sources", "list_sources_to_check"] },
      { label: "Review comments", tools: ["list_review_comments"] },
      { label: "Notes on a post in Buffer", tools: ["list_draft_notes"] },
      { label: "Your Buffer ideas board", tools: ["list_buffer_ideas"] },
      { label: "Your Buffer tags", tools: ["list_tags"] },
      { label: "Buffer's post templates and your saved hashtag sets", tools: ["list_post_templates", "get_post_template", "list_snippets"] },
      { label: "Teammates you can mention, and each channel's settings and text limit", tools: ["list_team_members", "get_channel_settings"] },
      { label: "Posts kept in Buffer before choosing accounts", tools: ["list_content_items", "get_content_item"] },
      { label: "Buffer's request allowance and daily posting limits", tools: ["get_buffer_limits"] },
      { label: "Setup progress and AI allowance", tools: ["get_setup_status", "get_ai_usage", "list_ai_models"] },
      { label: "Checks a draft without saving", tools: ["check_draft"] },
      { label: "Finds and proposes rules and fixes", tools: ["list_rule_suggestions", "propose_rule_fixes", "propose_review_changes"] },
    ],
  },
  {
    key: "writes", title: "Changes, when you ask", note: "Drafts stay drafts. Saves are checked against your playbook.",
    items: [
      { label: "Reads source text, video captions and web pages; can spend transcript and search credits", tools: ["read_material", "get_transcript", "search_context", "add_web_page"] },
      { label: "Writes and saves drafts in empty times", tools: ["save_drafts", "write_my_week"] },
      { label: "Saves ideas to your Buffer ideas board", tools: ["save_idea"] },
      { label: "Creates and renames tags, and tags drafts it wrote", tools: ["create_tag", "rename_tag", "tag_draft"] },
      { label: "Fills a post template from your material and checks it", tools: ["fill_post_template"] },
      { label: "Saves and replaces hashtag sets", tools: ["save_snippet"] },
      { label: "Writes a post once, then saves one checked draft per account", tools: ["save_channel_less_draft", "promote_to_draft_posts"] },
      { label: "Renames posts kept before choosing accounts, and links drafts to them", tools: ["update_content_item", "link_post_to_content_item", "unlink_post_from_content_item"] },
      { label: "Edits a draft it wrote", tools: ["update_draft"] },
      { label: "Adds, removes and routes rules", tools: ["add_rule", "remove_rule", "keep_suggestion", "dismiss_suggestion", "set_rule_override", "set_rule_inheritance"] },
      { label: "Saves your voice and examples", tools: ["save_my_voice_note", "add_voice_example", "remove_voice_example"] },
      { label: "Adds and removes material and feeds", tools: ["add_material", "remove_material", "add_source", "remove_source", "report_source_version"] },
      { label: "Shares drafts for review, turns links off", tools: ["share_for_review", "turn_off_review"] },
      { label: "Switches your AI model", tools: ["set_ai_model"] },
    ],
  },
  {
    key: "asks", title: "Needs your yes", note: "Your AI must ask you in the chat first.",
    items: [
      { label: "Schedules drafts in Buffer", tools: ["approve_drafts"] },
      { label: "Deletes a draft it wrote", tools: ["delete_draft"] },
      { label: "Adds a Buffer note to a draft it wrote", tools: ["add_draft_note"] },
      { label: "Deletes a tag, a hashtag set or a post kept before choosing accounts (your whole team loses it)", tools: ["delete_tag", "delete_snippet", "delete_content_item"] },
    ],
  },
];

/** Only in the app, never through a connected AI. */
export const APP_ONLY = "Only in the app: your AI key, which AI apps are connected, whether your AI can schedule, signing out and deleting your account.";
