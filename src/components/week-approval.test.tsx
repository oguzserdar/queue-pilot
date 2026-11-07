import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { demoWeek } from "@/lib/demo-data"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/(app)/actions", () => ({}))
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }))
const { WeekView } = await import("./week-view")

const week = { ...demoWeek, posts: [
  { ...demoWeek.posts[0], id: "ours", status: "draft" as const, ours: true, checks: [] },
  { ...demoWeek.posts[0], id: "foreign-api", status: "draft" as const, ours: true, checks: [] },
] }

describe("approval selection", () => {
  it.each(["check", "breaks"] as const)("excludes %s drafts from bulk approval", state => {
    const html = renderToStaticMarkup(<WeekView week={week} live verdicts={{ ours: [] }} readiness={{ ours: { state, reason: "Check required" } }} />);
    expect(html).toContain("Nothing ready to approve");
    expect(html).not.toContain("Approve 1 draft");
  });

  it("counts only recorded drafts even when another app's draft is marked API-made", () => {
    const html = renderToStaticMarkup(<WeekView week={week} live verdicts={{ ours: null }} />)
    expect(html).toContain("Approve 1 draft")
    expect(html).not.toContain("Approve 2 drafts")
    expect(html).toContain("Only your Approve schedules, or your AI when you ask it")
  })

  it("offers no approval when there are no writing records", () => {
    const html = renderToStaticMarkup(<WeekView week={week} live verdicts={{}} />)
    expect(html).toContain("Nothing ready to approve")
    expect(html).not.toContain("All approved")
    expect(html).not.toContain("Approve 2 drafts")
  })
})

describe("the week's title", () => {
  it("counts only drafts that can be approved, and names the held-back post apart, so it matches the Approve button", () => {
    const html = renderToStaticMarkup(<WeekView week={demoWeek} />)
    const approveButton = html.match(/Approve (\d+) drafts?/)?.[1]
    expect(html).toContain(`Next week: ${approveButton} drafts to approve, 1 held back`)
  })
})
