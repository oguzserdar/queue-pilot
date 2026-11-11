/**
 * @fileoverview The rule field stops at 200 characters, and says so in its own hint in plain words when the text
 * reaches the limit, instead of silently refusing more characters.
 */
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RuleForm, ruleTextHint } from "./rule-form"

describe("rule field limit", () => {
  it("says nothing below the limit", () => {
    expect(ruleTextHint(0)).toBeUndefined()
    expect(ruleTextHint(199)).toBeUndefined()
  })

  it("says 200 characters is the most once the text reaches it", () => {
    expect(ruleTextHint(200)).toBe("200 characters is the most for one rule.")
  })

  it("keeps the field at 200 characters and shows no hint while it is empty", () => {
    const html = renderToStaticMarkup(<RuleForm onAdd={async () => null} />)
    expect(html).toContain('maxLength="200"')
    expect(html).not.toContain("characters is the most")
  })
})
