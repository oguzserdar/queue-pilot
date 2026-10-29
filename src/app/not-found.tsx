import Link from "next/link";
import { StatusPage, statusLinkClass } from "@/components/status-page";

export default function NotFound() {
  return (
    <StatusPage
      title="This page does not exist"
      body="The link may be old or mistyped. Your queue and drafts are where you left them."
      actions={<Link href="/" className={statusLinkClass}>Open Queue Pilot</Link>}
    />
  );
}
