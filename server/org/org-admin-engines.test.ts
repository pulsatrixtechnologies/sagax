// The organization's engines the console adds to and removes from
// (server/org/org-admin-engines.ts, #5351) with faked dependencies.
import { describe, expect, it } from "vitest";

import { enginesRoutes, orgEngineRow, type EnginesDeps, type OrgEngineRow } from "./org-admin-engines.ts";
import { fakeConsole } from "../testing/console-context.ts";

const base = { kind: "cloud" as const, installed: true, auth: "oauth" as const, orgKey: false };
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const FAKE_KEY = "test-key-not-a-real-one";

function setup(options: { hosted?: boolean; busy?: boolean } = {}) {
  const removed: string[] = [];
  const keys = new Map<string, string>();
  const rows = (): OrgEngineRow[] => [
    orgEngineRow({ ...base, id: "claude", name: "Claude" }, "claudeAgent", undefined),
    orgEngineRow({ ...base, id: `claude-${UUID}`, name: "Second account" }, "claudeAgent", undefined),
    orgEngineRow({ ...base, id: "claudeApi", name: "Claude (API key)", auth: "apiKey", orgKey: keys.has("claudeApi") }, "claudeAgent", "api"),
  ].filter((row) => !removed.includes(row.id));
  const deps: EnginesDeps = {
    engines: rows,
    refusal: () => (options.hosted ? "Provider settings are managed for this workspace." : null),
    remove: async (id) => {
      if (options.busy) return { ok: false, status: 409, body: { error: "provider settings are already being updated" } };
      removed.push(id);
      return { ok: true, moved: [{ botId: "b1", to: "claude" }] };
    },
    setKey: async (id, key) => {
      if (key === "short") return { ok: false, status: 400, error: "Enter the access key as a single line, between 8 and 400 characters.", code: "engine_key_shape" };
      if (key) keys.set(id, key);
      else keys.delete(id);
      return { ok: true, configured: Boolean(key) };
    },
  };
  return { removed, keys, console: fakeConsole(enginesRoutes(deps)) };
}

describe("orgEngineRow", () => {
  it("an account added beside the first is added and removable; the first one is the catalog's", () => {
    expect(orgEngineRow({ ...base, id: "claude", name: "Claude" }, "claudeAgent", undefined)).toMatchObject({ source: "catalog", removable: false, takesKey: false });
    expect(orgEngineRow({ ...base, id: `chatgpt-${UUID}`, name: "Plan 2" }, "codex", undefined)).toMatchObject({ source: "added", removable: true, takesKey: false });
    expect(orgEngineRow({ ...base, id: "work", name: "Work" }, "claudeAgent", undefined)).toMatchObject({ source: "added", removable: true });
  });

  it("a key engine takes the organization's key and is never removed as an account", () => {
    expect(orgEngineRow({ ...base, id: "claudeApi", name: "Claude (API key)", auth: "apiKey" }, "claudeAgent", "api")).toMatchObject({ source: "catalog", removable: false, takesKey: true });
    expect(orgEngineRow({ ...base, id: "cerebras", name: "Cerebras (API)", auth: "apiKey" }, "cerebras", "api")).toMatchObject({ takesKey: true });
    // a file-backed key belongs to one person on an organization server
    expect(orgEngineRow({ ...base, id: "cursor", name: "Cursor" }, "cursorAgent", undefined)).toMatchObject({ takesKey: false });
  });
});

describe("engines", () => {
  it("GET engines: admin only, each row says what it is", async () => {
    const { console } = setup();
    const listed = await console.call("GET", "engines");
    expect(listed.status).toBe(200);
    expect(listed.body.engines.map((row: OrgEngineRow) => [row.id, row.source, row.removable, row.takesKey, row.orgKey])).toEqual([
      ["claude", "catalog", false, false, false],
      [`claude-${UUID}`, "added", true, false, false],
      ["claudeApi", "catalog", false, true, false],
    ]);
  });

  it("every route is the admin's", () => {
    const routes = enginesRoutes({} as EnginesDeps);
    expect(routes.map((route) => `${route.method} ${route.path} ${route.min}`)).toEqual([
      "GET engines admin",
      "POST engines/{id}/remove admin",
      "POST engines/{id}/key admin",
      "POST engines/{id}/key/remove admin",
    ]);
  });

  it("remove: an added account goes, its bots' moves answered, audited", async () => {
    const { console, removed } = setup();
    const answer = await console.call("POST", `engines/claude-${UUID}/remove`);
    expect(answer).toMatchObject({ status: 200, body: { ok: true, moved: [{ botId: "b1", to: "claude" }] } });
    expect(answer.body.engines.map((row: OrgEngineRow) => row.id)).toEqual(["claude", "claudeApi"]);
    expect(removed).toEqual([`claude-${UUID}`]);
    expect(console.records.at(-1)).toMatchObject({ category: "engine", action: "engines.remove", target: { kind: "engine", id: `claude-${UUID}`, name: "Second account" } });
  });

  it("remove: a catalog engine is refused, an unknown one is not found, nothing removed", async () => {
    const { console, removed } = setup();
    expect(await console.call("POST", "engines/claude/remove")).toMatchObject({ status: 400, body: { code: "catalog_engine" } });
    expect(await console.call("POST", "engines/claudeApi/remove")).toMatchObject({ status: 400, body: { code: "catalog_engine" } });
    expect((await console.call("POST", "engines/ghost/remove")).status).toBe(404);
    expect(removed).toEqual([]);
    expect(console.records).toEqual([]);
  });

  it("key: saved for a key engine, never in the answer nor in the audit row", async () => {
    const { console, keys } = setup();
    const answer = await console.call("POST", "engines/claudeApi/key", { body: { key: FAKE_KEY } });
    expect(answer.status).toBe(200);
    expect(answer.body.configured).toBe(true);
    expect(answer.body.engines.find((row: OrgEngineRow) => row.id === "claudeApi")).toMatchObject({ orgKey: true });
    expect(keys.get("claudeApi")).toBe(FAKE_KEY);
    expect(JSON.stringify(answer.body)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(console.records)).not.toContain(FAKE_KEY);
    expect(console.records.at(-1)).toMatchObject({ category: "engine", action: "engines.key.set", target: { kind: "engine", id: "claudeApi" } });
  });

  it("key: refused on an engine that takes none, on a bad body, on an empty key, on a bad shape", async () => {
    const { console, keys } = setup();
    expect(await console.call("POST", "engines/claude/key", { body: { key: FAKE_KEY } })).toMatchObject({ status: 400, body: { code: "engine_takes_no_key" } });
    expect((await console.call("POST", "engines/ghost/key", { body: { key: FAKE_KEY } })).status).toBe(404);
    expect((await console.call("POST", "engines/claudeApi/key", { body: { key: FAKE_KEY, extra: 1 } })).status).toBe(400);
    expect((await console.call("POST", "engines/claudeApi/key", { body: { key: "  " } })).status).toBe(400);
    expect(await console.call("POST", "engines/claudeApi/key", { body: { key: "short" } })).toMatchObject({ status: 400, body: { code: "engine_key_shape" } });
    expect(keys.size).toBe(0);
    expect(console.records).toEqual([]);
  });

  it("key/remove: clears the organization's key, audited", async () => {
    const { console, keys } = setup();
    await console.call("POST", "engines/claudeApi/key", { body: { key: FAKE_KEY } });
    const answer = await console.call("POST", "engines/claudeApi/key/remove");
    expect(answer).toMatchObject({ status: 200, body: { configured: false } });
    expect(keys.has("claudeApi")).toBe(false);
    expect(console.records.at(-1)).toMatchObject({ action: "engines.key.remove", target: { kind: "engine", id: "claudeApi" } });
  });

  it("a workspace whose provider settings are managed refuses every write, still lists", async () => {
    const { console, removed, keys } = setup({ hosted: true });
    expect((await console.call("GET", "engines")).status).toBe(200);
    expect((await console.call("POST", `engines/claude-${UUID}/remove`)).status).toBe(403);
    expect((await console.call("POST", "engines/claudeApi/key", { body: { key: FAKE_KEY } })).status).toBe(403);
    expect((await console.call("POST", "engines/claudeApi/key/remove")).status).toBe(403);
    expect(removed).toEqual([]);
    expect(keys.size).toBe(0);
  });

  it("a removal the server refuses comes back as it said it, not audited", async () => {
    const { console, removed } = setup({ busy: true });
    expect(await console.call("POST", `engines/claude-${UUID}/remove`)).toMatchObject({ status: 409, body: { code: "conflict", message: "provider settings are already being updated" } });
    expect(removed).toEqual([]);
    expect(console.records).toEqual([]);
  });
});
