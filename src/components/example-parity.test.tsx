/**
 * @fileoverview The signed-out example must show the same screens as a signed-in person: the week's actions and the
 * playbook's account view. If a live screen gains a section the example lacks, this test is where it fails first.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(app)/actions", () => ({}));
vi.mock("@/app/(app)/review-actions", () => ({}));
vi.mock("@/app/(app)/note-actions", () => ({}));
vi.mock("@/app/(app)/tag-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/registry/components/toast-stack/toast-stack", () => ({ useToastStack: () => ({ toast: vi.fn() }) }));

const { WeekView } = await import("./week-view");
const { PlaybookView } = await import("./playbook-view");
const { demoWeek } = await import("@/lib/demo-data");
const { countOpenSlots } = await import("@/lib/week-model");
const { exampleApprovals, exampleEvidence, exampleNotes, exampleRules, exampleTags, exampleWriting } = await import("@/lib/example-week-extras");
const { EXAMPLE_NOTE_DRAFTS, EXAMPLE_NOTE_PLAN, EXAMPLE_NOTE_RULE, EXAMPLE_TEAM_NOTE } = await import("@/lib/example-notes");
const { FeedbackPlanView } = await import("./feedback-plan-view");
const { ruleOrigin } = await import("@/lib/rule-origin");
const { channels } = await import("@/lib/example-channels");

describe("example matches the signed-in screens", () => {
  it("shows the week's actions a signed-in person has", () => {
    const ids = demoWeek.posts.filter((p) => p.status === "draft").map((p) => p.id);
    const html = renderToStaticMarkup(<WeekView week={demoWeek} evidence={exampleEvidence} notesPreview={exampleNotes(ids)} tagsPreview={exampleTags(ids)} rules={exampleRules} writing={exampleWriting} writeCount={countOpenSlots(demoWeek)} />);
    for (const label of ["New post", "Fill next week", "Share for review", "Times in"]) expect(html).toContain(label);
  });

  it("gives every example draft a creation line and the draft window's data", () => {
    const drafts = demoWeek.posts.filter((p) => p.status === "draft");
    expect(drafts.every((p) => p.createdAt && p.createdBy)).toBe(true);
    expect(exampleEvidence.length).toBeGreaterThan(0);
    expect(Object.values(exampleNotes(drafts.map((p) => p.id))).some((n) => n.notes.length > 0)).toBe(true);
  });

  it("shows the team-notes finder on the example playbook, as on the live one", () => {
    const example = renderToStaticMarkup(<PlaybookView mode="example" accounts={channels.map((c) => ({ id: c.id, name: c.handle, service: c.service }))} />);
    const live = renderToStaticMarkup(<PlaybookView mode="live" initial={[]} accounts={[]} reader={async () => null} />);
    for (const html of [example, live]) expect(html).toContain("Rules from your team&#x27;s notes");
  });

  it("turns Sam's note on the LinkedIn Gemini draft into a LinkedIn-only rule suggestion, in the live component", () => {
    // The note is the same one the draft window lists on that draft.
    expect(exampleNotes(["d1"]).d1.notes.some((n: { author: string | null; text: string }) => n.author === "Sam" && n.text === EXAMPLE_TEAM_NOTE.text)).toBe(true);
    expect(EXAMPLE_TEAM_NOTE).toMatchObject({ postId: "d1", channelId: "linkedin", author: "Sam" });
    // Every change it proposes is to a LinkedIn draft, and only the company that published the news is added.
    for (const e of EXAMPLE_NOTE_PLAN.edits) {
      expect(demoWeek.posts.find((p) => p.id === e.postId)?.channel).toBe("linkedin");
      expect(e.before).toBe(demoWeek.posts.find((p) => p.id === e.postId)?.text);
    }
    const html = renderToStaticMarkup(<FeedbackPlanView plan={EXAMPLE_NOTE_PLAN} from="Sam's note" labelFor={(id) => EXAMPLE_NOTE_DRAFTS[id]} scopes={[{ value: "accounts", label: "Only Alex Rivera (LinkedIn)", help: "x" }]} onApply={async () => ({ ok: true })} onKeep={async () => ({ ok: true })} />);
    for (const text of ["Lasting preference", "2 drafts would change", "Only Alex Rivera (LinkedIn)", "Keep as a rule"]) expect(html).toContain(text);
    expect(html).not.toContain("Every account");
    expect(EXAMPLE_NOTE_RULE.accountIds).toEqual(["linkedin"]);
    expect(ruleOrigin(EXAMPLE_NOTE_RULE)).toBe("A note from Sam on 1 Nov");
  });

  it("gives every example rule an origin and shows who approved a scheduled post", () => {
    expect(exampleRules.every((r) => ruleOrigin(r) ?? (r as { origin?: string }).origin)).toBe(true);
    const ids = demoWeek.posts.filter((p) => p.status === "draft").map((p) => p.id);
    const html = renderToStaticMarkup(<WeekView week={demoWeek} evidence={exampleEvidence} notesPreview={exampleNotes(ids)} tagsPreview={exampleTags(ids)} rules={exampleRules} writing={exampleWriting} writeCount={countOpenSlots(demoWeek)} approvals={exampleApprovals} />);
    expect(html).toContain("Last approved through Queue Pilot: by you in Queue Pilot, 3 Nov");
  });

  it("shows the playbook's account view, as the live playbook does", () => {
    const html = renderToStaticMarkup(<PlaybookView mode="example" accounts={channels.map((c) => ({ id: c.id, name: c.handle, service: c.service }))} />);
    expect(html).toContain("Rules for");
    expect(html).toContain("Pick an account to see what applies there.");
  });
});
