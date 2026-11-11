/**
 * @fileoverview Channel health and the Telegram and Discord copies live in Settings, Channels; Sources holds only material.
 * @module components/settings-channels.test
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsView } from "./settings-view";
import { SourcesView } from "./sources-view";
import { ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import type { ReactNode } from "react";

// The app shell provides the toast stack; the screens need it to render.
const inApp = (ui: ReactNode) => renderToStaticMarkup(<ToastStackProvider>{ui}</ToastStackProvider>);

describe("Channels in Settings", () => {
  it("shows each Buffer channel and the copies on the Channels tab", () => {
    const out = inApp(<SettingsView tab="channels" />);
    expect(out).toContain("Your Buffer channels");
    expect(out).toContain("Buffer schedules and publishes.");
  });

  it("keeps Sources to the material drafts are written from", () => {
    const out = inApp(<SourcesView mode="example" connectorUrl="https://qp.test/api/mcp" />);
    expect(out).toContain("Your material");
    expect(out).not.toContain("Your Buffer channels");
    expect(out).not.toContain("Telegram and Discord");
    expect(out).not.toContain("https://qp.test/api/mcp");
  });
});
