/** @fileoverview The changed words of an edit, with a little context, for the same-fix offer. */
import { describe, expect, it } from "vitest"
import { fixExcerpt } from "./fix-excerpt"

describe("fixExcerpt", () => {
  it("keeps a short edit whole", () => {
    expect(fixExcerpt("We launch today.", "We ship today.")).toEqual({ before: "We launch today.", after: "We ship today.", lead: "We", removed: "launch", added: "ship", tail: "today." })
  })

  it("cuts shared words far from the change, marking each cut", () => {
    const before = "One two three four five six seven eight launch nine ten eleven twelve thirteen fourteen."
    const after = "One two three four five six seven eight ship nine ten eleven twelve thirteen fourteen."
    expect(fixExcerpt(before, after)).toMatchObject({ before: "…four five six seven eight launch nine ten eleven twelve thirteen…", after: "…four five six seven eight ship nine ten eleven twelve thirteen…" })
  })

  it("shows an added ending after the last words of the draft", () => {
    expect(fixExcerpt("A long first line about the model and its score of 59.", "A long first line about the model and its score of 59. Full issue: link")).toEqual({ before: "…and its score of 59.", after: "…and its score of 59. Full issue: link", lead: "…and its score of 59.", removed: "", added: "Full issue: link", tail: "" })
  })
})
