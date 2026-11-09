/**
 * @fileoverview The signed-out Needs you items: the same example account as the week, delivery and playbook screens,
 * with dates that move with the example week (demo-clock.ts).
 */
import type { NeedItem } from "@/components/needs-you-view";
import { demoDays } from "./demo-data";
import { DEMO_BASE_START, shiftIso, storyShift, weekdayDayMonth } from "./demo-clock";

/** Example home, matching the example week used on the other screens, moved by `shift` days (demo-clock.ts). */
export const exampleNeeds = (shift: number): NeedItem[] => [
  { id: "drafts", tone: "warning", title: "4 drafts to approve", detail: `${demoDays(shift)[1]} to ${demoDays(shift)[3]}, written from This Week in AI 41 and 40`, action: "Review", href: "/week" },
  { id: "rule", tone: "warning", title: "1 fix you made twice", detail: "On Instagram you replaced a feeling with the result. Keep it as a rule?", action: "Decide", href: "/playbook" },
  { id: "willfail", tone: "danger", title: "1 post would fail", detail: "Wednesday's Threads post: Threads is disconnected in Buffer", action: "See the post", href: "/week" },
  { id: "failed", tone: "danger", title: "1 post did not go out", detail: `${weekdayDayMonth(shiftIso(DEMO_BASE_START, storyShift(shift) - 5))}, X 09:00: the image could not be loaded from its link`, action: "See why", href: "/delivery" },
  { id: "empty", tone: "warning", title: "1 empty slot next week", detail: "Friday, LinkedIn at 12:00", action: "Write it", href: "/week?new=1" },
];
