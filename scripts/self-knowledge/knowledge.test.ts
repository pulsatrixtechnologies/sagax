// The sagax_help knowledge base (server/self-knowledge/knowledge.generated.json)
// matches the code: a tool, a permission, a Settings page, a menu entry, an
// engine or a guide that changed without `pnpm gen:self-knowledge` fails
// here. Docs, AGENTS.md and release notes may drift between builds: every
// `pnpm build:server` regenerates the whole base.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditKnowledgeText, buildKnowledge, KNOWLEDGE_FILE, serializeKnowledge } from "./build.ts";
import { GUIDES } from "./guides.ts";
import type { KnowledgeBase, KnowledgeSection } from "../../server/self-knowledge-types.ts";
import { availableTools } from "../../server/drivers/agents-catalog.ts";
import { MCP_PERMISSIONS } from "../../server/mcp-permissions.ts";

const root = join(import.meta.dirname, "..", "..");
const committed = JSON.parse(readFileSync(join(root, KNOWLEDGE_FILE), "utf8")) as KnowledgeBase;
const fresh = buildKnowledge(root, committed.generated);
const STRICT = new Set(["tool", "setting", "menu", "engine", "guide"]);
const strict = (base: KnowledgeBase) => base.sections.filter((section) => STRICT.has(section.kind));
const RUN = "stale: run `pnpm gen:self-knowledge` and commit server/self-knowledge/knowledge.generated.json";

describe("self-knowledge base", () => {
  it("is up to date with the tools, permissions, Settings, menus, engines and guides", () => {
    const want = new Map(strict(fresh).map((section) => [section.id, section]));
    const have = new Map(strict(committed).map((section) => [section.id, section]));
    expect([...have.keys()], RUN).toEqual([...want.keys()]);
    for (const [id, section] of want) expect(have.get(id), `${id} ${RUN}`).toEqual(section);
    expect(committed.version, RUN).toBe(fresh.version);
  });

  it("covers every tool of the catalog with its permission", () => {
    const ids = new Set(committed.sections.map((section) => section.id));
    const full = availableTools({
      externalRuntime: false, coordinating: false, ownThreadCreation: true, skillAuthoring: true, sharedComputers: true,
      voiceNotes: true, meetings: true, cloudHome: false, memoryEnabled: true, chief: true, createBots: true,
      botId: "b", agentApi: true, perspicax: true, claims: true,
    }) as Array<{ name: string }>;
    for (const tool of full) expect(ids.has(`tool:${tool.name}`), `tool:${tool.name} ${RUN}`).toBe(true);
    const help = committed.sections.find((section) => section.id === "tool:sagax_help")!;
    expect(help.access).toContain("help:read");
    for (const permission of MCP_PERMISSIONS.filter((entry) => entry.tool && entry.source === "sagax")) {
      const section = committed.sections.find((entry) => entry.id === `tool:${permission.tool}`);
      if (section) expect(section.access, permission.key).toContain(permission.key);
    }
  });

  it("checks every reference of the hand-written guides", () => {
    expect(GUIDES.length).toBeGreaterThan(10);
    for (const guide of GUIDES) {
      expect(guide.refs.length, guide.id).toBeGreaterThan(0);
      expect(guide.text, guide.id).not.toMatch(/[–—]/);
    }
  });

  it("is deterministic and carries its version and day", () => {
    expect(serializeKnowledge(buildKnowledge(root, committed.generated))).toBe(serializeKnowledge(fresh));
    expect(buildKnowledge(root, "2000-01-01").hash).toBe(fresh.hash);
    expect(committed.version).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).forkVersion);
    expect(committed.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(committed.perspicax?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("holds no secret and stays small", () => {
    const text = readFileSync(join(root, KNOWLEDGE_FILE), "utf8");
    expect(text.length).toBeLessThan(2_500_000);
    expect(auditKnowledgeText(text)).toEqual([]);
    // The audit itself catches what it must (the generator exits 1 on any).
    expect(auditKnowledgeText("key sk-ant-abcdefghijklmnopqrstuvwxyz0123")).toHaveLength(1);
    expect(auditKnowledgeText("write to someone@gmail.com")).toHaveLength(1);
    expect(auditKnowledgeText("which team holds client:Acme")).toHaveLength(1);
    expect(auditKnowledgeText("disk-and-expired-approvals and hello@pulsatrix.ca")).toEqual([]);
  });

  it("keeps each section short and sourced", () => {
    for (const section of committed.sections as KnowledgeSection[]) {
      expect(section.text.length, section.id).toBeLessThanOrEqual(3000);
      expect(section.source, section.id).toBeTruthy();
    }
  });
});
