/**
 * @fileoverview robots.txt for whichever copy is serving it: the homepage, the demo and the privacy page are public;
 * the API, admin and private review links are not for crawlers.
 */
import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = publicOrigin(await headers());
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/r/", "/dev/"] }, sitemap: `${origin}/sitemap.xml` };
}
