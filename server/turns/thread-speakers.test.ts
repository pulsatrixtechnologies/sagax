// #3609: whom a thread's turn speaks for survives a restart, clean or not.
// A root that waited on a teammate (or on a card) when the server stopped
// continues as the same person after the start; a thread kept before its
// speaker was says the turn stopped at the restart instead of failing.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { failedTurnCause } from "../../shared/failed-turn.ts";
import { restartSentenceKey, TURN_NOT_RESUMED } from "../../shared/restart-words.ts";
import type { ModelSelection } from "../contracts.ts";
import { speakerPrincipal, type TurnSpeaker } from "../engines/engine-access.ts";
import { principalDir } from "../people/person-connections.ts";
import { Store } from "../store.ts";
import { continuationSpeaker } from "./continuation-speaker.ts";
import { legacyCutTurnSpeakers, saveInterruptedTurns } from "./interrupted-turns.ts";
import { restartCauseNotResumed } from "./restart-line-words.ts";
import { createPrepareValidateStartTurn } from "./start-turn-prepare-validate.ts";
import { storedTurnSpeaker, ThreadSpeakers } from "./thread-speakers.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "thread-speakers-")); dirs.push(dir); return dir; };

/** One process: its store (bots.json on disk) and its view of the speakers,
 * as server/index.ts builds them. A new process is a new pair over the
 * same files, with nothing in memory. */
function processView() {
  const store = new Store(selection);
  const restored: Array<{ threadId: string; principal: string }> = [];
  const speakers = new ThreadSpeakers(
    () => ({ read: (threadId) => store.threadSpeaker(threadId), write: (threadId, speaker) => store.setThreadSpeaker(threadId, speaker) }),
    (threadId, speaker) => restored.push({ threadId, principal: speakerPrincipal(speaker, "owner") }),
  );
  // threadContinuationSpeaker (server/index.ts): what every continuation carries
  const continuation = (threadId: string) => continuationSpeaker({ lastSpeaker: speakers.get(threadId) });
  return { store, speakers, restored, continuation };
}

/** What the continued turn does first: read its person's own files. */
function readsConnectionsOf(speaker: TurnSpeaker | undefined, dataDir: string): string {
  return principalDir(dataDir, speakerPrincipal(speaker ?? { origin: "person" }, "owner"));
}

describe("a thread's speaker across a restart (#3609)", () => {
  it("a root that waits on a teammate continues as the same person after a crash (no shutdown file)", () => {
    const before = processView();
    const bot = before.store.createBot({});
    const root = before.store.createTask(bot.id, "Lead the team")!.threadId;
    const person: TurnSpeaker = { origin: "person", principalId: "pr_alice", groupId: "grp_ops" };
    // The turn is admitted (start-turn-prepare-claim.ts), hands work to a
    // teammate and waits: it is not busy, so a stop writes nothing for it.
    before.speakers.set(root, person);

    const after = processView();
    // The teammate's result arrives: the delegation wake continues the root.
    const wake = after.continuation(root);
    expect(wake).toEqual(person);
    const dataDir = temp();
    expect(readsConnectionsOf(wake, dataDir)).toBe(join(dataDir, "principals", "pr_alice"));
    // What the admitted turn derived from its speaker is derived again.
    expect(after.restored).toEqual([{ threadId: root, principal: "pr_alice" }]);
  });

  it("a card resume after a clean stop speaks for the same person, routine lineage and peer source", () => {
    const before = processView();
    const bot = before.store.createBot({});
    const thread = before.store.createTask(bot.id, "Asked from another bot")!.threadId;
    const hop: TurnSpeaker = {
      origin: "peer", fromBotId: "bot_lead", principalId: "pr_bob", routine: true, routinePayer: "pr_bob", routineTrigger: "schedule",
      routineOwnerAuthorization: { runId: "run_1", routineId: "rt_1", botId: "bot_lead", principalId: "pr_bob" },
    };
    before.speakers.set(thread, hop);
    // A clean stop writes the cut turns only; whom they speak for stays with the thread.
    saveInterruptedTurns(temp(), [{ botId: bot.id, threadId: thread, at: Date.now() }]);

    const after = processView();
    // dispatchComputerResume / dispatchSecretResume / dispatchTeamSetupResume
    expect(after.continuation(thread)).toEqual(hop);
  });

  it("never takes another person's identity: two people, two threads of one bot, a restart between", () => {
    const before = processView();
    const bot = before.store.createBot({});
    const alice = before.store.createTask(bot.id, "Alice's")!.threadId;
    const bob = before.store.createTask(bot.id, "Bob's")!.threadId;
    before.speakers.set(alice, { origin: "person", principalId: "pr_alice" });
    before.speakers.set(bob, { origin: "person", principalId: "pr_bob" });

    const after = processView();
    expect(after.continuation(alice)).toEqual({ origin: "person", principalId: "pr_alice" });
    expect(after.continuation(bob)).toEqual({ origin: "person", principalId: "pr_bob" });
    // Bob writes again after the restart: Alice's thread still speaks for Alice.
    after.speakers.set(bob, { origin: "person", principalId: "pr_bob", groupId: "grp_b" });
    const again = processView();
    expect(again.continuation(alice)).toEqual({ origin: "person", principalId: "pr_alice" });
    expect(again.continuation(bob)).toEqual({ origin: "person", principalId: "pr_bob", groupId: "grp_b" });
    // Never the bot's owner, never the last person who wrote.
    const fresh = again.store.createTask(bot.id, "No turn yet")!.threadId;
    expect(processView().continuation(fresh)).toBeUndefined();
  });

  it("keeps ids and flags only", () => {
    expect(storedTurnSpeaker({ origin: "person", principalId: "pr_a", token: "x", groupId: 3 })).toEqual({ origin: "person", principalId: "pr_a" });
    expect(storedTurnSpeaker({ origin: "admin" })).toBeUndefined();
    expect(storedTurnSpeaker({ origin: "operator", principalId: "pr_a" })).toEqual({ origin: "operator" });
  });

  it("moves the speakers a stop of an older release wrote into their threads", () => {
    const dataDir = temp();
    saveInterruptedTurns(dataDir, [
      { botId: "b1", threadId: "t1", at: Date.now(), runtimeHeld: true, speaker: { origin: "person", principalId: "pr_a" } },
      { botId: "b1", threadId: "t2", at: Date.now() },
    ]);
    expect(legacyCutTurnSpeakers(dataDir)).toEqual([{ threadId: "t1", speaker: { origin: "person", principalId: "pr_a" } }]);
  });
});

describe("a continuation that cannot know whom it speaks for (#3609)", () => {
  function validateHost() {
    const rows: Array<{ threadId: string; message: any }> = [];
    const host: any = {
      IDENTITY: { kind: "perspicax" },
      workspaceMaintenance: { assertAvailable: () => {} },
      store: {
        bot: () => ({ id: "b1", modelSelection: selection() }),
        appendMessage: (threadId: string, message: any) => { rows.push({ threadId, message }); return message; },
      },
      peerThreadFor: () => "t-main",
      activeRoutineRunForThread: () => null,
      resolveTurnSpeaker: (input: { speaker?: TurnSpeaker }) => input.speaker ?? { origin: "person" },
      healThreadModel: () => { throw new Error("the turn ran"); },
    };
    return { host, rows };
  }

  it("says in its conversation that the turn stopped at the restart, and its waiting client reads interrupted", async () => {
    const { host, rows } = validateHost();
    const settled: Array<{ ok: boolean; text: string }> = [];
    const validate = createPrepareValidateStartTurn(host, async () => { throw new Error("admitted"); });
    const state: any = { botId: "b1", text: "continue", opts: { threadId: "t-old", cardContinuation: true, coordination: { id: "n1", resumed: false, settle: (r: any) => settled.push(r) } } };
    const result = await validate(state);
    expect(result.kind).toBe("return");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.threadId).toBe("t-old");
    const cause = failedTurnCause(String(rows[0]!.message.tool.name));
    expect(cause).toBe(TURN_NOT_RESUMED);
    // the agent API's await_turn reads this cause as "interrupted", never "failed"
    expect(restartCauseNotResumed(cause!)).toBe(true);
    // said in the reader's language through the restart words' catalog key
    expect(restartSentenceKey(cause!)?.key).toBe("restart.notResumed");
    expect(settled).toEqual([{ ok: false, text: TURN_NOT_RESUMED }]);
  });

  it("runs a continuation whose speaker is known", async () => {
    const { host, rows } = validateHost();
    const validate = createPrepareValidateStartTurn(host, async () => { throw new Error("admitted"); });
    const state: any = { botId: "b1", text: "continue", opts: { threadId: "t1", cardContinuation: true, speaker: { origin: "person", principalId: "pr_a" } } };
    await expect(validate(state)).rejects.toThrow("the turn ran");
    expect(rows).toHaveLength(0);
  });
});
