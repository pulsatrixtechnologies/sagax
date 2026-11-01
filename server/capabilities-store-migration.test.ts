// Capabilities lot 5: three-store migration. Fresh, partial crash, rerun,
// rollback-safe, person isolation. Synthetic data only.
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotCapabilityStore } from "./bot-capability-store.ts";
import { InstallationCapabilityStore } from "./installation-capability-store.ts";
import { PERSON_SKILLS_SPLIT_ID, migrateCapabilitiesStores } from "./capabilities-store-migration.ts";
import { createHash } from "node:crypto";
import { CAPABILITY_STORE_INVENTORY } from "../shared/capability-stores.ts";
import { capabilityPluginStateSchema } from "./capability-plugin-state.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const key = { kind: "key" as const, key: Buffer.alloc(32, 9) };

function open() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-cap-l5-"));
  dirs.push(dir);
  const bots = new BotCapabilityStore(dir);
  const installation = new InstallationCapabilityStore(dir, () => key);
  return { dir, bots, installation };
}

function writeBotLegacy(dir: string, botId: string, plugins: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const root = join(dir, "bot-plugins", botId);
  mkdirSync(join(root, "plugins"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "state.json"), JSON.stringify({ version: 2, plugins }, null, 2));
  writeFileSync(join(root, "plugins", "config.json"), JSON.stringify(values, null, 2));
}

function writeInstallationLegacy(dir: string) {
  mkdirSync(join(dir, "marketplaces"), { recursive: true });
  writeFileSync(join(dir, "marketplaces", "state.json"), JSON.stringify({
    version: 1,
    marketplaces: { acme: { source: "acme/tools", addedAt: 1, updatedAt: 1, visibility: "org" } },
    installed: { "reviewer@acme": { name: "reviewer", marketplace: "acme", installedAt: 1, servers: [], skills: [] } },
  }, null, 2));
  mkdirSync(join(dir, "skills-library"), { recursive: true });
  writeFileSync(join(dir, "skills-library", "index.json"), JSON.stringify({
    "order-audit": {
      name: "order-audit",
      description: "Audit an order",
      source: "upload",
      sha256: "a".repeat(64),
      importedAt: "2026-11-01T00:00:00.000Z",
      reviewState: "approved",
      warnings: [],
      skippedFiles: [],
    },
  }, null, 2));
  mkdirSync(join(dir, "org-flow-plugins"), { recursive: true });
  writeFileSync(join(dir, "org-flow-plugins", "state.json"), JSON.stringify({ version: 2, loaded: { flow: "1.0.0" } }, null, 2));
  mkdirSync(join(dir, "org-capabilities"), { recursive: true });
  writeFileSync(join(dir, "org-capabilities", "state.json"), JSON.stringify({ version: 1, loaded: {} }, null, 2));
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    mcpServers: { notes: { type: "http", url: "https://notes.example.test/mcp" } },
  }, null, 2));
}

function migrate(dir: string, bots: BotCapabilityStore, installation: InstallationCapabilityStore, extras: Partial<Parameters<typeof migrateCapabilitiesStores>[0]> = {}) {
  return migrateCapabilitiesStores({
    dataDir: dir,
    bots,
    installation,
    botIds: () => [],
    personIds: () => [],
    readMcpServers: () => {
      try {
        const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { mcpServers?: Record<string, unknown> };
        return raw.mcpServers ?? {};
      } catch {
        return {};
      }
    },
    clearMcpServers: () => {
      if (!existsSync(join(dir, "config.json"))) return;
      const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<string, unknown>;
      raw.mcpServers = {};
      writeFileSync(join(dir, "config.json"), JSON.stringify(raw, null, 2));
    },
    githubCredentialsMigrated: () => true,
    ...extras,
  });
}

describe("capability store inventory", () => {
  it("lists eleven sources across bot, person and installation", () => {
    expect(CAPABILITY_STORE_INVENTORY).toHaveLength(11);
    expect(CAPABILITY_STORE_INVENTORY.filter((row) => row.target === "bot")).toHaveLength(2);
    expect(CAPABILITY_STORE_INVENTORY.filter((row) => row.target === "person")).toHaveLength(2);
    expect(CAPABILITY_STORE_INVENTORY.filter((row) => row.target === "installation")).toHaveLength(7);
  });
});

describe("migrateCapabilitiesStores", () => {
  it("migrates a fresh tree into the three stores and retires old config files", () => {
    const { dir, bots, installation } = open();
    writeBotLegacy(dir, "bot-a", {
      "reviewer@acme": {
        name: "reviewer", marketplace: "acme", enabled: true, installedAt: 1, updatedAt: 1,
        removed: [], declaredMcpServers: [],
      },
    }, { "reviewer@acme": { team: "Alpha" } });
    writeInstallationLegacy(dir);
    mkdirSync(join(dir, "principals", "pr_alice"), { recursive: true, mode: 0o700 });
    // Minimal sealed envelope is not required: person migration only
    // retires connections.enc when capabilities.enc already exists.
    writeFileSync(join(dir, "principals", "pr_alice", "capabilities.enc"), JSON.stringify({ v: 1, iv: "AA==", tag: "AA==", data: "AA==" }));
    writeFileSync(join(dir, "principals", "pr_alice", "connections.enc"), JSON.stringify({ v: 1, iv: "AA==", tag: "AA==", data: "BB==" }));

    const first = migrate(dir, bots, installation, {
      botIds: () => ["bot-a"],
      personIds: () => ["pr_alice"],
      assignedSkillsFor: () => ["order-audit"],
    });
    expect(first.imported.length).toBeGreaterThan(0);
    expect(bots.present("bot-a")).toBe(true);
    expect(bots.plugins("bot-a").plugins["reviewer@acme"]).toMatchObject({ name: "reviewer", enabled: true });
    expect(bots.pluginValues("bot-a")).toEqual({ "reviewer@acme": { team: "Alpha" } });
    expect(bots.assignedSkills("bot-a")).toEqual(["order-audit"]);
    expect(installation.present()).toBe(true);
    expect(installation.read().marketplaces.marketplaces).toMatchObject({ acme: expect.objectContaining({ source: "acme/tools" }) });
    expect(installation.read().skillsLibrary["order-audit"]).toMatchObject({ name: "order-audit" });
    expect(installation.read().mcpServers).toEqual({ notes: { type: "http", url: "https://notes.example.test/mcp" } });
    expect(existsSync(join(dir, "bot-plugins", "bot-a", "state.json"))).toBe(false);
    expect(existsSync(join(dir, "bot-plugins", "bot-a", "state.json.migrated"))).toBe(true);
    expect(existsSync(join(dir, "bot-plugins", "bot-a", "state.json.capabilities-l5.bak"))).toBe(true);
    expect(existsSync(join(dir, "marketplaces", "state.json"))).toBe(false);
    expect(existsSync(join(dir, "principals", "pr_alice", "connections.enc"))).toBe(false);
    expect(existsSync(join(dir, "principals", "pr_alice", "capabilities.enc"))).toBe(true);

    const second = migrate(dir, bots, installation, {
      botIds: () => ["bot-a"],
      personIds: () => ["pr_alice"],
    });
    expect(second.imported).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(bots.plugins("bot-a").plugins["reviewer@acme"]).toMatchObject({ name: "reviewer" });
  });

  it("survives a partial crash: backup exists, new store incomplete, rerun finishes", () => {
    const { dir, bots, installation } = open();
    writeBotLegacy(dir, "bot-b", {
      "helper@acme": {
        name: "helper", marketplace: "acme", enabled: false, installedAt: 2, updatedAt: 2,
        removed: [], declaredMcpServers: [],
      },
    });
    // Simulate: backup taken, new store written without the config marker,
    // old state.json still present (crash before retire).
    const statePath = join(dir, "bot-plugins", "bot-b", "state.json");
    writeFileSync(`${statePath}.capabilities-l5.bak`, readFileSync(statePath));
    const partial = capabilityPluginStateSchema.parse(JSON.parse(readFileSync(statePath, "utf8")));
    bots.write("bot-b", {
      version: 1,
      plugins: partial,
      pluginValues: {},
      assignedSkills: [],
      migrated: ["bot-plugins-state"],
    });

    const result = migrate(dir, bots, installation, { botIds: () => ["bot-b"] });
    expect(result.imported.some((id) => id.includes("bot-plugins-config"))).toBe(true);
    expect(bots.hasMigrated("bot-b", "bot-plugins-state")).toBe(true);
    expect(bots.hasMigrated("bot-b", "bot-plugins-config")).toBe(true);
    expect(bots.plugins("bot-b").plugins["helper@acme"]).toMatchObject({ enabled: false });
    expect(existsSync(statePath)).toBe(false);
  });

  it("keeps person isolation: one person's marker never touches another", () => {
    const { dir, bots, installation } = open();
    for (const person of ["pr_alice", "pr_bob"]) {
      mkdirSync(join(dir, "principals", person), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, "principals", person, "capabilities.enc"), JSON.stringify({ v: 1, iv: "AA==", tag: "AA==", data: person }));
      writeFileSync(join(dir, "principals", person, "connections.enc"), JSON.stringify({ v: 1, iv: "AA==", tag: "AA==", data: `${person}-legacy` }));
    }
    migrate(dir, bots, installation, { personIds: () => ["pr_alice", "pr_bob"] });
    expect(readFileSync(join(dir, "principals", "pr_alice", "capabilities.enc"), "utf8")).toContain("pr_alice");
    expect(readFileSync(join(dir, "principals", "pr_bob", "capabilities.enc"), "utf8")).toContain("pr_bob");
    expect(existsSync(join(dir, "principals", "pr_alice", "connections.enc"))).toBe(false);
    expect(existsSync(join(dir, "principals", "pr_bob", "connections.enc"))).toBe(false);
    // backups preserve each person's legacy bytes separately
    expect(readFileSync(join(dir, "principals", "pr_alice", "connections.enc.capabilities-l5.bak"), "utf8")).toContain("pr_alice-legacy");
    expect(readFileSync(join(dir, "principals", "pr_bob", "connections.enc.capabilities-l5.bak"), "utf8")).toContain("pr_bob-legacy");
  });

  it("moves Me skills a dev build stored in the installation index back under their person, once", () => {
    // Before the fix of 2026-11-01, a person's Me skill entry was written
    // into the installation index while its SKILL.md stayed under the
    // person. Production never carried this layout; dev trees did.
    const { dir, bots, installation } = open();
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const entry = (name: string, description: string, text: string) => ({ name, description, source: "local-import", sha256: sha(text), importedAt: "2026-11-01T00:00:00.000Z", reviewState: "approved", warnings: [], skippedFiles: [] });
    const orgText = "---\nname: order-audit\ndescription: Audit an order\n---\nORG_ONLY\n";
    const aliceText = "---\nname: packing-list\ndescription: Alice packing\n---\nALICE_ONLY\n";
    mkdirSync(join(dir, "skills-library", "skills", "order-audit"), { recursive: true });
    writeFileSync(join(dir, "skills-library", "skills", "order-audit", "SKILL.md"), orgText);
    for (const person of ["pr_alice", "pr_bob"]) {
      mkdirSync(join(dir, "principals", person), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, "principals", person, "capabilities.enc"), JSON.stringify({ v: 1, iv: "AA==", tag: "AA==", data: `${person}-sealed` }));
    }
    mkdirSync(join(dir, "principals", "pr_alice", "capability-skills", "skills", "packing-list"), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "principals", "pr_alice", "capability-skills", "skills", "packing-list", "SKILL.md"), aliceText);
    const document = installation.read();
    document.skillsLibrary = { "order-audit": entry("order-audit", "Audit an order", orgText), "packing-list": entry("packing-list", "Alice packing", aliceText), "gone": entry("gone", "No file anywhere", "x") };
    document.migrated = ["marketplaces-state", "skills-library-index", "org-flow-state", "org-capabilities-state", "config-mcp-servers", "org-github-tokens", "marketplace-tokens"];
    installation.write(document);

    const first = migrate(dir, bots, installation, { personIds: () => ["pr_alice", "pr_bob"] });
    expect(first.imported).toEqual(expect.arrayContaining([`installation:${PERSON_SKILLS_SPLIT_ID}`, "person:pr_alice:me-skill:packing-list"]));
    const after = installation.read();
    expect(Object.keys(after.skillsLibrary).sort()).toEqual(["gone", "order-audit"]);
    expect(after.migrated).toContain(PERSON_SKILLS_SPLIT_ID);
    const aliceIndex = JSON.parse(readFileSync(join(dir, "principals", "pr_alice", "capability-skills", "index.json"), "utf8"));
    expect(aliceIndex["packing-list"]).toMatchObject({ description: "Alice packing", sha256: sha(aliceText) });
    // Bob gets nothing of Alice's; sealed person files are untouched
    expect(existsSync(join(dir, "principals", "pr_bob", "capability-skills", "index.json"))).toBe(false);
    expect(readFileSync(join(dir, "principals", "pr_bob", "capabilities.enc"), "utf8")).toContain("pr_bob-sealed");
    expect(readFileSync(join(dir, "principals", "pr_alice", "capabilities.enc"), "utf8")).toContain("pr_alice-sealed");

    const second = migrate(dir, bots, installation, { personIds: () => ["pr_alice", "pr_bob"] });
    expect(second.imported.filter((row) => row.includes("me-skill") || row.includes(PERSON_SKILLS_SPLIT_ID))).toEqual([]);
    expect(second.skipped).toContain(`installation:${PERSON_SKILLS_SPLIT_ID}`);
    expect(JSON.parse(readFileSync(join(dir, "principals", "pr_alice", "capability-skills", "index.json"), "utf8"))).toEqual(aliceIndex);
  });

  it("is rollback-safe: backups remain after a successful migrate", () => {
    const { dir, bots, installation } = open();
    writeInstallationLegacy(dir);
    migrate(dir, bots, installation);
    expect(existsSync(join(dir, "marketplaces", "state.json.capabilities-l5.bak"))).toBe(true);
    expect(existsSync(join(dir, "skills-library", "index.json.capabilities-l5.bak"))).toBe(true);
    expect(existsSync(join(dir, "org-flow-plugins", "state.json.capabilities-l5.bak"))).toBe(true);
    // Restoring the bak would recover the previous JSON shape.
    const bak = JSON.parse(readFileSync(join(dir, "marketplaces", "state.json.capabilities-l5.bak"), "utf8"));
    expect(bak.marketplaces.acme.source).toBe("acme/tools");
  });

  it("defers installation migration when the vault key is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-cap-l5-novault-"));
    dirs.push(dir);
    writeInstallationLegacy(dir);
    const bots = new BotCapabilityStore(dir);
    const installation = new InstallationCapabilityStore(dir, () => ({ kind: "unavailable", reason: "no vault" }));
    const result = migrateCapabilitiesStores({
      dataDir: dir,
      bots,
      installation,
      botIds: () => [],
      personIds: () => [],
    });
    expect(result.imported.filter((id) => id.startsWith("installation:"))).toEqual([]);
    expect(existsSync(join(dir, "marketplaces", "state.json"))).toBe(true);
  });
});
