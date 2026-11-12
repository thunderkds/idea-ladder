// T015: the /settings page route (reminders, export, import) and its sign-in return target; copies T011's /review ones.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHarness } from "./support/start-harness.ts";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.db.drop();
});

describe("T015 /settings page", () => {
  test("signed out goes through sign-in with a return to /settings; signed in gets the client; no-store", async () => {
    const out = await h.get("/settings");
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(`/auth/github?next=${encodeURIComponent("/settings")}`);
    expect(out.headers.get("cache-control")).toBe("no-store");
    const cookie = await h.learner();
    const page = await h.get("/settings", cookie);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toContain('<div id="root">');
  });

  test("sign-in keeps exactly /settings as a return target and refuses look-alikes", async () => {
    const returnCookie = async (next: string) =>
      (await h.get(`/auth/github?next=${encodeURIComponent(next)}`)).headers
        .getSetCookie()
        .find((c) => c.startsWith("il_return_to="));
    expect(await returnCookie("/settings")).toContain("il_return_to=%2Fsettings");
    for (const bad of [
      "/settings/x",
      "//settings",
      "/settings?x=1",
      "/Settings",
      "/settings/",
      "/settingsx",
      "/settings%0d%0aX: y",
    ]) {
      expect([bad, await returnCookie(bad)]).toEqual([bad, undefined]);
    }
  });
});
