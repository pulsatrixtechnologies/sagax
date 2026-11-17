// #4439: a bot saves team memory itself and raises no card. A "Remember
// this?" card an earlier version left waiting in a conversation stays
// answerable: Remember saves the entry where the card said, Skip drops it,
// and a second answer gets the real outcome back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "../config.ts";
import { Store } from "../store.ts";
import { TeamMemory } from "../memory/team-memory.ts";
import { personMemoryKey } from "../memory/team-memory-scope.ts";
import { teamMemoryCardSettled, teamMemoryLateAnswer } from "../memory/team-memory-cards.ts";
import { createResolveAndSendTrust } from "./resolveAndSendTrust.ts";
import { removeTempDir } from "../testing/cleanup.ts";

let dir: string;
let store: Store;
let memory: TeamMemory;
const appendDecision = vi.fn();

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "omb-old-team-memory-card-"));
  store = new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));
  memory = new TeamMemory(join(dir, "team-memory.json"));
  appendDecision.mockReset();
});

afterEach(async () => { await removeTempDir(dir); });

function answer() {
  const host = {
    DATA_DIR, appendDecision, store, teamMemory: memory, teamMemoryCardSettled, teamMemoryLateAnswer,
    effectiveBotOwner: () => "owner-1",
    // the server's rule on an organization server: the bot owner's own memory
    teamMemoryKeyFor: (_section: string, owner?: string) => personMemoryKey(owner ?? ""),
    json: (_res: ServerResponse, status: number, body: unknown) => { sent.push({ status, body }); },
  };
  const sent: Array<{ status: number; body: unknown }> = [];
  const resolve = createResolveAndSendTrust(() => host);
  return { sent, run: (threadId: string, requestId: string, behavior: "allow" | "deny") => resolve({} as ServerResponse, threadId, requestId, behavior) };
}

/** A card exactly as the version before #4439 wrote it, still open. */
function oldCard(name: string) {
  const bot = store.createBot({}, { seedMessages: false });
  const proposed = memory.propose(personMemoryKey("owner-1"), { kind: "term", name, detail: `${name} detail` }, { botId: bot.id, botName: "Scout", threadId: bot.threadId, at: 1 });
  store.appendMessage(bot.threadId, {
    role: "bot", kind: "options",
    card: {
      title: "Remember this in the bot owner's own memory?", subtitle: `Term: ${name}`, options: ["Remember", "Skip"],
      requestId: proposed.entry.id, tool: "propose_team_memory",
      teamMemoryRequest: { section: "", entryId: proposed.entry.id, kind: "term" },
    },
  } as never);
  return { bot, entryId: proposed.entry.id };
}

describe("a team memory card left from before #4439", () => {
  it("Remember saves the entry in the bot owner's own memory and closes the card", () => {
    const { bot, entryId } = oldCard("VPN");
    const { sent, run } = answer();
    expect(run(bot.threadId, entryId, "allow")).toBe(true);
    expect(sent).toEqual([{ status: 200, body: { ok: true, outcome: "allowed-once" } }]);
    expect(memory.list(personMemoryKey("owner-1")).find((entry) => entry.id === entryId)?.status).toBe("accepted");
    expect(memory.systemPrompt(personMemoryKey("owner-1"))).toContain("VPN: VPN detail");
    expect(store.messagesFor(bot.threadId).find((message) => message.card?.requestId === entryId)?.card?.answered).toBe("allow");
    // a second click gets the real outcome, never a fresh answer
    run(bot.threadId, entryId, "deny");
    expect(sent[1]).toMatchObject({ status: 409, body: { outcome: "allowed-once" } });
  });

  it("Skip drops it, as the person chose", () => {
    const { bot, entryId } = oldCard("OKR");
    const { sent, run } = answer();
    run(bot.threadId, entryId, "deny");
    expect(sent[0]).toEqual({ status: 200, body: { ok: true, outcome: "rejected" } });
    expect(memory.list(personMemoryKey("owner-1"))).toEqual([]);
  });
});
