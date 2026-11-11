/** The idle cost scenes of the app shell gallery (#3624): a person's ordinary
 * window (a dozen bots in sections, a forty message conversation open, the
 * bot panel's Coding section with a team's work, the pinned row) and the
 * server's frames of bots working, fed through the store's own fold
 * (foldLiveFrame) as the live stream delivers them. Measured by
 * scripts/capture/idle-cost.mjs. Every name is synthetic. Not shipped.
 *
 * ?scene=idle       nothing happens
 * ?scene=background three bots work in conversations that are not the open one
 * ?scene=open       the open conversation's bot works */
import { buildTeamWork, type TeamStepFacts } from "../../shared/team-work";
import type { ServerFrame } from "../../shared/wire";
import type { Bot, Message } from "../state/store";

export type Scene = "idle" | "background" | "open";

export function readScene(params: URLSearchParams): Scene | null {
  const scene = params.get("scene");
  return scene === "idle" || scene === "background" || scene === "open" ? scene : null;
}

/** Six more bots for a sidebar of a dozen, in a second section. */
export function moreBots(fr: boolean, at: number): Bot[] {
  const names = ["Orion", "Pixel", "Quill", "Rune", "Sol", "Tide"];
  const colors = ["blue", "green", "orange", "pink", "teal", "purple"];
  return names.map((name, i) => ({
    id: name.toLowerCase(), threadId: `t-${name.toLowerCase()}`, name, title: fr ? "Opérations" : "Operations", description: "",
    notifications: true, color: colors[i]!, unread: false, section: "Ops", modelSelection: { instanceId: "gallery", model: "m" },
    messages: [{ id: `m-${name}`, role: "bot", kind: "text", text: fr ? "Rien de neuf." : "Nothing new.", at: at + i * 60_000 } as Message],
    tasks: [{ threadId: `t-${name.toLowerCase()}`, title: fr ? "Général" : "General", createdAt: at, updatedAt: at + i * 60_000 }],
  }) as unknown as Bot);
}

/** A conversation of `count` messages (questions and answers). */
export function longConversation(fr: boolean, at: number, count: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    const user = i % 2 === 0;
    const n = Math.floor(i / 2) + 1;
    out.push({
      id: `${user ? "u" : "b"}${n}`, role: user ? "user" : "bot", kind: "text", at: at + i * 60_000, parentId: out.at(-1)?.id,
      text: user
        ? (fr ? `Question ${n} sur la file des billets de la semaine.` : `Question ${n} on this week's ticket queue.`)
        : (fr ? `Réponse ${n} : ${n + 2} billets fermés, deux en attente d'un retour.` : `Answer ${n}: ${n + 2} tickets closed, two waiting on a reply.`),
    } as Message);
  }
  return out;
}

/** The open bot's team work (GET /api/bots/:id/team-work): steps running. */
export function sceneTeamWork(orchestratorId: string, fr: boolean, now: number) {
  let seq = 0;
  const ago = (minutes: number) => now - minutes * 60_000;
  const step = (botId: string, title: string, work: string, status: TeamStepFacts["status"], start: number, end?: number): TeamStepFacts => ({
    id: `h${++seq}`, botId, requesterBotId: orchestratorId, threadId: `team-${seq}`, title, work, mode: "work", status,
    createdAt: ago(start), startedAt: ago(start), ...(end !== undefined ? { finishedAt: ago(end) } : {}), coding: true,
    ...(status === "running" ? { turn: { startedAt: ago(start), lastActionAt: now - 90_000 } } : {}),
  });
  const work = fr ? "Cartes d'approbation compactes" : "Compact approval cards";
  const steps = [
    step("orion", fr ? "Conception" : "Design", work, "completed", 40, 30),
    step("pixel", fr ? "Tests" : "Tests", work, "running", 30),
    step("quill", fr ? "Correctif" : "Fix", fr ? "Correctif du rapport" : "Report fix", "completed", 200, 180),
  ];
  const names = new Map([["orion", { name: "Orion" }], ["pixel", { name: "Pixel" }], ["quill", { name: "Quill" }]]);
  return buildTeamWork({ orchestratorId, now, since: ago(12 * 60), steps, names });
}

/** The frames a working bot's turn sends, as the server sends them: the
 * turn's start and its bot, a stream of text deltas, a tool call every two
 * seconds (its activity message, then its patch), and the bot again now and
 * then. Returns the way to stop. */
export function startWorking(botIds: string[], botOf: (botId: string) => Bot | undefined, feed: (frame: ServerFrame) => void): () => void {
  const timers: Array<ReturnType<typeof setInterval>> = [];
  let event = 0;
  // a bot frame is the whole bot but its transcript (reduce-bots.ts botPatched)
  const botFrame = (botId: string, turnStartedAt: number) => {
    const { messages: _messages, ...rest } = botOf(botId) ?? ({ id: botId } as Bot);
    return { kind: "bot", bot: { ...rest, busy: true, turnStartedAt } } as unknown as ServerFrame;
  };
  const base = (threadId: string) => ({ eventId: `e${++event}`, provider: "gallery", threadId, createdAt: new Date().toISOString(), turnId: `turn-${threadId}` });
  for (const botId of botIds) {
    const threadId = `t-${botId}`;
    let tool = 0;
    feed({ kind: "runtime", event: { ...base(threadId), type: "turn.started" } } as ServerFrame);
    const startedAt = Date.now();
    feed(botFrame(botId, startedAt));
    timers.push(setInterval(() => {
      feed({ kind: "runtime", event: { ...base(threadId), type: "content.delta", streamKind: "assistant_text", delta: "and the next words " } } as ServerFrame);
    }, 50));
    timers.push(setInterval(() => {
      const id = `${botId}-tool-${++tool}`;
      const message = { id, role: "bot", kind: "activity", text: "", at: Date.now(), tool: { name: `Read file notes-${tool}.md` } };
      feed({ kind: "runtime", event: { ...base(threadId), type: "item.started", itemType: "tool", title: message.tool.name, itemId: id } } as ServerFrame);
      feed({ kind: "message", threadId, message } as unknown as ServerFrame);
      setTimeout(() => {
        feed({ kind: "runtime", event: { ...base(threadId), type: "item.completed", itemType: "tool", ok: true, itemId: id } } as ServerFrame);
        feed({ kind: "message.patch", threadId, message: { ...message, tool: { ...message.tool, ok: true } } } as unknown as ServerFrame);
      }, 1_000);
    }, 2_000));
    timers.push(setInterval(() => {
      feed(botFrame(botId, startedAt));
    }, 5_000));
  }
  return () => { for (const timer of timers) clearInterval(timer); };
}
