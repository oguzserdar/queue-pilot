import { BriefingView } from "@/components/briefing-view";
import { getCurrentUser } from "@/lib/current-user";
import { demoShiftDays } from "@/lib/demo-clock";

export default async function Page() {
  const { user } = await getCurrentUser();
  return <BriefingView mode={user ? "live" : "example"} shift={demoShiftDays()} />;
}
