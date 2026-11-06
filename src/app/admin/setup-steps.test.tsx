/**
 * @fileoverview The /admin setup steps: in production the claim asks for the setup code, and without a usable code no
 * claim is offered and the page says how to recover admin from the deployment's settings or the server.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ claimAdmin: async () => {} }));
vi.mock("@/components/sign-in-button", () => ({ SignInButton: () => null }));
const { SetupSteps } = await import("./setup-steps");
const { setupCodeReady, setupCodeRequired } = await import("@/lib/admin-setup-code");

describe("admin setup steps", () => {
  it("offers no claim in production without a usable code, and explains both ways back", () => {
    const env = { NODE_ENV: "production", ADMIN_SETUP_CODE: "too-short" };
    const html = renderToStaticMarkup(<SetupSteps email="a@x" needsCode={setupCodeRequired(env)} ready={setupCodeReady(env)} />);
    expect(html).not.toContain("Become the admin</button>");
    expect(html).toContain("nobody can claim it from the web");
    expect(html).toContain("ADMIN_SETUP_CODE");
    expect(html).toContain("pnpm admin:grant");
  });

  it("asks for the setup code in production once one is configured", () => {
    const env = { NODE_ENV: "production", ADMIN_SETUP_CODE: "x".repeat(24) };
    const html = renderToStaticMarkup(<SetupSteps email="a@x" needsCode={setupCodeRequired(env)} ready={setupCodeReady(env)} />);
    expect(html).toContain('name="code"');
    expect(html).toContain("Become the admin");
  });

  it("keeps the code-free claim outside production when no code is set", () => {
    const env = { NODE_ENV: "development" };
    const html = renderToStaticMarkup(<SetupSteps email="a@x" needsCode={setupCodeRequired(env)} ready={setupCodeReady(env)} />);
    expect(html).not.toContain('name="code"');
    expect(html).toContain("Become the admin");
  });
});
