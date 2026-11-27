import { describe, expect, it, vi } from "vitest";
import { applyPreferences, PREFERENCES_PATH, preferenceChanges, readPreferences, startPreferenceSync } from "./user-preferences-sync";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function server(record: unknown, status = 200) {
  const puts: unknown[] = [];
  const patches: unknown[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ stored: true }), { status: 200 });
    }
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)).preferences);
      return new Response(JSON.stringify({ stored: true }), { status: 200 });
    }
    return new Response(JSON.stringify(record), { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, puts, patches, calls: fetch };
}

const noTimer = () => undefined;

describe("a person's preferences on an organization server", () => {
  it("reads and applies only the known keys", () => {
    const storage = memory({ "omb-skin": "midnight", "omb-drafts": "{}" });
    expect(readPreferences(storage)).toEqual({ "omb-skin": "midnight" });
    applyPreferences(storage, { "omb-font": "serif" });
    expect(storage.values.get("omb-skin")).toBeUndefined();
    expect(storage.values.get("omb-font")).toBe("serif");
    expect(storage.values.get("omb-drafts")).toBe("{}");
  });

  it("the server's record wins over what this page held", async () => {
    const storage = memory({ "omb-skin": "paper", "omb-language": "en", "omb-drafts": "kept" });
    const remote = server({ stored: true, preferences: { "omb-skin": "midnight", "omb-drafts": "nope" } });
    const sync = await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer });
    expect(sync).not.toBeNull();
    expect(storage.values.get("omb-skin")).toBe("midnight");
    // a key the server never stored stays local and is saved next (#5365)
    expect(storage.values.get("omb-language")).toBe("en");
    expect(storage.values.get("omb-drafts")).toBe("kept");
    expect(remote.puts).toEqual([]);
    await sync!.check();
    expect(remote.patches).toEqual([{ set: { "omb-language": "en" }, remove: [] }]);
  });

  it("keeps Show Bot threads on across a restart when the server had not stored it yet (#5365)", async () => {
    const key = "sagax.sidebarBotThreads.v1";
    const storage = memory({ [key]: "on" });
    const remote = server({ stored: true, preferences: { "omb-skin": "midnight" } });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    expect(storage.values.get(key)).toBe("on");
    await sync.check();
    expect(remote.patches).toEqual([{ set: { [key]: "on" }, remove: [] }]);
  });

  it("the first time, saves what this computer's solo app had, without asking and without touching it", async () => {
    const storage = memory();
    const remote = server({ stored: false, preferences: {}, updatedAt: null });
    const takeLocal = vi.fn(async () => ({ "omb-skin": "midnight", "omb-language": "fr", "omb-webhook-credentials": "secret" }));
    await startPreferenceSync({ fetch: remote.fetch, storage, takeLocalPreferences: takeLocal, setInterval: noTimer });
    expect(takeLocal).toHaveBeenCalledOnce();
    expect(remote.puts).toEqual([{ "omb-skin": "midnight", "omb-language": "fr" }]);
    expect(storage.values.get("omb-skin")).toBe("midnight");
  });

  it("without a hand-over, the first time saves this page's own values; with none at all it saves nothing", async () => {
    const page = memory({ "omb-font": "serif" });
    const first = server({ stored: false });
    await startPreferenceSync({ fetch: first.fetch, storage: page, setInterval: noTimer });
    expect(first.puts).toEqual([{ "omb-font": "serif" }]);
    const empty = server({ stored: false });
    await startPreferenceSync({ fetch: empty.fetch, storage: memory(), setInterval: noTimer });
    expect(empty.puts).toEqual([]);
  });

  it("saves a change back, once", async () => {
    const storage = memory();
    const remote = server({ stored: true, preferences: { "omb-skin": "paper" } });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    await sync.check();
    expect(remote.puts).toEqual([]);
    storage.setItem("omb-skin", "midnight");
    storage.setItem("omb-drafts", "not a preference");
    await sync.check();
    await sync.check();
    expect(remote.puts).toEqual([]);
    expect(remote.patches).toEqual([{ set: { "omb-skin": "midnight" }, remove: [] }]);
  });

  it("keeps everything local where the server keeps no preferences (a solo server, the operator)", async () => {
    const storage = memory({ "omb-skin": "paper" });
    const remote = server({ error: "no" }, 404);
    expect(await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer })).toBeNull();
    expect(remote.calls).toHaveBeenCalledOnce();
    expect(remote.calls.mock.calls[0][0]).toBe(PREFERENCES_PATH);
    expect(storage.values.get("omb-skin")).toBe("paper");
  });
});

/** A server that keeps one record and answers PATCH (unless `patch` is false). */
function liveServer(initial: Record<string, string>, options: { patch?: boolean } = {}) {
  let record: Record<string, string> = { ...initial };
  const patches: unknown[] = [];
  const puts: unknown[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      if (options.patch === false) return new Response("{}", { status: 405 });
      const body = JSON.parse(String(init.body)) as { set?: Record<string, string>; remove?: string[] };
      patches.push(body);
      record = { ...record, ...body.set };
      for (const key of body.remove ?? []) delete record[key];
      return new Response(JSON.stringify({ stored: true, preferences: record }), { status: 200 });
    }
    if (init?.method === "PUT") {
      record = JSON.parse(String(init.body)).preferences;
      puts.push(record);
      return new Response(JSON.stringify({ stored: true, preferences: record }), { status: 200 });
    }
    return new Response(JSON.stringify({ stored: true, preferences: record }), { status: 200 });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    patches,
    puts,
    record: () => record,
    /** Another device saved: the server's record changes. */
    elsewhere: (next: Record<string, string>) => void (record = { ...next }),
  };
}

const SECTIONS = "sagax.sidebarSections.v1";
const COLLAPSED = "openmausbot.sidebarCollapsedSections.v1";
const TWO = JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }, { name: "Support", items: [] }] });
const ONE = JSON.stringify({ sections: [{ name: "Ventes", items: ["bot:b1"] }] });

describe("live preferences between a person's devices", () => {
  it("lists what changed: the keys to set and the keys to remove", () => {
    expect(preferenceChanges({ "omb-skin": "paper", "omb-font": "serif" }, { "omb-skin": "midnight", "omb-language": "fr" })).toEqual({
      set: { "omb-skin": "midnight", "omb-language": "fr" },
      remove: ["omb-font"],
    });
  });

  it("saves only the keys this page changed (PATCH), never its copy of the others", async () => {
    const storage = memory();
    const remote = liveServer({ "omb-skin": "paper", [SECTIONS]: TWO, [COLLAPSED]: "[]" });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    storage.setItem("omb-skin", "midnight");
    storage.removeItem(COLLAPSED);
    await sync.check();
    expect(remote.patches).toEqual([{ set: { "omb-skin": "midnight" }, remove: [COLLAPSED] }]);
    expect(remote.puts).toEqual([]);
    await sync.check();
    expect(remote.patches).toHaveLength(1);
  });

  it("a section deleted on the phone is not brought back by this page's next change", async () => {
    const storage = memory();
    const remote = liveServer({ "omb-skin": "paper", [SECTIONS]: TWO });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    expect(storage.values.get(SECTIONS)).toBe(TWO);
    // the phone deletes Support; this page has not heard yet
    remote.elsewhere({ "omb-skin": "paper", [SECTIONS]: ONE });
    storage.setItem("omb-skin", "midnight");
    await sync.check();
    expect(remote.record()[SECTIONS]).toBe(ONE);
    expect(remote.record()["omb-skin"]).toBe("midnight");
  });

  it("applies the server's record to the keys this page did not change, and tells the modules", async () => {
    const storage = memory();
    const remote = liveServer({ "omb-skin": "paper", [SECTIONS]: TWO, [COLLAPSED]: "[]" });
    const notified: string[] = [];
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer, notify: (key) => notified.push(key) }))!;
    // a local fold not saved yet
    storage.setItem(COLLAPSED, "[\"general\"]");
    const changed = sync.receive({ preferences: { "omb-skin": "paper", [SECTIONS]: ONE, [COLLAPSED]: "[\"user:Ventes\"]", "omb-language": "fr" }, updatedAt: 5 });
    expect(changed.sort()).toEqual(["omb-language", SECTIONS].sort());
    expect(notified.sort()).toEqual(["omb-language", SECTIONS].sort());
    expect(storage.values.get(SECTIONS)).toBe(ONE);
    expect(storage.values.get("omb-language")).toBe("fr");
    // the unsaved local change stands, and is what goes next
    expect(storage.values.get(COLLAPSED)).toBe("[\"general\"]");
    await sync.check();
    expect(remote.patches).toEqual([{ set: { [COLLAPSED]: "[\"general\"]" }, remove: [] }]);
  });

  it("keeps Primary Bot row when an older preferences frame omits it (#4853)", async () => {
    const key = "sagax.primaryBotStyle.v1";
    const storage = memory({ "omb-skin": "paper" });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ stored: true }), { status: 200 });
      return new Response(JSON.stringify({ stored: true, preferences: { "omb-skin": "paper" }, updatedAt: 5 }), { status: 200 });
    });
    const sync = (await startPreferenceSync({ fetch: fetch as unknown as typeof globalThis.fetch, storage, setInterval: noTimer }))!;
    storage.setItem(key, "row");
    await sync.check();
    sync.receive({ preferences: { "omb-skin": "paper" }, updatedAt: 5 });
    expect(storage.values.get(key)).toBe("row");
  });

  it("a key removed on another device is removed here", async () => {
    const storage = memory();
    const remote = liveServer({ "omb-skin": "paper", [SECTIONS]: TWO });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    expect(sync.receive({ preferences: { "omb-skin": "paper" } })).toEqual([SECTIONS]);
    expect(storage.values.has(SECTIONS)).toBe(false);
    await sync.check();
    expect(remote.patches).toEqual([]);
  });

  it("refresh reads the record again and applies it", async () => {
    const storage = memory();
    const remote = liveServer({ [SECTIONS]: TWO });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    remote.elsewhere({ [SECTIONS]: ONE });
    await sync.refresh();
    expect(storage.values.get(SECTIONS)).toBe(ONE);
  });

  it("an older server without PATCH gets the whole record (PUT), as before", async () => {
    const storage = memory();
    const remote = liveServer({ "omb-skin": "paper" }, { patch: false });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    storage.setItem("omb-font", "serif");
    await sync.check();
    expect(remote.puts).toEqual([{ "omb-skin": "paper", "omb-font": "serif" }]);
    storage.setItem("omb-font", "mono");
    await sync.check();
    expect(remote.puts).toHaveLength(2);
  });
});
