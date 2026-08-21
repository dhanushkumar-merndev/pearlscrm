import { redirect } from "next/navigation";

/**
 * The application has no marketing root. Middleware sends unauthenticated
 * traffic to `/sign-in`; a signed-in visitor landing on `/` belongs on the
 * dashboard, which re-checks the session itself.
 */
export default function RootPage() {
  redirect("/dashboard");
}
