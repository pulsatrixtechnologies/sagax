// The bot workspace beyond memory (docs/bot-workspace.md): RULES.md under
// its own budget and right after the soul in the prompt, the docs/ index
// and tools confined to the workspace, and the Files list's last-used
// record. A bot with neither RULES.md nor docs/ keeps its prompt as it was.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { beginMemoryTurn, endMemoryTurn, flushMemoryJournal, readMemoryJournal, resetMemoryJournalState } from "./memory-journal.ts";
import { closeMessageDb } from "./message-db.ts";
import { createBotWorkspaceRoutes } from "./routes/bot-workspace.ts";
import { PASS } from "./routes/table.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import {
  DOCS_INDEX_MAX,
  RULES_MAX_BYTES,
  RULES_MAX_LINES,
  RULES_TEMPLATE,
  docSummary,
  docsIndexPrompt,
  isForgotten,
  loadRules,
  readWorkspaceText,
  rulesSystemPrompt,
  workspaceLoad,
  workspaceTree,
} from "./workspace-files.ts";
import { applyRulesUpdate, docPath, renameDoc, updateDoc, updateRules } from "./workspace-tools.ts";
import { USAGE_DIR, flushWorkspaceUsage, markWorkspaceUse, promptSectionPaths, resetWorkspaceUsageCache, workspaceUsage } from "./workspace-usage.ts";
import { ensureWorkspace, searchDocFiles, searchMemoryFiles, workspaceDir, writeMemoryFile } from "./workspace.ts";

let counter = 0;
let BOT = "";
const write = (relative: string, text: string) => {
  const path = join(workspaceDir(BOT), relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  BOT = `ws-files-${process.pid}-${counter++}`;
  closeMessageDb();
  rmSync(join(DATA_DIR, "workspaces"), { recursive: true, force: true });
  rmSync(USAGE_DIR, { recursive: true, force: true });
  resetMemoryJournalState();
  resetWorkspaceUsageCache();
  ensureWorkspace(BOT);
});
afterEach(() => {
  resetMemoryJournalState();
  resetWorkspaceUsageCache();
});

describe("RULES.md", () => {
  it("loads nothing without a file, and nothing for the starter template", () => {
    expect(loadRules(BOT)).toBeNull();
    expect(rulesSystemPrompt(BOT)).toBe("");
    write("RULES.md", RULES_TEMPLATE);
    expect(loadRules(BOT)).toBeNull();
    expect(rulesSystemPrompt(BOT)).toBe("");
  });

  it("loads the rules without their comments, in a delimited block", () => {
    write("RULES.md", "# Rules\n\n<!-- a note for me -->\n- Never quote a price.\n");
    const block = rulesSystemPrompt(BOT, { writes: true });
    expect(block).toContain("--- BEGIN RULES (RULES.md, ");
    expect(block).toContain("# Rules\n\n- Never quote a price.\n--- END RULES ---");
    expect(block).not.toContain("a note for me");
    expect(block).toContain("only with rules_update");
    expect(rulesSystemPrompt(BOT)).not.toContain("rules_update");
  });

  it("cuts at 100 lines or 12 KB, whichever first, with a notice like MEMORY.md", () => {
    write("RULES.md", Array.from({ length: 130 }, (_, i) => `- rule ${i}`).join("\n"));
    const lines = loadRules(BOT)!;
    expect(lines).toMatchObject({ truncated: true, lines: 130 });
    expect(lines.text.split("\n")).toHaveLength(RULES_MAX_LINES);
    expect(rulesSystemPrompt(BOT)).toContain(`[RULES.md is 130 lines and ${lines.bytes} bytes; only the first ${RULES_MAX_LINES} lines / ${RULES_MAX_BYTES} bytes are shown above.`);

    write("RULES.md", `- ${"é".repeat(7000)}`);
    const bytes = loadRules(BOT)!;
    expect(bytes.truncated).toBe(true);
    expect(Buffer.byteLength(bytes.text, "utf8")).toBeLessThanOrEqual(RULES_MAX_BYTES);
    expect(bytes.text).not.toContain("\uFFFD");
  });

  it("rides right after the soul and before memory, wherever it is listed", () => {
    write("RULES.md", "- Never quote a price.\n");
    const built = buildSystemPrompt("You are Pepper.", "Be brief.", [
      { id: "user-profile", label: "About", text: " about" },
      { id: "memory", label: "Memory", text: " MEMORY-MARKER" },
      { id: "rules", label: "Rules", text: rulesSystemPrompt(BOT) },
      { id: "docs", label: "Docs", text: " DOCS-MARKER" },
    ]);
    expect(built.sections.map((section) => section.id)).toEqual(["misuse-policy", "run-yourself", "verify-first", "persona", "soul", "rules", "work-style", "user-profile", "memory", "docs"]);
    expect(built.text.indexOf("BEGIN RULES")).toBeGreaterThan(built.text.indexOf("END STANDING INSTRUCTIONS"));
    expect(built.text.indexOf("BEGIN RULES")).toBeLessThan(built.text.indexOf("MEMORY-MARKER"));
    // rules are standing: the stable half; the docs index moves with docs_update
    expect(built.stable).toContain("BEGIN RULES");
    expect(built.volatile).toContain("DOCS-MARKER");
  });

  it("keeps the prompt of a bot without RULES.md or docs/ byte for byte", () => {
    const parts = [{ id: "memory", label: "Memory", text: " memory" }];
    const before = buildSystemPrompt("You are Pepper.", "Be brief.", parts);
    const after = buildSystemPrompt("You are Pepper.", "Be brief.", [
      { id: "rules", label: "Rules", text: rulesSystemPrompt(BOT) },
      ...parts,
      { id: "docs", label: "Docs", text: docsIndexPrompt(BOT, { tools: "agents" }) },
    ]);
    expect(after.text).toBe(before.text);
    expect(after.sections.map((section) => section.id)).toEqual(before.sections.map((section) => section.id));
  });
});

describe("rules_update", () => {
  it("appends one rule, starting the file with a heading", () => {
    const result = updateRules(BOT, { action: "append", text: "- Never email a client without my OK." }, { threadId: "t1" });
    expect(result).toMatchObject({ ok: true, path: "RULES.md", entry: "- Never email a client without my OK." });
    expect(readFileSync(join(workspaceDir(BOT), "RULES.md"), "utf8")).toBe("# Rules\n\n- Never email a client without my OK.\n");
  });

  it("replaces and removes an exact unique passage, and refuses an ambiguous one", () => {
    write("RULES.md", "# Rules\n\n- Always answer in French.\n- Never quote a price.\n");
    expect(updateRules(BOT, { action: "replace", oldText: "in French", text: "in the person's language" }).ok).toBe(true);
    expect(updateRules(BOT, { action: "remove", oldText: "- Never quote a price.\n" }).ok).toBe(true);
    expect(readFileSync(join(workspaceDir(BOT), "RULES.md"), "utf8")).toBe("# Rules\n\n- Always answer in the person's language.\n");
    write("RULES.md", "- Ask first.\n- Ask first.\n");
    expect(updateRules(BOT, { action: "remove", oldText: "- Ask first." })).toMatchObject({ ok: false, code: "conflict" });
    expect(updateRules(BOT, { action: "remove", oldText: "missing" })).toMatchObject({ ok: false, code: "conflict" });
  });

  it("has memory_update's guard rails: shape, size, budget, secrets", () => {
    expect(applyRulesUpdate("", { action: "append" })).toMatchObject({ ok: false, code: "invalid" });
    expect(applyRulesUpdate("", { action: "remove", oldText: "x", text: "y" })).toMatchObject({ ok: false, code: "invalid" });
    expect(applyRulesUpdate("", { action: "append", text: "x".repeat(501) })).toMatchObject({ ok: false, code: "invalid" });
    const full = Array.from({ length: RULES_MAX_LINES - 1 }, (_, i) => `- rule ${i}`).join("\n") + "\n";
    expect(applyRulesUpdate(full, { action: "append", text: "one more" }).ok).toBe(true);
    expect(applyRulesUpdate(`${full}- last\n`, { action: "append", text: "one too many" })).toMatchObject({ ok: false, code: "over-budget" });
    const key = `sk-ant-api03-${"a".repeat(40)}`;
    const saved = updateRules(BOT, { action: "append", text: `Never share ${key}` });
    expect(saved.ok && saved.entry).toContain("«redacted");
    expect(readFileSync(join(workspaceDir(BOT), "RULES.md"), "utf8")).not.toContain(key);
  });

  it("is journaled like a memory edit, as the bot's, with its thread", async () => {
    updateRules(BOT, { action: "append", text: "Never quote a price." }, { threadId: "thread-1" });
    await flushMemoryJournal(BOT);
    const [row] = readMemoryJournal(BOT);
    expect(row).toMatchObject({ path: "RULES.md", actor: "bot", via: "tool", threadId: "thread-1", kind: "created" });
  });
  it("journals a bot's own file-tool edit of RULES.md or docs/ at the turn boundary", () => {
    beginMemoryTurn(BOT, "thread-2");
    write("RULES.md", "- Never quote a price.\n");
    write("docs/a.md", "# A\n");
    const rows = endMemoryTurn("thread-2");
    expect(rows.map((row) => [row.path, row.actor, row.kind])).toEqual([["RULES.md", "bot", "created"], ["docs/a.md", "bot", "created"]]);
  });
});

describe("docs/", () => {
  it("summarises a document by its first heading, else its first line", () => {
    expect(docSummary("---\ntitle: x\n---\n\n# Onboarding\n\nSteps")).toBe("Onboarding");
    expect(docSummary("<!-- c -->\nPrice list for 2026\n")).toBe("Price list for 2026");
    expect(docSummary("")).toBe("");
    expect(docSummary(`# ${"a".repeat(300)}`).length).toBe(120);
  });

  it("indexes documents each turn (never their text), capped at 20", () => {
    expect(docsIndexPrompt(BOT, { tools: "agents" })).toBe("");
    write("docs/onboarding.md", "# Onboarding a client\n\nSECRET BODY TEXT\n");
    const one = docsIndexPrompt(BOT, { tools: "agents" });
    expect(one).toContain("Documents available");
    expect(one).toContain("- docs/onboarding.md: Onboarding a client (");
    expect(one).toContain("workspace_read");
    expect(one).not.toContain("SECRET BODY TEXT");
    expect(docsIndexPrompt(BOT, { tools: "files" })).toContain("your file tools");
    for (let i = 0; i < 25; i += 1) write(`docs/doc-${String(i).padStart(2, "0")}.md`, `# Doc ${i}\n`);
    const many = docsIndexPrompt(BOT, { tools: "agents" });
    expect(many.match(/^- docs\//gm)).toHaveLength(DOCS_INDEX_MAX);
    expect(many).toContain("…and 6 more");
  });

  it("docs_update writes, appends, replaces and deletes inside docs/ only", () => {
    expect(updateDoc(BOT, { action: "write", path: "price list.md", text: "# Prices\n- A: 10" })).toMatchObject({ ok: true, path: "docs/price list.md" });
    expect(updateDoc(BOT, { action: "append", path: "docs/price list.md", text: "- B: 20" }).ok).toBe(true);
    expect(updateDoc(BOT, { action: "replace", path: "docs/price list.md", oldText: "A: 10", text: "A: 12" }).ok).toBe(true);
    expect(readFileSync(join(workspaceDir(BOT), "docs", "price list.md"), "utf8")).toBe("# Prices\n- A: 12\n- B: 20\n");
    for (const path of ["../MEMORY.md", "docs/../../x.md", "/etc/passwd.md", "docs/sub/x.md", ".hidden.md", "notes.txt"]) {
      expect(docPath(path), path).toBeNull();
      expect(updateDoc(BOT, { action: "write", path, text: "x" }), path).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(updateDoc(BOT, { action: "append", path: "docs/missing.md", text: "x" })).toMatchObject({ ok: false, code: "missing" });
    expect(updateDoc(BOT, { action: "delete", path: "docs/price list.md" }).ok).toBe(true);
    expect(existsSync(join(workspaceDir(BOT), "docs", "price list.md"))).toBe(false);
  });

  it("renames a document and refuses to overwrite another", () => {
    write("docs/a.md", "# A\n");
    write("docs/b.md", "# B\n");
    expect(renameDoc(BOT, "docs/a.md", "docs/b.md")).toMatchObject({ ok: false, code: "exists" });
    expect(renameDoc(BOT, "docs/a.md", "docs/c.md")).toMatchObject({ ok: true, path: "docs/c.md" });
    expect(existsSync(join(workspaceDir(BOT), "docs", "a.md"))).toBe(false);
    expect(readFileSync(join(workspaceDir(BOT), "docs", "c.md"), "utf8")).toBe("# A\n");
  });

  it("workspace_read reads the bot's own skill revisions and installed plugins, never another hidden name (2026-10-19)", () => {
    write("skills/.revisions/r1/SKILL.md", "# Triage\n## Zone Z\nExact text.\n");
    write(".git/config", "[remote] url = https://token@github.com/x");
    write("skills/.env", "SECRET=1");
    expect(readWorkspaceText(BOT, "skills/.revisions/r1/SKILL.md").text).toContain("## Zone Z");
    for (const path of [".git/config", "skills/.env", ".claude/settings.json", "skills/.revisions/../../.git/config"]) {
      expect(() => readWorkspaceText(BOT, path), path).toThrow();
    }
    const pluginDir = join(tmpdir(), `ws-plugin-${process.pid}-${counter}`);
    mkdirSync(join(pluginDir, "skills", "flow", "scripts"), { recursive: true });
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(pluginDir, "skills", "flow", "scripts", "px_flow.py"), "print('dry run')\n");
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "{}");
    const plugins = [{ name: "pulsatrix-flow", dir: pluginDir }];
    expect(readWorkspaceText(BOT, "plugins/pulsatrix-flow/skills/flow/scripts/px_flow.py", 0, plugins)).toMatchObject({ path: "plugins/pulsatrix-flow/skills/flow/scripts/px_flow.py", text: "print('dry run')\n" });
    expect(readWorkspaceText(BOT, "plugins/pulsatrix-flow/.claude-plugin/plugin.json", 0, plugins).text).toBe("{}");
    expect(readWorkspaceText(BOT, "/workspace/sagax-plugins/pulsatrix-flow/skills/flow/scripts/px_flow.py", 0, plugins).text).toBe("print('dry run')\n");
    for (const path of ["plugins/pulsatrix-flow/../../etc/passwd", "plugins/other/skills/x.md", "plugins/pulsatrix-flow/missing.md"]) {
      expect(() => readWorkspaceText(BOT, path, 0, plugins), path).toThrow();
    }
    // without the plugin list, nothing outside the workspace is read
    expect(() => readWorkspaceText(BOT, "plugins/pulsatrix-flow/skills/flow/scripts/px_flow.py")).toThrow();
    rmSync(pluginDir, { recursive: true, force: true });
  });

  it("reads only the active person's library and plugin mounts, including their sandbox aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "ws-person-skills-"));
    mkdirSync(join(root, "skills", "ship"), { recursive: true });
    writeFileSync(join(root, "skills", "ship", "SKILL.md"), "Verify the package.");
    // A stale folder in the bot workspace cannot bypass the selected mounts.
    write("plugins/private-owner/skills/ship/SKILL.md", "Owner's private instructions.");
    write("capability-skills/me/skills/ship/SKILL.md", "Previous person's instructions.");
    try {
      expect(readWorkspaceText(BOT, "/workspace/sagax-capability-skills/me/skills/ship/SKILL.md", 0, [], root).text).toBe("Verify the package.");
      for (const path of ["plugins/private-owner/skills/ship/SKILL.md", "/workspace/sagax-plugins/private-owner/skills/ship/SKILL.md", "/workspace/sagax-capability-skills/me/skills/ship/SKILL.md", "capability-skills/me/skills/ship/SKILL.md"]) {
        expect(() => readWorkspaceText(BOT, path), path).toThrow(/no such file/);
      }
      for (const path of ["/workspace/sagax-capability-skills/other/skills/ship/SKILL.md", "/workspace/sagax-capability-skills/me/../other/SKILL.md", "/workspace/sagax-plugins/../private-owner/SKILL.md"]) {
        expect(() => readWorkspaceText(BOT, path, 0, [], root), path).toThrow();
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("workspace_read stays inside the workspace: traversal, absolute, hidden and links refused", () => {
    write("docs/onboarding.md", "# Onboarding\n");
    expect(readWorkspaceText(BOT, "docs/onboarding.md")).toMatchObject({ path: "docs/onboarding.md", text: "# Onboarding\n", nextOffset: null });
    expect(readWorkspaceText(BOT, "./docs/onboarding.md").path).toBe("docs/onboarding.md");
    for (const path of ["../other-bot/MEMORY.md", "docs/../../x", "/etc/passwd", "C:/Windows/win.ini", "docs\\onboarding.md", ".claude/settings.json", "docs/./onboarding.md", "", "docs/missing.md"]) {
      expect(() => readWorkspaceText(BOT, path), path).toThrow();
    }
    // V4: a missing workspace file throws WorkspacePathError status 404 so the
    // internal route can answer 200 { exists:false } without isError.
    try {
      readWorkspaceText(BOT, "SOUL.md");
      expect.unreachable("SOUL.md should be missing");
    } catch (error) {
      expect(error).toMatchObject({ status: 404, message: expect.stringMatching(/no such file/i) });
    }
    const outside = join(tmpdir(), `ws-outside-${process.pid}-${counter}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.md"), "outside");
    symlinkSync(outside, join(workspaceDir(BOT), "escape"));
    symlinkSync(join(outside, "secret.md"), join(workspaceDir(BOT), "docs", "link.md"));
    expect(() => readWorkspaceText(BOT, "escape/secret.md")).toThrow(/escapes the workspace/);
    expect(() => readWorkspaceText(BOT, "docs/link.md")).toThrow(/link/);
    rmSync(outside, { recursive: true, force: true });
  });

  it("workspace_read pages a long file without cutting a character", () => {
    write("docs/long.md", "é".repeat(40_000));
    const first = readWorkspaceText(BOT, "docs/long.md");
    expect(first.nextOffset).not.toBeNull();
    expect(first.text).not.toContain("\uFFFD");
    const second = readWorkspaceText(BOT, "docs/long.md", first.nextOffset!);
    expect((first.text + second.text).length).toBe(40_000);
  });

  it("workspace_search finds documents; session_search keeps to memory", () => {
    write("docs/onboarding.md", "# Onboarding\n\nAsk for the VPN token first.\n");
    writeMemoryFile(BOT, "# Memory\n- The client prefers mornings.\n");
    const docs = searchDocFiles(BOT, "VPN token");
    expect(docs.map((hit) => hit.file)).toEqual(["docs/onboarding.md"]);
    expect(searchDocFiles(BOT, "mornings")).toEqual([]);
    expect(searchMemoryFiles(BOT, "VPN token")).toEqual([]);
    expect(searchMemoryFiles(BOT, "mornings").map((hit) => hit.file)).toEqual(["MEMORY.md"]);
  });
});

describe("the Files list", () => {
  it("says when each file reaches the bot", () => {
    expect(workspaceLoad("RULES.md")).toBe("every-turn");
    expect(workspaceLoad("MEMORY.md")).toBe("every-turn");
    expect(workspaceLoad("MEMORY.md", { memoryEnabled: false })).toBe("never");
    expect(workspaceLoad("memory/clients.md")).toBe("on-demand");
    expect(workspaceLoad("memory/archive.md")).toBe("never");
    expect(workspaceLoad("memory/log/2026-10-09.md")).toBe("never");
    expect(workspaceLoad("docs/a.md")).toBe("on-demand");
    expect(workspaceLoad("skills/x/SKILL.md")).toBe("on-demand");
    expect(workspaceLoad("report.pdf")).toBe("never");
  });

  it("lists the tree with budgets, hiding dot entries", () => {
    write("RULES.md", "- Never quote a price.\n");
    write("docs/a.md", "# A\n");
    write("out/report.pdf", "%PDF");
    write(".claude/settings.json", "{}");
    const { entries } = workspaceTree(BOT);
    expect(entries.map((entry) => entry.path)).toEqual(["MEMORY.md", "RULES.md", "docs", "docs/a.md", "memory", "out", "out/report.pdf"]);
    const rules = entries.find((entry) => entry.path === "RULES.md")!;
    expect(rules).toMatchObject({ load: "every-turn", editable: true, budget: { maxLines: 100, maxBytes: 12000, lines: 1, over: false } });
    expect(entries.find((entry) => entry.path === "out/report.pdf")).toMatchObject({ load: "never", editable: false, markdown: false });
  });

  it("marks forgotten files: no use in 30 days and not loaded every turn", () => {
    const now = Date.now();
    const old = now - 40 * 24 * 60 * 60_000;
    const entry = { path: "docs/a.md", kind: "file" as const, load: "on-demand" as const, createdAt: old };
    expect(isForgotten(entry, undefined, now)).toBe(true);
    expect(isForgotten(entry, now - 1000, now)).toBe(false);
    expect(isForgotten({ ...entry, load: "every-turn" }, undefined, now)).toBe(false);
    expect(isForgotten({ ...entry, path: "memory/log/2026-01-01.md", load: "never" }, undefined, now)).toBe(false);
    expect(isForgotten({ ...entry, createdAt: now - 1000 }, undefined, now)).toBe(false);
  });

  it("tracks lastUsedAt per path in a sidecar outside the workspace", () => {
    markWorkspaceUse(BOT, ["RULES.md", "docs/a.md"], 1_000);
    markWorkspaceUse(BOT, ["docs/a.md"], 2_000);
    flushWorkspaceUsage();
    const file = join(USAGE_DIR, `${BOT}.json`);
    expect(file.startsWith(workspaceDir(BOT))).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).paths).toEqual({ "RULES.md": 1_000, "docs/a.md": 2_000 });
    resetWorkspaceUsageCache();
    expect(workspaceUsage(BOT)).toEqual({ "RULES.md": 1_000, "docs/a.md": 2_000 });
  });

  it("marks what a turn's prompt carried, and what the tools touched", () => {
    expect(promptSectionPaths([
      { id: "soul", text: "x" },
      { id: "rules", text: "x" },
      { id: "memory", text: " guidance only" },
      { id: "docs", text: "index" },
    ])).toEqual(["SOUL.md", "RULES.md"]);
    expect(promptSectionPaths([{ id: "memory", text: "...\n\nYour memory (MEMORY.md):\n- fact" }])).toEqual(["MEMORY.md"]);
    write("docs/a.md", "# A\n");
    readWorkspaceText(BOT, "docs/a.md");
    updateRules(BOT, { action: "append", text: "Never quote a price." });
    expect(Object.keys(workspaceUsage(BOT))).toEqual(["RULES.md"]);
  });

  it("serves the tree with lastUsedAt and forgotten, SOUL.md first; downloads stay inside", async () => {
    write("docs/a.md", "# A\n");
    markWorkspaceUse(BOT, ["docs/a.md"], Date.now());
    let allowed = true;
    const route = createBotWorkspaceRoutes({ bot: (id) => (id === BOT ? { id: BOT, soul: "Be brief." } : undefined), mayEdit: () => allowed });
    const answer = async (path: string, method = "GET", body: unknown = {}) => {
      const replies: Array<{ status: number; body: unknown }> = [];
      const url = new URL(`http://x${path}`);
      const out = await route({
        req: {} as never, res: {} as never, url, path: url.pathname, method, auth: {} as never,
        json: ((_res: unknown, status: number, body: unknown) => { replies.push({ status, body }); }) as never,
        readBody: (async () => body) as never,
      });
      return { out, reply: replies[0] };
    };
    const { reply } = await answer(`/api/bots/${BOT}/workspace`);
    const body = reply!.body as { soul: { path: string; load: string }; entries: Array<{ path: string; lastUsedAt?: number; forgotten: boolean }> };
    expect(reply!.status).toBe(200);
    expect(body.soul).toMatchObject({ path: "SOUL.md", load: "every-turn" });
    expect(body.entries.find((entry) => entry.path === "docs/a.md")).toMatchObject({ forgotten: false, lastUsedAt: expect.any(Number) });
    expect((await answer("/api/bots/nobody/workspace")).reply!.status).toBe(404);
    expect((await answer(`/api/bots/${BOT}/workspace/download?path=../x`)).reply!.status).toBe(400);
    expect((await answer(`/api/bots/${BOT}/elsewhere`)).out).toBe(PASS);
    // RULES.md and docs/ only; memory stays on the admin memory routes
    expect((await answer(`/api/bots/${BOT}/workspace/file`, "PUT", { path: "RULES.md", text: "- Ask first.\n" })).reply!.status).toBe(200);
    expect((await answer(`/api/bots/${BOT}/workspace/file?path=RULES.md`)).reply!.body).toMatchObject({ text: "- Ask first.\n", exists: true });
    expect((await answer(`/api/bots/${BOT}/workspace/file`, "PUT", { path: "MEMORY.md", text: "x" })).reply!.status).toBe(400);
    expect((await answer(`/api/bots/${BOT}/workspace/file?path=memory/a.md`)).reply!.status).toBe(400);
    // the Soul's gate: refused for anyone who may not edit the bot
    allowed = false;
    for (const [path, method] of [[`/api/bots/${BOT}/workspace`, "GET"], [`/api/bots/${BOT}/workspace/file`, "PUT"], [`/api/bots/${BOT}/workspace/download?path=RULES.md`, "GET"], [`/api/bots/${BOT}/workspace/docs/rename`, "POST"]]) {
      expect((await answer(path!, method!, { path: "RULES.md", text: "x", from: "docs/a.md", to: "docs/b.md" })).reply!.status, path).toBe(403);
    }
    expect(readFileSync(join(workspaceDir(BOT), "RULES.md"), "utf8")).toBe("- Ask first.\n");
  });
});
