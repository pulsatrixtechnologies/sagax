import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteLibrarySkill, installLibrarySkill, listLibrarySkills, loadBundledSkills, loadUserSkills, mergeSkills, parseSkillManifest, readLibrarySkillFile, readSkillLibraryIndex, renderSkillInstructions, selectBundledSkills, skillsLibraryRoot, updateLibrarySkill, type BundledSkill } from "./skill-library.ts";
import { InstallationCapabilityStore } from "./installation-capability-store.ts";
import { makeInstallationCapabilityBridge, setInstallationCapabilityBridge } from "./installation-capability-bridge.ts";

const instructionsFor = (text: string, capabilities: string[], skills: BundledSkill[], options?: { includeRoot?: boolean }) =>
  renderSkillInstructions(selectBundledSkills(text, capabilities, skills), options);

const phone: BundledSkill = {
  directory: "/skills/phone-harness",
  instructions: "---\nname: phone-harness\ndescription: test\n---\nUse phone tools.",
  manifest: {
    id: "phone-harness",
    name: "Phone Harness",
    version: "0.1.0",
    description: "Control a phone",
    defaultEnabled: true,
    triggerTerms: ["android", "phone"],
    requiredCapabilities: ["phoneMcp"],
  },
};

describe("bundled skill library", () => {
  it("selects a skill only when both its trigger and capability are present", () => {
    const rendered = instructionsFor("Open Uber on my Android", ["phoneMcp"], [phone]);
    expect(rendered).toContain("Use phone tools");
    expect(rendered).not.toContain('root="/skills/phone-harness"');
    expect(instructionsFor("Open Uber on my Android", ["phoneMcp"], [phone], { includeRoot: true }))
      .toContain('root="/skills/phone-harness"');
    expect(instructionsFor("Open Uber on my Android", [], [phone])).toBe("");
    expect(instructionsFor("Write a poem", ["phoneMcp"], [phone])).toBe("");
  });

  it("requires the manifest id to match its isolated folder", () => {
    expect(() => parseSkillManifest({
      ...phone.manifest,
      id: "other-skill",
    }, "/skills/phone-harness")).toThrow(/invalid id/);
  });

  it("loads a user skill without letting a broken sibling disable it", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-skills-"));
    const valid = join(root, "file-expense");
    mkdirSync(valid);
    writeFileSync(join(valid, "manifest.json"), JSON.stringify({
      id: "file-expense", name: "File expense", version: "1.0.0", description: "File expenses",
      defaultEnabled: true, triggerTerms: ["expense"], requiredCapabilities: [],
    }));
    writeFileSync(join(valid, "SKILL.md"), "---\nname: file-expense\ndescription: File expenses\n---\nDo it safely.\n");
    const broken = join(root, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "manifest.json"), "not json");
    writeFileSync(join(broken, "SKILL.md"), "broken");

    expect(loadUserSkills(root).map((skill) => skill.manifest.id)).toEqual(["file-expense"]);
  });

  it("does not let a user skill shadow a bundled skill id", () => {
    expect(mergeSkills([phone], [{ ...phone, instructions: "user replacement" }])).toEqual([phone]);
  });

  it("treats a non-directory user skill root as empty", () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-skills-root-"));
    const file = join(root, "not-a-directory");
    writeFileSync(file, "nope");
    expect(loadUserSkills(file)).toEqual([]);
  });
});

describe("bundled verification skill", () => {
  const skills = loadBundledSkills(join(process.cwd(), "skills"));
  const instructions = skills.find((skill) => skill.manifest.id === "create-verification-skill")?.instructions ?? "";

  it("ships one reviewed authoring adapter", () => {
    const ids = skills.map((skill) => skill.manifest.id);
    expect(ids).toContain("create-verification-skill");
    expect(ids).not.toContain("maintain-verification-skill");
    expect(instructions).toContain("skill_manage");
    expect(instructions).not.toContain("~/.sagax");
    expect(instructions).not.toContain("propose_routine");
  });

  it("requires skill authoring and an explicit creation request", () => {
    for (const text of [
      "/create-verification-skill for my notes app",
      "can you make a verification skill so you can prove changes work",
    ]) {
      expect(selectBundledSkills(text, [], skills)).toEqual([]);
      expect(selectBundledSkills(text, ["skillAuthoring"], skills).map((skill) => skill.manifest.id))
        .toEqual(["create-verification-skill"]);
    }
  });

  it("does not mount for generic verification or maintenance phrasing", () => {
    for (const text of [
      "please verify the numbers in this invoice",
      "maintain the verification skill for atlas",
      "the verification skill is stale",
      "make a control cli",
      "create a feature map for my app",
    ]) {
      expect(selectBundledSkills(text, ["skillAuthoring"], skills)).toEqual([]);
    }
  });
});

describe("bundled skill triggers", () => {
  const adb: BundledSkill = { ...phone, manifest: { ...phone.manifest, triggerTerms: ["adb", "usb phone", "/create-verification-skill"] } };
  it("match a trigger term as a whole word, never inside an id", () => {
    expect(selectBundledSkills("assignment 0cb14dd1-98e6-4adb-8b34-f8bc30a83b3f", ["phoneMcp"], [adb])).toEqual([]);
    expect(selectBundledSkills("Use adb to list devices", ["phoneMcp"], [adb])).toEqual([adb]);
    expect(selectBundledSkills("(ADB) logs", ["phoneMcp"], [adb])).toEqual([adb]);
    expect(selectBundledSkills("my usb phone, please", ["phoneMcp"], [adb])).toEqual([adb]);
    expect(selectBundledSkills("run /create-verification-skill now", ["phoneMcp"], [adb])).toEqual([adb]);
  });
});

// Lot 5 (2026-11-01): the installation store holds the organization's
// library index only. A person's Me library passes its own root
// (principals/<pid>/capability-skills) and must never read or write the
// installation index: on the 0.8.24 branch Bob's packing-list collided with
// Alice's (422 "already in the library") and the room prompt leaked hers.
describe("library roots after the lot 5 installation store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    setInstallationCapabilityBridge(null);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const skill = (description: string, body: string) => `---\nname: packing-list\ndescription: ${description}\n---\n${body}\n`;
  const entry = (name: string, sha256: string) => ({ name, description: "Audit an order", source: "upload", sha256, importedAt: "2026-11-01T00:00:00.000Z", reviewState: "approved", warnings: [], skippedFiles: [] });

  function bridgeOn() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-lib-roots-"));
    dirs.push(dir);
    const store = new InstallationCapabilityStore(dir, () => ({ kind: "key", key: Buffer.alloc(32, 5) }));
    store.markMigrated("skills-library-index");
    setInstallationCapabilityBridge(makeInstallationCapabilityBridge(store));
    const root = (person: string) => {
      const path = join(dir, "principals", person, "capability-skills");
      mkdirSync(path, { recursive: true, mode: 0o700 });
      return path;
    };
    return { dir, store, alice: root("pr_alice"), bob: root("pr_bob") };
  }

  it("keeps two persons' Me libraries apart from each other and from the installation index", () => {
    const { store, alice, bob } = bridgeOn();
    const mine = installLibrarySkill({ name: "packing-list", instructions: skill("Alice packing", "ALICE_ONLY"), source: "local-import", reviewState: "approved", root: alice });
    expect(mine).not.toHaveProperty("error");
    const his = installLibrarySkill({ name: "packing-list", instructions: skill("Bob packing", "BOB_ONLY"), source: "local-import", reviewState: "approved", root: bob });
    expect(his).not.toHaveProperty("error");
    expect(listLibrarySkills(alice).map((row) => [row.name, row.description, row.enabled])).toEqual([["packing-list", "Alice packing", true]]);
    expect(listLibrarySkills(bob).map((row) => [row.name, row.description, row.enabled])).toEqual([["packing-list", "Bob packing", true]]);
    expect(readLibrarySkillFile("packing-list", alice)).toContain("ALICE_ONLY");
    expect(readLibrarySkillFile("packing-list", bob)).toContain("BOB_ONLY");
    // each person's index lives under that person; the installation document stays empty
    expect(existsSync(join(alice, "index.json"))).toBe(true);
    expect(existsSync(join(bob, "index.json"))).toBe(true);
    expect(store.read().skillsLibrary).toEqual({});
    expect(readSkillLibraryIndex(skillsLibraryRoot())).toEqual({});
    // Bob's edit and removal never reach Alice's library
    const edited = updateLibrarySkill("packing-list", { text: skill("Bob packing v2", "BOB_ONLY_2"), warnings: [] }, bob);
    expect(edited).not.toHaveProperty("error");
    expect(deleteLibrarySkill("packing-list", bob)).toMatchObject({ removed: true });
    expect(listLibrarySkills(bob)).toEqual([]);
    expect(listLibrarySkills(alice).map((row) => [row.description, row.enabled])).toEqual([["Alice packing", true]]);
    expect(readLibrarySkillFile("packing-list", alice)).toContain("ALICE_ONLY");
    expect(readFileSync(join(alice, "index.json"), "utf8")).not.toContain("Bob");
  });

  it("reads the organization's library from the installation store, and only there", () => {
    const { store, alice } = bridgeOn();
    const document = store.read();
    document.skillsLibrary = { "order-audit": entry("order-audit", "a".repeat(64)) };
    store.write(document);
    expect(Object.keys(readSkillLibraryIndex(skillsLibraryRoot()))).toEqual(["order-audit"]);
    expect(Object.keys(readSkillLibraryIndex(alice))).toEqual([]);
    expect(listLibrarySkills(alice)).toEqual([]);
  });
});
