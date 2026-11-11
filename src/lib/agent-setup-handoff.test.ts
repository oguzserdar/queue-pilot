/**
 * @fileoverview The one message a person pastes into a chat AI to get started with Queue Pilot.
 * @module lib/agent-setup-handoff.test
 */
import { describe, expect, it } from "vitest";
import { chatHandoff } from "./agent-setup";
import { PLUGIN_SKILLS } from "./plugin-skills";

const text = chatHandoff("ChatGPT", "https://qp.test/api/mcp", ["Go to chatgpt.com/plugins, press +", "Paste the URL above as the Server URL"], PLUGIN_SKILLS["queue-pilot-fill-week"]);

describe("chatHandoff", () => {
  it("connects first, only when the tools are missing, one step at a time, with the address and no key", () => {
    expect(text).toContain("If you can, go to step 3.");
    expect(text).toContain("help me add Queue Pilot to ChatGPT.");
    expect(text).toContain("Otherwise give me one step, wait until I say it is done");
    // After an account deletion the app already lists Queue Pilot and only needs Reconnect.
    expect(text).toContain("it shows Reconnect), I press Reconnect, then Allow");
    expect(text).toContain("1. Go to chatgpt.com/plugins, press +.");
    expect(text).toContain("2. Paste Queue Pilot's address as the Server URL.");
    expect(text).toContain("Queue Pilot's address: https://qp.test/api/mcp");
    expect(text).toContain("There is no API key.");
  });

  it("ends the first run on a preview that saves nothing", () => {
    expect(text).toContain("Do not save, schedule or publish anything.");
  });

  it("carries the fill-week skill itself, without its install header", () => {
    expect(text).toContain("# Fill my week");
    expect(text).toContain("## Never");
    expect(text).not.toMatch(/^---$/m);
    expect(text).not.toContain("name: queue-pilot-fill-week");
  });
});
