import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Queue Pilot",
  description: "Your own AI fills the empty slots in your Buffer queue. You approve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={schibsted.variable}>
      <body>{children}</body>
    </html>
  );
}
