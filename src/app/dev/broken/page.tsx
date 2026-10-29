import { notFound } from "next/navigation";

/** Development only: throws, to show the error screen. Production answers 404. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  throw new Error("Example failure for the error screen");
}
