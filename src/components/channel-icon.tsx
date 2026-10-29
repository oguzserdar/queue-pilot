import {
  IconBrandBluesky,
  IconBrandFacebook,
  IconBrandGoogle,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandMastodon,
  IconBrandPinterest,
  IconBrandThreads,
  IconBrandTiktok,
  IconBrandX,
  IconBrandYoutube,
  IconWorld,
  type Icon,
} from "@tabler/icons-react";

/**
 * Each network's logo and brand colour, keyed by Buffer's service name. Colours come from each brand's published
 * guidelines; a black brand mark uses the text colour so it stays visible on a dark page.
 */
const LOGOS: Record<string, { Icon: Icon; color: string }> = {
  linkedin: { Icon: IconBrandLinkedin, color: "#0A66C2" },
  instagram: { Icon: IconBrandInstagram, color: "#FF0069" },
  twitter: { Icon: IconBrandX, color: "currentColor" },
  x: { Icon: IconBrandX, color: "currentColor" },
  bluesky: { Icon: IconBrandBluesky, color: "#1185FE" },
  threads: { Icon: IconBrandThreads, color: "currentColor" },
  facebook: { Icon: IconBrandFacebook, color: "#0866FF" },
  mastodon: { Icon: IconBrandMastodon, color: "#6364FF" },
  tiktok: { Icon: IconBrandTiktok, color: "currentColor" },
  youtube: { Icon: IconBrandYoutube, color: "#FF0000" },
  pinterest: { Icon: IconBrandPinterest, color: "#BD081C" },
  googlebusiness: { Icon: IconBrandGoogle, color: "#4285F4" },
};

/** The logo of the network a channel posts to; a plain globe for a network Queue Pilot has no logo for. */
export function ChannelIcon({ service, size = 16, className }: { service?: string; size?: number; className?: string }) {
  const logo = (service && LOGOS[service]) || { Icon: IconWorld, color: "currentColor" };
  return <logo.Icon size={size} stroke={1.75} color={logo.color} className={className} aria-hidden="true" focusable="false" />;
}
