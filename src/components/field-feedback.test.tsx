/**
 * @fileoverview Field feedback: a problem shows on the field that caused it, and counts and loading keep their place.
 */
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PasswordField } from "@/registry/components/password-field/password-field"
import { RollingNumber } from "./rolling-number"
import { NeedsSkeleton, WeekSkeleton } from "./week-skeleton"

describe("a key field with a problem", () => {
  it("marks the field invalid and ties the message to it", () => {
    const html = renderToStaticMarkup(<PasswordField id="k" label="Key" error="That key was refused." />)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toMatch(/aria-describedby="[^"]*k-error/)
    expect(html).toContain("That key was refused.")
  })
  it("stays valid with no problem", () => {
    const html = renderToStaticMarkup(<PasswordField id="k" label="Key" />)
    expect(html).not.toContain('aria-invalid="true"')
    expect(html).not.toContain("k-error")
  })
})

describe("the rolling count", () => {
  it("shows the number itself, so screen readers and copies read it", () => {
    expect(renderToStaticMarkup(<RollingNumber value={8} />)).toContain(">8<")
  })
})

describe("loading placeholders", () => {
  it("keep the page's title and say they are loading", () => {
    const week = renderToStaticMarkup(<WeekSkeleton />)
    expect(week).toContain("Next week")
    expect(week).toContain('aria-busy="true"')
    expect(renderToStaticMarkup(<NeedsSkeleton />)).toContain('aria-busy="true"')
  })
})
