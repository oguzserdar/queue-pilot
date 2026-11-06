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
const { exampleEvidence, exampleNotes, exampleRules, exampleTags, exampleWriting } = await import("@/lib/example-week-extras");
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

  it("shows the playbook's account view, as the live playbook does", () => {
    const html = renderToStaticMarkup(<PlaybookView mode="example" accounts={channels.map((c) => ({ id: c.id, name: c.handle, service: c.service }))} />);
    expect(html).toContain("Rules for");
    expect(html).toContain("Pick an account to see what applies there.");
  });
});
