// #3515: run markers ("RUN_STATUS: skipped", "NOTHING_TO_REPORT") are the
// server's to read: a stored message never carries one, and a row stored
// before reads without them, with no rewrite of the store. A failed or
// partial status line is never lost: its state and reason stay on the row
// (runStatus), and the relay still posts the card the person was promised.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import * as mdb from "./messages/message-db.ts";
import { Store } from "./store.ts";
import { clipReadable, isRoutineMarkerLine, isRunMarkerLine, withoutRoutineMarkers, withoutRunMarkers } from "../shared/routine-result.ts";
import { mirrorLateRunReply, relayPersonAttention, type AttentionBot, type AttentionRelayDeps } from "./turns/person-attention-relay.ts";
import type { WireMessage } from "../shared/wire.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

/** The relay wired to a real store: a teammate's thread "work" another bot
 * opened, and the bot's own conversation the card lands in. */
function relayWorld() {
  const store = new Store(selection);
  const owner = store.createBot({ name: "Wren" }, { seedMessages: false });
  const work = `work-${owner.id}`;
  const bot: AttentionBot = { id: owner.id, name: owner.name };
  const deps: AttentionRelayDeps<AttentionBot> = {
    task: (_botId, threadId) => (threadId === work ? { threadId, title: "@Nova · work", openedBy: { botId: "bot-nova", name: "Nova", kind: "work", at: 1 } } : { threadId, title: owner.name }) as never,
    messages: (threadId) => store.activePath(threadId) as WireMessage[],
    append: (threadId, message) => store.appendMessage(threadId, message as never) as WireMessage,
    patch: (threadId, messageId, patch) => { store.patchMessage(threadId, messageId, patch as never); },
    markUnread: () => {},
    conversation: () => owner.threadId,
    agentConversation: () => false,
    routineRun: () => null,
    ticketUrl: () => undefined,
    notify: () => {},
  };
  return { store, owner, work, bot, deps };
}

describe("run markers in a stored message (#3515)", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("a bot's text and a routine's report are stored without them, on append and on patch", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const skipped = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "RUN_STATUS: skipped\nJ'ai laissé la question de côté." });
    expect(skipped.text).toBe("J'ai laissé la question de côté.");
    expect(skipped.runStatus).toBeUndefined();
    const run = store.appendMessage(bot.threadId, {
      role: "bot", kind: "routine.run", text: "Trois points.",
      routineRun: { runId: "r1", routineId: "rt", routineName: "Veille", status: "completed", summary: "RUN_STATUS: complete. Nothing needs the person's decision.\nTrois points." },
    });
    expect(run.routineRun?.summary).toBe("Trois points.");
    const patched = store.patchMessage(bot.threadId, skipped.id, { text: "Je range le courriel.\nC'est fait.\nNOTHING_TO_REPORT" });
    expect(patched?.text).toBe("Je range le courriel.\nC'est fait.");
    // what the person typed stays as typed
    expect(store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "RUN_STATUS: skipped" }).text).toBe("RUN_STATUS: skipped");
  });

  it("a failed or partial status line leaves the text but stays on the row, with its reason", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const failed = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "RUN_STATUS: failed: the login was refused\nJe n'ai pas pu entrer." });
    expect(failed.text).toBe("Je n'ai pas pu entrer.");
    expect(failed.runStatus).toEqual({ state: "failed", reason: "the login was refused" });
    const partial = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Deux billets sur trois.\n**RUN_STATUS: partial**" });
    expect(partial.text).toBe("Deux billets sur trois.");
    expect(partial.runStatus).toEqual({ state: "partial" });
    // a later patch that carries no status line keeps the one the row has
    expect(store.patchMessage(bot.threadId, failed.id, { turnSucceeded: true })?.runStatus).toEqual({ state: "failed", reason: "the login was refused" });
  });

  it("a text written in pieces, the way an engine's stream grows it, ends with the status kept and no piece of a marker", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const whole = "Je n'ai pas pu entrer dans le portail.\nRUN_STATUS: failed: the login was refused";
    const row = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: whole.slice(0, 20) });
    for (let end = 30; end < whole.length; end += 7) store.patchMessage(bot.threadId, row.id, { text: whole.slice(0, end) });
    const last = store.patchMessage(bot.threadId, row.id, { text: whole });
    expect(last?.text).toBe("Je n'ai pas pu entrer dans le portail.");
    expect(last?.runStatus).toEqual({ state: "failed", reason: "the login was refused" });
    const fresh = new Store(selection).messagesFor(bot.threadId).find((message) => message.id === row.id);
    expect(fresh?.text).toBe("Je n'ai pas pu entrer dans le portail.");
    expect(fresh?.runStatus).toEqual({ state: "failed", reason: "the login was refused" });
  });

  it("a row stored before reads without them, its failed status kept as data", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    mdb.appendMessage(bot.threadId, { id: "old-1", at: 1, role: "bot", kind: "text", text: "Je range le courriel.\nNOTHING_TO_REPORT" } as never);
    mdb.appendMessage(bot.threadId, { id: "old-2", at: 2, parentId: "old-1", role: "bot", kind: "text", text: "RUN_STATUS: complete. Nothing needs the person's decision.\nRien de neuf." } as never);
    mdb.appendMessage(bot.threadId, { id: "old-3", at: 3, parentId: "old-2", role: "bot", kind: "text", text: "RUN_STATUS: failed: the login was refused\nJe n'ai pas pu entrer." } as never);
    const fresh = new Store(selection);
    const rows = fresh.messagesFor(bot.threadId);
    expect(rows.map((message) => message.text)).toEqual(["Je range le courriel.", "Rien de neuf.", "Je n'ai pas pu entrer."]);
    expect(rows.at(-1)?.runStatus).toEqual({ state: "failed", reason: "the login was refused" });
  });

  for (const [line, reason] of [["RUN_STATUS: failed: the login was refused", "the login was refused"], ["RUN_STATUS: partial: two tickets were skipped", "two tickets were skipped"]] as const) {
    it(`a hand-off whose stored turn ends "${line}" still posts the failure card with its reason`, () => {
      const w = relayWorld();
      w.store.appendMessage(w.work, { role: "bot", kind: "text", text: `Je n'ai pas pu finir.\n${line}`, turnId: "turn-1" });
      expect(w.store.activePath(w.work).at(-1)?.text).toBe("Je n'ai pas pu finir.");
      const outcome = relayPersonAttention({ bot: w.bot, threadId: w.work, turnId: "turn-1", ok: true }, w.deps);
      expect(outcome).toMatchObject({ posted: true });
      const card = w.store.activePath(w.owner.threadId).find((message) => message.attention)?.attention;
      expect(card).toMatchObject({ kind: "failure", items: [{ text: reason }] });
    });
  }

  it('"RUN_STATUS: complete" and "RUN_STATUS: skipped" leave nothing: no card, no status', () => {
    const w = relayWorld();
    const done = w.store.appendMessage(w.work, { role: "bot", kind: "text", text: "RUN_STATUS: complete. Nothing needs the person's decision.\nC'est fait.", turnId: "turn-1" });
    const skipped = w.store.appendMessage(w.work, { role: "bot", kind: "text", text: "RUN_STATUS: skipped", turnId: "turn-1" });
    expect([done.text, done.runStatus, skipped.text, skipped.runStatus]).toEqual(["C'est fait.", undefined, "", undefined]);
    expect(relayPersonAttention({ bot: w.bot, threadId: w.work, turnId: "turn-1", ok: true }, w.deps)).toMatchObject({ posted: false });
  });

  it("only lines of their own are markers", () => {
    const prose = "The run status was fine. Nothing to report on DB01, and I moved the archive.";
    expect(withoutRunMarkers(prose)).toBe(prose);
    expect(withoutRunMarkers("**RUN_STATUS: failed: the login was refused**\nDone.\nNOTHING_TO_REPORT")).toBe("Done.");
    expect(withoutRunMarkers("RUN_STATUS\nDone.")).toBe("Done.");
  });

  it('"MOVED Archive" is the bot\'s own words, never a marker: no tool, prompt or skill writes that form, so it stays', () => {
    expect(withoutRunMarkers("Je range le courriel.\nMOVED Archive")).toBe("Je range le courriel.\nMOVED Archive");
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const row = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "J'ai lu le courriel. Je le range.\nMOVED Archive" });
    expect(row.text).toBe("J'ai lu le courriel. Je le range.\nMOVED Archive");
  });

  it("a chat answer in ordinary words is the bot's own: stored, patched and read back whole", () => {
    const answers = ["Nothing to report.", "Same problem.", "**Nothing to report**", "Same problem!\nThe disk is full."];
    for (const answer of answers) expect(withoutRunMarkers(answer)).toBe(answer);
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const rows = answers.map((text) => store.appendMessage(bot.threadId, { role: "bot", kind: "text", text }));
    expect(rows.map((row) => row.text)).toEqual(answers);
    expect(store.patchMessage(bot.threadId, rows[0]!.id, { text: "Same problem." })?.text).toBe("Same problem.");
    mdb.appendMessage(bot.threadId, { id: "old-answer", at: 9, parentId: rows.at(-1)!.id, role: "bot", kind: "text", text: "Nothing to report." } as never);
    const fresh = new Store(selection).messagesFor(bot.threadId);
    expect(fresh.find((message) => message.id === "old-answer")?.text).toBe("Nothing to report.");
    expect(fresh.find((message) => message.id === rows[1]!.id)?.text).toBe("Same problem.");
    // the contract's exact tokens are stripped from every bot row
    const token = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "Toujours hors ligne.\n**SAME_PROBLEM**\nNOTHING_TO_REPORT." });
    expect(token.text).toBe("Toujours hors ligne.");
  });

  it("routine output loses the same-problem and quiet markers in every shape the report reader takes", () => {
    for (const marker of ["SAME_PROBLEM", "Same problem", "same-problem", "SAME PROBLEM", "**Same problem.**", "Nothing to report", "nothing-to-report"]) {
      expect(isRoutineMarkerLine(marker)).toBe(true);
      expect(withoutRoutineMarkers(`Le serveur est toujours hors ligne.\n${marker}`)).toBe("Le serveur est toujours hors ligne.");
    }
    expect(["SAME_PROBLEM", "**SAME_PROBLEM**", "NOTHING_TO_REPORT", "RUN_STATUS: skipped"].every(isRunMarkerLine)).toBe(true);
    expect(["Same problem", "same-problem", "Nothing to report."].some(isRunMarkerLine)).toBe(false);
    // the run's report and its card summary, on write and on read
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const run = store.appendMessage(bot.threadId, {
      role: "bot", kind: "routine.run", text: "Le serveur est toujours hors ligne.\nSame problem",
      routineRun: { runId: "r1", routineId: "rt", routineName: "Veille", status: "completed", summary: "Toujours hors ligne.\nsame-problem" },
    });
    expect([run.text, run.routineRun?.summary]).toEqual(["Le serveur est toujours hors ligne.", "Toujours hors ligne."]);
    mdb.appendMessage(bot.threadId, {
      id: "old-run", at: 9, parentId: run.id, role: "bot", kind: "routine.run", text: "Encore hors ligne.\nSame problem",
      routineRun: { runId: "r0", routineId: "rt", routineName: "Veille", status: "completed", summary: "Encore.\n**Same problem.**" },
    } as never);
    const old = new Store(selection).messagesFor(bot.threadId).find((message) => message.id === "old-run");
    expect([old?.text, old?.routineRun?.summary]).toEqual(["Encore hors ligne.", "Encore."]);
  });

  it("a run's late reply is mirrored without the same-problem line", () => {
    const w = relayWorld();
    w.store.appendMessage(w.work, { role: "bot", kind: "text", text: "Le serveur est toujours hors ligne.\nSame problem", turnId: "turn-1" });
    const deps = { ...w.deps, routineRun: (threadId: string) => (threadId === w.work ? { id: "run-1", routineName: "Veille", status: "completed" } : null) } as AttentionRelayDeps<AttentionBot>;
    expect(mirrorLateRunReply({ bot: w.bot, threadId: w.work, turnId: "turn-1", ok: true }, deps)).toBe(true);
    expect(w.store.activePath(w.owner.threadId).at(-1)?.text).toBe("Le serveur est toujours hors ligne.");
  });

  it("a marker inside a fenced code block is what the bot quoted: kept whole, never read as a status", () => {
    const quoted = "Voici la sortie du run :\n```\nRUN_STATUS: failed: the login was refused\nNOTHING_TO_REPORT\nSAME_PROBLEM\nMOVED Archive\n```\nC'est tout.";
    expect(withoutRunMarkers(quoted)).toBe(quoted);
    const store = new Store(selection);
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const row = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: quoted });
    expect(row.text).toBe(quoted);
    expect(row.runStatus).toBeUndefined();
  });

  it("a prose line that starts with Run status is the bot's own words, kept", () => {
    const report = "Voici le rapport.\nRun status: 3 of 12 backup jobs failed on DB01.\nJe surveille.";
    expect(withoutRunMarkers(report)).toBe(report);
    expect(withoutRunMarkers("**Run status of the nightly jobs**\nAll green.")).toBe("**Run status of the nightly jobs**\nAll green.");
    expect(withoutRunMarkers("RUN_STATUSES are listed below.")).toBe("RUN_STATUSES are listed below.");
  });

  it("a shortened text ends at a sentence, never inside a word", () => {
    const text = "Les deux partis sont partisans, et la suite est longue. ".repeat(10);
    const cut = clipReadable(text, 120, "\n[...]");
    expect(cut.endsWith(".\n[...]")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(120);
  });
});
