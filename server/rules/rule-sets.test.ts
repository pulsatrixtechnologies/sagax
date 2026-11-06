// Rule sets (server/rules/rule-sets.ts, server/routes/bot-rules.ts): an existing
// RULES.md becomes the first set without loss; sets are added, renamed,
// switched, reordered and deleted; the ones that are on load in order under
// a budget per set and in all; the routes keep the Soul's gate and audit
// every change; rules_update can aim at one set and still defaults to the
// first.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { flushMemoryJournal, readMemoryJournal, resetMemoryJournalState } from "../memory/memory-journal.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import {
  RULES_MAX_LINES,
  RULES_TOTAL_MAX_LINES,
  RULE_SETS_MANIFEST,
  findRuleSet,
  listRuleSets,
  loadActiveRules,
  newRuleSetId,
  rulesSystemPrompt,
  writeRuleSets,
} from "./rule-sets.ts";
import { createBotRulesRoutes, type BotRulesAuditRow } from "../routes/bot-rules.ts";
import { PASS } from "../routes/table.ts";
import { updateRules } from "../workspace/workspace-tools.ts";
import { resetMtimePromptCache } from "../workspace/mtime-prompt-cache.ts";
import { promptSectionPaths, resetWorkspaceUsageCache, USAGE_DIR } from "../workspace/workspace-usage.ts";
import { workspaceTree } from "../workspace/workspace-files.ts";
import { ensureWorkspace, workspaceDir } from "../workspace/workspace.ts";

let counter = 0;
let BOT = "";
const write = (relative: string, text: string) => {
  const path = join(workspaceDir(BOT), relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const read = (relative: string) => readFileSync(join(workspaceDir(BOT), relative), "utf8");
const rules = (n: number, prefix = "rule") => Array.from({ length: n }, (_, i) => `- ${prefix} ${i}`).join("\n") + "\n";

beforeEach(() => {
  BOT = `rule-sets-${process.pid}-${counter++}`;
  closeMessageDb();
  rmSync(join(DATA_DIR, "workspaces"), { recursive: true, force: true });
  rmSync(USAGE_DIR, { recursive: true, force: true });
  resetMemoryJournalState();
  resetWorkspaceUsageCache();
  resetMtimePromptCache();
  ensureWorkspace(BOT);
});
afterEach(() => {
  resetMemoryJournalState();
  resetWorkspaceUsageCache();
  resetMtimePromptCache();
});

describe("the sets on disk", () => {
  it("lists the default set alone for a bot that never had rules", () => {
    expect(listRuleSets(BOT)).toEqual([{ id: "rules", name: null, enabled: true, file: "RULES.md" }]);
    expect(rulesSystemPrompt(BOT)).toBe("");
  });

  it("turns an existing RULES.md into the first set, its prompt block unchanged", () => {
    write("RULES.md", "# Rules\n\n- Never quote a price.\n");
    const before = rulesSystemPrompt(BOT, { writes: true });
    expect(before).toContain("--- BEGIN RULES (RULES.md, ");
    expect(before).toContain("Change RULES.md only with rules_update");
    expect(listRuleSets(BOT)[0]).toMatchObject({ id: "rules", file: "RULES.md", enabled: true });
    // writing the manifest (a rename) keeps the file and its text
    writeRuleSets(BOT, [{ id: "rules", name: "House rules", enabled: true }]);
    expect(read("RULES.md")).toBe("# Rules\n\n- Never quote a price.\n");
    expect(listRuleSets(BOT)).toEqual([{ id: "rules", name: "House rules", enabled: true, file: "RULES.md" }]);
  });

  it("lists a set file the manifest does not name, switched on", () => {
    write("rules/emails.md", "- Sign every email.\n");
    expect(listRuleSets(BOT).map((set) => [set.id, set.enabled])).toEqual([["rules", true], ["emails", true]]);
    writeRuleSets(BOT, [{ id: "emails", name: "Emails", enabled: true }]);
    // RULES.md written later by an older client: listed again, on
    write("RULES.md", "- Ask first.\n");
    expect(listRuleSets(BOT).map((set) => set.id)).toEqual(["emails", "rules"]);
  });

  it("loads the sets that are on, in order, each in its own block", () => {
    write("RULES.md", "- Ask first.\n");
    write("rules/emails.md", "# Emails\n\n- Sign every email.\n");
    write("rules/off.md", "- Hidden rule.\n");
    writeRuleSets(BOT, [
      { id: "emails", name: "Emails", enabled: true },
      { id: "rules", name: null, enabled: true },
      { id: "off", name: "Off", enabled: false },
    ]);
    const block = rulesSystemPrompt(BOT, { writes: true });
    expect(block).toContain("in 2 sets");
    expect(block.indexOf('--- BEGIN RULES "Emails" (rules/emails.md,')).toBeLessThan(block.indexOf('--- BEGIN RULES "Rules" (RULES.md,'));
    expect(block).not.toContain("Hidden rule");
    expect(block).toContain("rules_update (set: the set's name");
    expect(promptSectionPaths([{ id: "rules", text: block }])).toEqual(["rules/emails.md", "RULES.md"]);
  });

  it("cuts each set at its budget and all of them at the total", () => {
    write("RULES.md", rules(RULES_MAX_LINES + 20));
    expect(loadActiveRules(BOT).sets[0]).toMatchObject({ truncated: true, cutBy: "set" });
    expect(rulesSystemPrompt(BOT)).toContain(`only the first ${RULES_MAX_LINES} lines`);
    const sets: Array<{ id: string; name: string | null; enabled: boolean }> = [{ id: "rules", name: null, enabled: true }];
    for (const id of ["a", "b", "c"]) {
      write(`rules/${id}.md`, rules(RULES_MAX_LINES, id));
      sets.push({ id, name: id.toUpperCase(), enabled: true });
    }
    writeRuleSets(BOT, sets);
    const loaded = loadActiveRules(BOT);
    const total = loaded.sets.reduce((sum, set) => sum + set.text.split("\n").length, 0);
    expect(total).toBeLessThanOrEqual(RULES_TOTAL_MAX_LINES);
    expect(loaded.sets[2]).toMatchObject({ id: "b", cutBy: "total" });
    expect(loaded.omitted).toEqual(["rules/c.md"]);
    expect(rulesSystemPrompt(BOT)).toContain("Not loaded, past the rules budget");
  });

  it("names sets with free slugs and finds them by id or name", () => {
    expect(newRuleSetId("Courriels clients", [])).toBe("courriels-clients");
    expect(newRuleSetId("Règles", ["regles"])).toBe("regles-2");
    expect(newRuleSetId("Rules", [])).toBe("rules-2");
    expect(newRuleSetId("!!!", [])).toBe("set");
    const sets = [
      { id: "rules", name: null, enabled: true, file: "RULES.md" },
      { id: "emails", name: "Client emails", enabled: false, file: "rules/emails.md" },
    ];
    expect(findRuleSet(sets, undefined)?.id).toBe("rules");
    expect(findRuleSet(sets, "client  EMAILS")?.id).toBe("emails");
    expect(findRuleSet(sets, "emails")?.id).toBe("emails");
    expect(findRuleSet(sets, "rules")?.id).toBe("rules");
    expect(findRuleSet(sets, "nope")).toBeUndefined();
  });

  it("shows set files in the Files list, loaded only while on", () => {
    write("rules/emails.md", "- Sign.\n");
    write("rules/off.md", "- Off.\n");
    writeRuleSets(BOT, [{ id: "emails", name: "E", enabled: true }, { id: "off", name: "O", enabled: false }]);
    const { entries } = workspaceTree(BOT);
    expect(entries.find((entry) => entry.path === "rules/emails.md")).toMatchObject({ load: "every-turn", editable: true, budget: { maxLines: RULES_MAX_LINES } });
    expect(entries.find((entry) => entry.path === "rules/off.md")).toMatchObject({ load: "never" });
    expect(entries.some((entry) => entry.path.endsWith(".sets.json"))).toBe(false);
  });

  it("refuses to write the manifest through a link", () => {
    rmSync(join(workspaceDir(BOT), "rules"), { recursive: true, force: true });
    const outside = join(DATA_DIR, `outside-${BOT}`);
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(workspaceDir(BOT), "rules"));
    expect(() => writeRuleSets(BOT, [{ id: "rules", name: null, enabled: true }])).toThrow(/not a plain folder/);
    expect(existsSync(join(outside, ".sets.json"))).toBe(false);
  });
});

describe("rules_update with a set", () => {
  it("defaults to the first set, and aims at a set by name", () => {
    write("rules/emails.md", "# Emails\n");
    writeRuleSets(BOT, [{ id: "emails", name: "Client emails", enabled: true }, { id: "rules", name: null, enabled: true }]);
    expect(updateRules(BOT, { action: "append", text: "Sign every email." })).toMatchObject({ ok: true, path: "rules/emails.md", set: "Client emails" });
    expect(updateRules(BOT, { action: "append", text: "Ask first.", set: "Rules" })).toMatchObject({ ok: true, path: "RULES.md" });
    expect(read("rules/emails.md")).toBe("# Emails\n- Sign every email.\n");
    expect(read("RULES.md")).toBe("# Rules\n\n- Ask first.\n");
    expect(updateRules(BOT, { action: "append", text: "x", set: "Nope" })).toMatchObject({ ok: false, code: "missing" });
    const conflict = updateRules(BOT, { action: "remove", oldText: "missing", set: "client emails" });
    expect(conflict).toMatchObject({ ok: false, code: "conflict" });
    expect(conflict.ok ? "" : conflict.error).toContain("rules/emails.md");
  });

  it("keeps working as before on a bot with RULES.md only", () => {
    expect(updateRules(BOT, { action: "append", text: "Never quote a price." })).toMatchObject({ ok: true, path: "RULES.md" });
    expect(existsSync(join(workspaceDir(BOT), RULE_SETS_MANIFEST))).toBe(false);
  });

  it("brings the default set back when every set was deleted", () => {
    writeRuleSets(BOT, []);
    expect(listRuleSets(BOT)).toEqual([]);
    expect(updateRules(BOT, { action: "append", text: "Ask first." })).toMatchObject({ ok: true, path: "RULES.md" });
    expect(listRuleSets(BOT).map((set) => set.id)).toEqual(["rules"]);
  });

  it("refuses a change past the total budget, not one to a set that is off", () => {
    const sets: Array<{ id: string; name: string | null; enabled: boolean }> = [{ id: "rules", name: null, enabled: true }];
    for (const id of ["a", "b"]) {
      write(`rules/${id}.md`, rules(RULES_MAX_LINES - 1, id));
      sets.push({ id, name: id, enabled: true });
    }
    write("RULES.md", rules(RULES_TOTAL_MAX_LINES - 2 * (RULES_MAX_LINES - 1)));
    write("rules/off.md", "- off\n");
    writeRuleSets(BOT, [...sets, { id: "off", name: "off", enabled: false }]);
    expect(updateRules(BOT, { action: "append", text: "one more", set: "a" })).toMatchObject({ ok: false, code: "over-budget" });
    expect(updateRules(BOT, { action: "append", text: "one more", set: "off" })).toMatchObject({ ok: true });
  });
});

describe("the rule set routes", () => {
  const setup = () => {
    let allowed = true;
    const audits: BotRulesAuditRow[] = [];
    const route = createBotRulesRoutes({
      bot: (id) => (id === BOT ? { id: BOT, name: "Pepper" } : undefined),
      mayEdit: () => allowed,
      audit: (_auth, _req, row) => audits.push(row),
    });
    const answer = async (path: string, method = "GET", body: unknown = {}) => {
      const replies: Array<{ status: number; body: Record<string, unknown> }> = [];
      const url = new URL(`http://x${path}`);
      const out = await route({
        req: {} as never, res: {} as never, url, path: url.pathname, method, auth: {} as never,
        json: ((_res: unknown, status: number, body: Record<string, unknown>) => { replies.push({ status, body }); }) as never,
        readBody: (async () => body) as never,
      });
      return { out, status: replies[0]?.status, body: replies[0]?.body ?? {} };
    };
    return { answer, audits, deny: () => { allowed = false; } };
  };
  type WireSet = { id: string; name: string | null; enabled: boolean; text: string; hash: string; lines: number; over: boolean };

  it("lists, adds, renames, switches, reorders, saves and deletes sets", async () => {
    write("RULES.md", "- Ask first.\n");
    const { answer, audits } = setup();
    const base = `/api/bots/${BOT}/rules`;
    let listing = await answer(base);
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({ budgets: { set: { maxLines: 100, maxBytes: 12000 }, total: { maxLines: 250, maxBytes: 24000 } }, total: { lines: 1, over: false } });
    expect((listing.body.sets as WireSet[]).map((set) => set.id)).toEqual(["rules"]);

    const created = await answer(`${base}/sets`, "POST", { name: "Courriels clients" });
    expect(created.status).toBe(201);
    expect(created.body.set).toMatchObject({ id: "courriels-clients", name: "Courriels clients", enabled: true, text: "# Courriels clients\n\n" });
    expect((await answer(`${base}/sets`, "POST", { name: "courriels CLIENTS" })).status).toBe(409);
    expect((await answer(`${base}/sets`, "POST", { name: "   " })).status).toBe(400);

    const set = created.body.set as WireSet;
    const saved = await answer(`${base}/sets/${set.id}/text`, "PUT", { text: "- Sign every email.\n", expectedHash: set.hash });
    expect(saved.status).toBe(200);
    expect(read("rules/courriels-clients.md")).toBe("- Sign every email.\n");
    // a stale hash is a conflict carrying what is on disk
    const stale = await answer(`${base}/sets/${set.id}/text`, "PUT", { text: "x", expectedHash: set.hash });
    expect(stale).toMatchObject({ status: 409, body: { code: "conflict", current: "- Sign every email.\n" } });

    expect((await answer(`${base}/sets/rules`, "PATCH", { name: "Règles maison" })).status).toBe(200);
    expect((await answer(`${base}/sets/rules`, "PATCH", { enabled: false })).status).toBe(200);
    expect(rulesSystemPrompt(BOT)).not.toContain("Ask first.");
    expect(rulesSystemPrompt(BOT)).toContain("Sign every email.");
    expect((await answer(`${base}/sets/rules`, "PATCH", {})).status).toBe(400);
    expect((await answer(`${base}/sets/nope`, "PATCH", { enabled: true })).status).toBe(404);

    expect((await answer(`${base}/order`, "PUT", { ids: ["rules"] })).status).toBe(409);
    listing = await answer(`${base}/order`, "PUT", { ids: ["courriels-clients", "rules"] });
    expect((listing.body.sets as WireSet[]).map((entry) => [entry.id, entry.name, entry.enabled])).toEqual([
      ["courriels-clients", "Courriels clients", true],
      ["rules", "Règles maison", false],
    ]);

    listing = await answer(`${base}/sets/courriels-clients`, "DELETE");
    expect(listing.status).toBe(200);
    expect(existsSync(join(workspaceDir(BOT), "rules/courriels-clients.md"))).toBe(false);
    expect((listing.body.sets as WireSet[]).map((entry) => entry.id)).toEqual(["rules"]);

    expect(audits.map((row) => row.action)).toEqual([
      "bot.rules-set.create",
      "bot.rules-set.edit",
      "bot.rules-set.update",
      "bot.rules-set.disable",
      "bot.rules-set.reorder",
      "bot.rules-set.delete",
    ]);
    expect(audits.every((row) => row.botId === BOT)).toBe(true);
    // the text changes are journaled like memory, as the person's
    await flushMemoryJournal(BOT);
    const journal = readMemoryJournal(BOT);
    expect(journal.some((entry) => entry.path === "rules/courriels-clients.md" && entry.actor === "person")).toBe(true);
  });

  it("keeps the Soul's gate and passes other paths", async () => {
    const { answer, deny } = setup();
    expect((await answer(`/api/bots/nobody/rules`)).status).toBe(404);
    expect((await answer(`/api/bots/${BOT}/workspace`)).out).toBe(PASS);
    deny();
    for (const [path, method] of [
      [`/api/bots/${BOT}/rules`, "GET"],
      [`/api/bots/${BOT}/rules/sets`, "POST"],
      [`/api/bots/${BOT}/rules/order`, "PUT"],
      [`/api/bots/${BOT}/rules/sets/rules`, "PATCH"],
      [`/api/bots/${BOT}/rules/sets/rules`, "DELETE"],
      [`/api/bots/${BOT}/rules/sets/rules/text`, "PUT"],
    ] as const) {
      expect((await answer(path, method, { name: "x", ids: [], enabled: false, text: "x" })).status, `${method} ${path}`).toBe(403);
    }
    expect(existsSync(join(workspaceDir(BOT), RULE_SETS_MANIFEST))).toBe(false);
  });

  it("caps the number of sets", async () => {
    const { answer } = setup();
    for (let i = 0; i < 19; i += 1) expect((await answer(`/api/bots/${BOT}/rules/sets`, "POST", { name: `Set ${i}` })).status).toBe(201);
    expect((await answer(`/api/bots/${BOT}/rules/sets`, "POST", { name: "One too many" })).status).toBe(409);
  });
});
