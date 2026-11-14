// A person's preferences on an organization server (server/people/user-preferences.ts,
// server/routes/user-preferences.ts): their own record, known keys only.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createUserPreferenceStore, migrateToAdvancedOnce, preferencesFrameAllowed } from "./user-preferences.ts";
import { createUserPreferenceRoutes, USER_PREFERENCES_PATH } from "../routes/user-preferences.ts";
import { PASS } from "../routes/table.ts";
import { CLIENT_ALLOW } from "../auth/request-auth.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";

describe("per-person preference store", () => {
  it("keeps each person's own known keys and nothing else, across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-prefs-"));
    const store = createUserPreferenceStore(dir, () => 1000);
    expect(store.get(ADA)).toEqual({ stored: false, preferences: {}, updatedAt: null });
    store.put(ADA, { "omb-skin": "midnight", "omb-language": "fr", "omb-drafts": "{\"secret\":1}", "omb-webhook-credentials": "x", "omb-font": 3 });
    expect(store.get(ADA)).toEqual({ stored: true, preferences: { "omb-skin": "midnight", "omb-language": "fr" }, updatedAt: 1000 });
    expect(store.get(BOB).stored).toBe(false);
    const again = createUserPreferenceStore(dir);
    // a restart also marks the record (the one-time move to Advanced)
    expect(again.get(ADA).preferences).toMatchObject({ "omb-skin": "midnight", "omb-language": "fr" });
    expect(readFileSync(join(dir, "user-preferences.json"), "utf8")).not.toContain("omb-drafts");
    if (process.platform !== "win32") expect(statSync(join(dir, "user-preferences.json")).mode & 0o777).toBe(0o600);
    expect(() => store.get("local-owner")).toThrow(/not a person/);
  });

  it("keeps each person's own sidebar sections apart", () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")), () => 1000);
    store.put(ADA, { "sagax.sidebarSections.v1": JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }] }) });
    store.put(BOB, { "sagax.sidebarSections.v1": JSON.stringify({ sections: [{ name: "Mine", items: ["bot:b1"] }] }) });
    expect(JSON.parse(store.get(ADA).preferences["sagax.sidebarSections.v1"]!).sections[0].name).toBe("Ventes");
    expect(JSON.parse(store.get(BOB).preferences["sagax.sidebarSections.v1"]!).sections[0].name).toBe("Mine");
  });

  // #3539: the first turn after a start read and parsed the whole file inside
  // its language lookup (languageOfPerson). The server loads it once at start.
  it("loads the file once when asked, so a later read never touches the disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-prefs-"));
    createUserPreferenceStore(dir, () => 1000).put(ADA, { "omb-language": "fr" });
    const store = createUserPreferenceStore(dir, () => 2000);
    store.load();
    // the file is gone after the load: the record comes from memory
    rmSync(join(dir, "user-preferences.json"));
    expect(store.get(ADA).preferences["omb-language"]).toBe("fr");
  });

  it("is loaded at the server's start, before it listens, never on a turn's path (#3539)", () => {
    const source = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
    const created = source.indexOf("const userPreferenceStore = createUserPreferenceStore(DATA_DIR);");
    expect(created).toBeGreaterThan(0);
    const loaded = source.indexOf("userPreferenceStore.load();", created);
    expect(loaded).toBeGreaterThan(created);
    expect(loaded).toBeLessThan(source.indexOf("server.listen(PORT"));
  });
});

describe("one-time move to Advanced on the organization server", () => {
  const MODE = "sagax.interfaceMode.v1";
  const MARK = "sagax.advancedModeMigratedAt.v1";
  const at = Date.parse("2026-10-16T14:00:00.000Z");
  const seed = (people: Record<string, Record<string, string>>) => {
    const dir = mkdtempSync(join(tmpdir(), "omb-prefs-"));
    const file = { version: 1, people: Object.fromEntries(Object.entries(people).map(([id, preferences]) => [id, { preferences, updatedAt: 1 }])) };
    writeFileSync(join(dir, "user-preferences.json"), JSON.stringify(file));
    return dir;
  };

  it("moves each stored Simple to Advanced once, marks everyone, and writes the file", () => {
    const dir = seed({ [ADA]: { [MODE]: "simple", "omb-skin": "paper" }, [BOB]: { "omb-language": "fr" } });
    const store = createUserPreferenceStore(dir, () => at);
    expect(store.get(ADA).preferences).toEqual({ [MODE]: "advanced", [MARK]: "2026-10-16T14:00:00.000Z", "omb-skin": "paper" });
    // a person with no choice keeps the Advanced default and gets the marker
    expect(store.get(BOB).preferences).toEqual({ "omb-language": "fr", [MARK]: "2026-10-16T14:00:00.000Z" });
    const onDisk = JSON.parse(readFileSync(join(dir, "user-preferences.json"), "utf8"));
    expect(onDisk.people[ADA].preferences[MODE]).toBe("advanced");
    expect(onDisk.people[BOB].preferences[MARK]).toBe("2026-10-16T14:00:00.000Z");
  });

  it("respects Simple chosen after the move, across restarts", () => {
    const dir = seed({ [ADA]: { [MODE]: "simple" } });
    const store = createUserPreferenceStore(dir, () => at);
    store.merge(ADA, { [MODE]: "simple" }, []);
    for (let start = 0; start < 3; start += 1) {
      const again = createUserPreferenceStore(dir, () => at + 86_400_000 * (start + 1));
      expect(again.get(ADA).preferences).toEqual({ [MODE]: "simple", [MARK]: "2026-10-16T14:00:00.000Z" });
    }
  });

  it("keeps the marker when a client replaces or trims the record", () => {
    const store = createUserPreferenceStore(seed({ [ADA]: { [MODE]: "simple" } }), () => at);
    store.put(ADA, { [MODE]: "simple", "omb-skin": "paper" });
    expect(store.get(ADA).preferences[MARK]).toBe("2026-10-16T14:00:00.000Z");
    store.merge(ADA, {}, [MARK]);
    expect(store.get(ADA).preferences).toEqual({ [MODE]: "simple", "omb-skin": "paper", [MARK]: "2026-10-16T14:00:00.000Z" });
  });

  it("leaves a marked record as it is", () => {
    expect(migrateToAdvancedOnce({ [MODE]: "simple", [MARK]: "2026-10-16T13:00:00.000Z" }, "later")).toBeNull();
    expect(migrateToAdvancedOnce({ [MODE]: "advanced" }, "now")).toEqual({ [MODE]: "advanced", [MARK]: "now" });
  });
});

type Answer = { status: number; body: unknown };
function call(route: ReturnType<typeof createUserPreferenceRoutes>, input: { method: string; auth: unknown; body?: unknown; path?: string; type?: string }) {
  let answer: Answer | null = null;
  const res = {} as never;
  return route({
    req: { headers: { "content-type": input.type ?? "application/json" } } as never,
    res, url: new URL(`http://x${input.path ?? USER_PREFERENCES_PATH}`), path: input.path ?? USER_PREFERENCES_PATH, method: input.method,
    auth: input.auth as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("GET and PUT /api/me/preferences", () => {
  const session = (principalId?: string) => ({ kind: "session", scopes: ["client"], session: { id: "s1", principalId } });

  it("answers the signed-in person's own record, on an organization server only", async () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")));
    const org = createUserPreferenceRoutes({ store, organization: () => true });
    const solo = createUserPreferenceRoutes({ store, organization: () => false });
    expect(await call(org, { method: "GET", auth: session(ADA), path: "/api/me/engines" })).toBe("PASS");
    expect(await call(solo, { method: "GET", auth: session(ADA) })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "GET", auth: { kind: "loopback", scopes: ["admin"] } })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "GET", auth: session(undefined) })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "PUT", auth: session(ADA), body: { preferences: { "omb-skin": "paper" } } })).toMatchObject({ status: 200, body: { stored: true, preferences: { "omb-skin": "paper" } } });
    expect(await call(org, { method: "GET", auth: session(ADA) })).toMatchObject({ status: 200, body: { preferences: { "omb-skin": "paper" } } });
    // nobody reads or writes someone else's: the session's person is the record
    expect(await call(org, { method: "GET", auth: session(BOB) })).toMatchObject({ status: 200, body: { stored: false } });
    expect(await call(org, { method: "PUT", auth: session(ADA), body: { preferences: ["x"] } })).toMatchObject({ status: 400 });
    expect(await call(org, { method: "PUT", auth: session(ADA), type: "text/plain", body: { preferences: {} } })).toMatchObject({ status: 415 });
    expect(await call(org, { method: "DELETE", auth: session(ADA) })).toMatchObject({ status: 405 });
  });

  it("is a member's own route (client scope)", () => {
    const rule = CLIENT_ALLOW.find((entry) => entry.path.test(USER_PREFERENCES_PATH));
    expect(rule?.methods).toEqual(["GET", "PUT", "PATCH"]);
    expect(rule?.feature).toBeUndefined();
  });
});

describe("PATCH /api/me/preferences", () => {
  const session = (principalId?: string) => ({ kind: "session", scopes: ["client"], session: { id: "s1", principalId } });
  const SECTIONS = "sagax.sidebarSections.v1";
  const two = JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }, { name: "Support", items: [] }] });
  const one = JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }] });

  it("changes only the keys it names: a device saving one key never undoes another's", async () => {
    let clock = 1000;
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")), () => clock++);
    const org = createUserPreferenceRoutes({ store, organization: () => true });
    await call(org, { method: "PUT", auth: session(ADA), body: { preferences: { "omb-skin": "paper", [SECTIONS]: two, "openmausbot.sidebarCollapsedSections.v1": "[\"general\"]" } } });
    // the phone deletes a section
    const phone = await call(org, { method: "PATCH", auth: session(ADA), body: { set: { [SECTIONS]: one } } });
    expect(phone).toMatchObject({ status: 200, body: { stored: true, preferences: { "omb-skin": "paper", [SECTIONS]: one } } });
    // the desktop folds nothing any more and changes its skin, without its old copy of the sections
    const desktop = await call(org, { method: "PATCH", auth: session(ADA), body: { set: { "omb-skin": "midnight" }, remove: ["openmausbot.sidebarCollapsedSections.v1"] } });
    expect((desktop as { body: { preferences: Record<string, string> } }).body.preferences).toEqual({ "omb-skin": "midnight", [SECTIONS]: one });
    expect(store.get(ADA).preferences[SECTIONS]).toBe(one);
  });

  it("ignores unknown keys, non-string values and oversized values; keeps others' records apart", async () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")));
    const org = createUserPreferenceRoutes({ store, organization: () => true });
    await call(org, { method: "PATCH", auth: session(ADA), body: { set: { "omb-skin": "paper", "omb-drafts": "x", "omb-font": 3, "omb-language": "x".repeat(9000) }, remove: ["omb-webhook-credentials", 4] } });
    expect(store.get(ADA).preferences).toEqual({ "omb-skin": "paper" });
    expect(store.get(BOB).stored).toBe(false);
    // an empty patch is a save of the same record
    expect(await call(org, { method: "PATCH", auth: session(ADA), body: {} })).toMatchObject({ status: 200, body: { preferences: { "omb-skin": "paper" } } });
  });

  it("has the gates and errors of GET and PUT", async () => {
    const store = createUserPreferenceStore(mkdtempSync(join(tmpdir(), "omb-prefs-")));
    const org = createUserPreferenceRoutes({ store, organization: () => true });
    const solo = createUserPreferenceRoutes({ store, organization: () => false });
    expect(await call(solo, { method: "PATCH", auth: session(ADA), body: { set: {} } })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "PATCH", auth: session(undefined), body: { set: {} } })).toMatchObject({ status: 404 });
    expect(await call(org, { method: "PATCH", auth: session(ADA), type: "text/plain", body: { set: {} } })).toMatchObject({ status: 415 });
    expect(await call(org, { method: "PATCH", auth: session(ADA), body: ["x"] })).toMatchObject({ status: 400 });
    expect(await call(org, { method: "PATCH", auth: session(ADA), body: { set: ["x"] } })).toMatchObject({ status: 400 });
    expect(await call(org, { method: "PATCH", auth: session(ADA), body: { set: null } })).toMatchObject({ status: 400 });
    expect(await call(org, { method: "PATCH", auth: session(ADA), body: { remove: "omb-skin" } })).toMatchObject({ status: 400 });
    expect(store.get(ADA).stored).toBe(false);
  });
});

describe("the preferences frame", () => {
  it("reaches the person's own streams only", () => {
    const frame = { kind: "preferences", audience: ADA, preferences: {}, updatedAt: 1 };
    expect(preferencesFrameAllowed(frame, ADA)).toBe(true);
    expect(preferencesFrameAllowed(frame, BOB)).toBe(false);
    expect(preferencesFrameAllowed(frame, undefined)).toBe(false);
    expect(preferencesFrameAllowed({ kind: "preferences" }, ADA)).toBe(false);
    // every other frame is someone else's business
    expect(preferencesFrameAllowed({ kind: "bot" }, BOB)).toBe(true);
  });
});
