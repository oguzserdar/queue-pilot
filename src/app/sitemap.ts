/**
 * @fileoverview sitemap.xml: the pages a visitor can open without signing in, at this copy's own address.
 */
import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicOrigin(await headers());
  return ["/", "/demo", "/privacy"].map((path) => ({ url: `${origin}${path}` }));
}
