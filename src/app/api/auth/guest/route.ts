import { NextResponse, type NextRequest } from "next/server";

import { GUEST_COOKIE, GUEST_COOKIE_OPTIONS } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/server";

// M11 — "Try it as a guest" (M11-PLAN decision 4). Sets `jj_guest=1` and sends the visitor
// home with a full navigation, so the client picks the guest database at load. No Supabase
// session is created: the cookie is the whole identity.
//
// A real session always wins: a signed-in user who reaches this route (it is linked from
// /denied, which the proxy does not gate) is sent home WITHOUT the cookie, so the cookie and a
// session never coexist and Javi's client never opens the guest database.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const response = NextResponse.redirect(new URL("/", request.url));
  if (!user) {
    response.cookies.set(GUEST_COOKIE, "1", GUEST_COOKIE_OPTIONS);
  }
  return response;
}
