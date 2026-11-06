/**
 * @fileoverview One list of operator settings (SETTINGS) drives /admin. The same list must be what a self-hoster
 * reads: every setting's environment name appears in .env.example and in the README's settings table, so the
 * screen, the docs and the server never disagree about what exists. No code reads those names from process.env
 * directly, so a value saved in /admin always wins.
 */
import { readdirSync, readFileSync } from "node:fs";
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

/** Every non-test source file under src, read once. */
function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

describe("settings are read through the resolver", () => {
  const files = sources(join(root, "src")).filter((f) => !f.path.endsWith(join("lib", "settings.ts")));
  // A direct read would skip the value saved in /admin, which must win over the server's environment.
  it.each(envs)("%s is never read straight from process.env", (env) => {
    const direct = new RegExp(`process\\.env(\\.${env}\\b|\\[\\s*["'\`]${env}["'\`])|\\{[^}]*\\b${env}\\b[^}]*\\}\\s*=\\s*process\\.env`);
    expect(files.filter((f) => direct.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
