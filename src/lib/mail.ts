/**
 * @fileoverview Email from Queue Pilot: account verification, password reset, and the notice sent when someone tries to
 * sign up with an address that already has an account. One sender, SMTP, set by whoever runs the server, so any mail
 * provider works. With no SMTP set, email accounts are off and only "Sign in with Buffer" shows.
 *
 * Mail counts as set up when SMTP_HOST, SMTP_PORT and SMTP_FROM are all set, or when RESEND_API_KEY (Vercel's
 * marketplace adds it) and SMTP_FROM are; port 465 uses TLS from the start,
 * other ports upgrade with STARTTLS, and certificates are always checked. Links in mail are built by Better Auth from
 * the configured public address, never from a request's Host header. Nothing here writes a link to the logs.
 */
import "server-only";
import { createTransport, type Transporter } from "nodemailer";

/** The SMTP settings this server runs with. */
export type MailConfig = { host: string; port: number; user?: string; pass?: string; from: string };

/** One message, as plain text with an HTML version. */
export type Mail = { to: string; subject: string; text: string; html: string };

/** Sends one message; throws when the server refuses it. */
export type Mailer = { send(mail: Mail): Promise<void>; key: string };

/**
 * Reads the SMTP settings from the environment.
 *
 * @returns The settings, or null when mail is not set up (email accounts then stay off)
 */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  // Resend as Vercel's marketplace installs it (RESEND_API_KEY), over its SMTP with TLS from the start
  // (resend.com/docs/send-with-smtp: smtp.resend.com, 465 implicit TLS, user "resend", the key as password).
  if (env.RESEND_API_KEY && !env.SMTP_HOST) return env.SMTP_FROM ? { host: "smtp.resend.com", port: 465, user: "resend", pass: env.RESEND_API_KEY, from: env.SMTP_FROM } : null;
  const port = Number(env.SMTP_PORT);
  if (!env.SMTP_HOST || !Number.isInteger(port) || port <= 0 || !env.SMTP_FROM) return null;
  return { host: env.SMTP_HOST, port, user: env.SMTP_USER || undefined, pass: env.SMTP_PASSWORD || undefined, from: env.SMTP_FROM };
}

/**
 * A mailer for the given settings.
 *
 * @param transport - Replaces the SMTP connection in tests
 */
export function smtpMailer(config: MailConfig, transport?: Pick<Transporter, "sendMail">): Mailer {
  const t = transport ?? createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465 && config.port !== 25,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
    tls: { rejectUnauthorized: true },
  });
  return {
    key: `${config.host}:${config.port}:${config.user ?? ""}:${config.from}`,
    async send(mail) {
      await t.sendMail({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** A short message with one button, in plain words. */
function message(to: string, subject: string, lines: string[], action?: { label: string; url: string }): Mail {
  const text = [...lines, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "Queue Pilot"].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#15181d;max-width:480px">${lines.map((l) => `<p>${escape(l)}</p>`).join("")}${
    action ? `<p><a href="${escape(action.url)}" style="display:inline-block;background:#9b1b5a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escape(action.label)}</a></p><p style="font-size:13px;color:#5b6370">Or open this link: ${escape(action.url)}</p>` : ""
  }<p style="font-size:13px;color:#5b6370">Queue Pilot</p></div>`;
  return { to, subject, text, html };
}

/** The verification email sent after sign-up. */
export const verifyMail = (to: string, url: string) =>
  message(to, "Confirm your email for Queue Pilot", ["Confirm this is your email to finish creating your Queue Pilot account.", "The link works for one hour. If you did not sign up, ignore this email."], { label: "Confirm email", url });

/** The password reset email. */
export const resetMail = (to: string, url: string) =>
  message(to, "Reset your Queue Pilot password", ["Someone asked to reset the password for this email. If it was you, choose a new one.", "The link works for one hour and once. If it was not you, ignore this email; your password stays the same."], { label: "Choose a new password", url });

/** Sent instead of a second account when someone signs up with an address that already has one. */
export const existingAccountMail = (to: string, signInUrl: string) =>
  message(to, "You already have a Queue Pilot account", ["Someone tried to create a Queue Pilot account with this email, which already has one.", "If it was you, sign in instead. If you forgot your password, you can reset it from the sign-in page. If it was not you, ignore this email."], { label: "Sign in", url: signInUrl });
