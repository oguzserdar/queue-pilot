/**
 * @fileoverview Needs you rows: a draft with an out-of-date check offers Check again and never approval or a tick box.
 */
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { TriageItem } from "@/lib/triage-model"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("@/app/(app)/actions", () => ({}))
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }))
const { TriageList } = await import("./triage-list")

const items: TriageItem[] = [
  { id: "approve-a", kind: "approve", title: "Ready draft", detail: "Mon 2 9:00", href: "/week", action: "Approve", postId: "a", run: "approve" },
  { id: "check-b", kind: "check", title: "Stale draft", detail: "Mon 2 12:00", href: "/week", action: "Check again", postId: "b", run: "recheck" },
]

describe("Needs you rows", () => {
  it("offers approval and a tick box only on drafts ready to approve", () => {
    const html = renderToStaticMarkup(<TriageList items={items} live />)
    expect(html.match(/Select: /g)?.length).toBe(1)
    expect(html).toContain("Select: Ready draft")
    expect(html).not.toContain("Select: Stale draft")
    expect(html).toContain("Check again")
  })
})
