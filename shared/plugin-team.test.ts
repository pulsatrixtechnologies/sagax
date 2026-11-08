import { describe, expect, it } from "vitest";
import { pluginAgentTools, pluginTeamToPackage, PluginTeamError } from "./plugin-team.ts";

const ARCHITECT = `---
name: px-architect
description: Architect for complex problems only (Fable 5.1). One at a time, narrow brief, returns a design and a decision, not code.
model: claude-fable-5-1
tools: Read, Glob, Grep, Bash
---

You are \`px-architect\`, a role of the Pulsatrix Dev team (plugin \`pulsatrix-dev\`).

## Scope

- Repos: all four repos (read only)
`;

const TRIAGE = `---
name: px-triage
description: Sorts new issues.
model: haiku
tools: [Read, "Grep"]
---

You sort issues.
`;

const manifest = { name: "pulsatrix-dev", displayName: "Pulsatrix Dev (coding team)", description: "The coding team.", version: "0.1.0" };

describe("pluginTeamToPackage (I1)", () => {
  it("turns each agents/*.md into one bot of ONE team: name, description, model and tools come across, the body is the soul", () => {
    const built = pluginTeamToPackage({
      plugin: "pulsatrix-dev",
      manifest,
      agents: [{ file: "px-triage.md", text: TRIAGE }, { file: "px-architect.md", text: ARCHITECT }],
    });
    expect(built.agents).toEqual([
      { key: "px-architect", name: "px-architect", model: "claude-fable-5-1", description: "Architect for complex problems only (Fable 5.1). One at a time, narrow brief, returns a design and a decision, not code.", tools: ["Read", "Glob", "Grep", "Bash"] },
      { key: "px-triage", name: "px-triage", model: "haiku", description: "Sorts new issues.", tools: ["Read", "Grep"] },
    ]);
    const pkg = built.document.package;
    expect(pkg.team).toEqual({ name: "Pulsatrix Dev (coding team)" });
    expect(pkg).toMatchObject({ id: "plugin-pulsatrix-dev", release: "0.1.0", category: "Imported" });
    const architect = pkg.agents.find((agent) => agent.key === "px-architect")!;
    expect(architect.description).toBe("Architect for complex problems only (Fable 5.1). One at a time, narrow brief, returns a design and a decision, not code.");
    expect(architect.soul.startsWith("Allowed tools: Read, Glob, Grep, Bash.\n\nYou are `px-architect`")).toBe(true);
    expect(architect.soul).toContain("## Scope");
    expect(architect.title).toBe("Pulsatrix Dev (coding team)");
    expect(built.skipped).toEqual([]);
  });

  it("names the team as asked, keeps keys unique and skips an agent with no body", () => {
    const built = pluginTeamToPackage({
      plugin: "dev",
      teamName: "Pulsatrix Dev",
      agents: [
        { file: "a.md", text: "---\nname: Same\n---\nOne." },
        { file: "b.md", text: "---\nname: Same\n---\nTwo." },
        { file: "empty.md", text: "---\nname: Empty\n---\n" },
      ],
    });
    expect(built.document.package.team).toEqual({ name: "Pulsatrix Dev" });
    expect(built.agents.map((agent) => agent.key)).toEqual(["same", "same-2"]);
    expect(built.skipped).toEqual(["agent empty.md (it has no instructions)"]);
    expect(built.document.package.release).toBe("1.0.0");
  });

  it("refuses a plugin with no agents", () => {
    expect(() => pluginTeamToPackage({ plugin: "x", agents: [] })).toThrow(PluginTeamError);
  });

  it("reads tools written as a comma list or a YAML flow list", () => {
    expect(pluginAgentTools("Read, Glob,Read")).toEqual(["Read", "Glob"]);
    expect(pluginAgentTools("[Read, 'Bash']")).toEqual(["Read", "Bash"]);
    expect(pluginAgentTools(undefined)).toEqual([]);
  });
});
