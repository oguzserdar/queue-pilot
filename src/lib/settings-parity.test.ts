/**
 * @fileoverview One list of operator settings (SETTINGS) drives /admin. The same list must be what a self-hoster
 * reads: every setting's environment name appears in .env.example and in the README's settings table, so the
 * screen, the docs and the server never disagree about what exists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "./settings";

const root = join(__dirname, "../..");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const settingsTable = readme.slice(readme.indexOf("### Settings"), readme.indexOf("## ", readme.indexOf("### Settings") + 4));
const envs = Object.values(SETTINGS).map((s) => s.env);

describe("settings parity", () => {
  it.each(envs)("%s is in .env.example", (env) => {
    expect(envExample).toMatch(new RegExp(`^#? ?${env}=`, "m"));
  });
  it.each(envs)("%s is in the README settings table", (env) => {
    expect(settingsTable).toContain(`\`${env}\``);
  });
});
