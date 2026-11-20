// D-20261119-087 (#5105): a product skill names its product and the APIs it
// needs; a bot is served the API ids api_list lists for it, less the ones
// turned off for it; a platform skill always stays.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readSkillMetadata } from "../../shared/skill-md.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { botServedProducts, hiddenProductSkills, installedPluginDir, productSkillServed, servedProductIds, skillProductOf, withServedProductSkills } from "./product-skills.ts";

const root = mkdtempSync(join(tmpdir(), "sagax-product-skills-"));
afterAll(() => removeTempDir(root));

const skill = (name: string, metadata = "") => `---\nname: ${name}\ndescription: "The ${name} skill."\n${metadata}---\n# ${name}\n`;

describe("readSkillMetadata", () => {
  it("reads the indented keys under metadata, a block list joined, and nothing else", () => {
    const raw = "---\nname: a\nmetadata:\n  product: Acme\n  formerly: acme:a\n  apis:\n    - acme_desk\n    - 'acme_time'\n  deeper:\n    key: x\ndescription: d\n---\nbody";
    expect(readSkillMetadata(raw)).toEqual({ product: "Acme", formerly: "acme:a", apis: "acme_desk acme_time", deeper: "" });
    expect(readSkillMetadata("---\nname: a\ndescription: d\n---\n")).toEqual({});
    expect(readSkillMetadata("no frontmatter")).toEqual({});
  });
});

describe("skillProductOf", () => {
  it("is null for a platform skill and lists the APIs of a product skill", () => {
    expect(skillProductOf(skill("rules"))).toBeNull();
    expect(skillProductOf(skill("acme-desk", "metadata:\n  product: acme\n  apis: acme_desk acme_schedule\n"))).toEqual({ product: "acme", apis: ["acme_desk", "acme_schedule"] });
    expect(skillProductOf(skill("acme-time", "metadata:\n  product: Acme\n  apis: \"[ACME_time, acme_time]\"\n"))).toEqual({ product: "acme", apis: ["acme_time"] });
    expect(skillProductOf(skill("acme-x", "metadata:\n  product: acme\n"))).toEqual({ product: "acme", apis: [] });
  });
});

describe("servedProductIds", () => {
  const listed = { ids: ["acme_desk", "Acme_Time", "nimbus_backup"], groups: new Map([["acme", ["acme_desk", "acme_time"]], ["empty", ["gone"]]]) };
  it("serves every listed id and every family with a listed member", () => {
    expect([...servedProductIds(listed, new Set())].sort()).toEqual(["acme", "acme_desk", "acme_time", "nimbus_backup"]);
  });
  it("leaves out the products turned off for the bot, and a family whose members are all off", () => {
    expect([...servedProductIds(listed, new Set(["acme_time"]))].sort()).toEqual(["acme", "acme_desk", "nimbus_backup"]);
    expect([...servedProductIds(listed, new Set(["acme_time", "acme_desk"]))].sort()).toEqual(["nimbus_backup"]);
    expect([...botServedProducts(listed, { products: { nimbus_backup: false, acme_desk: true } })!].sort()).toEqual(["acme", "acme_desk", "acme_time"]);
    expect(botServedProducts(undefined, { products: {} })).toBeNull();
  });
});

describe("productSkillServed", () => {
  it("needs every API the skill names, or its product id when it names none", () => {
    const served = new Set(["acme_desk", "acme"]);
    expect(productSkillServed({ product: "acme", apis: ["acme_desk"] }, served)).toBe(true);
    expect(productSkillServed({ product: "acme", apis: ["acme_desk", "acme_schedule"] }, served)).toBe(false);
    expect(productSkillServed({ product: "acme", apis: [] }, served)).toBe(true);
    expect(productSkillServed({ product: "nimbus", apis: [] }, served)).toBe(false);
  });
});

describe("withServedProductSkills", () => {
  const plugin = join(root, "installed", "ops");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "ops" }));
  for (const [name, metadata] of [["rules", ""], ["acme-desk", "metadata:\n  product: acme\n  apis: acme_desk\n"], ["nimbus-restore", "metadata:\n  product: nimbus\n  apis: nimbus_backup\n"]] as const) {
    mkdirSync(join(plugin, "skills", name), { recursive: true });
    writeFileSync(join(plugin, "skills", name, "SKILL.md"), skill(name, metadata));
  }
  mkdirSync(join(plugin, "acme", "scripts"), { recursive: true });
  writeFileSync(join(plugin, "acme", "scripts", "run.py"), "print('ok')\n");
  const copies = join(root, "copies");

  it("hides the skill folders of the products the bot is not served", () => {
    expect(hiddenProductSkills(plugin, new Set(["acme_desk"]))).toEqual(["nimbus-restore"]);
    expect(hiddenProductSkills(plugin, new Set())).toEqual(["acme-desk", "nimbus-restore"]);
    expect(hiddenProductSkills(join(root, "none"), new Set())).toEqual([]);
  });

  it("gives a copy without them, naming the installed folder, and never changes the installed one", () => {
    const [folder] = withServedProductSkills([{ name: "ops", dir: plugin, scope: "organization" }], new Set(["acme_desk"]), copies);
    expect(folder!.dir).not.toBe(plugin);
    expect(folder!.installed).toBe(plugin);
    expect(installedPluginDir(folder!)).toBe(plugin);
    expect(readdirSync(join(folder!.dir, "skills")).sort()).toEqual(["acme-desk", "rules"]);
    expect(existsSync(join(folder!.dir, "acme", "scripts", "run.py"))).toBe(true);
    expect(readdirSync(join(plugin, "skills")).sort()).toEqual(["acme-desk", "nimbus-restore", "rules"]);
  });

  it("keeps the installed folder when every product is served or what is served is unknown", () => {
    const folders = [{ name: "ops", dir: plugin, scope: "organization" }];
    expect(withServedProductSkills(folders, new Set(["acme_desk", "nimbus_backup"]), copies)[0]).toBe(folders[0]);
    expect(withServedProductSkills(folders, null, copies)[0]).toBe(folders[0]);
    expect(installedPluginDir(folders[0]!)).toBe(plugin);
  });
});
