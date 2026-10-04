// M11 Task 2 — the server side of guest mode (M11-PLAN decision 4): the proxy decision table,
// the home page's own gate, `GET /api/auth/guest`, and the sign-in gate clearing `jj_guest`.
// "Session beats cookie" is asserted at every gate.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string; email?: string } | null }));
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));

// The proxy builds its own server client from @supabase/ssr.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
  }),
}));

// The home page + route handlers use the app's server client.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: auth.user }, error: null }),
      exchangeCodeForSession: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ upsert: async () => ({ error: null }) }),
  }),
}));
vi.mock("@/lib/auth/allowlist", () => ({ isAllowed: async () => true }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name in jar.cookies ? { name, value: jar.cookies[name] } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/components/calendar/Calendar", () => ({ Calendar: () => null }));

import { config, proxy } from "@/proxy";
import Home from "@/app/page";
import { GET as guestRoute } from "@/app/api/auth/guest/route";
import { GET as gateRoute } from "@/app/api/auth/gate/route";

const JAVI = { id: "javi-uuid", email: "javi@example.com" };

function request(path: string, cookie = ""): NextRequest {
  return new NextRequest(new URL(path, "https://journal.test"), {
    headers: cookie ? { cookie } : {},
  });
}

/** The proxy's verdict: where it redirects, or "pass". */
async function verdict(path: string, cookie: string) {
  const res = await proxy(request(path, cookie));
  const location = res.headers.get("location");
  return {
    to: location ? new URL(location).pathname : "pass",
    guestCookie: res.cookies.get("jj_guest"),
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-key");
  auth.user = null;
  jar.cookies = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — the decision table (user / guest / both / neither × / and /login)", () => {
  test.each([
    // [who, user?, cookie, path, expected]
    ["neither", false, "", "/", "/login"],
    ["neither", false, "", "/login", "pass"],
    ["guest", false, "jj_guest=1", "/", "pass"],
    ["guest", false, "jj_guest=1", "/login", "/"],
    ["user", true, "", "/", "pass"],
    ["user", true, "", "/login", "/"],
    ["both", true, "jj_guest=1", "/", "pass"],
    ["both", true, "jj_guest=1", "/login", "/"],
    // A cookie that is not exactly "1" is not a guest.
    ["bad cookie", false, "jj_guest=0", "/", "/login"],
  ])("%s, user=%s, cookie=%j, %s → %s", async (_who, hasUser, cookie, path, expected) => {
    auth.user = hasUser ? JAVI : null;
    expect((await verdict(path, cookie)).to).toBe(expected);
  });

  test("a guest cookie riding along with a real session is cleared (session wins)", async () => {
    auth.user = JAVI;
    for (const path of ["/", "/login"]) {
      const { guestCookie } = await verdict(path, "jj_guest=1");
      expect(guestCookie?.value).toBe("");
      expect(guestCookie?.maxAge).toBe(0);
      expect(guestCookie?.path).toBe("/");
    }
  });

  test("a guest's own cookie is left alone", async () => {
    expect((await verdict("/", "jj_guest=1")).guestCookie).toBeUndefined();
  });

  test("the guest route and the sign-in gate are outside the matcher", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/auth/guest")).toBe(false);
    expect(matcher.test("/api/auth/gate")).toBe(false);
    expect(matcher.test("/denied")).toBe(false);
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
  });
});

describe("the home page's own gate", () => {
  test("neither → /login", async () => {
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
  });

  test("a guest gets the calendar", async () => {
    jar.cookies = { jj_guest: "1" };
    await expect(Home()).resolves.toBeTruthy();
  });

  test("a signed-in user gets the calendar, cookie or not", async () => {
    auth.user = JAVI;
    await expect(Home()).resolves.toBeTruthy();
    jar.cookies = { jj_guest: "1" };
    await expect(Home()).resolves.toBeTruthy();
  });
});

describe("GET /api/auth/guest", () => {
  test("sets jj_guest=1 (client-readable, lax, site-wide, a year) and goes home", async () => {
    const res = await guestRoute(request("/api/auth/guest"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    const cookie = res.cookies.get("jj_guest");
    expect(cookie).toMatchObject({
      value: "1",
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  });

  test("a signed-in user is sent home WITHOUT the cookie (session wins)", async () => {
    auth.user = JAVI;
    const res = await guestRoute(request("/api/auth/guest"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(res.cookies.get("jj_guest")).toBeUndefined();
  });
});

describe("the sign-in gate", () => {
  test("a successful sign-in clears jj_guest, so her client never opens the guest database", async () => {
    auth.user = JAVI;
    const res = await gateRoute(request("/api/auth/gate?code=abc", "jj_guest=1"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    const cookie = res.cookies.get("jj_guest");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.path).toBe("/");
  });

  test("a failed sign-in leaves guest mode as it was", async () => {
    const res = await gateRoute(request("/api/auth/gate?error=access_denied", "jj_guest=1"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.cookies.get("jj_guest")).toBeUndefined();
  });
});
