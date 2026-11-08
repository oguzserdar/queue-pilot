"use server";

/**
 * Announcements from Sources: the places a person can send to, sending one announcement with its exact text per
 * place, resending a place Telegram or Discord refused, and the recent results. The Discord channel is checked on the
 * server against the bot's real permissions every time, never taken from the browser on trust.
 */
import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresEchoStore } from "@/lib/echo-store";
import { botTokens } from "@/lib/echo-run";
import { limit } from "@/lib/rate-limit";
import { recordAction } from "@/lib/security-events";
import * as telegram from "@/lib/telegram";
import * as discord from "@/lib/discord";
import { resendFailed, sendAnnouncement, shownStatus, type AnnounceDeps, type AnnounceItem, type AnnounceKind, type AnnounceStatus } from "@/lib/announce";
import { postgresAnnounceStore } from "@/lib/announce-store";

/** Where the person can announce, as the composer shows it. */
export type AnnounceTargets = {
  telegram: { label: string; limit: number } | null;
  discord: { label: string; limit: number; channels: { id: string; name: string; canPost: boolean }[]; defaultId: string | null } | null;
  /** Why Discord channels could not be listed, when the bot is connected but the read failed. */
  problem?: string;
};

export type AnnounceRowView = { announcementId: string; kind: AnnounceKind; label: string; text: string; status: AnnounceStatus; link: string | null; error: string | null; at: string };

async function guildChannels(token: string, guildId: string) {
  return discord.channelsWithAccess(token, guildId);
}

export async function announceTargets(): Promise<AnnounceTargets> {
  const userId = await signedInUserId();
  if (!userId) return { telegram: null, discord: null };
  const [dests, tokens] = await Promise.all([postgresEchoStore().destinations(userId), botTokens()]);
  const tg = dests.find((d) => d.kind === "telegram");
  const dc = dests.find((d) => d.kind === "discord");
  const out: AnnounceTargets = {
    telegram: tg && tokens.telegram ? { label: tg.label, limit: telegram.TEXT_LIMIT } : null,
    discord: null,
  };
  if (dc && dc.guildId && tokens.discord) {
    try {
      const channels = await guildChannels(tokens.discord, dc.guildId);
      out.discord = { label: dc.label.split(" #")[0] ?? dc.label, limit: discord.CONTENT_LIMIT, channels, defaultId: channels.find((c) => c.id === dc.target && c.canPost)?.id ?? channels.find((c) => c.canPost)?.id ?? null };
    } catch (e) {
      out.problem = `Discord did not list the channels just now: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

function deps(tokens: { telegram?: string; discord?: string }, guildId: string | null): AnnounceDeps {
  return {
    store: postgresAnnounceStore(),
    refused: (e) => e instanceof telegram.TelegramError || e instanceof discord.DiscordError,
    post: async (item) => {
      if (item.kind === "telegram") {
        const r = await telegram.postAnnouncement(tokens.telegram!, Number(item.target), item.text);
        return { link: telegram.messageUrl(r.username, r.messageId) };
      }
      const r = await discord.postAnnouncement(tokens.discord!, item.target, item.text);
      return { link: guildId ? discord.messageUrl(guildId, item.target, r.messageId) : null };
    },
  };
}

export type SendAnnouncementInput = { key: string; telegram?: { text: string }; discord?: { channelId: string; text: string } };
export type SendAnnouncementResult =
  | { ok: true; results: { kind: AnnounceKind; label: string; status: AnnounceStatus; link: string | null; error: string | null }[] }
  | { ok: false; message: string };

/** Sends one announcement, each place getting the exact text the person confirmed. */
export async function sendAnnouncementAction(input: SendAnnouncementInput): Promise<SendAnnouncementResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof input?.key !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(input.key)) return { ok: false, message: "Open the announcement again and send it from there." };
  if (!(await limit("outbound", userId)).ok) return { ok: false, message: "Too many sends this hour. Try again later." };
  const [dests, tokens] = await Promise.all([postgresEchoStore().destinations(userId), botTokens()]);
  const items: AnnounceItem[] = [];
  const tg = dests.find((d) => d.kind === "telegram");
  const dc = dests.find((d) => d.kind === "discord");

  if (input.telegram) {
    const text = String(input.telegram.text ?? "").trim();
    if (!tg || !tokens.telegram) return { ok: false, message: "Connect a Telegram channel first." };
    if (!text) return { ok: false, message: "Write the Telegram message, or leave Telegram out." };
    if (text.length > telegram.TEXT_LIMIT) return { ok: false, message: `The Telegram message is ${text.length} characters; Telegram takes up to ${telegram.TEXT_LIMIT}.` };
    items.push({ kind: "telegram", target: tg.target, label: tg.label, text });
  }
  if (input.discord) {
    const text = String(input.discord.text ?? "").trim();
    if (!dc || !dc.guildId || !tokens.discord) return { ok: false, message: "Add Queue Pilot to a Discord server first." };
    if (!text) return { ok: false, message: "Write the Discord message, or leave Discord out." };
    if (text.length > discord.CONTENT_LIMIT) return { ok: false, message: `The Discord message is ${text.length} characters; Discord takes up to ${discord.CONTENT_LIMIT}.` };
    let channels;
    try { channels = await guildChannels(tokens.discord, dc.guildId); } catch (e) { return { ok: false, message: `Discord did not answer just now: ${e instanceof Error ? e.message : String(e)}` }; }
    const channel = channels.find((c) => c.id === String(input.discord!.channelId));
    if (!channel) return { ok: false, message: "That channel is not in your Discord server." };
    if (!channel.canPost) return { ok: false, message: `Queue Pilot cannot post in #${channel.name}. Give its role View Channel and Send Messages there, or pick another channel.` };
    items.push({ kind: "discord", target: channel.id, label: `${dc.label.split(" #")[0]} #${channel.name}`, text });
  }
  if (!items.length) return { ok: false, message: "Choose at least one place to send it." };

  const { results } = await sendAnnouncement(userId, input.key, items, deps(tokens, dc?.guildId ?? null));
  if (results.some((r) => r.status === "sent" || r.status === "uncertain")) {
    await recordAction(userId, "announcement_sent", { via: "app" }, { name: results.filter((r) => r.status !== "failed").map((r) => (r.kind === "telegram" ? "Telegram" : "Discord")).join(" and ") });
  }
  revalidatePath("/sources");
  return { ok: true, results };
}

/** Sends a place again after Telegram or Discord refused it, with the same text. */
export async function resendAnnouncementAction(announcementId: string, kind: AnnounceKind): Promise<SendAnnouncementResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof announcementId !== "string" || announcementId.length > 100 || (kind !== "telegram" && kind !== "discord")) return { ok: false, message: "Unknown announcement." };
  if (!(await limit("outbound", userId)).ok) return { ok: false, message: "Too many sends this hour. Try again later." };
  const [dests, tokens] = await Promise.all([postgresEchoStore().destinations(userId), botTokens()]);
  if (!tokens[kind]) return { ok: false, message: "That bot is not set up on this deployment." };
  const r = await resendFailed(userId, announcementId, kind, deps(tokens, dests.find((d) => d.kind === "discord")?.guildId ?? null));
  if (!r) return { ok: false, message: "Only a message Telegram or Discord refused can be sent again." };
  revalidatePath("/sources");
  return { ok: true, results: [r] };
}

/** The person's recent announcement results, newest first. */
export async function recentAnnouncements(): Promise<AnnounceRowView[]> {
  const userId = await signedInUserId();
  if (!userId) return [];
  const now = new Date();
  return (await postgresAnnounceStore().recent(userId, 12)).map((r) => ({
    announcementId: r.announcementId, kind: r.kind, label: r.label, text: r.text, status: shownStatus(r, now), link: r.link, error: r.error, at: r.createdAt.toISOString(),
  }));
}
