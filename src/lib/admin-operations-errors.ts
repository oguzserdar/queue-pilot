/**
 * @fileoverview The error codes the admin door answers with (src/lib/admin-operations.ts), what to do after each, and
 * the refusal an operation raises to answer with one.
 */

/** Why an operation did not run, as a code an AI app can act on. */
export type AdminErrorCode = "INVALID_INPUT" | "PERMISSION_DENIED" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED" | "REQUIRES_HUMAN" | "RATE_LIMITED" | "INTERNAL_ERROR";

/** What to do after each error code, in one plain sentence. */
export const NEXT_STEP: Record<AdminErrorCode, string> = {
  INVALID_INPUT: "Fix the arguments and try again; nothing changed.",
  PERMISSION_DENIED: "Do not retry. Ask the admin to check their role and, for an AI app, to give this app admin access under Settings, Connected AI apps.",
  NOT_FOUND: "List again to get a current name or id.",
  CONFLICT: "Read the current state again, then retry.",
  NOT_CONFIGURED: "Tell the admin what is missing on this deployment; retrying will not help.",
  REQUIRES_HUMAN: "Ask the admin to do this on the /admin page; an AI app cannot.",
  RATE_LIMITED: "Wait a minute before trying again.",
  INTERNAL_ERROR: "Nothing is confirmed. Read the current state before retrying.",
};

/** A refusal raised inside an operation, carried to the caller with its code. */
export class AdminOperationError extends Error {
  constructor(readonly code: AdminErrorCode, message: string) {
    super(message);
    this.name = "AdminOperationError";
  }
}
