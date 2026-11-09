/**
 * @fileoverview A note's date is written by the browser after load, never by the server: the server cannot know the
 * reader's language or time zone, and a server date ("Nov 8") that differs from the browser's ("8 Kas") breaks
 * hydration and rebuilds the week on the client.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftNotes } from "./draft-notes";

const note = { id: "n1", author: "Sam", avatar: null, createdAt: "2026-11-08T21:05:00.000Z", edited: false, text: "Name the company first.", canEdit: false, canDelete: false };

describe("DraftNotes", () => {
  it("leaves each note's date empty in the server render", () => {
    const html = renderToStaticMarkup(<DraftNotes postId="d1" preview={{ notes: [note], more: false, team: true, teammates: [] }} />);
    expect(html).toContain('<time dateTime="2026-11-08T21:05:00.000Z"></time>');
    expect(html).not.toMatch(/Nov|Kas|2026, /);
  });
});
