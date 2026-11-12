// #3581: a server is rolled before people update their apps. Every row the
// server writes into a bot's main conversation for work done elsewhere (a
// card for the person, a run's late answer on its card, an AI client's row
// and its trace) must be a shape the released apps draw
// (shared/fixtures/chat-rows-released.json), else they show an update
// notice or an empty row.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { WireMessage } from "../../shared/wire.ts";
import { mirrorBackgroundReply, mirrorLateRunReply, relayPersonAttention, type AttentionBot, type AttentionRelayDeps } from "./person-attention-relay.ts";

interface ReleasedApp { kinds: string[]; relayVia: string[]; relayTrace: string[] }
const released = JSON.parse(readFileSync(new URL("../../shared/fixtures/chat-rows-released.json", import.meta.url), "utf8")) as { releases: Record<string, Record<"desktop" | "phone", ReleasedApp>> };

const BOT: AttentionBot = { id: "bot-a", name: "Server" };

/** Every row the relay writes into the person's conversation, by each path. */
function writtenRows(): WireMessage[] {
  const threads = new Map<string, WireMessage[]>();
  let next = 0;
  const add = (threadId: string, row: Partial<WireMessage>) => {
    const list = threads.get(threadId) ?? [];
    const stored = { id: `m${next++}`, at: next, ...row } as WireMessage;
    list.push(stored);
    threads.set(threadId, list);
    return stored;
  };
  const deps: AttentionRelayDeps<AttentionBot> = {
    task: (_botId, threadId) => ({ threadId, title: threadId, ...(threadId === "work" ? { openedBy: { botId: "bot-b", name: "Bot B", kind: "work", at: 1 } } : {}) }) as never,
    messages: (threadId) => threads.get(threadId) ?? [],
    append: (threadId, message) => add(threadId, message),
    patch: (threadId, messageId, patch) => {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((row) => row.id === messageId);
      if (at >= 0) list[at] = { ...list[at]!, ...patch };
    },
    markUnread: () => {},
    conversation: () => "main",
    agentConversation: () => false,
    routineRun: (threadId) => threadId === "run" ? { id: "run-1", routineName: "Backup check", status: "completed" } : null,
    notify: () => {},
    relayVia: (_botId, threadId) => threadId === "client" ? "mcp" : threadId === "work" ? "teammate" : undefined,
    runRow: (_runThreadId, _target, said) => ({ text: said, routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Backup check", status: "completed", summary: said }, rings: true }),
  };
  add("work", { role: "bot", kind: "text", text: "- [HUMAIN] **100201**: decide which client it belongs to.", turnId: "t1" });
  relayPersonAttention({ bot: BOT, threadId: "work", turnId: "t1", ok: true }, deps);
  add("run", { role: "bot", kind: "text", text: "All 12 backups completed.", turnId: "t2" });
  mirrorLateRunReply({ bot: BOT, threadId: "run", turnId: "t2", ok: true }, deps);
  add("client", { role: "user", kind: "text", text: "Close the duplicates" });
  add("client", { role: "bot", kind: "text", text: "Done, 3 closed.", turnId: "t3" });
  mirrorBackgroundReply({ bot: BOT, threadId: "client", turnId: "t3", ok: true }, deps);
  mirrorBackgroundReply({ bot: BOT, threadId: "client", turnId: "t4", ok: false }, deps);
  return threads.get("main") ?? [];
}

describe("the rows a bot's main chat gets from work done elsewhere, in released apps (#3581)", () => {
  const rows = writtenRows();

  it("writes a card, the run's card, an AI client's row and its trace", () => {
    expect(rows.map((row) => [row.kind, Boolean(row.attention), row.relayVia ?? null, row.relayTrace ?? null])).toEqual([
      ["text", true, null, null],
      ["routine.run", false, null, null],
      ["text", false, "mcp", null],
      ["text", false, "mcp", "failed"],
    ]);
  });

  for (const [release, apps] of Object.entries(released.releases)) {
    for (const [app, drawn] of Object.entries(apps)) {
      it(`every row is drawn by the ${release} ${app} app`, () => {
        for (const row of rows) {
          expect(drawn.kinds, `kind ${row.kind}`).toContain(row.kind);
          if (row.relayVia) expect(drawn.relayVia, `relayVia ${row.relayVia}`).toContain(row.relayVia);
          // an app that does not read the trace draws the row's own words
          if (row.relayTrace && !drawn.relayTrace.includes(row.relayTrace)) expect((row.text ?? "").trim()).not.toBe("");
          expect((row.text ?? "").trim(), `${row.kind} carries plain words`).not.toBe("");
        }
      });
    }
  }
});
