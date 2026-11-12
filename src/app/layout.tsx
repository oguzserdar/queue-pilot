import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { Schibsted_Grotesk } from "next/font/google";
import { publicOrigin } from "@/lib/origin";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin", "latin-ext"] });

const DESCRIPTION = "Your own AI fills the empty slots in your Buffer queue, checked against a playbook learned from your edits.";

/**
 * Title, description and link previews. The base address is the one the page was served from, so a self-hosted copy
 * shares previews of itself; the preview image comes from opengraph-image.png and twitter-image.png beside this file.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(publicOrigin(await headers())),
    title: "Queue Pilot",
    description: DESCRIPTION,
    openGraph: { type: "website", siteName: "Queue Pilot", title: "Queue Pilot", description: DESCRIPTION, url: "/" },
    twitter: { card: "summary_large_image", title: "Queue Pilot", description: DESCRIPTION },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable}>
      <body>
        {children}
        {/* Page views for the deployment's own Vercel dashboard. Cookie-free, and it does nothing off Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
