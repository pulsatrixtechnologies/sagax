// A personal computer's look for its paired phone (server/desktop/desktop-appearance.ts,
// server/routes/desktop-appearance.ts).
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopAppearanceStore } from "./desktop-appearance.ts";
import { createDesktopAppearanceRoutes } from "../routes/desktop-appearance.ts";
import { PASS } from "../routes/table.ts";
import { CLIENT_ALLOW } from "../auth/request-auth.ts";
import { DESKTOP_APPEARANCE_PATH } from "../../shared/desktop-appearance.ts";

describe("desktop appearance store", () => {
  it("keeps the four appearance keys, valid values only, across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-look-"));
    const store = createDesktopAppearanceStore(dir, () => 1000);
    expect(store.get()).toEqual({ stored: false, preferences: {}, updatedAt: null });
    store.put({ "omb-skin": "dusk", "omb-font": "serif", "omb.retro98.unlocked": "1", "omb-language": "fr", "omb.retro98.on": "yes" });
    expect(store.get()).toEqual({ stored: true, preferences: { "omb-skin": "dusk", "omb-font": "serif", "omb.retro98.unlocked": "1" }, updatedAt: 1000 });
    expect(createDesktopAppearanceStore(dir).get().preferences).toEqual({ "omb-skin": "dusk", "omb-font": "serif", "omb.retro98.unlocked": "1" });
    expect(readFileSync(join(dir, "desktop-appearance.json"), "utf8")).not.toContain("omb-language");
    if (process.platform !== "win32") expect(statSync(join(dir, "desktop-appearance.json")).mode & 0o777).toBe(0o600);
  });

  it("starts empty from a damaged file", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-look-"));
    writeFileSync(join(dir, "desktop-appearance.json"), "{not json");
    expect(createDesktopAppearanceStore(dir).get()).toMatchObject({ preferences: {} });
  });
});

type Answer = { status: number; body: unknown };
function call(route: ReturnType<typeof createDesktopAppearanceRoutes>, input: { method: string; body?: unknown; path?: string; type?: string }) {
  let answer: Answer | null = null;
  const path = input.path ?? DESKTOP_APPEARANCE_PATH;
  return route({
    req: { headers: { "content-type": input.type ?? "application/json" } } as never,
    res: {} as never, url: new URL(`http://x${path}`), path, method: input.method,
    auth: { kind: "session", scopes: ["client"], session: { id: "s1" } } as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/appearance", () => {
  it("answers on a personal computer, 404 on an organization server", async () => {
    const store = createDesktopAppearanceStore(mkdtempSync(join(tmpdir(), "omb-look-")), () => 5);
    const solo = createDesktopAppearanceRoutes({ store, organization: () => false });
    const org = createDesktopAppearanceRoutes({ store, organization: () => true });
    expect(await call(solo, { method: "GET", path: "/api/me/preferences" })).toBe("PASS");
    expect(await call(org, { method: "GET" })).toMatchObject({ status: 404 });
    expect(await call(solo, { method: "GET" })).toMatchObject({ status: 200, body: { stored: false, preferences: {} } });
    expect(await call(solo, { method: "PUT", body: { preferences: { "omb-skin": "lagoon", "omb-font": "skin" } } }))
      .toMatchObject({ status: 200, body: { stored: true, preferences: { "omb-skin": "lagoon", "omb-font": "skin" }, updatedAt: 5 } });
    // PUT replaces: a key left out is gone
    expect(await call(solo, { method: "PUT", body: { preferences: { "omb-skin": "retro98", "omb.retro98.on": "1" } } }))
      .toMatchObject({ status: 200, body: { preferences: { "omb-skin": "retro98", "omb.retro98.on": "1" } } });
    expect(await call(solo, { method: "GET" })).toMatchObject({ body: { preferences: { "omb-skin": "retro98", "omb.retro98.on": "1" } } });
    expect(await call(solo, { method: "PUT", body: { preferences: ["x"] } })).toMatchObject({ status: 400 });
    expect(await call(solo, { method: "PUT", type: "text/plain", body: { preferences: {} } })).toMatchObject({ status: 415 });
    expect(await call(solo, { method: "DELETE" })).toMatchObject({ status: 405 });
  });

  it("is open to a client session (the paired phone), GET and PUT only", () => {
    const rule = CLIENT_ALLOW.find((entry) => entry.path.test(DESKTOP_APPEARANCE_PATH));
    expect(rule?.methods).toEqual(["GET", "PUT"]);
    expect(rule?.feature).toBeUndefined();
  });
});
