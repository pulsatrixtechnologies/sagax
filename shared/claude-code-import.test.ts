import { describe, expect, it } from "vitest";

import {
  claudeCodeRelativePath, claudeCodeSecretPath, claudeCodeToPackage, claudeCodeWantedPath, frontmatter, isHermesHome,
} from "./claude-code-import.ts";
import { GrokImportError } from "./grok-import.ts";
import { parsePackageDocument } from "./package-format.ts";

const project = [
  { path: "CLAUDE.md", text: "@AGENTS.md\n\nAlways answer in French." },
  { path: "AGENTS.md", text: "# Project notes\n\nRun `pnpm test` before you push." },
  { path: "CLAUDE.local.md", text: "My sandbox is on port 5173." },
  { path: ".claude/skills/release-notes/SKILL.md", text: "---\nname: release-notes\ndescription: >\n  Write the release notes\n  from merged pull requests.\n---\n\n# Release notes\n\nList every merged PR." },
  { path: ".claude/commands/review.md", text: "---\ndescription: Review the current diff\n---\n\nReview the diff for bugs." },
  { path: ".claude/agents/test-runner.md", text: "---\nname: test-runner\ndescription: Runs the tests and fixes failures\ntools: Bash, Read\nmodel: opus\nskills: release-notes, missing-skill\n---\n\nYou run the tests. Fix what fails." },
  { path: ".mcp.json", text: JSON.stringify({ mcpServers: {
    tracker: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwx" } },
    local: { command: "npx", args: ["-y", "some-server", "--token", "abc123"], env: { API_TOKEN: "abc123" } },
    templated: { type: "http", url: "https://${HOST}/mcp" },
  } }) },
  { path: "src/index.ts", text: "export const unrelated = true;" },
];

describe("claudeCodeToPackage", () => {
  const { document, leftOut } = claudeCodeToPackage(project, { folderName: "acme-app", timeZone: "America/New_York" });
  const pkg = document.package;

  it("makes one bot from CLAUDE.md, with its imports inlined and the local notes appended", () => {
    const main = pkg.agents[0]!;
    expect(main.name).toBe("acme-app");
    expect(main.soul).toContain("Run `pnpm test` before you push.");
    expect(main.soul).toContain("Always answer in French.");
    expect(main.soul).not.toContain("@AGENTS.md");
    expect(main.soul).toContain("## Personal notes (CLAUDE.local.md)");
    // AGENTS.md was imported by CLAUDE.md: it is not repeated.
    expect(main.soul!.match(/pnpm test/g)).toHaveLength(1);
  });

  it("brings skills and commands as skills, each a valid SKILL.md", () => {
    const names = pkg.skills!.entries.map((entry) => entry.name).sort();
    expect(names).toEqual(["release-notes", "review"]);
    const notes = pkg.skills!.entries.find((entry) => entry.name === "release-notes")!;
    expect(notes.description).toBe("Write the release notes from merged pull requests.");
    expect(notes.instructions.startsWith("---\nname: release-notes\n")).toBe(true);
    expect(pkg.agents[0]!.skills?.sort()).toEqual(["release-notes", "review"]);
  });

  it("makes each subagent its own bot, without its tools or model", () => {
    const sub = pkg.agents.find((agent) => agent.name === "test-runner")!;
    expect(sub.soul).toBe("You run the tests. Fix what fails.");
    expect(sub.description).toBe("Runs the tests and fixes failures");
    expect(sub.skills).toEqual(["release-notes"]);
    expect(JSON.stringify(sub)).not.toMatch(/opus|Bash/);
  });

  it("keeps an http MCP server as a slot with header names only, and lists command servers", () => {
    expect(pkg.connections).toHaveLength(1);
    expect(pkg.connections![0]!.mcp).toEqual({ transport: "http", url: "https://mcp.example.com/mcp", valueNames: ["Authorization"] });
    expect(pkg.agents[0]!.connections).toEqual([pkg.connections![0]!.key]);
    const text = JSON.stringify(document);
    expect(text).not.toContain("sk-live-");
    expect(text).not.toContain("abc123");
    const local = leftOut.find((item) => item.name.includes("local"))!;
    expect(local.reason).toContain("runs a program");
    expect(local.original).toContain("API_TOKEN");
    expect(local.original).not.toContain("abc123");
    expect(leftOut.some((item) => item.name.includes("templated"))).toBe(true);
  });

  it("arrives inert: no routine, no approval, no model, no publisher", () => {
    expect(pkg.routines ?? []).toEqual([]);
    for (const agent of pkg.agents) expect(agent.approval).toBeUndefined();
    expect(pkg.publisher).toBeUndefined();
    expect(() => parsePackageDocument(document, { trust: "file" })).not.toThrow();
  });

  it("lists secret files by name only", () => {
    const result = claudeCodeToPackage(project, { folderName: "acme-app", skippedSecrets: [".env", ".claude/settings.local.json"] });
    expect(result.leftOut.filter((item) => item.kind === "secrets").map((item) => item.name)).toEqual([".env", ".claude/settings.local.json"]);
  });

  it("reads a picked ~/.claude folder as the project's .claude", () => {
    const result = claudeCodeToPackage([
      { path: "CLAUDE.md", text: "Be brief." },
      { path: "skills/notes/SKILL.md", text: "---\nname: notes\ndescription: Take notes\n---\n\nWrite notes." },
    ], { folderName: ".claude" });
    expect(result.document.package.agents[0]!.name).toBe("Claude Code");
    expect(result.document.package.skills!.entries.map((entry) => entry.name)).toEqual(["notes"]);
  });

  it("refuses a folder with nothing to import", () => {
    expect(() => claudeCodeToPackage([{ path: "README.md", text: "hi" }], { folderName: "x" })).toThrow(GrokImportError);
  });
});

describe("which files are read", () => {
  it("reads only the agent files and never a secret", () => {
    expect(claudeCodeWantedPath("CLAUDE.md")).toBe(true);
    expect(claudeCodeWantedPath(".claude/skills/a/SKILL.md")).toBe(true);
    expect(claudeCodeWantedPath(".claude/skills/a/helper.py")).toBe(false);
    expect(claudeCodeWantedPath(".claude/agents/nested/x.md")).toBe(true);
    expect(claudeCodeWantedPath("src/CLAUDE.md")).toBe(false);
    for (const secret of [
      ".env", ".env.local", ".claude/settings.local.json", "certs/server.pem", ".claude/.credentials.json", "id_ed25519", "auth.json",
      // Lot C / upstream d2caaef1a: data files named after credentials
      "token.json", "session.json", "password.txt", "cookies.txt", "service-account.json", "api_key.txt", "storage_state.json",
      ".claude/skills/x/secrets/token.json",
    ]) {
      expect(claudeCodeSecretPath(secret), secret).toBe(true);
      expect(claudeCodeWantedPath(secret), secret).toBe(false);
    }
    // Instructions may be named after a credential; they stay readable.
    expect(claudeCodeSecretPath("references/credentials.md")).toBe(false);
    expect(claudeCodeSecretPath("CLAUDE.md")).toBe(false);
  });

  it("leaves out a SKILL.md that embeds a provider key (holdsCredential)", () => {
    const key = `sk-ant-api03-${"0123456789abcdefABCD"}`;
    const { document, leftOut } = claudeCodeToPackage([
      { path: "CLAUDE.md", text: "Help with tickets." },
      { path: ".claude/skills/leak/SKILL.md", text: `---\nname: leak\ndescription: Bad\n---\n\nUse ${key} always.` },
      { path: ".claude/skills/ok/SKILL.md", text: "---\nname: ok\ndescription: Fine\n---\n\nBe careful." },
    ], { folderName: "acme" });
    expect(document.package.skills?.entries.map((entry) => entry.name)).toEqual(["ok"]);
    expect(leftOut.some((item) => item.reasonKey === "leftOut.reason.secretFile" && String(item.name).includes("leak"))).toBe(true);
  });

  it("normalises paths", () => {
    expect(claudeCodeRelativePath("./CLAUDE.md")).toBe("CLAUDE.md");
    expect(claudeCodeRelativePath(".claude\\agents\\a.md")).toBe(".claude/agents/a.md");
    expect(claudeCodeRelativePath("agents/a.md", ".claude")).toBe(".claude/agents/a.md");
  });

  it("parses folded frontmatter", () => {
    expect(frontmatter("---\nname: a\ndescription: |\n  one\n  two\n---\nbody").fields).toEqual({ name: "a", description: "one two" });
    expect(frontmatter("no frontmatter").body).toBe("no frontmatter");
  });
});

describe("left out, in the person's language", () => {
  it("names a catalog key for every line, whose English is the line itself", async () => {
    const en = (await import("../src/locales/en.json")).default as Record<string, string>;
    const fill = (template: string, params: Record<string, string | number> = {}) =>
      template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
    const { leftOut } = claudeCodeToPackage(project, { folderName: "acme-app", skippedSecrets: [".env"] });
    expect(leftOut.length).toBeGreaterThan(2);
    for (const item of leftOut) {
      expect(en[item.reasonKey!], item.reason).toBeDefined();
      expect(fill(en[item.reasonKey!]!, item.params)).toBe(item.reason);
      if (item.nameKey) expect(fill(en[item.nameKey]!, item.params)).toBe(item.name);
    }
  });
});

const hermes = [
  { path: "SOUL.md", text: "<!-- template comment -->\nYou are Atlas, a terse ops assistant." },
  { path: "memories/MEMORY.md", text: "Prod deploys go through the release branch.\n§\nThe NAS is at 10.0.0.5\nand backs up nightly.\n§\n" },
  { path: "memories/USER.md", text: "Prefers answers in French.\n§\nWorks Eastern time." },
  { path: "skills/devops/release-check/SKILL.md", text: "---\nname: release-check\ndescription: Check a release before it ships\nmetadata:\n  hermes:\n    tags: [ops]\n---\n\n# Release check\n\nRun the smoke tests." },
  { path: "skills/.hub/cache/SKILL.md", text: "---\nname: cached\n---\n\nHub cache." },
  { path: "cron/jobs.json", text: JSON.stringify({ jobs: [
    { id: "a1", name: "Morning brief", prompt: "Summarise the night.", skills: ["release-check"], schedule: { kind: "cron", expr: "0 8 * * 1-5", display: "0 8 * * 1-5" }, enabled: true },
    { id: "a2", name: "Every 30m", prompt: "Check the queue.", schedule: { kind: "interval", minutes: 30, display: "every 30m" } },
    { id: "a3", name: "Every 45m", prompt: "Odd interval.", schedule: { kind: "interval", minutes: 45, display: "every 45m" } },
    { id: "a4", name: "Once", prompt: "One shot.", schedule: { kind: "once", run_at: "2026-12-01T09:00:00Z", display: "once" } },
  ] }) },
  { path: "config.yaml", text: "model:\n  default: some-model\nmcp_servers:\n  tracker:\n    url: https://mcp.example.com/mcp\n    headers:\n      Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwx\n  github:\n    command: npx\n    args: [\"-y\", \"@modelcontextprotocol/server-github\"]\n    env:\n      GITHUB_TOKEN: ghp_x\n" },
  { path: "profiles/coder/SOUL.md", text: "You write code." },
  { path: "profiles/coder/skills/devops/release-check/SKILL.md", text: "---\nname: release-check\ndescription: Check a release before it ships\nmetadata:\n  hermes:\n    tags: [ops]\n---\n\n# Release check\n\nRun the smoke tests." },
  { path: "profiles/coder/skills/dev/review/SKILL.md", text: "---\nname: review\ndescription: Review a diff\n---\n\nReview the diff." },
  { path: "profiles/coder/config.yaml", text: "mcp_servers:\n  tracker:\n    url: https://mcp.example.com/mcp\n" },
  { path: "profiles/empty/config.yaml", text: "model:\n  default: x\n" },
  { path: "sessions/s1.json", text: "{}" },
];

describe("Hermes home", () => {
  const { document, leftOut } = claudeCodeToPackage(hermes, { folderName: ".hermes", skippedSecrets: [".env", "auth.json"], timeZone: "America/New_York" });
  const pkg = document.package;
  const main = pkg.agents[0]!;

  it("is told apart from a Claude Code project", () => {
    expect(isHermesHome(hermes.map((file) => file.path))).toBe(true);
    expect(isHermesHome(["CLAUDE.md", "SOUL.md"])).toBe(false);
    expect(isHermesHome(["AGENTS.md"], "my-app")).toBe(false);
    expect(isHermesHome(["config.yaml"], ".hermes")).toBe(true);
    expect(claudeCodeRelativePath(".hermes/SOUL.md")).toBe("SOUL.md");
    expect(claudeCodeWantedPath("memories/MEMORY.md")).toBe(true);
    expect(claudeCodeWantedPath("skills/devops/release-check/SKILL.md")).toBe(true);
    expect(claudeCodeWantedPath("skills/.hub/cache/SKILL.md")).toBe(false);
    expect(claudeCodeWantedPath("state.db")).toBe(false);
  });

  it("makes the main bot from SOUL.md, without template comments", () => {
    expect(main.name).toBe("Hermes");
    expect(main.title).toBe("Hermes agent");
    expect(main.soul).toBe("You are Atlas, a terse ops assistant.");
  });

  it("seeds its memory from MEMORY.md and USER.md, one bullet per entry", () => {
    const notes = main.seed!.memory["MEMORY.md"]!;
    expect(notes).toContain("## What the agent noted (MEMORY.md)");
    expect(notes).toContain("- Prod deploys go through the release branch.");
    expect(notes).toContain("- The NAS is at 10.0.0.5\n  and backs up nightly.");
    expect(notes).toContain("## About you (USER.md)\n\n- Prefers answers in French.\n- Works Eastern time.");
  });

  it("brings skills off, shared between profiles, never the hub cache", () => {
    expect(pkg.skills!.entries.map((entry) => entry.name).sort()).toEqual(["release-check", "review"]);
    expect(main.skills).toEqual(["release-check"]);
    expect(pkg.agents[1]!.skills!.sort()).toEqual(["release-check", "review"]);
  });

  it("turns cron jobs into paused routines and lists what cannot run on a clock", () => {
    const routines = pkg.routines!;
    expect(routines.map((routine) => routine.name)).toEqual(["Morning brief", "Every 30m"]);
    expect(routines.every((routine) => routine.enabledAfterInstall === false && routine.agent === main.key)).toBe(true);
    expect(routines[0]!.schedule).toMatchObject({ type: "cron", expression: "0 8 * * 1-5" });
    expect(routines[0]!.prompt).toBe("Use the skill release-check.\n\nSummarise the night.");
    expect(routines[1]!.schedule).toMatchObject({ type: "cron", expression: "*/30 * * * *" });
    expect(leftOut.find((item) => item.name === "Routine “Every 45m”")?.reasonKey).toBe("leftOut.reason.intervalRoutine");
    expect(leftOut.find((item) => item.name === "Routine “Once”")?.reasonKey).toBe("leftOut.reason.onceRoutine");
  });

  it("brings http MCP servers as one shared slot, without header values; command servers are listed", () => {
    expect(pkg.connections!.map((connection) => connection.key)).toEqual(["tracker"]);
    expect(JSON.stringify(document)).not.toContain("sk-live");
    expect(JSON.stringify(document)).not.toContain("ghp_x");
    expect(pkg.connections![0]!.mcp).toMatchObject({ url: "https://mcp.example.com/mcp", valueNames: ["Authorization"] });
    expect(main.connections).toEqual(["tracker"]);
    expect(pkg.agents[1]!.connections).toEqual(["tracker"]);
    expect(leftOut.find((item) => item.name === "App “github”")?.reasonKey).toBe("leftOut.reason.runsProgram");
  });

  it("makes one more bot per profile that has content", () => {
    expect(pkg.agents.map((agent) => agent.name)).toEqual(["Hermes", "coder"]);
    expect(pkg.agents[1]!.title).toBe("Hermes profile");
    expect(pkg.agents[1]!.soul).toBe("You write code.");
    expect(new Set(pkg.agents.map((agent) => agent.key)).size).toBe(2);
    expect(leftOut.filter((item) => item.reasonKey === "leftOut.reason.secretFile").map((item) => item.name)).toEqual([".env", "auth.json"]);
    expect(() => parsePackageDocument(document, { trust: "file" })).not.toThrow();
  });

  it("reads a single picked profile folder as the main bot", () => {
    const profile = claudeCodeToPackage([{ path: "SOUL.md", text: "You write code." }], { folderName: "coder" });
    expect(profile.document.package.agents[0]!.name).toBe("coder");
  });

  it("lists invalid files and refuses a home with nothing to bring", () => {
    const broken = claudeCodeToPackage([
      { path: "SOUL.md", text: "Hi." },
      { path: "config.yaml", text: "mcp_servers: [\n" },
      { path: "cron/jobs.json", text: "{" },
    ], { folderName: ".hermes" });
    expect(broken.leftOut.map((item) => item.reasonKey)).toEqual(expect.arrayContaining(["leftOut.reason.invalidYaml", "leftOut.reason.invalidJson"]));
    expect(() => claudeCodeToPackage([{ path: "config.yaml", text: "model: x\n" }], { folderName: ".hermes" })).toThrow(GrokImportError);
  });

  it("names a catalog key for every left-out line", async () => {
    const en = (await import("../src/locales/en.json")).default as Record<string, string>;
    const fill = (template: string, params: Record<string, string | number> = {}) =>
      template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
    for (const item of leftOut) {
      expect(en[item.reasonKey!], item.reason).toBeDefined();
      expect(fill(en[item.reasonKey!]!, item.params)).toBe(item.reason);
      if (item.nameKey) expect(fill(en[item.nameKey]!, item.params)).toBe(item.name);
    }
  });
});
