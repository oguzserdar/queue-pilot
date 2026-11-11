/**
 * @fileoverview The same-fix offer card. The example (playbook example, homepage, demo) reads exactly as before; the
 * live Playbook draws the person's own edit, place and rule in the same card, and while the model reads the edits it
 * shows one calm line at #fixes, the place Home links to.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/(app)/actions", () => ({ addRule: vi.fn(), readRule: vi.fn(), removeRule: vi.fn(), setRuleException: vi.fn() }))
vi.mock("@/app/(app)/fix-actions", () => ({ checkRepeatedFixes: vi.fn(() => new Promise(() => {})), keepRepeatedFix: vi.fn(), setRepeatedFixAside: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { SameFixOffer, EXAMPLE_SAME_FIX } = await import("./playbook-view")
const { RepeatedFixes, readingLine } = await import("./repeated-fixes")
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim()

describe("SameFixOffer", () => {
  it("draws the example exactly as the homepage and demo show it", () => {
    expect(text(renderToStaticMarkup(<SameFixOffer content={EXAMPLE_SAME_FIX} />))).toBe(
      'You made the same fix twice Before: This week felt like a turning point for coding agents. After: Android Studio now lets you pick from over 40 coding agents. On Instagram you replaced a feeling with the result, on Tuesday and last Friday. Keep as a rule: "Start with the result, not a feeling." Keep as a rule Not now',
    )
  })

  it("draws a live offer from its props: the edit, where, the model's reason and the rule", () => {
    const html = renderToStaticMarkup(<SameFixOffer content={{ title: "You made the same fix in 3 drafts", before: "…we launch today", after: "…we ship today", where: 'On Alex Rivera (LinkedIn) you changed "launch" to "ship" in 3 drafts.', rule: 'Say "ship", never "launch".', change: { lead: "…we", removed: "launch", added: "ship", tail: "today" }, why: "Alex uses ship for every release." }} />)
    expect(html).toContain("<del>")
    expect(html).toContain("<ins>")
    expect(text(html)).toBe('You made the same fix in 3 drafts …we Cut: launch Added: ship today On Alex Rivera (LinkedIn) you changed "launch" to "ship" in 3 drafts. Alex uses ship for every release. Keep as a rule: Say "ship", never "launch". Keep as a rule Not now')
  })

  it("holds both buttons while a choice is saving", () => {
    const html = renderToStaticMarkup(<SameFixOffer content={EXAMPLE_SAME_FIX} pending />)
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2)
  })
})

describe("RepeatedFixes", () => {
  it("sits at #fixes and says it is reading the edits while the model checks", () => {
    const html = renderToStaticMarkup(<RepeatedFixes repeats={1} edits={2} />)
    expect(html).toContain('id="fixes"')
    expect(text(html)).toContain("Reading your two edits…")
    expect(text(html)).not.toContain("Keep as a rule")
  })

  it("words the reading line for one repeat or several", () => {
    expect(readingLine(1, 3)).toBe("Reading your three edits…")
    expect(readingLine(2, 2)).toBe("Reading the fixes you repeated…")
  })
})
