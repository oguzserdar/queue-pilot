import { mailConfig } from "@/lib/mail";
import { SignInView } from "./sign-in-view";

export const dynamic = "force-dynamic";

/** Sign in. Email sign-in shows only when this server can send mail (verification and reset need it). */
export default function SignInPage() {
  return <SignInView emailEnabled={mailConfig() !== null} />;
}
