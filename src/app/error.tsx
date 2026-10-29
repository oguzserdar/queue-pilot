"use client";

import { useEffect } from "react";
import { StatusPage, statusLinkClass } from "@/components/status-page";

/** Any screen that throws lands here, inside the root layout. The reference id matches the server log line. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage
      title="Queue Pilot hit a problem"
      body={`This screen could not load. Nothing in your Buffer changed. Try again${error.digest ? ", and if it keeps happening, send us the reference below" : ""}.`}
      reference={error.digest}
      actions={
        <>
          <button type="button" className={statusLinkClass} onClick={reset}>Try again</button>
          <a href="/" className={statusLinkClass}>Open Queue Pilot</a>
        </>
      }
    />
  );
}
