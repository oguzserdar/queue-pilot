/**
 * Where Discord sends the user back after "Add to server". The state must match the signed-in user, the server comes
 * from the code exchange (not the redirect's guild_id hint), and the bot's default channel is saved as the destination.
 */
import { NextResponse, type NextRequest } from "next/server";
import { signedInUserId } from "@/lib/current-user";
import { defaultChannel, exchangeInstall, postableChannels, stateMatches } from "@/lib/discord";
import { postgresEchoStore } from "@/lib/echo-store";
import { publicOrigin } from "@/lib/origin";
import { limit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const back = (result: string) => NextResponse.redirect(`${publicOrigin(req.headers)}/sources?discord=${result}`, 303);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: clientSecret, DISCORD_BOT_TOKEN: botToken, SESSION_SECRET: secret } = process.env;
  if (!clientId || !clientSecret || !botToken || !secret) return back("not-set-up");
  const userId = await signedInUserId();
  if (!userId) return back("signed-out");
  if (!(await limit("connect", userId)).ok) return back("slow");
  if (!code || !stateMatches(state, userId, secret, new Date())) return back("expired");
  try {
    const redirectUri = `${publicOrigin(req.headers)}/api/discord/callback`;
    const { guildId, guildName } = await exchangeInstall(code, { clientId, clientSecret, redirectUri });
    const channel = defaultChannel(await postableChannels(botToken, guildId));
    if (!channel) return back("no-channel");
    await postgresEchoStore().setDestination(userId, { kind: "discord", label: `${guildName} #${channel.name}`, target: channel.id, guildId });
    return back("connected");
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-discord-install-failed", message: e instanceof Error ? e.message : String(e) }));
    return back("failed");
  }
}
