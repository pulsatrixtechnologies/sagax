// Perspicax #2220 (M-20261119-042): each entry of a person's default
// installs is posed once, switched off, in their own place; the person
// removing it never sees it come back; one they already have is left as
// they set it; one that cannot be posed yet waits and is tried again; a
// record that cannot be read poses nothing; the directory's list is read
// entry by entry.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DefaultInstalls, RETRY_MS, defaultInstallKey, type DefaultInstallEntry, type DefaultInstallPerson } from "./default-installs.ts";
import { directorySchema } from "../perspicax/perspicax-link.ts";

const tickets: DefaultInstallEntry = { kind: "plugin", source: "acme", name: "tickets" };
const digest: DefaultInstallEntry = { kind: "skill", source: "library", name: "digest" };
const notes: DefaultInstallEntry = { kind: "plugin", source: "tools", name: "notes" };

/** A person's own place: what is installed, and whether it is on. */
class Place {
  plugins = new Map<string, boolean>();
  skills = new Map<string, boolean>();
  calls: string[] = [];
  refuse = new Set<string>();
  has(principalId: string, entry: DefaultInstallEntry): boolean {
    return (entry.kind === "plugin" ? this.plugins : this.skills).has(`${principalId}/${entry.source}/${entry.name}`);
  }
  async installPlugin(principalId: string, marketplace: string, plugin: string): Promise<void> {
    this.calls.push(`plugin ${principalId} ${marketplace}/${plugin}`);
    if (this.refuse.has(marketplace)) throw Object.assign(new Error("marketplace not connected"), { code: "marketplace_not_connected" });
    this.plugins.set(`${principalId}/${marketplace}/${plugin}`, false);
  }
  async installSkill(principalId: string, name: string): Promise<void> {
    this.calls.push(`skill ${principalId} ${name}`);
    this.skills.set(`${principalId}/library/${name}`, false);
  }
}

describe("default installs from Perspicax", () => {
  let dir: string;
  let place: Place;
  let people: DefaultInstallPerson[];
  let clock: number;
  const make = () => new DefaultInstalls({
    dataDir: dir,
    people: () => people,
    has: (p, e) => place.has(p, e),
    installPlugin: (p, m, n) => place.installPlugin(p, m, n),
    installSkill: (p, n) => place.installSkill(p, n),
    now: () => clock,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sagax-default-installs-"));
    place = new Place();
    people = [];
    clock = 1_800_000_000_000;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("poses each entry once, switched off, in the person's own place", async () => {
    people = [{ principalId: "pr_nora", entries: [tickets, digest] }];
    const installs = make();
    expect(await installs.sync("directory")).toEqual({ posed: 2, failed: 0 });
    expect(place.calls).toEqual(["plugin pr_nora acme/tickets", "skill pr_nora digest"]);
    expect(place.plugins.get("pr_nora/acme/tickets")).toBe(false);
    expect(place.skills.get("pr_nora/library/digest")).toBe(false);
    expect(installs.status("pr_nora")).toEqual({
      posed: [{ ...tickets, at: clock }, { ...digest, at: clock }],
      failed: [],
    });
    // A second directory, a sign-in, a restart: nothing again.
    expect(await installs.sync("sign-in")).toEqual({ posed: 0, failed: 0 });
    expect(await make().sync("start")).toEqual({ posed: 0, failed: 0 });
    expect(place.calls).toHaveLength(2);
  });

  it("never poses again what the person removed", async () => {
    people = [{ principalId: "pr_nora", entries: [tickets] }];
    const installs = make();
    await installs.sync("directory");
    place.plugins.delete("pr_nora/acme/tickets");
    await installs.sync("directory");
    await installs.sync("sign-in");
    expect(place.has("pr_nora", tickets)).toBe(false);
    expect(place.calls).toEqual(["plugin pr_nora acme/tickets"]);
  });

  it("leaves what the person already has as they set it", async () => {
    place.plugins.set("pr_nora/acme/tickets", true);
    people = [{ principalId: "pr_nora", entries: [tickets] }];
    const installs = make();
    expect(await installs.sync("directory")).toEqual({ posed: 0, failed: 0 });
    expect(place.calls).toEqual([]);
    expect(place.plugins.get("pr_nora/acme/tickets")).toBe(true);
    expect(installs.status("pr_nora").posed.map(defaultInstallKey)).toEqual(["plugin:acme:tickets"]);
  });

  it("an entry that cannot be posed yet waits and is tried again", async () => {
    place.refuse.add("tools");
    people = [{ principalId: "pr_nora", entries: [notes, tickets] }];
    const installs = make();
    expect(await installs.sync("directory")).toEqual({ posed: 1, failed: 1 });
    expect(installs.status("pr_nora").failed).toEqual([{ ...notes, at: clock, reason: "marketplace_not_connected" }]);
    // Too soon: not tried again.
    clock += RETRY_MS - 1;
    expect(await installs.sync("directory")).toEqual({ posed: 0, failed: 0 });
    // The marketplace is connected now, and the wait is over.
    place.refuse.clear();
    clock += 1;
    expect(await installs.sync("schedule")).toEqual({ posed: 1, failed: 0 });
    expect(installs.status("pr_nora")).toEqual({ posed: [{ ...tickets, at: clock - RETRY_MS }, { ...notes, at: clock }], failed: [] });
  });

  it("each person gets their own list and nobody else's", async () => {
    people = [
      { principalId: "pr_nora", entries: [tickets] },
      { principalId: "pr_marc", entries: [digest] },
      { principalId: "pr_old", entries: [] },
    ];
    await make().sync("directory");
    expect(place.calls).toEqual(["plugin pr_nora acme/tickets", "skill pr_marc digest"]);
  });

  it("a record that cannot be read poses nothing, and an erased person's record goes", async () => {
    people = [{ principalId: "pr_nora", entries: [tickets] }];
    writeFileSync(join(dir, "default-installs.json"), "{ not json");
    expect(await make().sync("directory")).toEqual({ posed: 0, failed: 0 });
    expect(place.calls).toEqual([]);
    rmSync(join(dir, "default-installs.json"));
    const installs = make();
    await installs.sync("directory");
    installs.forget("pr_nora");
    expect(installs.status("pr_nora")).toEqual({ posed: [], failed: [] });
  });

  it("the directory's list is read entry by entry", () => {
    const person = {
      sub: "u-nora", login: "nora", name: "Nora", email: null, role: "employee", status: "active",
      default_installs: [{ kind: "plugin", source: "acme", name: "tickets" }, { kind: "plugin", source: "../x", name: "y" }, { kind: "skill", source: "library", name: "digest", label: "Digest" }],
    };
    const parsed = directorySchema.parse({ server_id: "srv", people: [person, { ...person, sub: "u-old", default_installs: undefined }], teams: [] });
    expect(parsed.people[0]!.default_installs).toEqual([tickets, digest]);
    expect(parsed.people[1]!.default_installs).toBeUndefined();
  });
});
