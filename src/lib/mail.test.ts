/**
 * @fileoverview Which mail settings count as set up: plain SMTP, or Resend's key as Vercel's marketplace installs it
 * (RESEND_API_KEY), sent over Resend's SMTP with TLS from the start.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { mailConfig } = await import("./mail");

describe("mailConfig", () => {
  it("reads plain SMTP settings", () => {
    expect(mailConfig({ SMTP_HOST: "smtp.example", SMTP_PORT: "587", SMTP_FROM: "QP <a@example.com>" })).toEqual({ host: "smtp.example", port: 587, user: undefined, pass: undefined, from: "QP <a@example.com>" });
  });
  it("uses Resend over SMTP with TLS from the start when only RESEND_API_KEY is set", () => {
    expect(mailConfig({ RESEND_API_KEY: "re_123", SMTP_FROM: "QP <hello@getqueuepilot.com>" })).toEqual({ host: "smtp.resend.com", port: 465, user: "resend", pass: "re_123", from: "QP <hello@getqueuepilot.com>" });
  });
  it("needs a from address with Resend too (its domain must be verified in Resend)", () => {
    expect(mailConfig({ RESEND_API_KEY: "re_123" })).toBeNull();
  });
  it("control: nothing set means email accounts stay off", () => {
    expect(mailConfig({})).toBeNull();
  });
});
