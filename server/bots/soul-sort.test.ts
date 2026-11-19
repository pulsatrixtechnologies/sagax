// The soul holds identity, persona and voice only (#5019): what a write
// adds is filed where it belongs, through the bot tools' own writes.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { closeMessageDb } from "../messages/message-db.ts";
import { flushMemoryJournal, readMemoryJournal, resetMemoryJournalState } from "../memory/memory-journal.ts";
import { MEMORY_INDEX, RULES_PATH, readMemoryDoc } from "../memory/memory-store.ts";
import { RULE_MAX_CHARS, writeRuleSets } from "../rules/rule-sets.ts";
import { updateDoc, updateRules } from "../workspace/workspace-tools.ts";
import { updateMemory } from "../workspace/workspace.ts";
import {
  createSoulSorter,
  docPathFor,
  markAdded,
  parseSoulSortReply,
  soulUnits,
  splitUnder,
  type SoulClassifier,
} from "./soul-sort.ts";
import { soulSortWriters } from "./soul-sort-writers.ts";
import { soulSortModel as model } from "../testing/soul-sort-model.ts";

let counter = 0;
let BOT = "";

beforeEach(() => {
  BOT = `soul-sort-${process.pid}-${counter++}`;
  closeMessageDb();
  rmSync(join(DATA_DIR, "workspaces"), { recursive: true, force: true });
  resetMemoryJournalState();
});
afterEach(() => {
  closeMessageDb();
});

function sorter(classifier: SoulClassifier, options: { memoryOn?: boolean; soul?: { value: string } } = {}) {
  const soul = options.soul ?? { value: "" };
  return createSoulSorter({
    classifier,
    botName: () => "Marc",
    writers: soulSortWriters({ memoryOn: () => options.memoryOn ?? true }),
    ruleMax: RULE_MAX_CHARS,
    currentSoul: () => soul.value,
    commitSoul: (_botId, next, expected) => {
      if (soul.value !== expected) return false;
      soul.value = next;
      return true;
    },
    settleMs: 60_000,
  });
}

const rules = () => readMemoryDoc(BOT, RULES_PATH).text;
const VOICE = "Never open the way you opened the previous reply.";

describe("units and what a write adds", () => {
  it("cuts paragraphs, list items, leads and headings, and marks only the new ones", () => {
    const before = "Tu es Marc, le répartiteur.\n\n## Voix\n\nCourt et direct.";
    const after = `${before}\n\nRègles :\n- Ne jamais assigner un billet sans vérifier l'horaire.\n  - même le vendredi\n- Toujours copier le contact.\n\n## Flotte\n\n| Bot | Rôle |\n|---|---|\n| Ada | QA |`;
    const parsed = soulUnits(after);
    markAdded(before, parsed);
    expect(parsed.units.map((unit) => [unit.kind, unit.added, unit.text.split("\n")[0]])).toEqual([
      ["text", false, "Tu es Marc, le répartiteur."],
      ["heading", false, "## Voix"],
      ["text", false, "Court et direct."],
      ["lead", true, "Règles :"],
      ["text", true, "- Ne jamais assigner un billet sans vérifier l'horaire."],
      ["text", true, "- Toujours copier le contact."],
      ["heading", true, "## Flotte"],
      ["text", true, "| Bot | Rôle |"],
    ]);
    expect(parsed.units[4]!.text).toContain("même le vendredi");
    expect(parsed.units[4]!.context).toEqual(["## Voix", "Règles :"]);
  });

  it("splits a long rule under the limit, word for word", () => {
    const long = `${"Never assign a ticket before reading its whole history and the client's agreement. ".repeat(9)}Then ask.`;
    const pieces = splitUnder(long, RULE_MAX_CHARS);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((piece) => piece.length <= RULE_MAX_CHARS)).toBe(true);
    expect(pieces.join(" ")).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("a part that does not copy the item exactly throws the verdict away", () => {
    const item = "Tu es Marc. Ne jamais assigner sans vérifier.";
    expect(parseSoulSortReply(JSON.stringify({ items: [{ i: 0, kind: "persona", parts: [{ text: "Ne jamais assigner sans verifier.", kind: "rule" }] }] }), [item])).toEqual([null]);
    expect(parseSoulSortReply(JSON.stringify({ items: [{ i: 0, kind: "persona", parts: [{ text: "Ne jamais assigner sans vérifier.", kind: "rule" }] }] }), [item]))
      .toEqual([{ kind: "persona", parts: [{ text: "Ne jamais assigner sans vérifier.", kind: "rule" }] }]);
    expect(parseSoulSortReply("not json", [item])).toBeNull();
  });

  it("names a document from its title", () => {
    expect(docPathFor("Triage des billets")).toBe("docs/triage-des-billets.md");
    expect(docPathFor("???")).toBe("docs/soul-notes.md");
  });
});

describe("the sort", () => {
  it("files an added rule in RULES.md and takes it and its new heading out of the soul", async () => {
    const before = "You are Marc, the dispatcher.";
    const after = `${before}\n\n## Rules\n\n- Never assign a ticket without checking the schedule.\n- Always copy the client's contact.`;
    const { classifier } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, before, after, "person");
    expect(sorted.soul).toBe(before);
    expect(rules()).toContain("- Never assign a ticket without checking the schedule.");
    expect(rules()).toContain("- Always copy the client's contact.");
    expect(sorted.report.moved.map((move) => [move.kind, move.to])).toEqual([["rule", "RULES.md"], ["rule", "RULES.md"]]);
    expect(sorted.report.kept).toEqual([]);
    // journaled like any rule, as the person's, from the soul
    await flushMemoryJournal(BOT);
    expect(readMemoryJournal(BOT).some((entry) => entry.path === RULES_PATH && entry.actor === "person" && entry.via === "soul")).toBe(true);
  });

  it("keeps voice and persona in the soul (no false positive on the voice rule)", async () => {
    const before = "You are Marc, the dispatcher.";
    const after = `${before}\n\n## Voice\n\n${VOICE}\n\nWarm, short, plain words.`;
    const { classifier } = model(() => ({ kind: "persona" }));
    const sorted = await sorter(classifier).sort(BOT, before, after, "person");
    expect(sorted.soul).toBe(after);
    expect(sorted.report).toEqual({ moved: [], kept: [] });
    expect(readMemoryDoc(BOT, RULES_PATH).exists).toBe(false);
  });

  it("a failed classification keeps the text in the soul and says so", async () => {
    const before = "You are Marc.";
    const after = `${before}\n\nNever assign a ticket without checking the schedule.`;
    const failing: SoulClassifier = () => async () => { throw new Error("engine down"); };
    const sorted = await sorter(failing).sort(BOT, before, after, "person");
    expect(sorted.soul).toBe(after);
    expect(sorted.report.kept).toEqual([{ text: "Never assign a ticket without checking the schedule.", reason: "unsorted" }]);
    const none = await sorter(() => null).sort(BOT, before, after, "person");
    expect(none.soul).toBe(after);
    expect(none.report.kept[0]!.reason).toBe("unsorted");
    const garbled = await sorter(() => async () => "I think it is a rule").sort(BOT, before, after, "person");
    expect(garbled.soul).toBe(after);
  });

  it("moves only the added text: a rule the soul already held stays", async () => {
    const before = "You are Marc.\n\n## Rules\n\n- An old rule kept by hand.";
    const after = `${before}\n\nYou speak Quebec French.`;
    const { classifier, prompts } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, before, after, "person");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("An old rule kept by hand");
    expect(sorted.soul).toContain("- An old rule kept by hand.");
  });

  it("files a procedure and a reference in docs/, and a fact in memory", async () => {
    const before = "You are Marc.";
    const after = `${before}\n\n## Triage\n\n1. Read the ticket.\n2. Check the schedule.\n\nThe client's office closes at 5 pm on Fridays.`;
    const { classifier } = model((text) => text.includes("office") ? { kind: "fact" } : { kind: "procedure", title: "Ticket triage" });
    const sorted = await sorter(classifier).sort(BOT, before, after, "person");
    expect(sorted.soul).toBe(before);
    expect(readMemoryDoc(BOT, "docs/ticket-triage.md").text).toBe("# Ticket triage\n\n1. Read the ticket.\n2. Check the schedule.\n");
    expect(readMemoryDoc(BOT, MEMORY_INDEX).text).toContain("The client's office closes at 5 pm on Fridays.");
    expect(sorted.report.moved.map((move) => move.to)).toEqual(["MEMORY.md", "docs/ticket-triage.md"]);
  });

  it("keeps a fact when memory is off", async () => {
    const after = "You are Marc.\n\nThe client's office closes at 5 pm.";
    const { classifier } = model(() => ({ kind: "fact" }));
    const sorted = await sorter(classifier, { memoryOn: false }).sort(BOT, "You are Marc.", after, "person");
    expect(sorted.soul).toBe(after);
    expect(sorted.report.kept[0]!.reason).toBe("memory-off");
  });

  it("takes the rule sentence out of a mixed paragraph, word for word", async () => {
    const after = "Tu es Marc, le répartiteur. Ne jamais assigner un billet sans vérifier l'horaire.";
    const { classifier } = model(() => ({ kind: "persona", parts: [{ text: "Ne jamais assigner un billet sans vérifier l'horaire.", kind: "rule" }] }));
    const sorted = await sorter(classifier).sort(BOT, "", after, "person");
    expect(sorted.soul).toBe("Tu es Marc, le répartiteur.");
    expect(rules()).toContain("- Ne jamais assigner un billet sans vérifier l'horaire.");
  });

  it("cuts a long rule under the per-rule limit, every word kept", async () => {
    const long = `${"Never assign a ticket before reading its whole history and the client's agreement. ".repeat(9)}Then ask.`.trim();
    const { classifier } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", `You are Marc.\n\n${long}`, "person");
    expect(sorted.soul).toBe("You are Marc.");
    expect(sorted.report.moved[0]!.entries).toBeGreaterThan(1);
    const lines = rules().split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
    expect(lines.every((line) => line.length <= RULE_MAX_CHARS)).toBe(true);
    expect(lines.join(" ")).toBe(long);
  });

  it("a rule RULES.md refuses stays in the soul; one it already has is not added twice", async () => {
    for (let index = 0; index < 98; index += 1) expect(updateRules(BOT, { action: "append", text: `Rule number ${index}.` }).ok).toBe(true);
    const after = "You are Marc.\n\n- Rule number 3.\n- A new rule that does not fit.\n- One more that does not fit.";
    const { classifier } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", after, "person");
    expect(sorted.soul).toBe("You are Marc.\n\n- A new rule that does not fit.\n- One more that does not fit.");
    expect(rules().match(/Rule number 3\./g)).toHaveLength(1);
    expect(sorted.report.moved.map((move) => move.text)).toEqual(["- Rule number 3."]);
    expect(sorted.report.kept.map((kept) => [kept.reason, kept.text])).toEqual([["refused", "A new rule that does not fit."], ["refused", "One more that does not fit."]]);
    expect(sorted.report.kept[0]!.detail).toMatch(/Nothing was saved/);
  });

  it("a mixed add: the voice stays, the rule and the procedure each land once, word for word", async () => {
    const before = "# Nora\n\nTu es Nora, l'adjointe d'Alex.\n\n## Voix\n\nCourte, chaleureuse.";
    const voice = "Tutoie toujours Alex, sur un ton complice.";
    const rule = "Never send an email to a client without asking Alex first.";
    const after = `${before}\n\n${voice}\n\n${rule}\n\n## Ticket triage\n\n- Read the ticket.\n- Check the agreement.\n`;
    const { classifier } = model((text) => text === rule ? { kind: "rule" } : text.startsWith("- ") ? { kind: "procedure", title: "Ticket triage" } : { kind: "persona" });
    const sorted = await sorter(classifier).sort(BOT, before, after, "person");
    expect(sorted.soul).toBe(`${before}\n\n${voice}\n`);
    expect(rules().split("\n").filter((line) => line === `- ${rule}`)).toHaveLength(1);
    expect(readMemoryDoc(BOT, "docs/ticket-triage.md").text).toBe("# Ticket triage\n\n- Read the ticket.\n- Check the agreement.\n");
    expect(sorted.report.kept).toEqual([]);
  });

  it("a rule paragraph with a voice sentence: the rules leave the soul, the voice stays (never in two places)", async () => {
    const after = "You are Marc.\n\nAlways check the schedule before booking. Say it warmly. Never book on Sunday.";
    const { classifier } = model(() => ({ kind: "rule", parts: [{ text: "Say it warmly.", kind: "persona" }] }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", after, "person");
    expect(sorted.soul).toBe("You are Marc.\n\nSay it warmly.");
    expect(rules()).toContain("- Always check the schedule before booking. Never book on Sunday.");
    expect(sorted.soul).not.toContain("Never book on Sunday");
  });

  it("a fact that is only part of a remembered one is written, never dropped", async () => {
    expect(updateMemory(BOT, { action: "append", text: "Client contact: Bobby Tremblay" }).ok).toBe(true);
    const after = "You are Marc.\n\nClient contact: Bob";
    const { classifier } = model(() => ({ kind: "fact" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", after, "person");
    expect(sorted.soul).toBe("You are Marc.");
    expect(readMemoryDoc(BOT, MEMORY_INDEX).text.split("\n").some((line) => line.endsWith("· Client contact: Bob"))).toBe(true);
    // the same fact again is not written twice
    const again = await sorter(classifier).sort(BOT, "You are Marc.", after, "person");
    expect(again.soul).toBe("You are Marc.");
    expect(readMemoryDoc(BOT, MEMORY_INDEX).text.match(/Client contact: Bob$/gm)).toHaveLength(1);
  });

  it("a procedure a document holds only inside longer lines is written, never dropped", async () => {
    expect(updateDoc(BOT, { action: "write", path: "docs/ticket-triage.md", text: "# Ticket triage\n\n- Read the ticket twice, then call.\n" }).ok).toBe(true);
    const after = "You are Marc.\n\n- Read the ticket";
    const { classifier } = model(() => ({ kind: "procedure", title: "Ticket triage" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", after, "person");
    expect(sorted.soul).toBe("You are Marc.");
    expect(readMemoryDoc(BOT, "docs/ticket-triage.md").text).toMatch(/^- Read the ticket$/m);
  });

  it("a rule held only by a set that is off is filed again, so it stays in force", async () => {
    writeRuleSets(BOT, [{ id: "rules", name: null, enabled: true }, { id: "old", name: "Old", enabled: false }]);
    expect(updateRules(BOT, { action: "append", text: "Never book on Sunday.", set: "Old" }).ok).toBe(true);
    const { classifier } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", "You are Marc.\n\nNever book on Sunday.", "person");
    expect(sorted.soul).toBe("You are Marc.");
    expect(rules()).toContain("- Never book on Sunday.");
  });

  it("a full RULES.md files the rule in the next set that is on (#5019)", async () => {
    for (let index = 0; index < 98; index += 1) expect(updateRules(BOT, { action: "append", text: `Rule number ${index}.` }).ok).toBe(true);
    expect(updateRules(BOT, { action: "append", text: "Does not fit." })).toMatchObject({ ok: false, code: "over-budget" });
    expect(updateRules(BOT, { action: "append", text: "First of the new set.", set: "Répartition" })).toMatchObject({ ok: true, created: true });
    const { classifier } = model(() => ({ kind: "rule" }));
    const sorted = await sorter(classifier).sort(BOT, "You are Marc.", "You are Marc.\n\n- Never book on Sunday.", "person");
    expect(sorted.soul).toBe("You are Marc.");
    expect(readMemoryDoc(BOT, "rules/repartition.md").text).toContain("- Never book on Sunday.");
    expect(sorted.report.moved.map((move) => move.to)).toEqual(["rules/repartition.md"]);
  });

  it("a draft is sorted when the editor is left, against the soul it started from", async () => {
    const soul = { value: "You are Marc." };
    const { classifier } = model(() => ({ kind: "rule" }));
    const sort = sorter(classifier, { soul });
    sort.noted({ botId: BOT, before: soul.value, after: "You are Marc.\n\nNever", mode: "draft", actor: "person" });
    soul.value = "You are Marc.\n\nNever assign without checking.";
    sort.noted({ botId: BOT, before: "You are Marc.\n\nNever", after: soul.value, mode: "draft", actor: "person" });
    expect(sort.baseFor(BOT, "ignored")).toBe("You are Marc.");
    const report = await sort.settle(BOT);
    expect(report?.moved[0]?.to).toBe("RULES.md");
    expect(soul.value).toBe("You are Marc.");
    expect(sort.baseFor(BOT, "now")).toBe("now");
    sort.close();
  });

  it("a write sorted after it lands (a bot's own change) commits the sorted soul", async () => {
    const soul = { value: "You are Marc.\n\n- Never assign without checking." };
    const { classifier } = model(() => ({ kind: "rule" }));
    const sort = sorter(classifier, { soul });
    sort.noted({ botId: BOT, before: "You are Marc.", after: soul.value, mode: "sort", actor: "bot" });
    const report = await sort.flush(BOT);
    expect(report?.moved).toHaveLength(1);
    expect(soul.value).toBe("You are Marc.");
    await flushMemoryJournal(BOT);
    expect(readMemoryJournal(BOT).some((entry) => entry.path === RULES_PATH && entry.actor === "bot")).toBe(true);
    // a restore is written as it was
    sort.noted({ botId: BOT, before: soul.value, after: "You are Marc.\n\n- Restored rule.", mode: "restore", actor: "person" });
    expect(await sort.flush(BOT)).toBeNull();
  });

  it("the preview says where each piece will go and writes nothing", async () => {
    const { classifier } = model((text) => text === VOICE ? { kind: "persona" } : { kind: "rule" });
    const preview = await sorter(classifier).preview(BOT, "You are Marc.", `You are Marc.\n\n${VOICE}\n\nNever assign without checking.`);
    expect(preview).toEqual({ moves: [{ kind: "rule", to: "RULES.md", text: "Never assign without checking." }], unsorted: 0 });
    expect(readMemoryDoc(BOT, RULES_PATH).exists).toBe(false);
  });
});
