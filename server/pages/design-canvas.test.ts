// Designs, kind "design" of the published pages (#2717). Blocking: the
// design tool is exposed to the bot, it produces a Design page rendered in
// the pages surface, and it lands in the same conversation (no new thread).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PAGE_TOOL_DEFINITIONS } from "../drivers/agents-page-tools.ts";
import { createAgentCard, type AgentCardStore } from "../widgets/chat-widgets.ts";
import type { Message } from "../store.ts";
import { PublishedPages } from "./published-pages.ts";
import { pageDocument } from "./published-pages-render.ts";
import { exportFilename } from "../routes/published-pages.ts";
import { pageIsHtml, parsePageProposal } from "../../shared/published-pages.ts";
import { applyDesignSystem, BUILTIN_DESIGN_SYSTEMS, DESIGN_CANVAS_CSS, designScreens, designSystemOf, parseDesignTokens } from "../../src/lib/design-systems.ts";

const now = Date.parse("2026-11-08T12:00:00Z");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function pages(): PublishedPages {
  const dir = mkdtempSync(join(tmpdir(), "sagax-design-"));
  dirs.push(dir);
  return new PublishedPages(dir, () => now);
}

const DESIGN = [
  "<!doctype html><html><head><title>Notes</title></head><body>",
  "<section data-screen=\"Welcome\" data-device=\"phone\"><h1>Notes</h1><button style=\"background:var(--accent)\">Start</button></section>",
  "<section data-screen=\"Sync\" data-device=\"phone\"><p>Everywhere</p></section>",
  "<section data-screen=\"Ready\"><p>Done</p></section>",
  "</body></html>",
].join("");

function cardStore(messages: Message[], threads: string[]): AgentCardStore {
  return {
    groupByThread: () => null,
    messagesFor: () => messages,
    appendMessage: (threadId, message) => {
      threads.push(threadId);
      const full = { ...message, id: `m${messages.length + 1}`, at: now } as Message;
      messages.push(full);
      return full;
    },
    patchMessage: () => null,
  };
}

describe("designs (#2717)", () => {
  it("the bot's propose_page tool offers kind design and design systems", () => {
    const tool = PAGE_TOOL_DEFINITIONS.find((definition) => definition.name === "propose_page")!;
    expect(tool.name).not.toContain("__");
    const schema = tool.inputSchema as unknown as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties.kind!.enum).toContain("design");
    expect(schema.properties.design_system).toBeDefined();
    expect(schema.properties.design_tokens).toBeDefined();
    expect(tool.description).toMatch(/kind design/);
  });

  it("a design proposed by the bot is a Design page in the same conversation, no new thread", () => {
    const store = pages();
    const messages: Message[] = [];
    const threads: string[] = [];
    const result = createAgentCard({
      store: cardStore(messages, threads),
      bot: { id: "bot1", name: "Scout", color: "blue" as never },
      threadId: "t1",
      input: { tool: "propose_page", title: "Notes onboarding", kind: "design", content: DESIGN },
      proposePage: (input) => {
        const made = store.propose({ ...input, botId: "bot1", threadId: "t1", ownerId: "p1" });
        return made.ok ? { ok: true, pageId: made.page.id, version: made.version.n } : made;
      },
    });
    expect(result.ok).toBe(true);
    // one row, in the conversation the bot spoke in
    expect(threads).toEqual(["t1"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toMatch(/^Design proposed: Notes onboarding/);
    const page = store.get(messages[0]!.pagePublish!.pageId)!;
    expect(page.versions.at(-1)!.kind).toBe("design");
    expect(page.threadId).toBe("t1");
    expect(page.status).toBe("draft");
    // the Sagax system is applied by default and the screens are kept
    const content = store.content(page.id, 1)!;
    expect(designSystemOf(content)).toEqual({ id: "sagax", name: "Sagax" });
    expect(designScreens(content).map((screen) => screen.name)).toEqual(["Welcome", "Sync", "Ready"]);
    // rendered in the pages surface with the canvas
    expect(pageIsHtml("design")).toBe(true);
    const html = pageDocument({ kind: "design", title: page.title ?? "", content });
    expect(html).toContain(DESIGN_CANVAS_CSS);
    expect(html).toContain("data-screen=\"Welcome\"");
  });

  it("parses design proposals with a system and tokens", () => {
    const parsed = parsePageProposal({ title: "x", kind: "design", content: DESIGN, design_system: "editorial", design_tokens: ":root{--accent:#ff3366}" });
    expect(parsed).toMatchObject({ ok: true, value: { kind: "design", designSystem: "editorial" } });
  });

  it("a named system replaces the old one, and tokens from the person's code are saved as their own", () => {
    const store = pages();
    const first = store.propose({ botId: "b", threadId: "t", ownerId: "p1", title: "x", kind: "design", content: DESIGN, designSystem: "Editorial" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(designSystemOf(store.content(first.page.id, 1)!)?.id).toBe("editorial");
    const own = store.propose({ pageId: first.page.id, botId: "b", threadId: "t", ownerId: "p1", title: "x", kind: "design", content: store.content(first.page.id, 1)!, designSystem: "Acme", designTokens: ":root{--accent:#ff3366;--bg:#fff;color:red}" });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    const content = store.content(first.page.id, own.version.n)!;
    expect(designSystemOf(content)).toEqual({ id: "own-acme", name: "Acme" });
    expect(content.match(/data-sagax-design-system=/g)).toHaveLength(1);
    expect(content).toContain("--accent:#ff3366");
    expect(store.designSystems("p1").map((system) => system.id)).toContain("own-acme");
    // another person never sees it
    expect(store.designSystems("p2").map((system) => system.id)).not.toContain("own-acme");
  });

  it("keeps only custom properties with safe values", () => {
    expect(parseDesignTokens({ "--accent": "#123456", color: "red", "--x": "url(javascript:alert(1))" })).toEqual({ "--accent": "#123456" });
    expect(parseDesignTokens("nothing here")).toBeNull();
    const vendored = BUILTIN_DESIGN_SYSTEMS.map((system) => system.id);
    expect(vendored).toEqual(["sagax", "minimal", "editorial", "clean", "modern"]);
    expect(applyDesignSystem("<p>x</p>", BUILTIN_DESIGN_SYSTEMS[1]!)).toMatch(/^<style data-sagax-design-system="minimal"/);
  });

  it("names an export after the title and the version, never an id", () => {
    expect(exportFilename("Onboarding : Notes app", 3)).toBe("onboarding-notes-app-v3.html");
    expect(exportFilename("???", 1)).toBe("page-v1.html");
  });
});
