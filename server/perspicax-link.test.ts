// The link file Perspicax writes, and the directory it opens (slice 3, PB1).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { avatarContentType, DIRECTORY_ABSENT_CONFIRM_MS, directoryIntervalMs, isSubjectRefusal, PerspicaxDirectory, readLinkFile, type Directory } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const EXPECT = { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" };
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;

function linkDoc(patch: Record<string, unknown> = {}) {
  return { version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: SERVER_ID, origin: ORIGIN, link_token: TOKEN_A, ...patch };
}

function writeLink(path: string, doc: unknown, mode = 0o640) {
  writeFileSync(path, typeof doc === "string" ? doc : JSON.stringify(doc));
  chmodSync(path, mode);
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "px-link-"));
}

describe("readLinkFile", () => {
  it("accepts 0640 and 0600 files that match this server", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    writeLink(path, linkDoc(), 0o640);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: true, link: { serverId: SERVER_ID, linkToken: TOKEN_A, clientId: "pulsa-bot" } });
    chmodSync(path, 0o600);
    expect(readLinkFile(path, EXPECT).ok).toBe(true);
    // a trailing slash on the configured issuer is the same issuer
    expect(readLinkFile(path, { ...EXPECT, issuer: `${ISSUER}/` }).ok).toBe(true);
  });

  it("refuses a file other users can read, a missing file, an oversized file", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "missing" });
    writeLink(path, linkDoc(), 0o644);
    // Windows has no POSIX "other users" bits to refuse on
    if (process.platform !== "win32") expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "mode" });
    writeLink(path, JSON.stringify({ ...linkDoc(), pad: "x".repeat(5000) }), 0o600);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "size" });
  });

  it("refuses mismatched fields, extra keys and a bad token, and never echoes the token", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ issuer: "https://other.example.test" }, "mismatch"],
      [{ origin: "https://elsewhere.example.test" }, "mismatch"],
      [{ client_id: "other" }, "mismatch"],
      [{ version: 2 }, "fields"],
      [{ link_token: "pxat1.short" }, "fields"],
      [{ link_token: "pxlo1.aaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, "fields"],
      [{ server_id: "NOT A ULID" }, "fields"],
      [{ extra: true }, "fields"],
    ];
    for (const [patch, code] of cases) {
      writeLink(path, linkDoc(patch), 0o600);
      const read = readLinkFile(path, EXPECT);
      expect(read, JSON.stringify(patch)).toMatchObject({ ok: false, code });
      expect(JSON.stringify(read)).not.toContain(TOKEN_A);
    }
    writeLink(path, "not json", 0o600);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "json" });
  });
});

describe("SAGAX_PERSPICAX_DIRECTORY_SECONDS", () => {
  it("defaults to 300 s and takes 5 to 3600", () => {
    expect(directoryIntervalMs(undefined)).toBe(300_000);
    expect(directoryIntervalMs("5")).toBe(5_000);
    expect(directoryIntervalMs("3600")).toBe(3_600_000);
    expect(() => directoryIntervalMs("4")).toThrow();
    expect(() => directoryIntervalMs("1.5")).toThrow();
    expect(() => directoryIntervalMs("3601")).toThrow();
  });
});

type Reply = { status: number; body?: unknown; etag?: string } | "hang" | "throw";

function harness(initial: Directory, extra: { subjectToken?: (sub: string) => Promise<string | null> } = {}) {
  const clock = { now: 1_000_000 };
  const dir = tempDir();
  const linkFile = join(dir, "pulsabot.json");
  writeLink(linkFile, linkDoc());
  let n = 0;
  const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock.now, newId: () => `pr_00000000-0000-4000-8000-${String(n++).padStart(12, "0")}` });
  const out: string[] = [];
  const narrowed: string[] = [];
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let directory = initial;
  let validToken = TOKEN_A;
  const queue: Reply[] = [];
  const keys = new Map<string, { key?: string; status?: number }>();
  const resolveCalls: Array<{ sub: string; provider: string; authorization: string; subject?: string }> = [];
  const teamNames: Array<Array<{ id: string; name: string }>> = [];
  const delegationCalls: Array<{ present: (sub: string) => boolean | undefined; at: number }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    if (String(input).endsWith("/api/v1/pulsabot/provider-keys/resolve")) {
      const asked = JSON.parse(String(init?.body)) as { sub: string; provider: string };
      resolveCalls.push({ ...asked, authorization: headers.authorization ?? "", ...(headers["x-perspicax-subject-token"] ? { subject: headers["x-perspicax-subject-token"] } : {}) });
      if (headers.authorization !== `Bearer ${validToken}`) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      const held = keys.get(`${asked.sub}/${asked.provider}`);
      if (held?.status) return new Response(JSON.stringify({ error: held.status === 409 ? "user_inactive" : "x" }), { status: held.status });
      if (!held?.key) return new Response(JSON.stringify({ error: "no_key" }), { status: 404 });
      return new Response(JSON.stringify({ provider: asked.provider, key: held.key, fingerprint: `fp-${held.key.slice(-4)}` }), { status: 200, headers: { "cache-control": "no-store" } });
    }
    requests.push({ url: String(input), headers });
    const next = queue.shift();
    if (next === "throw") throw new Error("connect ECONNREFUSED");
    if (next === "hang") {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timed out"))));
    }
    if (next) return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.etag ? { etag: next.etag } : {} });
    if (headers.authorization !== `Bearer ${validToken}`) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const etag = `"${JSON.stringify(directory).length.toString(16).padStart(32, "0")}"`;
    if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(JSON.stringify(directory), { status: 200, headers: { etag, "cache-control": "no-store" } });
  }) as typeof fetch;
  const sync = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: "http://perspicax:8787",
    linkFile,
    expect: EXPECT,
    principals,
    onPersonOut: (iss, sub) => { out.push(sub); principals.markDisabled(iss, sub); },
    onRoleNarrowed: (id) => narrowed.push(id),
    onDelegations: (present, at) => delegationCalls.push({ present, at }),
    version: "0.1.89",
    teamNames: { replaceFromDirectory: (teams) => { teamNames.push([...teams]); return true; } },
    now: () => clock.now,
    fetch: fetcher,
    log: () => {},
    timeoutMs: 200,
    ...extra,
  });
  return {
    sync, principals, out, narrowed, requests, queue, linkFile, keys, resolveCalls, teamNames, clock, delegationCalls,
    setDirectory: (next: Directory) => { directory = next; },
    rotate: (token: string) => { validToken = token; },
  };
}

const person = (sub: string, patch: Partial<Directory["people"][number]> = {}): Directory["people"][number] => ({
  sub, login: sub.toLowerCase(), name: sub, email: `${sub.toLowerCase()}@example.test`, role: "employee", status: "active", locale: null, ...patch,
});
const directoryOf = (people: Directory["people"]): Directory => ({ server_id: SERVER_ID, people, teams: [] });

describe("PerspicaxDirectory", () => {
  it("creates principals for people who never signed in and sends the link token, version and accept", async () => {
    const h = harness(directoryOf([person("BOB"), person("ALICE", { role: "admin" })]));
    expect(h.sync.state()).toMatchObject({ state: "missing" });
    expect(await h.sync.refresh()).toMatchObject({ state: "ok", syncedAt: expect.any(Number) });
    expect(h.requests[0]).toMatchObject({
      url: "http://perspicax:8787/api/v1/pulsabot/directory",
      headers: { authorization: `Bearer ${TOKEN_A}`, "x-pulsabot-version": "0.1.89", accept: "application/json" },
    });
    expect(h.principals.bySubject(ISSUER, "BOB")).toMatchObject({ name: "BOB", login: "bob", email: "bob@example.test", orgRole: "member" });
    expect(h.principals.bySubject(ISSUER, "ALICE")?.orgRole).toBe("admin");
    expect(h.sync.people().map((p) => p.sub)).toEqual(["BOB", "ALICE"]);
    expect(h.sync.serverId()).toBe(SERVER_ID);
  });

  it("updates attributes, keeps a disable newer than the fetch, and a 304 changes nothing", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    const later = h.clock.now + 60_000;
    h.principals.markDisabled(ISSUER, "BOB", later);
    h.setDirectory(directoryOf([person("BOB", { name: "Robert" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "BOB")).toMatchObject({ name: "Robert", disabledAt: later });
    const before = h.requests.length;
    await h.sync.refresh();
    expect(h.requests[before]?.headers["if-none-match"]).toMatch(/^"/);
    expect(h.sync.state().state).toBe("ok");
  });

  it("re-enables a person the directory lists active again, once (S7-9)", async () => {
    const h = harness(directoryOf([person("CAROL")]));
    const changes: Array<[string, boolean]> = [];
    h.principals.onDisabledChanged((p, disabled) => changes.push([p.subject?.sub ?? "", disabled]));
    await h.sync.refresh();
    h.setDirectory(directoryOf([person("CAROL", { status: "disabled" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.disabledAt).toBeDefined();
    h.clock.now += 1_000;
    h.setDirectory(directoryOf([person("CAROL", { name: "Carol" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.disabledAt).toBeUndefined();
    await h.sync.refresh();
    expect(changes).toEqual([["CAROL", true], ["CAROL", false]]);
  });

  it("logs out a disabled person at once and a known subject gone from two answers a minute apart", async () => {
    const h = harness(directoryOf([person("BOB"), person("DAVE"), person("ERIN"), person("FRED")]));
    await h.sync.refresh();
    expect(h.out).toEqual([]);
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled" })]));
    await h.sync.refresh();
    // 2026-10-20: missing once (a partial answer mid-deploy) is not out
    expect(h.out.sort()).toEqual(["DAVE"]);
    // still missing a minute later: out; back in the next answer: never out
    h.clock.now += DIRECTORY_ABSENT_CONFIRM_MS;
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled" }), person("FRED")]));
    await h.sync.refresh();
    expect(h.out.sort()).toEqual(["DAVE", "ERIN"]);
    h.clock.now += DIRECTORY_ABSENT_CONFIRM_MS;
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled", name: "Dave" })]));
    await h.sync.refresh();
    expect(h.out.sort()).toEqual(["DAVE", "ERIN"]);
    // already out: not signalled again on the next poll
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled", name: "D" })]));
    await h.sync.refresh();
    expect(h.out.sort()).toEqual(["DAVE", "ERIN"]);
  });

  it("narrows a person demoted from admin at once", async () => {
    const h = harness(directoryOf([person("CAROL", { role: "admin" })]));
    await h.sync.refresh();
    h.setDirectory(directoryOf([person("CAROL", { role: "manager" })]));
    await h.sync.refresh();
    const carol = h.principals.bySubject(ISSUER, "CAROL")!;
    expect(carol.orgRole).toBe("member");
    expect(h.narrowed).toEqual([carol.id]);
  });

  it("on 401 re-reads the rotated link file and retries once", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    h.rotate(TOKEN_B);
    writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }));
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    const last = h.requests.at(-1)!;
    expect(last.headers.authorization).toBe(`Bearer ${TOKEN_B}`);
    // a token nobody rewrote stays refused
    h.rotate(`pxat1.${"c".repeat(43)}`);
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "link_refused" });
  });

  it("knows its own link token in constant time, follows a rotation, and refuses anything else (2026-10-11)", async () => {
    const h = harness(directoryOf([person("BOB")]));
    // before any fetch: the file is read on demand
    expect(h.sync.linkTokenMatches(TOKEN_A)).toBe(true);
    expect(h.sync.linkTokenMatches(TOKEN_B)).toBe(false);
    expect(h.sync.linkTokenMatches("")).toBe(false);
    expect(h.sync.linkTokenMatches(`${TOKEN_A}x`)).toBe(false);
    // Perspicax rotates the token and rewrites the file: the new one opens, the old one no longer
    writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }));
    expect(h.sync.linkTokenMatches(TOKEN_B)).toBe(true);
    expect(h.sync.linkTokenMatches(TOKEN_A)).toBe(false);
    // a link file this server refuses (here, readable by others; on Windows, which has no such bits, a wrong version) closes it once it is read again
    if (process.platform === "win32") writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B, version: 2 }));
    else writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }), 0o644);
    expect(h.sync.linkTokenMatches(TOKEN_A)).toBe(false);
    expect(h.sync.linkTokenMatches(TOKEN_B)).toBe(false);
  });

  it("runs one refresh at a time", async () => {
    const h = harness(directoryOf([person("BOB")]));
    const [a, b] = await Promise.all([h.sync.refresh(), h.sync.refresh()]);
    expect(a).toEqual(b);
    expect(h.requests).toHaveLength(1);
  });

  it("keeps the last good data through a timeout, a network error and a 5xx", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    h.queue.push("hang");
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "unreachable", syncedAt: expect.any(Number) });
    h.queue.push("throw");
    expect((await h.sync.refresh()).error).toBe("unreachable");
    h.queue.push({ status: 502, body: {} });
    expect((await h.sync.refresh()).error).toBe("http_502");
    expect(h.sync.people().map((p) => p.sub)).toEqual(["BOB"]);
    expect(h.out).toEqual([]);
  });

  it("refuses a directory for another server id and a malformed body", async () => {
    const h = harness(directoryOf([person("BOB")]));
    h.queue.push({ status: 200, body: { ...directoryOf([]), server_id: "other" } });
    expect((await h.sync.refresh()).error).toBe("server_mismatch");
    h.queue.push({ status: 200, body: { people: "nope" } });
    expect((await h.sync.refresh()).error).toBe("malformed");
    expect(h.principals.listBySubjectIssuer(ISSUER)).toEqual([]);
  });

  it("reports a bad link file as an error and a missing one as missing", async () => {
    const h = harness(directoryOf([]));
    // readable by others; Windows has no such bits, so a wrong version there
    if (process.platform === "win32") writeLink(h.linkFile, linkDoc({ version: 2 }));
    else chmodSync(h.linkFile, 0o644);
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "link_invalid" });
    expect(h.requests).toHaveLength(0);
  });
});

describe("PerspicaxDirectory, slice 4: teams and owner keys", () => {
  const withTeams = (people: Directory["people"], teams: Directory["teams"]): Directory => ({ server_id: SERVER_ID, people, teams });

  it("gives each person the teams the directory lists (manager wins) and hands the names over", async () => {
    const h = harness(withTeams([person("CAROL"), person("MIA", { role: "manager" }), person("DAVE")], [
      { id: "01TEAMT", name: "T", managers: ["MIA"], members: ["CAROL", "MIA"] },
      { id: "01TEAMU", name: "U", managers: [], members: ["DAVE"] },
    ]));
    const changed: string[] = [];
    h.principals.onAccessChanged((id) => changed.push(id));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.teams).toEqual([{ id: "01TEAMT", manager: false }]);
    expect(h.principals.bySubject(ISSUER, "MIA")).toMatchObject({ teams: [{ id: "01TEAMT", manager: true }], perspicaxRole: "manager" });
    expect(h.principals.bySubject(ISSUER, "DAVE")?.teams).toEqual([{ id: "01TEAMU", manager: false }]);
    expect(h.teamNames.at(-1)).toEqual([{ id: "01TEAMT", name: "T" }, { id: "01TEAMU", name: "U" }]);
    expect(changed).toEqual([]);
    // carol leaves T: her teams empty and her access is recomputed
    h.setDirectory(withTeams([person("CAROL"), person("MIA", { role: "manager" }), person("DAVE")], [
      { id: "01TEAMT", name: "T", managers: ["MIA"], members: ["MIA"] },
      { id: "01TEAMU", name: "U", managers: [], members: ["DAVE"] },
    ]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.teams).toBeUndefined();
    expect(changed).toEqual([h.principals.bySubject(ISSUER, "CAROL")!.id]);
  });

  it("keeps provider_keys per person, names only", async () => {
    const h = harness(withTeams([person("ALICE", { provider_keys: ["anthropic"] }), person("BOB")], []));
    await h.sync.refresh();
    expect(h.sync.providerKeys("ALICE")).toEqual(["anthropic"]);
    expect(h.sync.providerKeys("BOB")).toEqual([]);
    expect(h.sync.providerKeys("NOBODY")).toEqual([]);
  });

  it("reads permissions per person: known keys only, null when Perspicax sends none (2026-10-09)", async () => {
    const h = harness(withTeams([
      person("ALICE", { permissions: ["usage.view", "nope.key", "server.link", "bots.create", "usage.view"] }),
      person("BOB", { permissions: [] }),
      person("CAROL"),
      person("DAN", { permissions: "bogus" as never }),
    ], []));
    expect(h.sync.permissionsOf("ALICE")).toBeNull();
    await h.sync.refresh();
    // catalogue order, deduplicated; unknown and admin-only keys dropped
    expect(h.sync.permissionsOf("ALICE")).toEqual(["bots.create", "usage.view"]);
    expect(h.sync.permissionsOf("BOB")).toEqual([]);
    expect(h.sync.permissionsOf("CAROL")).toBeNull();
    expect(h.sync.permissionsOf("DAN")).toBeNull();
    expect(h.sync.permissionsOf("NOBODY")).toBeNull();
  });

  it("tolerates the permission sets of Perspicax 0051: sagax_permission_sets per person, sagax_permissions null per profile", async () => {
    const h = harness({
      ...withTeams([
        person("ALICE", { permissions: ["bots.create"], sagax_permission_sets: ["Membre", "Facturation"] } as Partial<Directory["people"][number]>),
        person("BOB", { sagax_permission_sets: "bogus" } as Partial<Directory["people"][number]>),
      ], []),
      profiles: [{ id: "P1", slug: "dispatch", name: "Dispatch", description: "", sagax_permissions: null }],
    });
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    // the person's keys still come from permissions; the set names are display only
    expect(h.sync.permissionsOf("ALICE")).toEqual(["bots.create"]);
    expect(h.sync.permissionsOf("BOB")).toBeNull();
    expect(h.sync.profileCatalog().map((p) => p.id)).toEqual(["P1"]);
    expect(h.sync.profilePermissions("P1")).toBeNull();
  });

  it("ignores sagax_integrations an older Perspicax still sends (removed 2026-10-30)", async () => {
    const h = harness(withTeams([
      person("ALICE", { sagax_integrations: "off" } as never),
      person("BOB", { sagax_integrations: "bogus" } as never),
    ], []));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "ALICE")).toBeDefined();
    expect(h.principals.bySubject(ISSUER, "BOB")).toBeDefined();
    expect("integrationRights" in h.sync).toBe(false);
  });

  it("reads sagax_server_engines per person: the list, [] for none, null when not sent (Perspicax 0063)", async () => {
    const h = harness(withTeams([
      person("ALICE", { sagax_server_engines: ["grok", "xaiVoice"] }),
      person("BOB", { sagax_server_engines: [] }),
      person("CAROL"),
      person("DAN", { sagax_server_engines: ["not an id!"] as never }),
    ], []));
    expect(h.sync.serverEngines("ALICE")).toBeNull();
    await h.sync.refresh();
    expect(h.sync.serverEngines("ALICE")).toEqual(["grok", "xaiVoice"]);
    expect(h.sync.serverEngines("BOB")).toEqual([]);
    expect(h.sync.serverEngines("CAROL")).toBeNull();
    // a malformed list is dropped (null: none for a member), never fatal
    expect(h.sync.serverEngines("DAN")).toBeNull();
    expect(h.sync.serverEngines("NOBODY")).toBeNull();
  });

  it("botRights is use only when the last directory says so, else manage", async () => {
    const h = harness(directoryOf([
      person("BOB", { sagax_bots: "use" }),
      person("ALICE", { sagax_bots: "manage" }),
      person("CAROL"),
    ]));
    expect(h.sync.botRights("BOB")).toBe("manage");
    await h.sync.refresh();
    expect(h.sync.botRights("BOB")).toBe("use");
    expect(h.sync.botRights("ALICE")).toBe("manage");
    expect(h.sync.botRights("CAROL")).toBe("manage");
    expect(h.sync.botRights("NOBODY")).toBe("manage");
    h.setDirectory(directoryOf([person("BOB")]));
    await h.sync.refresh();
    expect(h.sync.botRights("BOB")).toBe("manage");
  });

  it("resolves an owner key with the link token, caches it 60 s, and invalidates", async () => {
    const h = harness(withTeams([person("ALICE", { provider_keys: ["anthropic"] })], []));
    await h.sync.refresh();
    h.keys.set("ALICE/anthropic", { key: "sk-ant-test-alice-key-0001" });
    expect(await h.sync.resolveProviderKey("ALICE", "anthropic")).toEqual({ ok: true, key: "sk-ant-test-alice-key-0001", fingerprint: "fp-0001" });
    expect(h.resolveCalls).toEqual([{ sub: "ALICE", provider: "anthropic", authorization: `Bearer ${TOKEN_A}` }]);
    // cached: no second call within 60 s
    h.keys.set("ALICE/anthropic", { key: "sk-ant-test-alice-key-0002" });
    expect((await h.sync.resolveProviderKey("ALICE", "anthropic")) as { key: string }).toMatchObject({ key: "sk-ant-test-alice-key-0001" });
    expect(h.resolveCalls).toHaveLength(1);
    h.clock.now += 60_001;
    expect((await h.sync.resolveProviderKey("ALICE", "anthropic")) as { key: string }).toMatchObject({ key: "sk-ant-test-alice-key-0002" });
    h.sync.invalidate("ALICE", "anthropic");
    await h.sync.resolveProviderKey("ALICE", "anthropic");
    expect(h.resolveCalls).toHaveLength(3);
    // the directory dropping the provider drops the cached key
    h.setDirectory(withTeams([person("ALICE")], []));
    await h.sync.refresh();
    await h.sync.resolveProviderKey("ALICE", "anthropic");
    expect(h.resolveCalls).toHaveLength(4);
  });

  it("S4-14: a disabled owner's cached key is dropped at once, by the directory or a back-channel logout", async () => {
    const h = harness(withTeams([person("ERIN", { provider_keys: ["anthropic", "openai"] }), person("BOB")], []));
    await h.sync.refresh();
    h.keys.set("ERIN/anthropic", { key: "sk-ant-test-erin-key-00001" });
    h.keys.set("ERIN/openai", { key: "sk-test-openai-erin-000001" });
    await h.sync.resolveProviderKey("ERIN", "anthropic");
    await h.sync.resolveProviderKey("ERIN", "openai");
    expect(h.resolveCalls).toHaveLength(2);
    // back-channel logout: every cached key of that subject goes
    h.sync.forgetSubject("ERIN");
    h.keys.set("ERIN/anthropic", { status: 409 });
    expect(await h.sync.resolveProviderKey("ERIN", "anthropic")).toEqual({ ok: false, error: "user_inactive" });
    h.keys.set("ERIN/openai", { key: "sk-test-openai-erin-000001" });
    await h.sync.resolveProviderKey("ERIN", "openai");
    expect(h.resolveCalls).toHaveLength(4);
    // the directory says disabled while still listing provider_keys: no key
    // is served from cache and none is advertised
    h.setDirectory(withTeams([person("ERIN", { status: "disabled", provider_keys: ["anthropic", "openai"] }), person("BOB")], []));
    await h.sync.refresh();
    expect(h.sync.providerKeys("ERIN")).toEqual([]);
    h.keys.set("ERIN/openai", { status: 409 });
    expect(await h.sync.resolveProviderKey("ERIN", "openai")).toEqual({ ok: false, error: "user_inactive" });
    expect(h.resolveCalls).toHaveLength(5);
  });

  it("answers no_key, user_inactive, link and unreachable", async () => {
    const h = harness(withTeams([person("ALICE")], []));
    await h.sync.refresh();
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "no_key" });
    h.keys.set("ALICE/openai", { status: 409 });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "user_inactive" });
    h.keys.set("ALICE/openai", { status: 500 });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "unreachable" });
    h.rotate(TOKEN_B);
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "link" });
    // on 401 it re-reads the link file once
    writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }));
    h.keys.set("ALICE/openai", { key: "sk-test-openai-key-000000001" });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toMatchObject({ ok: true, key: "sk-test-openai-key-000000001" });
    expect(h.resolveCalls.at(-1)!.authorization).toBe(`Bearer ${TOKEN_B}`);
  });

  it("2026-10-28: a link call for a person carries that person's own token, and only theirs", async () => {
    const asked: string[] = [];
    const h = harness(withTeams([person("ALICE"), person("BOB")], []), {
      subjectToken: async (sub) => {
        asked.push(sub);
        return sub === "ALICE" ? "alice-sign-in-token" : null;
      },
    });
    await h.sync.refresh();
    h.keys.set("ALICE/anthropic", { key: "sk-ant-test-alice-key-0001" });
    h.keys.set("BOB/anthropic", { key: "sk-ant-test-bob-key-00001" });
    await h.sync.resolveProviderKey("ALICE", "anthropic");
    await h.sync.resolveProviderKey("BOB", "anthropic");
    expect(h.resolveCalls).toEqual([
      { sub: "ALICE", provider: "anthropic", authorization: `Bearer ${TOKEN_A}`, subject: "alice-sign-in-token" },
      // no token at hand: the link token alone, as before
      { sub: "BOB", provider: "anthropic", authorization: `Bearer ${TOKEN_A}` },
    ]);
    h.queue.push({ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } });
    expect(await h.sync.linkPostJson("/api/v1/memory/feedback", { person: "ALICE" }, { timeoutMs: 200, maxBytes: 1024, subject: "ALICE" })).toMatchObject({ ok: true });
    expect(h.requests.at(-1)!.headers["x-perspicax-subject-token"]).toBe("alice-sign-in-token");
    // without `subject`, nobody's token is asked for or sent
    await h.sync.linkPostJson("/api/v1/memory/feedback", {}, { timeoutMs: 200, maxBytes: 1024 });
    expect(h.requests.at(-1)!.headers["x-perspicax-subject-token"]).toBeUndefined();
    expect(asked).toEqual(["ALICE", "BOB", "ALICE"]);
  });

  it("2026-10-28: a resolver that throws sends the call with the link token alone", async () => {
    const h = harness(withTeams([person("ALICE")], []), { subjectToken: async () => { throw new Error("vault"); } });
    await h.sync.refresh();
    h.queue.push({ status: 403, body: { code: "subject", message: "the person's Sagax sign-in token is not valid here" } });
    const result = await h.sync.linkPostJson("/api/v1/memory/feedback", {}, { timeoutMs: 200, maxBytes: 1024, subject: "ALICE" });
    expect(h.requests.at(-1)!.headers["x-perspicax-subject-token"]).toBeUndefined();
    expect(isSubjectRefusal(result)).toBe(true);
    expect(isSubjectRefusal({ ok: false, error: "link", status: 403, body: { error: "not_owner" } })).toBe(false);
  });
});

describe("PerspicaxDirectory, slice 5: profiles and token exchange", () => {
  type Answer = { status: number; body?: unknown } | "throw";
  function exchangeHarness(answers: Answer[] = []) {
    const dir = tempDir();
    const linkFile = join(dir, "pulsabot.json");
    writeLink(linkFile, linkDoc());
    const principals = new PrincipalRegistry({ path: join(dir, "principals.json") });
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
    const logs: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? ""), ...(init?.redirect ? { redirect: init.redirect } : {}) });
      const next = answers.shift() ?? { status: 200, body: {} };
      if (next === "throw") throw new Error("connect ECONNREFUSED");
      return new Response(next.body === undefined ? null : typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status });
    }) as typeof fetch;
    const sync = new PerspicaxDirectory({
      issuer: `${ISSUER}/`, serverBase: "http://perspicax:8787/", linkFile, expect: EXPECT, principals,
      onPersonOut: () => {}, onRoleNarrowed: () => {}, version: "0.1.89", now: () => 5_000_000, fetch: fetcher, log: (l) => logs.push(l),
    });
    return { sync, calls, answers, linkFile, logs };
  }
  const ok = { status: 200, body: { access_token: "pxlo1.BOB.exchanged-secret", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 900, scope: "profile:P1" } };

  it("an old directory without profiles still parses; the new fields are read and sorted", async () => {
    const h = harness(directoryOf([person("BOB")]));
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    expect(h.sync.profileCatalog()).toEqual([]);
    expect(h.sync.profilesOf("BOB")).toEqual([]);
    h.setDirectory({
      ...directoryOf([person("BOB", { profiles: ["P2", "P1", "P1"] }), person("DAVE", { status: "disabled", profiles: ["P1"] }), person("CAROL")]),
      profiles: [{ id: "P2", slug: "billing", name: "Billing", description: "" }, { id: "P1", slug: "dispatch", name: "Dispatch", description: "CW dispatch" }],
    });
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    expect(h.sync.profileCatalog().map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(h.sync.profilesOf("BOB")).toEqual(["P1", "P2"]);
    expect(h.sync.profilesOf("CAROL")).toEqual([]);
    expect(h.sync.profilesOf("DAVE")).toEqual([]);
    expect(h.sync.profilesOf("NOBODY")).toEqual([]);
  });

  it("sends the exchange with the link's Basic header and the contract's form", async () => {
    const h = exchangeHarness([ok]);
    expect(h.sync.mcpEndpoint()).toBe("http://perspicax:8787/mcp");
    expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: true, token: "pxlo1.BOB.exchanged-secret", expiresAt: 5_000_000 + 900_000 });
    const [call] = h.calls;
    expect(call).toMatchObject({ url: "http://perspicax:8787/oauth/token", method: "POST", redirect: "error" });
    expect(call!.headers.authorization).toBe(`Basic ${Buffer.from(`pulsa-bot-server:${TOKEN_A}`).toString("base64")}`);
    expect(call!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(call!.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "pxlo1.BOB.subject",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: `${ISSUER}/mcp?profile=P1`,
    });
    expect(call!.body).toContain(`resource=${encodeURIComponent(`${ISSUER}/mcp?profile=P1`)}`);
  });

  it("maps every answer", async () => {
    const cases: Array<[Answer, string]> = [
      [{ status: 400, body: { error: "invalid_target" } }, "not_held"],
      [{ status: 400, body: { error: "invalid_grant" } }, "subject"],
      [{ status: 400, body: { error: "invalid_request" } }, "unreachable"],
      [{ status: 429, body: { error: "slow_down" } }, "rate_limited"],
      [{ status: 500, body: "oops" }, "unreachable"],
      [{ status: 200, body: { token_type: "Bearer" } }, "unreachable"],
      [{ status: 200, body: "x".repeat(9000) }, "unreachable"],
      ["throw", "unreachable"],
    ];
    for (const [answer, error] of cases) {
      const h = exchangeHarness([answer]);
      expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: false, error });
    }
    const bad = exchangeHarness([ok]);
    expect(await bad.sync.exchangeToken("pxlo1.BOB.subject", "P1&x=y")).toEqual({ ok: false, error: "not_held" });
    expect(bad.calls).toHaveLength(0);
  });

  it("surfaces invalid_target's error_description and caches not_held briefly", async () => {
    let now = 5_000_000;
    const dir = tempDir();
    const linkFile = join(dir, "pulsabot.json");
    writeLink(linkFile, linkDoc());
    const principals = new PrincipalRegistry({ path: join(dir, "principals.json") });
    const answers: Answer[] = [
      { status: 400, body: { error: "invalid_target", error_description: "Carol does not hold profile Dispatch" } },
      ok,
    ];
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input));
      const next = answers.shift() ?? { status: 200, body: {} };
      if (next === "throw") throw new Error("connect ECONNREFUSED");
      return new Response(next.body === undefined ? null : typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status });
    }) as typeof fetch;
    const sync = new PerspicaxDirectory({
      issuer: `${ISSUER}/`, serverBase: "http://perspicax:8787/", linkFile, expect: EXPECT, principals,
      onPersonOut: () => {}, onRoleNarrowed: () => {}, version: "0.1.89", now: () => now, fetch: fetcher, log: () => {},
    });
    expect(await sync.exchangeToken("pxlo1.CAROL.subject", "P1")).toEqual({
      ok: false,
      error: "not_held",
      description: "Carol does not hold profile Dispatch",
    });
    expect(calls).toHaveLength(1);
    // Same subject + profile: served from the short negative cache, no second call.
    expect(await sync.exchangeToken("pxlo1.CAROL.subject", "P1")).toEqual({
      ok: false,
      error: "not_held",
      description: "Carol does not hold profile Dispatch",
    });
    expect(calls).toHaveLength(1);
    // A different subject still hits the server (cache is per person + profile).
    answers.unshift({ status: 400, body: { error: "invalid_target", error_description: "Bob does not hold profile Dispatch" } });
    expect(await sync.exchangeToken("pxlo1.BOB.subject", "P1")).toMatchObject({ ok: false, error: "not_held", description: "Bob does not hold profile Dispatch" });
    expect(calls).toHaveLength(2);
    // After the cache window, the same person may try again.
    now += 60_001;
    expect(await sync.exchangeToken("pxlo1.CAROL.subject", "P1")).toEqual({ ok: true, token: "pxlo1.BOB.exchanged-secret", expiresAt: now + 900_000 });
    expect(calls).toHaveLength(3);
  });

  it("a 401 re-reads the link file once and retries, then answers link", async () => {
    const h = exchangeHarness([{ status: 401, body: { error: "invalid_client" } }, ok]);
    expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toMatchObject({ ok: true });
    expect(h.calls).toHaveLength(2);
    const twice = exchangeHarness([{ status: 401 }, { status: 401 }]);
    expect(await twice.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: false, error: "link" });
    expect(twice.calls).toHaveLength(2);
    // the retry uses the rotated token from the file
    const rotated = exchangeHarness([{ status: 401 }, ok]);
    await rotated.sync.exchangeToken("pxlo1.BOB.subject", "P1");
    writeLink(rotated.linkFile, linkDoc({ link_token: TOKEN_B }));
    rotated.answers.push({ status: 401 }, ok);
    await rotated.sync.exchangeToken("pxlo1.BOB.subject", "P1");
    expect(rotated.calls.at(-1)!.headers.authorization).toBe(`Basic ${Buffer.from(`pulsa-bot-server:${TOKEN_B}`).toString("base64")}`);
  });

  it("issues a routine delegation from a sign-in access token, no consent (2026-10-08)", async () => {
    const issued = { status: 200, body: { access_token: "pxlo1.BOB.delegated", refresh_token: "pxlr1.BOB.delegated", token_type: "Bearer", expires_in: 3600, issued_token_type: "urn:ietf:params:oauth:token-type:refresh_token", scope: "openid profile email offline_access pulsabot:routines" } };
    const h = exchangeHarness([issued]);
    expect(await h.sync.issueRoutineDelegation("pxlo1.BOB.subject")).toEqual({ ok: true, refreshToken: "pxlr1.BOB.delegated", accessToken: "pxlo1.BOB.delegated", accessExpiresAt: 5_000_000 + 3_600_000 });
    const [call] = h.calls;
    expect(call).toMatchObject({ url: "http://perspicax:8787/oauth/token", method: "POST", redirect: "error" });
    expect(call!.headers.authorization).toBe(`Basic ${Buffer.from(`pulsa-bot-server:${TOKEN_A}`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(call!.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "pxlo1.BOB.subject",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
      scope: "openid profile email offline_access pulsabot:routines",
      resource: ORIGIN,
    });
    // a refresh token without the marker is no delegation: revoked, refused
    const unmarked = exchangeHarness([{ status: 200, body: { ...issued.body, scope: "openid profile email offline_access" } }, { status: 200, body: {} }]);
    expect(await unmarked.sync.issueRoutineDelegation("pxlo1.BOB.subject")).toEqual({ ok: false, error: "unsupported" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(unmarked.calls[1]).toMatchObject({ url: "http://perspicax:8787/oauth/revoke" });
    expect(Object.fromEntries(new URLSearchParams(unmarked.calls[1]!.body))).toEqual({ token: "pxlr1.BOB.delegated", token_type_hint: "refresh_token" });
    const cases: Array<[Answer, string]> = [
      // Perspicax up to 1.8.13: "requested_token_type must be an access token"
      [{ status: 400, body: { error: "invalid_request" } }, "unsupported"],
      [{ status: 400, body: { error: "invalid_grant" } }, "subject"],
      [{ status: 429, body: { error: "slow_down" } }, "rate_limited"],
      [{ status: 500, body: "oops" }, "unreachable"],
      [{ status: 200, body: { access_token: "pxlo1.x", token_type: "Bearer" } }, "unsupported"],
      ["throw", "unreachable"],
    ];
    for (const [answer, error] of cases) {
      const one = exchangeHarness([answer]);
      expect(await one.sync.issueRoutineDelegation("pxlo1.BOB.subject")).toEqual({ ok: false, error });
    }
    const twice = exchangeHarness([{ status: 401 }, { status: 401 }]);
    expect(await twice.sync.issueRoutineDelegation("pxlo1.BOB.subject")).toEqual({ ok: false, error: "link" });
    expect(h.logs.join("\n")).not.toContain("delegated");
  });

  it("revokes with the Basic header and logs a failure without the token", async () => {
    const h = exchangeHarness([{ status: 200, body: {} }, { status: 503 }, "throw"]);
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(true);
    expect(h.calls[0]).toMatchObject({ url: "http://perspicax:8787/oauth/revoke", method: "POST" });
    expect(h.calls[0]!.headers.authorization).toMatch(/^Basic /);
    expect(Object.fromEntries(new URLSearchParams(h.calls[0]!.body))).toEqual({ token: "pxlo1.BOB.exchanged-secret", token_type_hint: "access_token" });
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(false);
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(false);
    expect(h.logs).toHaveLength(2);
    expect(h.logs.join("\n")).not.toContain("exchanged-secret");
  });
});

describe("PerspicaxDirectory, slice 6: routine delegations", () => {
  it("reports each person's delegation after each answer, a 304 with the cached people", async () => {
    const dates = { consented_at: "2026-09-30T10:00:00Z", renewed_at: "2026-09-30T10:05:00Z", expires_at: "2026-10-30T10:05:00Z" };
    const h = harness(directoryOf([
      person("ALICE", { routine_delegation: dates }),
      person("BOB", { routine_delegation: null }),
      person("CAROL"),
      person("DAVE", { status: "disabled", routine_delegation: dates }),
    ]));
    h.clock.now = 7_000_000;
    await h.sync.refresh();
    expect(h.delegationCalls).toHaveLength(1);
    const { present, at } = h.delegationCalls[0]!;
    expect(at).toBe(7_000_000);
    expect(present("ALICE")).toBe(true);
    expect(present("BOB")).toBe(false);
    expect(present("CAROL")).toBeUndefined();
    expect(present("DAVE")).toBe(false);
    expect(present("NOBODY")).toBeUndefined();
    h.clock.now = 8_000_000;
    await h.sync.refresh();
    expect(h.delegationCalls).toHaveLength(2);
    expect(h.delegationCalls[1]!.at).toBe(8_000_000);
    expect(h.delegationCalls[1]!.present("BOB")).toBe(false);
  });

  it("refuses a malformed delegation field", async () => {
    const h = harness({ ...directoryOf([]), people: [{ ...person("ALICE"), routine_delegation: { consented_at: 5 } }] } as unknown as Directory);
    expect((await h.sync.refresh()).state).toBe("error");
    expect(h.delegationCalls).toEqual([]);
  });
});

describe("an avatar read through the link", () => {
  it("is served only when its bytes are a PNG or a JPEG", () => {
    expect(avatarContentType(Buffer.from("89504e470d0a1a0a00", "hex"))).toBe("image/png");
    expect(avatarContentType(Buffer.from("ffd8ffe000", "hex"))).toBe("image/jpeg");
    expect(avatarContentType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(avatarContentType(Buffer.alloc(0))).toBeNull();
  });
});

describe("Capabilities lot 4: the organization's declarations in the directory", () => {
  const declaration = (patch: Record<string, unknown> = {}) => ({
    id: "cap-1", mount_name: "example-tools", form: "skill", name: "Example tools", description: "", source: { kind: "manual" },
    scope: "organization", mode: "offered", enabled: true, configured: true, configuration_kind: "skill",
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    configuration: { type: "skill", files: { "SKILL.md": "---\nname: example-tools\ndescription: Fixture\n---\nUse the fixture.\n" } },
    ...patch,
  });

  it("an older Perspicax without the new fields keeps today's behaviour (all undefined)", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    expect(h.sync.orgCapabilities()).toBeUndefined();
    expect(h.sync.capabilityMarketplaces()).toBeUndefined();
    expect(h.sync.capabilityMarketplacePolicy()).toBeUndefined();
  });

  it("parses declarations with their configuration, marketplaces, and a null policy that stays null", async () => {
    const h = harness({
      ...directoryOf([person("BOB")]),
      capabilities: [declaration(), declaration({ id: "cap-2", mount_name: "notes", form: "mcp", configuration_kind: "stdio", configuration: { type: "stdio", command: "notes-mcp", args: ["--fixture"], env: { MODE: "fixture" } } })],
      capability_marketplaces: [{ id: "m-1", name: "Example", source: "example-org/*", enabled: true, created_at: "x", updated_at: "x" }],
      capability_marketplace_policy: null,
    } as Directory);
    await h.sync.refresh();
    expect(h.sync.orgCapabilities()?.map((row) => row.mount_name)).toEqual(["example-tools", "notes"]);
    expect(h.sync.orgCapabilities()?.[1]?.configuration).toEqual({ type: "stdio", command: "notes-mcp", args: ["--fixture"], env: { MODE: "fixture" } });
    expect(h.sync.capabilityMarketplaces()).toEqual([expect.objectContaining({ source: "example-org/*", enabled: true })]);
    expect(h.sync.capabilityMarketplacePolicy()).toBeNull();
  });

  it("drops a malformed element alone and reads a malformed policy as absent, never as any", async () => {
    const h = harness({
      ...directoryOf([person("BOB")]),
      capabilities: [declaration(), { id: "bad", form: "rocket" }, declaration({ id: "cap-3", mount_name: "../escape" })],
      capability_marketplaces: "not a list",
      capability_marketplace_policy: { mode: "everything" },
    } as unknown as Directory);
    await h.sync.refresh();
    expect(h.sync.state().state).toBe("ok");
    expect(h.sync.orgCapabilities()?.map((row) => row.id)).toEqual(["cap-1"]);
    expect(h.sync.capabilityMarketplaces()).toBeUndefined();
    expect(h.sync.capabilityMarketplacePolicy()).toBeUndefined();
  });

  it("linkJson carries the link token and the person's sign-in token, and keeps a subject refusal's code", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    h.queue.push({ status: 200, body: { value: { mode: "list" }, changed: true } });
    const put = await h.sync.linkPutJson("/api/v1/pulsabot/capabilities/marketplace-policy", { mode: "list" }, { timeoutMs: 200, maxBytes: 4096, subjectToken: "subject-fixture" });
    expect(put).toEqual({ ok: true, status: 200, body: { value: { mode: "list" }, changed: true } });
    const sent = h.requests.at(-1)!;
    expect(sent.url).toBe("http://perspicax:8787/api/v1/pulsabot/capabilities/marketplace-policy");
    expect(sent.headers).toMatchObject({ authorization: `Bearer ${TOKEN_A}`, "x-perspicax-subject-token": "subject-fixture", "content-type": "application/json" });
    h.queue.push({ status: 403, body: { code: "subject", message: "x", details: {} } });
    const refused = await h.sync.linkDeleteJson("/api/v1/pulsabot/capabilities/cap-1", { timeoutMs: 200, maxBytes: 4096, subjectToken: "subject-fixture" });
    expect(refused).toMatchObject({ ok: false, status: 403, body: { code: "subject" } });
    expect(isSubjectRefusal(refused)).toBe(true);
    h.queue.push({ status: 400, body: { code: "validation", message: "mount_name: required", details: {} } });
    expect(await h.sync.linkJson("POST", "/api/v1/pulsabot/capabilities", {}, { timeoutMs: 200, maxBytes: 4096, subjectToken: "subject-fixture" }))
      .toMatchObject({ ok: false, error: "refused", status: 400, body: { message: "mount_name: required" } });
  });
});
