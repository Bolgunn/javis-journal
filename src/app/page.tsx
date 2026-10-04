import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Calendar } from "@/components/calendar/Calendar";
import { isGuestRequest } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/server";

// The calendar home. Thin server component: auth check, then hand off to the client
// island (which owns view + current-month state and opens on the current month).
// M11: a guest (no session, the `jj_guest` cookie) is let in too — through the same
// `isGuestRequest` the proxy uses, after the real-user check, so a session always wins.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const guest = !user && isGuestRequest(await cookies());

  if (!user && !guest) {
    redirect("/login");
  }

  return <Calendar />;
}
