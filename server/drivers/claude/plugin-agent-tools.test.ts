import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { CLAUDE_ORG_TOOLS, claudeDisallowedTools } from "../host-tools.ts";
import { pluginDirForTurn, rewriteAgentForTurn, unofferedAgentTools } from "./plugin-agent-tools.ts";

const ROLE = "---\nname: px-triage\ndescription: Classifies work.\nmodel: sonnet\ntools: Read, Glob, Grep, Bash\n---\n\nYou are px-triage.\n";
const ORG = { offered: [...CLAUDE_ORG_TOOLS], denied: claudeDisallowedTools(undefined, true, true) };

function frontmatter(text: string): Record<string, unknown> {
  return parseYaml(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, unknown>;
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function plugin(): { dir: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "plugin-agent-tools-"));
  dirs.push(base);
  const dir = join(base, "installed", "pulsatrix-dev");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  mkdirSync(join(dir, "skills", "triage"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pulsatrix-dev" }));
  writeFileSync(join(dir, "agents", "px-triage.md"), ROLE);
  writeFileSync(join(dir, "agents", "px-web.md"), "---\nname: px-web\ndescription: Web.\ntools:\n  - WebSearch\n  - mcp__browser__open\n---\nWeb role.\n");
  writeFileSync(join(dir, "skills", "triage", "SKILL.md"), "---\nname: triage\ndescription: d\n---\nbody\n");
  return { dir, root: join(base, "copies") };
}

describe("plugin agent roles on a bot turn (#3384)", () => {
  it("counts the host tools an organization turn withholds, never MCP tools or what it offers", () => {
    expect(unofferedAgentTools(["Read", "Glob", "Grep", "Bash"], ORG)).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect(unofferedAgentTools(["WebSearch", "Task", "mcp__sagax-environment__run_command", "*"], ORG)).toEqual([]);
    expect(unofferedAgentTools(["Read", "Bash"], { offered: null, denied: [] })).toEqual([]);
    expect(unofferedAgentTools(["Bash(git:*)"], { offered: null, denied: ["Bash"] })).toEqual(["Bash(git:*)"]);
  });

  it("starts a role naming withheld tools with the turn's own tools and keeps the rest of the file", () => {
    const next = rewriteAgentForTurn(ROLE, ORG)!;
    const front = frontmatter(next);
    expect(front).toEqual({ name: "px-triage", description: "Classifies work.", model: "sonnet" });
    expect(next).toContain("You are px-triage.");
    expect(next).toContain("Read, Glob, Grep, Bash are not offered in this session");
    // a YAML list form too
    const list = rewriteAgentForTurn("---\nname: r\ndescription: d\ntools:\n  - Read\n  - Bash\nmodel: opus\n---\nbody\n", ORG)!;
    expect(frontmatter(list)).toEqual({ name: "r", description: "d", model: "opus" });
    // a list the turn offers whole stays as written
    expect(rewriteAgentForTurn("---\nname: r\ndescription: d\ntools: WebSearch, Agent\n---\nbody\n", ORG)).toBeNull();
    expect(rewriteAgentForTurn("---\nname: r\ndescription: d\n---\nbody\n", ORG)).toBeNull();
  });

  it("loads a copy with the rewritten role on an organization turn, and the installed folder otherwise", () => {
    const { dir, root } = plugin();
    expect(pluginDirForTurn(dir, { offered: null, denied: [] }, root)).toBe(dir);
    const copy = pluginDirForTurn(dir, ORG, root);
    expect(copy).not.toBe(dir);
    expect(copy.endsWith("pulsatrix-dev")).toBe(true);
    expect(frontmatter(readFileSync(join(copy, "agents", "px-triage.md"), "utf8")).tools).toBeUndefined();
    // the role whose tools the turn offers, the skills and the manifest are as installed
    expect(readFileSync(join(copy, "agents", "px-web.md"), "utf8")).toBe(readFileSync(join(dir, "agents", "px-web.md"), "utf8"));
    expect(readFileSync(join(copy, "skills", "triage", "SKILL.md"), "utf8")).toContain("body");
    expect(readFileSync(join(copy, ".claude-plugin", "plugin.json"), "utf8")).toContain("pulsatrix-dev");
    // the installed role is never changed
    expect(readFileSync(join(dir, "agents", "px-triage.md"), "utf8")).toBe(ROLE);
    // same folder, same tools: the same copy; a changed folder: a new one
    expect(pluginDirForTurn(dir, ORG, root)).toBe(copy);
    writeFileSync(join(dir, "agents", "px-triage.md"), ROLE.replace("Classifies work.", "Sorts work."));
    const next = pluginDirForTurn(dir, ORG, root);
    expect(next).not.toBe(copy);
    expect(readFileSync(join(next, "agents", "px-triage.md"), "utf8")).toContain("Sorts work.");
  });

  // #4082: the turn's commands run in the person's environment
  it("loads a copy whose skill, command and role text names the environment's paths", () => {
    const { dir, root } = plugin();
    const skill = "---\nname: triage\ndescription: d\n---\nRun `python3 ${CLAUDE_PLUGIN_ROOT}/bin/t.py --db $CLAUDE_PLUGIN_DATA/db`.\n";
    writeFileSync(join(dir, "skills", "triage", "SKILL.md"), skill);
    mkdirSync(join(dir, "commands"), { recursive: true });
    writeFileSync(join(dir, "commands", "go.md"), "Run ${CLAUDE_PLUGIN_ROOT}/bin/go.sh\n");
    writeFileSync(join(dir, "agents", "px-triage.md"), ROLE.replace("You are px-triage.", "You are px-triage. Read ${CLAUDE_PLUGIN_ROOT}/README.md."));
    const environment = { root: "/workspace/sagax-plugins/pulsatrix-dev", data: "/workspace/sagax-plugin-data/pulsatrix-dev" };
    // even a turn that keeps every built-in
    const copy = pluginDirForTurn(dir, { offered: null, denied: [] }, root, environment);
    expect(copy).not.toBe(dir);
    expect(readFileSync(join(copy, "skills", "triage", "SKILL.md"), "utf8")).toContain("Run `python3 /workspace/sagax-plugins/pulsatrix-dev/bin/t.py --db /workspace/sagax-plugin-data/pulsatrix-dev/db`.");
    expect(readFileSync(join(copy, "commands", "go.md"), "utf8")).toBe("Run /workspace/sagax-plugins/pulsatrix-dev/bin/go.sh\n");
    // an organization turn: the role starts with the turn's tools and names the paths
    const org = readFileSync(join(pluginDirForTurn(dir, ORG, root, environment), "agents", "px-triage.md"), "utf8");
    expect(frontmatter(org).tools).toBeUndefined();
    expect(org).toContain("Read /workspace/sagax-plugins/pulsatrix-dev/README.md.");
    expect(readFileSync(join(dir, "skills", "triage", "SKILL.md"), "utf8")).toBe(skill);
    // without an environment, the paths stay the engine's to fill
    expect(pluginDirForTurn(dir, { offered: null, denied: [] }, root)).toBe(dir);
  });
});
