// M11 Task 1 — the identity seam and the guest database (M11-PLAN decisions 2, 4, 5).

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  GUEST_DB_NAME,
  GUEST_USER_ID,
  JOURNAL_DB_NAME,
  clearGuestCookie,
  isGuest,
  isGuestRequest,
  journalDbName,
} from "./identity";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A minimal `document` whose cookie jar behaves like a browser's for one name. */
function stubCookies(initial: string) {
  let jar = initial;
  vi.stubGlobal("document", {
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      // Only what clearGuestCookie writes: `name=; Max-Age=0; …` drops that pair.
      const [pair] = value.split(";");
      const name = pair.split("=")[0];
      jar = jar
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith(`${name}=`))
        .join("; ");
    },
  });
}

describe("isGuest (client)", () => {
  test("false with no document (server, tests)", () => {
    expect(isGuest()).toBe(false);
  });

  test("true only for jj_guest=1", () => {
    stubCookies("sb-x=abc; jj_guest=1; other=2");
    expect(isGuest()).toBe(true);
  });

  test.each(["", "jj_guest=0", "jj_guest=", "not_jj_guest=1", "jj_guest=1x"])(
    "false for %j",
    (cookie) => {
      stubCookies(cookie);
      expect(isGuest()).toBe(false);
    },
  );

  test("never throws, even if reading the cookie does", () => {
    vi.stubGlobal("document", {
      get cookie(): string {
        throw new Error("SecurityError");
      },
    });
    expect(isGuest()).toBe(false);
  });

  test("clearGuestCookie leaves guest mode and touches no other cookie", () => {
    stubCookies("sb-x=abc; jj_guest=1");
    clearGuestCookie();
    expect(isGuest()).toBe(false);
    expect(document.cookie).toBe("sb-x=abc");
  });
});

describe("isGuestRequest (server)", () => {
  const store = (jar: Record<string, string>) => ({
    get: (name: string) => (name in jar ? { value: jar[name] } : undefined),
  });

  test("reads jj_guest=1 only", () => {
    expect(isGuestRequest(store({ jj_guest: "1" }))).toBe(true);
    expect(isGuestRequest(store({ jj_guest: "0" }))).toBe(false);
    expect(isGuestRequest(store({}))).toBe(false);
  });
});

describe("the database name (decision 2)", () => {
  test("journalDbName follows the cookie", () => {
    expect(journalDbName()).toBe(JOURNAL_DB_NAME);
    stubCookies("jj_guest=1");
    expect(journalDbName()).toBe(GUEST_DB_NAME);
  });

  test("the db singleton opens Javi's database without the cookie", async () => {
    const { db } = await import("@/lib/db");
    expect(db.name).toBe("javis-journal");
  });

  test("the db singleton opens the guest database with the cookie", async () => {
    stubCookies("jj_guest=1");
    const { db } = await import("@/lib/db");
    expect(db.name).toBe("javis-journal-guest");
  });

  test("the choice is made once, at module load", async () => {
    const { db } = await import("@/lib/db");
    stubCookies("jj_guest=1"); // a cookie arriving later does not move an open page
    const again = await import("@/lib/db");
    expect(again.db).toBe(db);
    expect(db.name).toBe("javis-journal");
  });
});

describe("guestProfileBootstrap (decision 5)", () => {
  async function freshGuestDb() {
    stubCookies("jj_guest=1");
    const { db } = await import("@/lib/db");
    await db.open();
    await db.profiles.clear();
    const { guestProfileBootstrap } = await import("./guest-bootstrap");
    return { db, guestProfileBootstrap };
  }

  test("writes the guest profile when none exists, with the defaults", async () => {
    const { db, guestProfileBootstrap } = await freshGuestDb();
    expect(await guestProfileBootstrap()).toBe(true);

    const rows = await db.profiles.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: GUEST_USER_ID,
      start_of_week: 1,
      selected_frame: "rse",
      fireworks_seen: false,
    });
    // Straight to Dexie: nothing for the (never-drained) outbox.
    expect(await db.sync_outbox.count()).toBe(0);
  });

  test("never overwrites: a returning guest keeps their frame and week start", async () => {
    const { db, guestProfileBootstrap } = await freshGuestDb();
    await guestProfileBootstrap();
    await db.profiles.update(GUEST_USER_ID, { selected_frame: "none", start_of_week: 0 });

    expect(await guestProfileBootstrap()).toBe(false);
    const row = await db.profiles.get(GUEST_USER_ID);
    expect(row?.selected_frame).toBe("none");
    expect(row?.start_of_week).toBe(0);
  });

  test("concurrent boots write exactly one row", async () => {
    const { db, guestProfileBootstrap } = await freshGuestDb();
    const results = await Promise.all([guestProfileBootstrap(), guestProfileBootstrap()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.profiles.count()).toBe(1);
  });
});
