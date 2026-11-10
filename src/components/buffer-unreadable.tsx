import { LocalTime } from "./local-time";

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/**
 * Shown to a signed-in person whose Buffer account could not be read and has no saved copy yet. It replaces every app
 * page, so they are never shown the signed-out example as if it were their account.
 */
export function BufferUnreadable({ retryAt }: { retryAt: string | null }) {
  return (
    <main style={{ maxWidth: 520, margin: "96px auto", padding: "0 20px", display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-xl)" }}>You are signed in, but Buffer could not be read</h1>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>
        {retryAt
          ? <>Buffer's request limit is reached for now. It opens again at <LocalTime iso={retryAt} options={TIME} fallback="the time Buffer gave" />. Nothing in your Buffer was changed.</>
          : "Buffer did not answer just now. Nothing in your Buffer was changed."}
      </p>
      <form method="post" action="/auth/signout" style={{ margin: 0, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <a href="/">Try again</a>
        <button type="submit" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "var(--text-muted)", textDecoration: "underline", cursor: "pointer" }}>Sign out</button>
      </form>
    </main>
  );
}
