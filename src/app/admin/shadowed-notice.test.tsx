/**
 * @fileoverview The notice at the top of /admin that lists every setting whose saved value hides a value set in the
 * server's environment, each with the action that goes back to the server's value.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ clearAdminSetting: async () => {} }));
const { ShadowedNotice } = await import("./shadowed-notice");

describe("shadowed settings notice", () => {
  it("lists each hidden server value with its own Use the server's value action", () => {
    const html = renderToStaticMarkup(<ShadowedNotice keys={["fallback_ai_key", "ai_cap_per_person"]} />);
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("AI key");
    expect(html).toContain("FALLBACK_AI_KEY");
    expect(html).toContain("Actions per person per day");
    expect(html).toContain("AI_CAP_PER_PERSON");
    expect(html.match(/Use the server(&#x27;|')s value/g)).toHaveLength(2);
    expect(html).toContain('name="key" value="fallback_ai_key"');
    expect(html).toContain('name="key" value="ai_cap_per_person"');
  });

  it("shows nothing when no saved value hides the server's", () => {
    expect(renderToStaticMarkup(<ShadowedNotice keys={[]} />)).toBe("");
  });
});
