export function sourceTimestamp(locator: string) {
  const total = Number(locator.slice(2));
  if (!Number.isSafeInteger(total) || total < 0) return "";
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}:${seconds}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}
export function sourceCheckedTime(value: string, timeZone: string, now = new Date()) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
  return day.format(date) === day.format(now) ? `Today ${clock}` : `${new Intl.DateTimeFormat("en-GB", { timeZone, month: "short", day: "numeric" }).format(date)} ${clock}`;
}
export function sourceDraftTime(value: string | null | undefined, timeZone: string) {
  return value ? new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "No time chosen";
}
