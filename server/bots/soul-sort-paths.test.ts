// #5019: every path that writes a soul files an added rule in RULES.md,
// keeps voice and persona in the soul, keeps the text when the
// classification fails, and never reaches another person's bot.
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { flushMemoryJournal, readMemoryJournal, resetMemoryJournalState } from "../memory/memory-journal.ts";
import { RULES_PATH, readMemoryDoc } from "../memory/memory-store.ts";
import { RULE_MAX_CHARS } from "../rules/rule-sets.ts";
import { createBotsCoreSoulRoutes } from "../routes/bots-core-soul.ts";
import { commitBotPatch } from "../routes/bots-mutate-patch-commit.ts";
import { createBotPatchState, type BotPatchState, type BotsMutateEnv } from "../routes/bots-mutate-helpers.ts";
import type { BotsCoreRouteDeps } from "../routes/bots-core-deps.ts";
import { Store } from "../store.ts";
import { rulesAreNeverLines, soulSortModel } from "../testing/soul-sort-model.ts";
import { createSoulSorter, type SoulClassifier } from "./soul-sort.ts";
import { soulSortWriters } from "./soul-sort-writers.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
const PERSONA = "You are Marc, the dispatcher. Warm and brief.";
const VOICE = "Never open the way you opened the previous reply.";
const RULE = "- Never assign a ticket without checking the schedule.";

let sorters: Array<{ close(): void }> = [];

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  resetMemoryJournalState();
});
afterEach(() => {
  for (const sorter of sorters) sorter.close();
  sorters = [];
  closeMessageDb();
});

/** A store wired like the server: every soul write reaches the sorter. */
function wired(classifier: SoulClassifier = soulSortModel(rulesAreNeverLines).classifier) {
  const store = new Store(selection);
  const sorter = createSoulSorter({
    classifier,
    botName: (id) => store.bot(id)?.name ?? "",
    writers: soulSortWriters({ memoryOn: (id) => store.bot(id)?.memoryEnabled !== false }),
    ruleMax: RULE_MAX_CHARS,
    currentSoul: (id) => store.bot(id) ? store.bot(id)!.soul ?? "" : null,
    commitSoul: (id, soul, expected) => (store.bot(id)?.soul ?? "") === expected && Boolean(store.patchBotProfile(id, { soul }, { soulWrite: "sorted" })),
  });
  sorters.push(sorter);
  store.onSoulWrite((write) => sorter.noted(write));
  return { store, sorter };
}

const rulesOf = (botId: string) => readMemoryDoc(botId, RULES_PATH).text;

describe("each soul write path files an added rule (#5019)", () => {
  it("PATCH /api/bots/:id (the app, update_agent_settings, sagax_settings bot.persona): sorted before it is saved, answered", async () => {
    const { store, sorter } = wired();
    const bot = store.createBot({ name: "Marc", soul: PERSONA });
    await sorter.flush(bot.id);
    const json = vi.fn();
    const known: Record<string, unknown> = {
      store, soulSorter: sorter, json, res: {}, req: { headers: {} }, auth: { kind: "loopback" },
      sessionPrincipal: () => null, wireBot: (record: unknown) => record, sectionKey: (value: unknown) => value ?? "",
      recordProfileChange: vi.fn(), recordPersonaSave: vi.fn(), profileSnapshot: (record: { soul?: string }) => ({ soul: record.soul }),
      liveApprovalChange: () => false, assertTeamComputerChangeIdle: vi.fn(),
    };
    const env = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : vi.fn(() => undefined) }) as unknown as BotsMutateEnv;
    const patch = async (body: Record<string, unknown>) => {
      const state = { ...createBotPatchState([`/api/bots/${bot.id}`, bot.id] as unknown as RegExpMatchArray), body, existingBot: store.bot(bot.id), patch: { soul: body.soul }, profile: { patch: { soul: body.soul } }, beforeProfile: { soul: store.bot(bot.id)!.soul } } as unknown as BotPatchState;
      await commitBotPatch(env, state);
      return json.mock.calls.at(-1)![2] as { bot: { soul: string }; soulSorted?: { moved: Array<{ to: string }> } };
    };
    const answer = await patch({ soul: `${PERSONA}\n\n## Voice\n\n${VOICE}\n\n${RULE}` });
    expect(store.bot(bot.id)!.soul).toBe(`${PERSONA}\n\n## Voice\n\n${VOICE}`);
    expect(rulesOf(bot.id)).toContain(RULE);
    expect(answer.soulSorted?.moved.map((move) => move.to)).toEqual(["RULES.md"]);

    // the app's typing: saved as typed, filed when the editor is left
    const typing = await patch({ soul: `${store.bot(bot.id)!.soul}\n\n- Always copy the client's contact.`, soulDraft: true });
    expect(typing.soulSorted).toBeUndefined();
    expect(store.bot(bot.id)!.soul).toContain("Always copy the client's contact.");
    const settled = await sorter.settle(bot.id);
    expect(settled?.moved[0]?.to).toBe("RULES.md");
    expect(store.bot(bot.id)!.soul).toBe(`${PERSONA}\n\n## Voice\n\n${VOICE}`);
    expect(rulesOf(bot.id)).toContain("- Always copy the client's contact.");
  });

  it("the bot's own change (propose_profile, once applied) is filed right after, as the bot's", async () => {
    const { store, sorter } = wired();
    const bot = store.createBot({ name: "Marc", soul: PERSONA });
    await sorter.flush(bot.id);
    store.patchBotProfile(bot.id, { soul: `${PERSONA}\n\n${RULE}` }, { soulActor: "bot" });
    const report = await sorter.flush(bot.id);
    expect(report?.moved).toHaveLength(1);
    expect(store.bot(bot.id)!.soul).toBe(PERSONA);
    expect(rulesOf(bot.id)).toContain(RULE);
    await flushMemoryJournal(bot.id);
    expect(readMemoryJournal(bot.id).find((entry) => entry.path === RULES_PATH)).toMatchObject({ actor: "bot", via: "soul" });
  });

  it("a Primary Bot's team setup (propose_team_setup) files the new bot's rules", async () => {
    const { store, sorter } = wired();
    const chief = store.createBot({ name: "Chief", section: "Ops" });
    store.patchBot(chief.id, { chiefOfStaff: true });
    store.applyTeamSetup({ version: 1, requestId: "setup-soul", botId: chief.id, threadId: chief.threadId, reason: "Requested", createdAt: 1, requesterRevision: "fixture", newTeams: [], operations: [
      { action: "create", botId: "ada-bot", threadId: "ada-thread", fields: { name: "Ada", section: "Ops", modelSelection: selection(), soul: `You are Ada.\n\n${RULE}` } },
    ] });
    await sorter.flush("ada-bot");
    expect(store.bot("ada-bot")!.soul).toBe("You are Ada.");
    expect(rulesOf("ada-bot")).toContain(RULE);
  });

  it("a new bot (POST /api/bots, the Bot Designer's own) and SOUL.md applied from disk are filed too", async () => {
    const { store, sorter } = wired();
    const made = store.createBot({ name: "Designer", soul: `You design bots.\n\n${RULE}` });
    await sorter.flush(made.id);
    expect(store.bot(made.id)!.soul).toBe("You design bots.");
    store.setSoul(made.id, `You design bots.\n\n- Always ask one question at a time.`);
    await sorter.flush(made.id);
    expect(store.bot(made.id)!.soul).toBe("You design bots.");
    expect(rulesOf(made.id)).toContain("- Always ask one question at a time.");
  });

  it("a version restore, an undo and an import are written as they were", async () => {
    const { store, sorter } = wired();
    const imported = store.createBot({ name: "Imported", soul: `You are Ada.\n\n${RULE}` }, { seedMessages: false, soulWrite: "restore" });
    expect(await sorter.flush(imported.id)).toBeNull();
    expect(store.bot(imported.id)!.soul).toBe(`You are Ada.\n\n${RULE}`);
    store.patchBotProfile(imported.id, { soul: `You are Ada.\n\n- Always restore me.` }, { soulWrite: "restore" });
    expect(await sorter.flush(imported.id)).toBeNull();
    expect(store.bot(imported.id)!.soul).toContain("Always restore me.");
  });

  it("a classification that fails keeps the text in the soul and says so", async () => {
    const { store, sorter } = wired(() => async () => { throw new Error("engine down"); });
    const bot = store.createBot({ name: "Marc", soul: PERSONA });
    await sorter.flush(bot.id);
    store.patchBotProfile(bot.id, { soul: `${PERSONA}\n\n${RULE}` });
    const report = await sorter.flush(bot.id);
    expect(report?.kept).toEqual([{ text: RULE, reason: "unsorted" }]);
    expect(store.bot(bot.id)!.soul).toBe(`${PERSONA}\n\n${RULE}`);
    expect(readMemoryDoc(bot.id, RULES_PATH).exists).toBe(false);
  });
});

describe("isolation (#5019)", () => {
  it("a sort files only into the bot whose soul was written", async () => {
    const { store, sorter } = wired();
    const mine = store.createBot({ name: "Mine", ownerUserId: "pr_ada" });
    const theirs = store.createBot({ name: "Theirs", ownerUserId: "pr_bea" });
    store.patchBotProfile(mine.id, { soul: `You are Mine.\n\n${RULE}` });
    await sorter.flush(mine.id);
    expect(rulesOf(mine.id)).toContain(RULE);
    expect(readMemoryDoc(theirs.id, RULES_PATH).exists).toBe(false);
  });

  it("the preview and the settle of another person's bot are refused, and file nothing", async () => {
    const { store, sorter } = wired();
    const theirs = store.createBot({ name: "Theirs", ownerUserId: "pr_bea", soul: "You are Bea's bot." });
    store.patchBotProfile(theirs.id, { soul: `You are Bea's bot.\n\n${RULE}` }, { soulWrite: "draft" });
    const routes = createBotsCoreSoulRoutes({
      store, soulSorter: sorter, wireBot: (bot: unknown) => bot, ownerOrAdminOf: () => false,
    } as unknown as BotsCoreRouteDeps);
    const call = async (path: string, body: unknown) => {
      const json = vi.fn();
      await routes({ req: {}, res: { on: vi.fn() }, path, method: "POST", auth: { kind: "session", scopes: ["client"] }, json, readBody: async () => body } as never);
      return json.mock.calls[0]!;
    };
    expect((await call(`/api/bots/${theirs.id}/soul/preview`, { soul: `You are Bea's bot.\n\n${RULE}` }))[1]).toBe(403);
    expect((await call(`/api/bots/${theirs.id}/soul/settle`, {}))[1]).toBe(403);
    expect(store.bot(theirs.id)!.soul).toContain(RULE);
    expect(readMemoryDoc(theirs.id, RULES_PATH).exists).toBe(false);
  });
});
