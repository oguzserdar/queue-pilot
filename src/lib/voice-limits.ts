/** Limits shared by the voice form and connector. */
/** Three to five examples work best (Claude prompting best practices); twelve is the ceiling, because every example is read before every draft. */
export const SUGGESTED_EXAMPLES = "3 to 5"
export const MAX_EXAMPLES = 12
/** Maximum length of a writing note. */
export const MAX_NOTE = 1000
/** Maximum length of one example, pasted or picked from Buffer: a full LinkedIn post (3000 in Buffer) fits. */
export const MAX_PASTED_TEXT = 3000
