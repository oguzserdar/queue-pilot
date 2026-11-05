/**
 * @fileoverview The one routing note Queue Pilot adds to tools that do plain Buffer work: managing tags, hashtag sets,
 * ideas, templates, content items, teammates and channel settings. Queue Pilot adds nothing to those actions, so an
 * assistant that also has Buffer's official connector may use it instead, which spends the person's own Buffer allowance
 * rather than Queue Pilot's shared one. Tools that carry Queue Pilot's voice, rules, source evidence or learning never
 * get this note.
 */

/** Appended to the description of every plain-Buffer tool, word for word. */
export const BUFFER_ONLY_NOTE = " If Buffer's official connector is also available and exposes this action, you can use it for this Buffer-only task. Use one connector for the action, not both. Keep QP-managed draft checks, source evidence and learning in QP. Never switch connectors to bypass a refusal or request limit.";
