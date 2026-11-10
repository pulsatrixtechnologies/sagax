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
});
