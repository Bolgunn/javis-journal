import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  GUEST_COOKIE,
  GUEST_COOKIE_CLEAR_OPTIONS,
  isGuestRequest,
} from "@/lib/auth/identity";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function applyAuthCookies(
  response: NextResponse,
  cookiesToSet: CookieToSet[],
  headersToSet: Record<string, string>,
): NextResponse {
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  Object.entries(headersToSet).forEach(([name, value]) => {
    response.headers.set(name, value);
  });

  return response;
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  let authCookiesToSet: CookieToSet[] = [];
  let authHeadersToSet: Record<string, string> = {};

  const supabase = createServerClient(
    requireEnv("SUPABASE_URL", process.env.SUPABASE_URL),
    requireEnv("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          authCookiesToSet = cookiesToSet;
          authHeadersToSet = headersToSet;

          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({ request });
          applyAuthCookies(
            supabaseResponse,
            authCookiesToSet,
            authHeadersToSet,
          );
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;

  // `/preview` (and its sub-routes like /preview/responsive, /preview/interactive)
  // are dev-only design-tuning pages with no user data. Let them bypass the auth
  // gate everywhere EXCEPT the real production site, so the owner can review the
  // design locally and on Vercel preview (branch) deployments from a phone. The
  // production site (VERCEL_ENV === "production") keeps them gated.
  const isProductionSite = process.env.VERCEL_ENV === "production";
  if (
    !isProductionSite &&
    (pathname === "/preview" || pathname.startsWith("/preview/"))
  ) {
    return supabaseResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // M11: a guest (the `jj_guest` cookie, no Supabase session) is let through like a signed-in
  // user — the pages it reaches render from the visitor's own IndexedDB and can write nothing
  // server-side. A real session always wins (decision 4): it is checked first, and a guest
  // cookie riding along with one is cleared, so the client never opens the guest database for a
  // signed-in user.
  const guest = !user && isGuestRequest(request.cookies);
  const clearStaleGuest = Boolean(user) && isGuestRequest(request.cookies);

  const finish = (response: NextResponse): NextResponse => {
    if (clearStaleGuest) {
      response.cookies.set(GUEST_COOKIE, "", GUEST_COOKIE_CLEAR_OPTIONS);
    }
    return response;
  };

  if (!user && !guest && pathname !== "/login") {
    return applyAuthCookies(
      NextResponse.redirect(new URL("/login", request.url)),
      authCookiesToSet,
      authHeadersToSet,
    );
  }

  if ((user || guest) && pathname === "/login") {
    return finish(
      applyAuthCookies(
        NextResponse.redirect(new URL("/", request.url)),
        authCookiesToSet,
        authHeadersToSet,
      ),
    );
  }

  return finish(supabaseResponse);
}

export const config = {
  matcher: [
    "/((?!api/auth/gate|api/auth/guest|api/health|denied|_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
