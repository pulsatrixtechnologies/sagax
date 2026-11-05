// The server's half of a call turn's latency timeline
// (docs/voice-mode-xai.md, "Latency"). The page measures the person's side
// (end of speech, speech to text, first audio) and logs it under the
// utterance id; the server logs its own stages under the same id, so the
// two lines of one turn can be put side by side:
//
//   [voice-latency] utt=<id> received->dispatch 12ms dispatch->engine 3ms (warm) engine->first-token 640ms total 655ms
//
// received: the send route accepted the utterance; dispatch: the turn's
// context is built and handed to the engine; engine: the engine took it (a
// warm process, or a cold start); first-token: the first streamed text of the
// answer. Ids and milliseconds only: never the words.

import { audioTurnNotice, callTurnNotice, type VoiceAudioTiming, type VoiceClientTiming } from "./voice-timing.ts";

export type VoiceLatencyStage = "dispatch" | "engine" | "firstToken";

interface Timeline {
  utteranceId: string;
  receivedAt: number;
  marks: Partial<Record<VoiceLatencyStage, number>>;
  /** the engine reused a running process */
  warm?: boolean;
  /** the page's own stages of the turn (voiceCall.timing) */
  client?: VoiceClientTiming;
  /** what the turn ran on and from (server/voice/voice-turn.ts) */
  run?: VoiceTurnRun;
}

/** The model and context of a call turn, for its Events line. */
export interface VoiceTurnRun {
  model?: string;
  /** bytes of context in front of the words */
  contextBytes?: number;
  /** the call's session was started by this turn, or resumed */
  session?: "new" | "resumed";
}

/** A turn that never streams is forgotten after this long. */
const STALE_MS = 2 * 60_000;

export class VoiceLatencyLog {
  private readonly turns = new Map<string, Timeline>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly notice: ((threadId: string, message: string) => void) | undefined;

  constructor(now: () => number = () => performance.now(), log: (line: string) => void = (line) => console.log(line), notice?: (threadId: string, message: string) => void) {
    this.now = now;
    this.log = log;
    this.notice = notice;
  }

  /** A call utterance reached the send route for this thread. */
  received(threadId: string, utteranceId: string, client?: VoiceClientTiming): void {
    this.prune();
    this.turns.set(threadId, { utteranceId, receivedAt: this.now(), marks: {}, ...(client ? { client } : {}) });
  }

  /** A stage of the thread's current call turn (the first time only). */
  mark(threadId: string, stage: VoiceLatencyStage, detail?: { warm?: boolean; run?: VoiceTurnRun }): void {
    const turn = this.turns.get(threadId);
    if (!turn || turn.marks[stage] !== undefined) return;
    turn.marks[stage] = this.now();
    if (detail?.warm !== undefined) turn.warm = detail.warm;
    if (detail?.run) turn.run = detail.run;
    if (stage === "firstToken") {
      this.log(voiceLatencyLine(turn));
      // the same turn in the thread's Events lens, the page's stages first
      const { dispatch, engine, firstToken } = turn.marks;
      const span = (from: number | undefined, to: number | undefined) => (from === undefined || to === undefined ? undefined : Math.max(0, to - from));
      this.notice?.(threadId, callTurnNotice({
        ...(turn.client ? { client: turn.client } : {}),
        dispatchMs: span(turn.receivedAt, dispatch),
        engineMs: span(dispatch, engine),
        firstTokenMs: span(engine ?? dispatch ?? turn.receivedAt, firstToken),
        ...(turn.warm !== undefined ? { warm: turn.warm } : {}),
        ...(turn.run ? { run: turn.run } : {}),
      }));
      this.turns.delete(threadId);
    }
  }

  /** The page heard the answer's first words (POST /voice/call "heard"):
   * its own audio stages, after the server's line of the same turn. */
  heard(threadId: string, audio: VoiceAudioTiming): void {
    this.notice?.(threadId, audioTurnNotice(audio));
  }

  /** The thread's turn ended without streaming text (a tool-only turn, an error). */
  settled(threadId: string): void {
    this.turns.delete(threadId);
  }

  /** The utterance the thread's current call turn is timing (tests). */
  current(threadId: string): string | undefined {
    return this.turns.get(threadId)?.utteranceId;
  }

  private prune(): void {
    const at = this.now();
    for (const [threadId, turn] of this.turns) if (at - turn.receivedAt > STALE_MS) this.turns.delete(threadId);
  }
}

/** One turn's server stages as a log line (ids and milliseconds only). */
export function voiceLatencyLine(turn: Timeline): string {
  const ms = (from: number | undefined, to: number | undefined) => (from === undefined || to === undefined ? "?" : `${Math.round(to - from)}ms`);
  const { dispatch, engine, firstToken } = turn.marks;
  const warmth = turn.warm === undefined ? "" : turn.warm ? " (warm)" : " (cold start)";
  return `[voice-latency] utt=${turn.utteranceId} received->dispatch ${ms(turn.receivedAt, dispatch)} dispatch->engine ${ms(dispatch, engine)}${warmth} engine->first-token ${ms(engine, firstToken)} total ${ms(turn.receivedAt, firstToken)}`;
}
