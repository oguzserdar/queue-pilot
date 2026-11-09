import { EmbedWeek } from "@/components/embed-week";
import { demoShiftDays } from "@/lib/demo-clock";

/** Rebuilt at most hourly, so the example week moves on by itself after each Monday. */
export const revalidate = 3600;

export default function Page() {
  return <EmbedWeek shift={demoShiftDays()} />;
}
