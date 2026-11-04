/**
 * @fileoverview Limits for AI app connections, kept free of server imports so the browser can show them too.
 */

/** A connection not used for this many days stops working, counted from its last call, or from approval if it never called. */
export const UNUSED_DAYS = 30;
/** The longest name a person can give a connection. */
export const MAX_LABEL = 60;
