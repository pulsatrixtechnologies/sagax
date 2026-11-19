// #4504: the update service and its three kinds, on fakes (no network, no server).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileUpdateHistory, MemoryUpdateHistory } from "./update-history.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CapabilityUpdates,
  compareVersions,
  pinnedPackage,
  shortNotes,
  skillFolderUpdate,
  withPinnedVersion,
  NOTES_MAX_CHARS,
  type UpdateItem,
  type UpdatePerson,
  type UpdateProvider,
} from "./capability-updates.ts";
import {
  changelogNotes,
  connectorUpdateProvider,
  pluginListedFields,
  pluginUpdateProvider,
  skillUpdateProvider,
  type InstalledConnectorRecord,
  type InstalledPluginRecord,
  type InstalledSkillRecord,
} from "./capability-update-providers.ts";

const ADA: UpdatePerson = { id: "pr_ada", manager: false };
const BOB: UpdatePerson = { id: "pr_bob", manager: false };

const item = (over: Partial<UpdateItem> & Pick<UpdateItem, "key" | "kind">): UpdateItem => ({
  name: over.key, scope: "me", updateAvailable: false, canUpdate: true, ...over,
});

function fakeProvider(kind: UpdateItem["kind"], byPerson: Record<string, UpdateItem[]>, update: UpdateProvider["update"], check: UpdateProvider["check"] = async () => false): UpdateProvider {
  return { kind, items: (person) => byPerson[person.id] ?? [], check, update };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("version helpers", () => {
  it("reads a command pinned to a package version, and only that", () => {
    expect(pinnedPackage("npx", ["-y", "@acme/nimbus-mcp@1.2.3"])).toEqual({ registry: "npm", name: "@acme/nimbus-mcp", version: "1.2.3", arg: 1 });
    expect(pinnedPackage("/usr/local/bin/bunx", ["nimbus-mcp@0.4.0", "--port", "1"])).toMatchObject({ registry: "npm", name: "nimbus-mcp", version: "0.4.0", arg: 0 });
    expect(pinnedPackage("pnpm", ["dlx", "nimbus-mcp@2.0.0"])).toMatchObject({ name: "nimbus-mcp", arg: 1 });
    expect(pinnedPackage("uvx", ["nimbus-server==0.9.1"])).toMatchObject({ registry: "pypi", name: "nimbus-server", version: "0.9.1" });
    // unpinned: it follows its source on every start already
    expect(pinnedPackage("npx", ["-y", "nimbus-mcp"])).toBeNull();
    expect(pinnedPackage("node", ["server.js"])).toBeNull();
    expect(pinnedPackage("npx", ["nimbus-mcp@latest"])).toBeNull();
  });

  it("rewrites only the pinned argument", () => {
    const pin = pinnedPackage("uvx", ["--from", "x", "nimbus-server==0.9.1"])!;
    expect(withPinnedVersion(["--from", "x", "nimbus-server==0.9.1"], pin, "1.0.0")).toEqual(["--from", "x", "nimbus-server==1.0.0"]);
    const npm = pinnedPackage("npx", ["-y", "@acme/nimbus-mcp@1.2.3", "--flag"])!;
    expect(withPinnedVersion(["-y", "@acme/nimbus-mcp@1.2.3", "--flag"], npm, "1.3.0")).toEqual(["-y", "@acme/nimbus-mcp@1.3.0", "--flag"]);
    expect(() => withPinnedVersion([], npm, "nope")).toThrow();
  });

  it("compares versions, a pre-release before its release", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("v2.0", "2.0.0")).toBe(0);
    expect(compareVersions("main", "1.0.0")).toBeNull();
  });

  it("keeps notes short, never a wall of text", () => {
    expect(shortNotes("  one\n\n\ntwo  ")).toBe("one\ntwo");
    expect(shortNotes("x".repeat(2000))!.length).toBe(NOTES_MAX_CHARS);
    expect(shortNotes("")).toBeUndefined();
  });

  it("a skill folder is behind only for commits after its import", () => {
    const installed = { commit: "a".repeat(40), importedAt: "2026-11-01T00:00:00Z" };
    expect(skillFolderUpdate(installed, [{ sha: "a".repeat(40), date: "2026-11-01T00:00:00Z", message: "x" }])).toBeNull();
    expect(skillFolderUpdate(installed, [{ sha: "c".repeat(40), date: "2026-10-01T00:00:00Z", message: "older" }])).toBeNull();
    expect(skillFolderUpdate(installed, [
      { sha: "b".repeat(40), date: "2026-11-10T00:00:00Z", message: "Clearer steps\n\nbody" },
      { sha: "d".repeat(40), date: "2026-11-05T00:00:00Z", message: "Fix a typo" },
    ])).toEqual({ available: "bbbbbbb", notes: "Clearer steps\nFix a typo" });
  });

  it("reads a plugin's notes from its CHANGELOG section", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-changelog-"));
    dirs.push(dir);
    writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\n## 1.1.0\n\n- Faster search\n- New command\n\n## 1.0.0\n\n- First\n");
    expect(changelogNotes(dir, "1.1.0")).toBe("- Faster search\n- New command");
    expect(changelogNotes(dir, "2.0.0")).toBeUndefined();
    expect(changelogNotes(join(dir, "none"), "1.1.0")).toBeUndefined();
  });
});

describe("the update service", () => {
  it("counts the person's updates, never another person's items, and checks stale sources without waiting", async () => {
    let release: () => void = () => undefined;
    const check = vi.fn(() => new Promise<boolean>((resolve) => { release = () => resolve(true); }));
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("plugin", {
        pr_ada: [item({ key: "plugin:me:me:a@m", kind: "plugin", updateAvailable: true, installedVersion: "1.0.0", availableVersion: "1.1.0" }), item({ key: "plugin:me:me:b@m", kind: "plugin" })],
        pr_bob: [item({ key: "plugin:me:me:c@m", kind: "plugin", updateAvailable: true })],
      }, async () => undefined, check)],
      log: () => undefined,
    });
    const view = await updates.list(ADA);
    expect(view.count).toBe(1);
    expect(view.items.map((row) => row.key)).toEqual(["plugin:me:me:a@m", "plugin:me:me:b@m"]);
    // the check started and the list did not wait for it
    expect(check).toHaveBeenCalledTimes(1);
    expect(view.checking).toBe(true);
    release();
    await updates.check();
    expect((await updates.list(BOB)).count).toBe(1);
  });

  it("a source that cannot be reached is no error for the person", async () => {
    const log = vi.fn();
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("skill", { pr_ada: [item({ key: "skill:me:me:s", kind: "skill" })] }, async () => undefined, async () => { throw new Error("offline"); })],
      log,
    });
    await updates.check();
    const view = await updates.list(ADA);
    expect(view.items).toHaveLength(1);
    expect(view.checkedAt).not.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("nothing changed"));
  });

  it("update all: each item its own result, a failure says which and why and the rest goes on", async () => {
    const installed: Record<string, string> = { "plugin:me:me:a@m": "1.0.0", "skill:me:me:s": "aaaaaaa", "connector:me:me:c": "1.2.3" };
    const items = () => [
      item({ key: "plugin:me:me:a@m", kind: "plugin", name: "Alpha", updateAvailable: installed["plugin:me:me:a@m"] === "1.0.0", installedVersion: installed["plugin:me:me:a@m"], availableVersion: "1.1.0" }),
      item({ key: "skill:me:me:s", kind: "skill", name: "steps", updateAvailable: true, installedVersion: "aaaaaaa", availableVersion: "bbbbbbb" }),
      item({ key: "connector:me:me:c", kind: "connector", name: "nimbus", updateAvailable: installed["connector:me:me:c"] === "1.2.3", installedVersion: installed["connector:me:me:c"], availableVersion: "1.3.0" }),
      item({ key: "plugin:organization:organization:x", kind: "plugin", name: "Policy", updateAvailable: true, organization: "required", canUpdate: false }),
    ];
    const applied: string[] = [];
    const update: UpdateProvider["update"] = async (_person, target) => {
      if (target.kind === "skill") throw new Error("GitHub answered 404");
      installed[target.key] = target.availableVersion!;
      applied.push(target.key);
    };
    const updates = new CapabilityUpdates({
      providers: (["plugin", "skill", "connector"] as const).map((kind) => ({ kind, items: () => items().filter((row) => row.kind === kind), check: async () => false, update })),
    });
    const answer = await updates.apply(ADA, { all: true });
    expect(answer.results).toEqual([
      { key: "plugin:me:me:a@m", kind: "plugin", name: "Alpha", status: "updated", from: "1.0.0", to: "1.1.0" },
      { key: "skill:me:me:s", kind: "skill", name: "steps", status: "failed", from: "aaaaaaa", error: "GitHub answered 404. The installed version still works." },
      { key: "connector:me:me:c", kind: "connector", name: "nimbus", status: "updated", from: "1.2.3", to: "1.3.0" },
    ]);
    // the organization's item is not part of "all", and the failed one stays
    expect(applied).toEqual(["plugin:me:me:a@m", "connector:me:me:c"]);
    expect(answer.count).toBe(1);
  });

  it("an item the organization holds is refused with why; another person's key is out of reach", async () => {
    const update = vi.fn(async () => undefined);
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("plugin", {
        pr_ada: [item({ key: "plugin:organization:organization:x", kind: "plugin", name: "Policy", updateAvailable: true, organization: "required", pinned: "2.0.0", canUpdate: false })],
        pr_bob: [item({ key: "plugin:bot:bot-b:p@m", kind: "plugin", updateAvailable: true })],
      }, update)],
    });
    const answer = await updates.apply(ADA, { keys: ["plugin:organization:organization:x", "plugin:bot:bot-b:p@m"] });
    expect(answer.results[0]).toMatchObject({ status: "failed", error: expect.stringContaining("organization console") });
    expect(answer.results[1]).toMatchObject({ status: "failed", error: expect.stringContaining("Not one of your installed items") });
    expect(update).not.toHaveBeenCalled();
  });

  it("checks on its own: past the first delay, then on its period", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => false);
    const updates = new CapabilityUpdates({ providers: [fakeProvider("connector", {}, async () => undefined, check)], random: () => 0 });
    const job = updates.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
    job.stop();
  });
});

describe("the three kinds", () => {
  it("plugins: versions, what an update brings and its notes from the existing marketplace listing", async () => {
    const records: InstalledPluginRecord[] = [
      { scope: "bot", target: "bot-1", bot: { id: "bot-1", name: "Nimbus" }, id: "review@acme", name: "Review", installedVersion: "1.0.0", version: "1.1.0", updateAvailable: true, notes: "- Faster" },
      { scope: "me", target: "me", id: "files@acme", name: "Files", version: "2.0.0", offeredRevision: "abcdef123456", updateAvailable: true },
      { scope: "organization", target: "organization", id: "decl-1", name: "Policy", installedVersion: "3.0.0", updateAvailable: false, organization: "required", pinned: "3.0.0" },
    ];
    const install = vi.fn(async () => ({ version: "1.1.0" }));
    const provider = pluginUpdateProvider({ records: () => records, pull: async () => true, install });
    const items = await provider.items(ADA);
    expect(items[0]).toMatchObject({ key: "plugin:bot:bot-1:review@acme", bot: { name: "Nimbus" }, installedVersion: "1.0.0", availableVersion: "1.1.0", updateAvailable: true, updateNotes: "- Faster", canUpdate: true });
    expect(items[1]).toMatchObject({ installedVersion: "2.0.0", availableVersion: "abcdef1", updateAvailable: true });
    expect(items[2]).toMatchObject({ organization: "required", pinned: "3.0.0", canUpdate: false, updateAvailable: false });
    expect(pluginListedFields(records[0]!)).toEqual({ updateKey: "plugin:bot:bot-1:review@acme", availableVersion: "1.1.0", updateNotes: "- Faster" });
    expect(await provider.update(ADA, items[0]!)).toEqual({ to: "1.1.0" });
    expect(install).toHaveBeenCalledWith(ADA, records[0]);
    expect(await provider.check()).toBe(true);
  });

  it("skills: a GitHub folder checked once per source, updated by importing it again", async () => {
    const github = { owner: "acme", repo: "skills", ref: "main", path: "skills/steps", commit: "a".repeat(40) };
    const records: InstalledSkillRecord[] = [
      { scope: "bot", target: "bot-1", bot: { id: "bot-1", name: "Nimbus" }, name: "steps", importedAt: "2026-11-01T00:00:00Z", github, owner: "pr_ada" },
      { scope: "me", target: "me", name: "steps-copy", importedAt: "2026-11-01T00:00:00Z", github, owner: "pr_ada" },
      { scope: "me", target: "me", name: "hand-written", importedAt: "2026-11-01T00:00:00Z" },
    ];
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify([{ sha: "b".repeat(40), commit: { message: "Clearer steps", committer: { date: "2026-11-10T00:00:00Z" } } }]), { status: 200 });
    }) as unknown as typeof fetch;
    const reimport = vi.fn(async () => ({ commit: "b".repeat(40) }));
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [], transport: fetcher, reimport });
    expect((await provider.items(ADA)).every((row) => !row.updateAvailable)).toBe(true);
    expect(await provider.check()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/repos/acme/skills/commits?");
    expect(calls[0]).toContain("path=skills%2Fsteps");
    const items = await provider.items(ADA);
    expect(items[0]).toMatchObject({ key: "skill:bot:bot-1:steps", installedVersion: "aaaaaaa", availableVersion: "bbbbbbb", updateAvailable: true, updateNotes: "Clearer steps" });
    expect(items[2]).toMatchObject({ updateAvailable: false });
    expect(items[2]!.installedVersion).toBeUndefined();
    expect(provider.fields(records[1]!)).toMatchObject({ updateKey: "skill:me:me:steps-copy", updateAvailable: true });
    expect(await provider.update(ADA, items[0]!)).toEqual({ to: "bbbbbbb" });
    await expect(provider.update(ADA, items[2]!)).rejects.toThrow(/not imported from GitHub/);
  });

  it("skills: GitHub out of reach keeps what was known", async () => {
    const github = { owner: "acme", repo: "skills", ref: "HEAD", path: "", commit: "a".repeat(40) };
    const records: InstalledSkillRecord[] = [{ scope: "me", target: "me", name: "steps", importedAt: "2026-11-01T00:00:00Z", github }];
    const fetcher = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [], transport: fetcher, reimport: async () => undefined });
    expect(await provider.check()).toBe(false);
    expect((await provider.items(ADA))[0]!.updateAvailable).toBe(false);
  });

  it("connectors: a pinned package checked at its registry, updated by its new version in the arguments", async () => {
    const records: InstalledConnectorRecord[] = [
      { scope: "me", target: "me", name: "nimbus", command: "npx", args: ["-y", "nimbus-mcp@1.2.3"] },
      { scope: "me", target: "me", name: "remote" },
      { scope: "organization", target: "organization", name: "policy", command: "npx", args: ["policy-mcp@1.0.0"], organization: "required" },
    ];
    const fetcher = (async (url: string) => new Response(JSON.stringify({ version: String(url).includes("nimbus") ? "1.3.0" : "9.9.9" }), { status: 200 })) as unknown as typeof fetch;
    const setArgs = vi.fn();
    const provider = connectorUpdateProvider({ records: () => records, allRecords: () => records, fetcher, setArgs });
    expect(await provider.check()).toBe(true);
    const items = await provider.items(ADA);
    expect(items[0]).toMatchObject({ key: "connector:me:me:nimbus", installedVersion: "1.2.3", availableVersion: "1.3.0", updateAvailable: true });
    expect(items[1]).toMatchObject({ updateAvailable: false });
    expect(items[2]).toMatchObject({ organization: "required", canUpdate: false, updateAvailable: false });
    expect(await provider.update(ADA, items[0]!)).toEqual({ to: "1.3.0" });
    expect(setArgs).toHaveBeenCalledWith(ADA, records[0], ["-y", "nimbus-mcp@1.3.0"]);
  });
});

describe("library skill replacement keeps the installed copy on a failure", () => {
  it("updates the folder and its record, and refuses a source that renamed the skill", async () => {
    const { installLibrarySkill, readLibrarySkillFile, replaceLibrarySkill } = await import("../skills/skill-library.ts");
    const root = mkdtempSync(join(tmpdir(), "sagax-library-update-"));
    dirs.push(root);
    mkdirSync(join(root, "skills"), { recursive: true });
    const text = (body: string, name = "steps") => `---\nname: ${name}\ndescription: Steps for a task.\n---\n\n${body}\n`;
    const github = { owner: "acme", repo: "skills", ref: "main", path: "steps", commit: "a".repeat(40) };
    expect(installLibrarySkill({ name: "steps", instructions: text("Old."), source: "acme/skills/steps", reviewState: "approved", github, root })).not.toHaveProperty("error");
    const refused = replaceLibrarySkill("steps", { instructions: text("Other.", "renamed"), source: "acme/skills/steps", warnings: [] }, root);
    expect(refused).toHaveProperty("error");
    expect(readLibrarySkillFile("steps", root)).toContain("Old.");
    const done = replaceLibrarySkill("steps", { instructions: text("New."), source: "acme/skills/steps", warnings: [], github: { ...github, commit: "b".repeat(40) } }, root);
    expect(done).not.toHaveProperty("error");
    expect(readLibrarySkillFile("steps", root)).toContain("New.");
    expect((done as { github?: { commit: string } }).github?.commit).toBe("b".repeat(40));
  });
});

describe("review of #4504", () => {
  it("orders pre-releases by their numbers", () => {
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.9")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-rc.1")).toBe(-1);
    expect(compareVersions("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });

  it("a folder commit after the imported one counts, whatever its date", () => {
    const installed = { commit: "a".repeat(40), importedAt: "2026-11-01T00:00:00Z" };
    expect(skillFolderUpdate(installed, [
      { sha: "b".repeat(40), date: "2026-10-01T00:00:00Z", message: "Merged late" },
      { sha: "a".repeat(40), date: "2026-09-01T00:00:00Z", message: "Imported" },
    ])).toEqual({ available: "bbbbbbb", notes: "Merged late" });
  });

  it("a source never reached is unknown, never current, and shows no update mark", async () => {
    const github = { owner: "acme", repo: "skills", ref: "main", path: "", commit: "a".repeat(40) };
    const skills = skillUpdateProvider({ records: () => [{ scope: "me", target: "me", name: "steps", importedAt: "2026-11-01T00:00:00Z", github }], allRecords: () => [], credentialsFor: () => [], reimport: async () => undefined });
    const connectors = connectorUpdateProvider({ records: () => [{ scope: "me", target: "me", name: "nimbus", command: "npx", args: ["nimbus-mcp@1.0.0"] }], allRecords: () => [], setArgs: () => undefined });
    expect((await skills.items(ADA))[0]).toMatchObject({ updateAvailable: false, updateUnknown: true });
    expect((await connectors.items(ADA))[0]).toMatchObject({ updateAvailable: false, updateUnknown: true });
    const updates = new CapabilityUpdates({ providers: [skills, connectors] });
    const answer = await updates.apply(ADA, { keys: ["skill:me:me:steps", "connector:me:me:nimbus"] });
    expect(answer.results.map((row) => row.status)).toEqual(["unknown", "unknown"]);
  });

  it("a private source's commits are read and shown per person, with that person's own access", async () => {
    const github = { owner: "acme", repo: "private", ref: "main", path: "steps", commit: "a".repeat(40) };
    const records: InstalledSkillRecord[] = [
      { scope: "me", target: "me", name: "steps", importedAt: "2026-11-01T00:00:00Z", github, owner: "pr_ada" },
      { scope: "me", target: "me", name: "steps", importedAt: "2026-11-01T00:00:00Z", github, owner: "pr_bob" },
    ];
    const transport = (async (_url: string, init?: RequestInit) => new Headers(init?.headers).get("authorization") === "Bearer t-ada"
      ? new Response(JSON.stringify([{ sha: "b".repeat(40), commit: { message: "Secret subject", committer: { date: "2026-11-10T00:00:00Z" } } }]), { status: 200 })
      : new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const credentialsFor = (owner: string | undefined) => owner === "pr_ada" ? [{ token: "t-ada", via: "person" as const }] : [];
    const provider = skillUpdateProvider({ records: (person) => records.filter((row) => row.owner === person.id), allRecords: () => records, credentialsFor, transport, reimport: async () => undefined });
    await provider.check();
    expect((await provider.items(ADA))[0]).toMatchObject({ updateAvailable: true, updateNotes: "Secret subject" });
    const bob = (await provider.items(BOB))[0]!;
    expect(bob.updateAvailable).toBe(false);
    expect(bob.updateNotes).toBeUndefined();
  });

  it("GitHub's rate limit: a refusal stops the round until its reset, and a reserve is left for imports", async () => {
    let now = Date.parse("2026-11-16T12:00:00Z");
    const reset = Math.floor(now / 1000) + 3600;
    const asked: string[] = [];
    let answer: "limited" | "low" | "ok" = "limited";
    const fetcher = (async (url: string) => {
      asked.push(String(url));
      if (answer === "limited") return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } });
      return new Response(JSON.stringify([]), { status: 200, headers: { "x-ratelimit-remaining": answer === "low" ? "5" : "50", "x-ratelimit-reset": String(Math.floor(now / 1000) + 3600) } });
    }) as unknown as typeof fetch;
    const records: InstalledSkillRecord[] = ["one", "two", "three"].map((path) => ({ scope: "me", target: "me", name: path, importedAt: "2026-11-01T00:00:00Z", github: { owner: "acme", repo: "skills", ref: "main", path, commit: "a".repeat(40) } }));
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor: () => [], transport: fetcher, reimport: async () => undefined, now: () => now });
    expect(provider.checkEvery).toBe(6 * 60 * 60_000);
    await provider.check();
    expect(asked).toHaveLength(1);
    await provider.check();
    expect(asked).toHaveLength(1);
    now = (reset + 1) * 1000;
    answer = "low";
    await provider.check();
    // past the reset: one request, then the reserve stops the round
    expect(asked).toHaveLength(2);
    answer = "ok";
    now += 2 * 60 * 60_000;
    await provider.check();
    expect(asked).toHaveLength(5);
  });

  it("two updates of one item at once run one update", async () => {
    let release: () => void = () => undefined;
    const update = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const updates = new CapabilityUpdates({ providers: [fakeProvider("plugin", { pr_ada: [item({ key: "plugin:me:me:a@m", kind: "plugin", updateAvailable: true, availableVersion: "2.0.0" })] }, update)] });
    const first = updates.apply(ADA, { keys: ["plugin:me:me:a@m"] });
    const second = updates.apply(ADA, { all: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(a.results[0]!.status).toBe("updated");
    expect(b.results[0]!.status).toBe("updated");
  });

  it("the live frame: only when the person's own list changed, with the same count as their GET", async () => {
    let available = false;
    const sent: Array<[string, number]> = [];
    const updates = new CapabilityUpdates({
      providers: [{
        kind: "plugin",
        items: (person) => person.id === "pr_ada" ? [item({ key: "plugin:me:me:a@m", kind: "plugin", updateAvailable: available })]
          : [item({ key: "plugin:installation:installation:b@m", kind: "plugin", scope: "installation", updateAvailable: available && person.manager })],
        check: async () => true,
        update: async () => undefined,
      }],
      people: () => [{ id: "pr_owner", manager: true }],
      notify: (person, view) => { sent.push([person, view.count]); },
    });
    // a person with only Me items is known once they read their list
    await updates.list(ADA);
    await updates.check();
    expect(sent).toEqual([]);
    available = true;
    await updates.check();
    expect(sent.sort()).toEqual([["pr_ada", 1], ["pr_owner", 1]]);
    await updates.check();
    expect(sent).toHaveLength(2);
  });
});

describe("second review of #4504", () => {
  it("two people updating their own item of the same name each get their own update", async () => {
    const releases: Array<() => void> = [];
    const done: string[] = [];
    const update = vi.fn((person: UpdatePerson) => new Promise<void>((resolve) => { releases.push(() => { done.push(person.id); resolve(); }); }));
    const own = (version: string) => [item({ key: "plugin:me:me:a@m", kind: "plugin", updateAvailable: true, availableVersion: version })];
    const updates = new CapabilityUpdates({ providers: [fakeProvider("plugin", { pr_ada: own("2.0.0"), pr_bob: own("3.0.0") }, update)] });
    const ada = updates.apply(ADA, { keys: ["plugin:me:me:a@m"] });
    const bob = updates.apply(BOB, { keys: ["plugin:me:me:a@m"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const release of releases) release();
    const [a, b] = await Promise.all([ada, bob]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(done.sort()).toEqual(["pr_ada", "pr_bob"]);
    expect(a.results[0]!.to).toBe("2.0.0");
    expect(b.results[0]!.to).toBe("3.0.0");
  });

  it("an organization skill or connector is keyed by its declaration id, which the item carries", async () => {
    const skills = skillUpdateProvider({ records: () => [{ scope: "organization", target: "organization", id: "d9", name: "house-rules", importedAt: "", organization: "offered" }], allRecords: () => [], credentialsFor: () => [], reimport: async () => undefined });
    const connectors = connectorUpdateProvider({ records: () => [{ scope: "organization", target: "organization", id: "d8", name: "audit-log", organization: "offered" }], allRecords: () => [], setArgs: () => undefined });
    expect((await skills.items(ADA))[0]).toMatchObject({ key: "skill:organization:organization:d9", name: "house-rules", organizationId: "d9" });
    expect((await connectors.items(ADA))[0]).toMatchObject({ key: "connector:organization:organization:d8", name: "audit-log", organizationId: "d8" });
  });

  it("GitHub's rate limit is per credential, honours retry-after, and the next round resumes where the last stopped", async () => {
    let now = Date.parse("2026-11-16T12:00:00Z");
    const asked: string[] = [];
    const answers: Record<string, () => Response> = {};
    const transport = (async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).searchParams.get("path")!;
      const owner = new Headers(init?.headers).get("authorization") === "Bearer t-ada" ? "pr_ada" : "pr_bob";
      asked.push(`${owner}:${path}`);
      return (answers[`${owner}:${path}`] ?? (() => new Response("[]", { status: 200, headers: { "x-ratelimit-remaining": "50" } })))();
    }) as unknown as typeof fetch;
    const credentialsFor = (owner: string | undefined) => [{ token: owner === "pr_ada" ? "t-ada" : "t-bob", via: "person" as const }];
    const github = (path: string) => ({ owner: "acme", repo: "skills", ref: "main", path, commit: "a".repeat(40) });
    const records: InstalledSkillRecord[] = [
      { scope: "me", target: "me", name: "a1", importedAt: "2026-11-01T00:00:00Z", github: github("a1"), owner: "pr_ada" },
      { scope: "me", target: "me", name: "b1", importedAt: "2026-11-01T00:00:00Z", github: github("b1"), owner: "pr_bob" },
    ];
    // a secondary limit with requests left: retry-after pauses that credential only
    answers["pr_ada:a1"] = () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "40", "retry-after": "120" } });
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, credentialsFor, transport, reimport: async () => undefined, now: () => now });
    await provider.check();
    expect(asked).toEqual(["pr_ada:a1", "pr_bob:b1"]);
    await provider.check();
    expect(asked).toEqual(["pr_ada:a1", "pr_bob:b1", "pr_bob:b1"]);
    now += 121_000;
    delete answers["pr_ada:a1"];
    await provider.check();
    expect(asked.slice(3)).toEqual(["pr_ada:a1", "pr_bob:b1"]);

    // a short budget: the next round starts with the sources the last did not reach
    const order: string[] = [];
    let low = true;
    const shared = (async (url: string) => {
      order.push(new URL(String(url)).searchParams.get("path")!);
      return new Response("[]", { status: 200, headers: { "x-ratelimit-remaining": low ? "5" : "50" } });
    }) as unknown as typeof fetch;
    const three: InstalledSkillRecord[] = ["s1", "s2", "s3"].map((path) => ({ scope: "me", target: "me", name: path, importedAt: "2026-11-01T00:00:00Z", github: github(path) }));
    const cursor = skillUpdateProvider({ records: () => three, allRecords: () => three, credentialsFor: () => [], transport: shared, reimport: async () => undefined, now: () => now });
    await cursor.check();
    low = false;
    now += 2 * 60 * 60_000;
    await cursor.check();
    expect(order).toEqual(["s1", "s2", "s3", "s1"]);
  });

  it("right after a start, the first change for a person who never read their list sends the frame", async () => {
    const sent: Array<[string, number]> = [];
    const updates = new CapabilityUpdates({
      providers: [{ kind: "plugin", items: () => [item({ key: "plugin:me:me:a@m", kind: "plugin", updateAvailable: true })], check: async () => true, update: async () => undefined }],
      people: () => [{ id: "pr_owner", manager: false }],
      notify: (person, view) => { sent.push([person, view.count]); },
    });
    await updates.check();
    expect(sent).toEqual([["pr_owner", 1]]);
  });
});

describe("automatic update of plugins (#4504, #475)", () => {
  const behind = (key: string, over: Partial<UpdateItem> = {}) => item({ key, kind: "plugin", name: key, updateAvailable: true, installedVersion: "1.0.0", availableVersion: "1.1.0", ...over });

  it("updates the person's own plugins by itself when a check finds a newer one, with no banner in the frame", async () => {
    const calls: string[] = [];
    const sent: unknown[][] = [];
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("plugin", { pr_ada: [behind("plugin:me:me:a@m"), behind("plugin:bot:b1:a@m", { scope: "bot" }), behind("plugin:installation:installation:a@m", { scope: "installation" }), behind("plugin:organization:organization:x", { scope: "organization", organization: "required" })] },
        async (_person, one) => { calls.push(one.key); return { to: "1.1.0" }; }, async () => true)],
      people: () => [ADA],
      autoUpdate: { kinds: ["plugin"] },
      notify: (...args) => sent.push(args),
      log: () => {},
    });
    await updates.check();
    expect(calls).toEqual(["plugin:me:me:a@m", "plugin:bot:b1:a@m"]);
    // the frame says the list changed: it carries no line about what was updated
    expect(sent.length).toBeGreaterThan(0);
    for (const args of sent) expect(args).toHaveLength(2);
  });

  it("a plugin held by four bots is one history line for the person, not four (M-20261119-040)", async () => {
    const bots = ["b1", "b2", "b3", "b4"].map((id) => behind(`plugin:bot:${id}:flow@m`, { name: "Pulsatrix Flow", scope: "bot", installedVersion: "0.33.6", availableVersion: "0.33.8" }));
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("plugin", { pr_ada: bots, pr_bob: [behind("plugin:me:me:flow@m", { name: "Pulsatrix Flow", installedVersion: "0.33.6", availableVersion: "0.33.8" })] }, async () => ({ to: "0.33.8" }), async () => true)],
      people: () => [ADA, BOB],
      autoUpdate: { kinds: ["plugin"] },
      now: () => 1_000,
      log: () => {},
    });
    await updates.check();
    const ada = await updates.list(ADA);
    expect(ada.history).toEqual([{ kind: "plugin", name: "Pulsatrix Flow", at: 1_000, from: "0.33.6", to: "0.33.8" }]);
    expect((await updates.list(BOB)).history).toHaveLength(1);
  });

  it("a later update of the same plugin adds a line, newest first, and the history stays short", () => {
    const history = new MemoryUpdateHistory();
    expect(history.record("p", { kind: "plugin", name: "A", at: 1, from: "1", to: "2" })).toBe(true);
    expect(history.record("p", { kind: "plugin", name: "A", at: 2, from: "1", to: "2" })).toBe(false);
    for (let version = 3; version < 12; version += 1) history.record("p", { kind: "plugin", name: "A", at: version, from: String(version - 1), to: String(version) });
    const rows = history.read("p");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.to).toBe("11");
    expect(history.read("other")).toEqual([]);
  });

  it("the history file survives a restart and an unreadable file starts fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-history-"));
    dirs.push(dir);
    const file = join(dir, "history.json");
    new FileUpdateHistory(file).record("p", { kind: "plugin", name: "A", at: 5, from: "1", to: "2" });
    expect(new FileUpdateHistory(file).read("p")).toEqual([{ kind: "plugin", name: "A", at: 5, from: "1", to: "2" }]);
    writeFileSync(file, "not json");
    expect(new FileUpdateHistory(file).read("p")).toEqual([]);
  });

  it("a failed automatic update leaves the old version and is not retried for the same version", async () => {
    const update = vi.fn(async () => { throw new Error("The source is unreachable."); });
    const updates = new CapabilityUpdates({
      providers: [fakeProvider("plugin", { pr_ada: [behind("plugin:me:me:a@m")] }, update, async () => true)],
      people: () => [ADA],
      autoUpdate: { kinds: ["plugin"] },
      log: () => {},
    });
    await updates.check();
    await updates.check();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does nothing by itself unless asked, and never touches skills or connectors", async () => {
    const update = vi.fn(async () => ({}));
    const off = new CapabilityUpdates({ providers: [fakeProvider("plugin", { pr_ada: [behind("plugin:me:me:a@m")] }, update, async () => true)], people: () => [ADA], log: () => {} });
    await off.check();
    const skills = new CapabilityUpdates({ providers: [fakeProvider("skill", { pr_ada: [behind("skill:me:me:s", { kind: "skill" })] }, update, async () => true)], people: () => [ADA], autoUpdate: { kinds: ["plugin"] }, log: () => {} });
    await skills.check();
    expect(update).not.toHaveBeenCalled();
  });
});
