/**
 * @fileoverview The Playbook with only the starting rule: it still reads as "no rules of your own yet", invites the
 * person to find their first rules, explains the starting rule in one line, and shows where it came from. Once the
 * person has a rule of their own, the page reads as a normal playbook again.
 */
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ShownRule } from "./playbook-view"

vi.mock("@/app/(app)/actions", () => ({ addRule: vi.fn(), readRule: vi.fn(), removeRule: vi.fn(), setRuleException: vi.fn() }))
vi.mock("@/app/(app)/review-actions", () => ({}))
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }))
vi.mock("./first-rules-finder", () => ({ FirstRulesFinder: ({ open }: { open?: boolean }) => <div data-finder={open ? "open" : "closed"} /> }))
vi.mock("./rewrite-finder", () => ({ RewriteFinder: () => null }))
vi.mock("./rule-tester", () => ({ RuleTester: () => null }))
vi.mock("./team-notes-finder", () => ({ TeamNotesFinder: () => null }))
const { PlaybookView, STARTING_RULE_LINE } = await import("./playbook-view")

const starting = { id: "s", kind: "guidance", text: "Keep private matters private.", channels: "all", level: "warn", addedBy: "starting", origin: "Starting rule" } as ShownRule
const mine = { id: "m", kind: "guidance", text: "Name the number first.", channels: "all", level: "warn", addedBy: "you", origin: "Added by you" } as ShownRule
const render = (initial: ShownRule[], accounts: { id: string; name: string; service: string }[] = []) =>
  renderToStaticMarkup(<PlaybookView mode="live" initial={initial} networks={["linkedin"]} accounts={accounts} />)

describe("PlaybookView with the starting rule", () => {
  it("still invites the person to find their first rules and explains the starting rule", () => {
    const html = render([starting])
    expect(html).toContain("No rules of your own yet.")
    expect(html).toContain(STARTING_RULE_LINE)
    expect(html).toContain('data-finder="open"')
    expect(html).not.toContain('data-finder="closed"')
    expect(html).toContain("Keep private matters private.")
    expect(html).toContain("Starting rule")
  })

  it("names the starting rule in the per-account view too", () => {
    const html = render([starting], [{ id: "a1", name: "Alex", service: "linkedin" }])
    expect(html).toContain("Starting rule")
    expect(html).toContain('data-finder="open"')
  })

  it("reads as a normal playbook once the person has a rule of their own", () => {
    const html = render([starting, mine])
    expect(html).not.toContain("No rules of your own yet.")
    expect(html).not.toContain(STARTING_RULE_LINE)
    expect(html).toContain('data-finder="closed"')
    expect(html).not.toContain('data-finder="open"')
  })

  it("keeps the empty playbook as it was", () => {
    const html = render([])
    expect(html).toContain("No rules yet.")
    expect(html).not.toContain(STARTING_RULE_LINE)
    expect(html).toContain('data-finder="open"')
  })
})
