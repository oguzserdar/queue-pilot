/**
 * Review link limits and shapes, kept apart from src/lib/review-store.ts so the public review page can use them
 * without pulling the database into the browser.
 */

/** A draft as it was shared. */
export type SharedDraft = { postId: string; network: string; channel: string; dueAt: string | null; text: string };
export type ReviewLink = { id: string; drafts: SharedDraft[]; createdAt: string; revokedAt: string | null };
export type ReviewComment = { id: string; postId: string; name: string; text: string; quote: string | null; start: number | null; end: number | null; createdAt: string };

/** Most drafts in one link: a week of posts. */
export const MAX_SHARED_DRAFTS = 30;
/** Most links a person keeps switched on at once. */
export const MAX_OPEN_LINKS = 20;
/** Most comments one link takes, so a leaked link cannot fill the database. */
export const MAX_COMMENTS = 200;
export const MAX_NAME = 60;
export const MAX_COMMENT = 1000;

