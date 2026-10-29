import type { MetadataRoute } from "next";

/** The web app manifest: name, colours and icons for "Add to Home Screen" and installed use. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Queue Pilot",
    short_name: "Queue Pilot",
    description: "Your AI writes drafts into Buffer, checked against a playbook learned from your edits.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f8",
    theme_color: "#17121a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
