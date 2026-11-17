// #4504: the update service and its three kinds, on fakes (no network, no server).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const onApplied = vi.fn();
    const updates = new CapabilityUpdates({
      providers: (["plugin", "skill", "connector"] as const).map((kind) => ({ kind, items: () => items().filter((row) => row.kind === kind), check: async () => false, update })),
      onApplied,
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
    expect(onApplied).toHaveBeenCalledWith(ADA, answer.results);
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
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, fetcherFor: () => fetcher, reimport });
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
    const provider = skillUpdateProvider({ records: () => records, allRecords: () => records, fetcherFor: () => fetcher, reimport: async () => undefined });
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
