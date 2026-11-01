// Capabilities lot 4: the organization's declarations installed once here,
// offered off by default per person, imposed on, one Flow identity.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OrgCapabilities, validSkillPath } from "./org-capabilities.ts";
import type { OrgCapabilityDeclaration } from "./perspicax-link.ts";

const skill = (patch: Partial<OrgCapabilityDeclaration> = {}): OrgCapabilityDeclaration => ({
  id: "cap-skill", mount_name: "packing-rules", form: "skill", name: "Packing rules", description: "", source: { kind: "manual" },
  mode: "offered", enabled: true,
  configuration: { type: "skill", files: { "SKILL.md": "---\nname: packing-rules\ndescription: Fixture\n---\nCheck the label.\n", "reference/sizes.md": "Small, large." } },
  ...patch,
});
const plugin = (patch: Partial<OrgCapabilityDeclaration> = {}): OrgCapabilityDeclaration => ({
  id: "cap-plugin", mount_name: "shipping", form: "plugin", name: "Shipping", description: "",
  source: { kind: "marketplace", url: "https://example.com/catalog.git", plugin: "shipping", version: "1.0.0" },
  mode: "imposed", enabled: true, configuration: { type: "plugin", values: { region: "north" } },
  ...patch,
});
const mcp = (patch: Partial<OrgCapabilityDeclaration> = {}): OrgCapabilityDeclaration => ({
  id: "cap-mcp", mount_name: "notes", form: "mcp", name: "Notes", description: "", source: { kind: "manual" },
  mode: "offered", enabled: true, configuration: { type: "stdio", command: "notes-mcp", args: ["--fixture"], env: { MODE: "fixture" } },
  ...patch,
});

function pluginSource(root: string): string {
  const dir = join(root, "source-shipping");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(dir, "skills", "ship"), { recursive: true });
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "shipping", version: "1.0.0", userConfig: { region: { type: "string", title: "Region" } } }));
  writeFileSync(join(dir, "skills", "ship", "SKILL.md"), "---\nname: ship\ndescription: Ship\n---\nShip to ${user_config.region}.\n");
  writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { tracker: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/tracker.js"] } } }));
  return dir;
}

function harness(declarations: OrgCapabilityDeclaration[] | undefined, options: { members?: string[]; choices?: Record<string, Record<string, boolean>>; flow?: string[] } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "org-capabilities-"));
  const source = pluginSource(dataDir);
  const fetched: string[] = [];
  let current = declarations;
  const choices = options.choices ?? {};
  const org = new OrgCapabilities({
    dataDir,
    declarations: () => current,
    flowNames: () => options.flow ?? [],
    isMember: (principal) => (options.members ?? ["p1"]).includes(principal),
    choices: (principal) => choices[principal] ?? {},
    fetchPlugin: async (input) => { fetched.push(`${input.url}#${input.plugin}@${input.version ?? ""}`); return source; },
    sandboxRoot: "/workspace/sagax-plugins",
    log: () => {},
  });
  return { org, dataDir, fetched, choices, set: (next: OrgCapabilityDeclaration[] | undefined) => { current = next; } };
}

describe("OrgCapabilities", () => {
  it("leaves everything as it is when Perspicax sends no declarations (an older Perspicax)", async () => {
    const h = harness(undefined);
    expect(await h.org.sync("test")).toEqual([]);
    expect(h.org.declared()).toBe(false);
    expect(h.org.mountsFor("p1")).toEqual([]);
  });

  it("materializes a skill once as one linked folder and installs a plugin once, whole, without hooks", async () => {
    const h = harness([skill({ mode: "imposed" }), plugin()]);
    await h.org.sync("directory");
    const skillDir = h.org.loadDir("packing-rules");
    expect(readFileSync(join(skillDir, "skills", "packing-rules", "SKILL.md"), "utf8")).toContain("Check the label.");
    expect(readFileSync(join(skillDir, "skills", "packing-rules", "reference", "sizes.md"), "utf8")).toBe("Small, large.");
    const pluginDir = h.org.loadDir("shipping");
    expect(existsSync(join(pluginDir, "hooks"))).toBe(false);
    expect(existsSync(join(pluginDir, ".mcp.json"))).toBe(false);
    // the declared values reach the plugin's files
    expect(readFileSync(join(pluginDir, "skills", "ship", "SKILL.md"), "utf8")).toContain("Ship to north.");
    expect(h.org.views().map((view) => [view.mount, view.state])).toEqual([["packing-rules", "installed"], ["shipping", "installed"]]);
    // idempotent: an unchanged declaration is not fetched again
    await h.org.sync("again");
    expect(h.fetched).toEqual(["https://example.com/catalog.git#shipping@1.0.0"]);
    const mounts = h.org.mountsFor("p1");
    expect(mounts.map((mount) => mount.view.mount)).toEqual(["packing-rules", "shipping"]);
    expect(mounts.find((mount) => mount.view.mount === "shipping")?.mcpServers).toEqual({ tracker: { command: "node", args: ["/workspace/sagax-plugins/shipping/tracker.js"], env: {} } });
  });

  it("takes out what is no longer declared or is switched off in Perspicax", async () => {
    const h = harness([skill({ mode: "imposed" })]);
    await h.org.sync("directory");
    expect(existsSync(h.org.loadDir("packing-rules"))).toBe(true);
    h.set([skill({ mode: "imposed", enabled: false })]);
    await h.org.sync("directory");
    expect(existsSync(h.org.loadDir("packing-rules"))).toBe(false);
    expect(h.org.views()[0]).toMatchObject({ state: "off" });
    expect(h.org.mountsFor("p1")).toEqual([]);
    h.set([]);
    await h.org.sync("directory");
    expect(h.org.views()).toEqual([]);
  });

  it("offered is off by default for each person, on in that person's own state only; imposed is on", async () => {
    const h = harness([skill(), mcp(), plugin()], { members: ["p1", "p2"], choices: { p2: { "cap-skill": true, "cap-mcp": true } } });
    await h.org.sync("directory");
    expect(h.org.mountsFor("p1").map((mount) => mount.view.mount)).toEqual(["shipping"]);
    expect(h.org.mountsFor("p2").map((mount) => mount.view.mount)).toEqual(["packing-rules", "notes", "shipping"]);
    expect(h.org.mountsFor("p2").find((mount) => mount.view.mount === "notes")?.mcpServers).toEqual({ notes: { command: "notes-mcp", args: ["--fixture"], env: { MODE: "fixture" } } });
    // not an active member: nothing, imposed included
    expect(h.org.mountsFor("p3")).toEqual([]);
    // the organization's names win over the person's own
    expect([...h.org.claimedNames("p2")].sort()).toEqual(["notes", "packing-rules", "shipping", "tracker"]);
  });

  it("never mounts a second Flow: a Flow mount name or a flow_plugins plugin stays a single identity", async () => {
    const h = harness([plugin({ id: "cap-flow", mount_name: "pulsatrix-flow-example" }), plugin({ id: "cap-alias", mount_name: "tenant-pack", source: { kind: "marketplace", url: "https://example.com/c.git", plugin: "tenant-pack" } })], { flow: ["tenant-pack"] });
    await h.org.sync("directory");
    expect(h.fetched).toEqual([]);
    expect(h.org.views().map((view) => view.state)).toEqual(["flow", "flow"]);
    expect(h.org.mountsFor("p1")).toEqual([]);
  });

  it("refuses a skill path that leaves its folder and says so", async () => {
    const h = harness([skill({ mode: "imposed", configuration: { type: "skill", files: { "SKILL.md": "x", "../escape.md": "y" } } })]);
    await h.org.sync("directory");
    expect(h.org.views()[0]).toMatchObject({ state: "failed", error: expect.stringContaining("not relative") });
    expect(validSkillPath("a/b.md")).toBe(true);
    for (const bad of ["/abs", "a/../b", "a//b", "c:\\x", ""]) expect(validSkillPath(bad), bad).toBe(false);
  });
});
