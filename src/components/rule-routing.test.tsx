/**
 * @fileoverview Rules for one account: when shared rules are off for its whole network, the account cannot claim to turn
 * a shared rule back on.
 */
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Rule } from "@/lib/rules"

vi.mock("@/app/(app)/review-actions", () => ({}))
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }))
const { RuleRouting } = await import("./rule-routing")

const shared = { id: "s", kind: "guidance", text: "Make one concrete point.", channels: "all", level: "warn" } as Rule
const accounts = [{ id: "company", name: "Company", service: "linkedin" }]

describe("RuleRouting", () => {
  it("says shared rules are off for the network and offers no Turn on here", () => {
    const html = renderToStaticMarkup(<RuleRouting rules={[shared]} accounts={accounts} inheritance={{ networks: { linkedin: { shared: false } } }} onDelete={() => {}} onAdd={() => {}} />)
    expect(html).toContain("Shared is off for every LinkedIn account")
    expect(html).not.toContain("Turn on here")
    expect(html).not.toContain("On here")
  })
})
