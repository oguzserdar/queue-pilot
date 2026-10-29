"use client";

import "./globals.css";
import { StatusPage, statusLinkClass } from "@/components/status-page";

/** Used only when the root layout itself fails, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <StatusPage
          title="Queue Pilot hit a problem"
          body="Queue Pilot could not load. Nothing in your Buffer changed. Try again in a minute."
          reference={error.digest}
          actions={<button type="button" className={statusLinkClass} onClick={reset}>Try again</button>}
        />
      </body>
    </html>
  );
}
