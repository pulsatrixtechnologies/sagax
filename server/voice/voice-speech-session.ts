// One live call's streaming voice (GET /api/bots/<id>/voice/speech): the
// page's socket on one side, xAI's streaming text to speech socket
// (server/tts/grok.ts openSpeechStream) on the other. Each utterance the
// page opens is one xAI utterance, spoken one after the other on the same
// open socket, its PCM forwarded to the page as binary frames between
// `start` and `done`. An answer is one utterance: `say` with `more: true`
// opens it (`text.delta` without `text.done`), every later clause is an
// `append` (`text.delta`), and `finish` ends it (`text.done`) when the
// answer does. A whole text is `say` alone (`text.delta`, `text.done`).
// Appended text is made speakable here too, without trimming its edges
// (" pense" stays a word of its own). A cancelled utterance (barge-in,
// hold, hang-up) is dropped from the queue, or, when it is the one
// speaking, cleared at xAI (`text.clear`, confirmed by `audio.clear`):
// nothing of it reaches the page after.
//
// Stability: a dropped xAI socket fails the utterances in flight (the page
// goes on over POST /voice/stream) and is reopened with a backoff, at most
// SPEECH_RECONNECTS times in a row (a reopen counts as working once it sent
// audio or lived SPEECH_STABLE_MS) and SPEECH_MAX_REOPENS_PER_MIN a minute; after that the page is told to use POST
// for the rest of the call (`fallback`), logged once. An utterance with
// audio still owed (text sent that its audio does not cover yet, or text.done
// sent) and no progress for SPEECH_STALL_MS, or a clear not confirmed in
// SPEECH_CLEAR_MS, counts as a dropped socket; an open one whose audio has
// caught up waits for the bot's next words; after SPEECH_IDLE_FINISH_MS
// with no new text and no audio owed, its xAI utterance is ended
// (`text.done`, a turn that never sent its finish leaves nothing open at
// xAI). The page's utterance goes on: words appended later open a new xAI
// utterance under the same id, and anything queued behind it ends it. Pure of
// HTTP: the route (voice-mode.ts) wires the sockets, the tests drive it with
// fakes.
import type { SpeechStream, SpeechStreamHandlers } from "../tts/grok.ts";
import { splitHeldDelta } from "../tts/speech-text.ts";

/** Reconnect attempts in a row before the call falls back to POST. */
export const SPEECH_RECONNECTS = 3;
/** A reopened socket that lived this long (or sent audio) works. */
export const SPEECH_STABLE_MS = 10_000;
/** At most this many reconnects in a minute; one more falls back to POST. */
export const SPEECH_MAX_REOPENS_PER_MIN = 6;
/** The waits before each reconnect attempt. */
export const SPEECH_BACKOFF_MS = [250, 750, 2_000] as const;
/** Audio owed without any progress this long: the socket is stuck. */
export const SPEECH_STALL_MS = 8_000;
/** An open utterance's audio has caught up with its text once it is at
 * least this long per character sent (a voice faster than any real one:
 * the tail xAI may hold back for more text stays inside the margin). */
export const SPEECH_CAUGHT_UP_CPS = 30;
/** An open utterance with no new text and no audio owed this long: its
 * xAI utterance ends. */
export const SPEECH_IDLE_FINISH_MS = 20_000;
/** One `append` is cut to this many characters. */
export const SPEECH_APPEND_MAX = 500;
/** A `text.clear` not confirmed this soon: the socket is stuck. */
export const SPEECH_CLEAR_MS = 2_000;
/** A clause id from the page. */
export const SPEECH_ID = /^[\w-]{1,64}$/;
/** xAI closes a streaming socket around 600 s. Rotate while idle before that,
 * so the next clause is not the one that discovers the socket is gone. */
export const SPEECH_SOCKET_AGE_MS = 540_000;

/** What the server says to the page (JSON text frames; audio is binary). */
export type SpeechFrame =
  | { type: "ready"; sampleRate: number }
  | { type: "start"; id: string }
  | { type: "done"; id: string }
  | { type: "skip"; id: string }
  /** these clauses failed (the socket dropped): speak them another way */
  | { type: "error"; ids: string[] }
  /** the socket is gone for this call: POST /voice/stream from now on */
  | { type: "fallback" }
  /** the answer to the page's ping */
  | { type: "pong" };

export interface SpeechSessionDeps {
  /** open xAI's socket (voice, speed and language already fixed) */
  open(handlers: SpeechStreamHandlers): SpeechStream;
  /** the clause made speakable (code, links and markdown out) */
  speakable(text: string): string;
  /** appended text made speakable, its edges kept; `before` is the
   * utterance's text so far (to tell its language) */
  speakableDelta?(text: string, before: string): string;
  /** characters sent to xAI (the usage ledger) */
  usage(characters: number): void;
  sendText(frame: SpeechFrame): void;
  sendBinary(pcm: Uint8Array): void;
  /** close the page's socket */
  closePage(code: number): void;
  log(line: string): void;
  sampleRate: number;
  backoffMs?: readonly number[];
  stallMs?: number;
  clearMs?: number;
  /** override the idle rotation (tests) */
  maxAgeMs?: number;
  /** override SPEECH_IDLE_FINISH_MS (tests) */
  idleFinishMs?: number;
}

export interface SpeechSession {
  /** true once xAI's socket first opened, false when it did not */
  ready: Promise<boolean>;
  /** xAI's last error on this session (this side's own words, never a key) */
  readonly lastError: string | undefined;
  /** a text frame from the page */
  message(text: string): void;
  /** the page left (or the route gives up): close everything */
  close(): void;
}

interface Clause {
  id: string;
  text: string;
  cancelled?: boolean;
  /** the page opened it to grow (`more: true`) */
  more?: boolean;
  /** page sent `finish` (text.done). A complete `say` starts finished. */
  finished?: boolean;
  /** characters sent to xAI, and PCM bytes it sent back */
  sent: number;
  bytes: number;
  /** text.done went to xAI */
  doneSent?: boolean;
  /** its xAI utterance was ended for idleness; the page's goes on */
  sealed?: boolean;
  /** words appended while that end was still being spoken */
  pending?: string;
  /** the last appended word, not finished yet: held until a space or a
   * sentence end so the identifier filter sees it whole (splitHeldDelta) */
  held?: string;
}

export function createSpeechSession(deps: SpeechSessionDeps): SpeechSession {
  const backoff = deps.backoffMs ?? SPEECH_BACKOFF_MS;
  const stallMs = deps.stallMs ?? SPEECH_STALL_MS;
  const clearMs = deps.clearMs ?? SPEECH_CLEAR_MS;
  const maxAgeMs = deps.maxAgeMs ?? SPEECH_SOCKET_AGE_MS;
  const idleFinishMs = deps.idleFinishMs ?? SPEECH_IDLE_FINISH_MS;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let upstream: SpeechStream | null = null;
  let open = false;
  let failures = 0;
  let lastError: string | undefined;
  let openedAt = 0;
  let reopens: number[] = [];
  let closed = false;
  let gone = false;
  let rotating = false;
  let aged = false;
  let ageTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Clause[] = [];
  let current: Clause | null = null;
  let clearing = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });

  const send = (frame: SpeechFrame) => {
    if (!closed) deps.sendText(frame);
  };
  const disarm = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const clearAge = () => {
    if (ageTimer) clearTimeout(ageTimer);
    ageTimer = null;
  };
  const scheduleAge = () => {
    clearAge();
    aged = false;
    ageTimer = setTimeout(() => {
      ageTimer = null;
      aged = true;
      rotateIfIdle();
    }, maxAgeMs);
    ageTimer.unref?.();
  };
  /** The socket is old and nothing is in flight: reconnect without counting
   * a failure, so a long call does not fall back to POST. */
  const rotateIfIdle = () => {
    if (!aged || closed || current || clearing || queue.length || !open || !upstream) return;
    aged = false;
    rotating = true;
    upstream.close();
  };
  /** no progress for `ms`: treat the socket as dropped */
  const arm = (ms: number) => {
    disarm();
    watchdog = setTimeout(() => {
      watchdog = null;
      upstream?.close();
    }, ms);
    watchdog.unref?.();
  };

  /** Audio is owed for the utterance speaking: text.done went, or its
   * audio does not cover the text sent yet. */
  const owed = (clause: Clause) => clause.doneSent === true ||
    (clause.sent > 0 && clause.bytes / 2 / deps.sampleRate < clause.sent / SPEECH_CAUGHT_UP_CPS);
  const unidle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  /** the stall watchdog runs only while audio is owed; an open utterance
   * whose audio has caught up is ended at xAI after idleFinishMs */
  const watch = () => {
    unidle();
    if (current && !clearing && owed(current)) arm(stallMs);
    else if (!clearing) disarm();
    const idle = current;
    if (!idle || clearing || idle.cancelled || idle.finished || idle.sent === 0 || idle.doneSent || owed(idle)) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (current !== idle || clearing || idle.doneSent || !upstream) return;
      idle.sealed = true;
      idle.doneSent = true;
      upstream.done();
      watch();
    }, idleFinishMs);
    idleTimer.unref?.();
  };
  /** Text for the utterance speaking: to xAI, counted. */
  const sendText = (clause: Clause, text: string) => {
    if (!text || !upstream) return;
    clause.sent += text.length;
    deps.usage(text.length);
    upstream.delta(text);
  };
  const sendDone = (clause: Clause) => {
    if (clause.doneSent || !upstream) return;
    // nothing was ever said: no utterance at xAI to end
    if (clause.sent === 0) return finish();
    clause.doneSent = true;
    upstream.done();
  };

  const pump = () => {
    if (closed || !open || current || clearing || !upstream) return;
    const next = queue.shift();
    if (!next) {
      rotateIfIdle();
      return;
    }
    current = next;
    send({ type: "start", id: next.id });
    sendText(next, next.text);
    if (next.finished) sendDone(next);
    watch();
  };

  const finish = () => {
    disarm();
    unidle();
    if (current) send({ type: "done", id: current.id });
    current = null;
    clearing = false;
    pump();
  };

  const lost = (socket: SpeechStream) => {
    if (socket !== upstream) return;
    disarm();
    if (rotating) {
      rotating = false;
      upstream = null;
      open = false;
      if (closed) return;
      connect();
      return;
    }
    const wasOpen = open;
    upstream = null;
    open = false;
    clearing = false;
    if (!wasOpen) resolveReady(false);
    const ids = [...(current && !current.cancelled ? [current.id] : []), ...queue.map((clause) => clause.id)];
    current = null;
    queue = [];
    if (closed) return;
    if (ids.length) send({ type: "error", ids });
    // a socket that lived a while worked: the count starts again (xAI
    // accepting then closing at once is still failing)
    if (openedAt && Date.now() - openedAt >= SPEECH_STABLE_MS) failures = 0;
    openedAt = 0;
    failures += 1;
    const at = Date.now();
    reopens = reopens.filter((time) => at - time < 60_000);
    reopens.push(at);
    if (failures > SPEECH_RECONNECTS || reopens.length > SPEECH_MAX_REOPENS_PER_MIN) {
      gone = true;
      deps.log("[voice-mode] xAI streaming speech dropped; this call speaks over POST /voice/stream from now on");
      send({ type: "fallback" });
      closed = true;
      deps.closePage(1000);
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, backoff[Math.min(failures - 1, backoff.length - 1)] ?? 1_000);
    retry.unref?.();
  };

  const connect = () => {
    if (closed) return;
    let socket: SpeechStream | null = null;
    const mine = () => socket !== null && socket === upstream;
    socket = deps.open({
      onAudio: (pcm) => {
        if (!mine() || !current || current.cancelled) return;
        current.bytes += pcm.byteLength;
        failures = 0;
        deps.sendBinary(pcm);
        watch();
      },
      onDone: () => {
        // a cleared clause's own done may come before audio.clear: wait for it
        if (!mine() || clearing) return;
        // ended for idleness: the page's utterance goes on unless something waits
        const idle = current;
        if (idle?.sealed && (idle.pending || (!idle.finished && !queue.length))) {
          idle.sent = 0;
          idle.bytes = 0;
          idle.doneSent = false;
          disarm();
          const more = idle.pending?.trimStart();
          idle.pending = "";
          if (more) {
            idle.sealed = false;
            sendText(idle, more);
            if (idle.finished) sendDone(idle);
            watch();
          }
          return;
        }
        finish();
      },
      onCleared: () => {
        if (!mine()) return;
        finish();
      },
      onError: (message) => {
        // xAI may close after an error, or not: either way this socket is done
        if (!mine()) return;
        lastError = message;
        deps.log(`[voice-speech] xAI streaming speech error: ${message}`);
        socket?.close();
      },
      onClose: () => {
        if (socket) lost(socket);
      },
    });
    upstream = socket;
    socket.ready.then(() => {
      if (!mine() || closed) return;
      open = true;
      openedAt = Date.now();
      resolveReady(true);
      scheduleAge();
      pump();
    }, () => {});
  };

  const cancel = (id: string) => {
    const queued = queue.findIndex((clause) => clause.id === id);
    if (queued >= 0) {
      queue.splice(queued, 1);
      send({ type: "done", id });
      return;
    }
    if (!current || current.id !== id || current.cancelled) return;
    current.cancelled = true;
    // nothing at xAI to clear (never said, or ended for idleness)
    if (!upstream || !open || (current.sent === 0 && !current.doneSent)) return finish();
    clearing = true;
    upstream.clear();
    arm(clearMs);
  };

  /** Appended words for an open utterance: cleaned, kept, and said now
   * when it is the one speaking. */
  const addWords = (target: Clause, raw: string) => {
    if (!raw) return;
    let text = deps.speakableDelta ? deps.speakableDelta(raw, target.text) : raw;
    // the utterance's first words: no space before them
    if (!target.text || (target.sealed && target.sent === 0)) text = text.trimStart();
    if (!text) return;
    target.text += text;
    if (target === current && open) {
      // more words after an idle end: a new xAI utterance carries them
      // (once the end's own audio is done)
      if (target.sealed && target.doneSent) {
        target.pending = (target.pending ?? "") + text;
        return;
      }
      target.sealed = false;
      sendText(target, text);
      watch();
    }
  };
  /** The utterance is complete: its last held word is whole now. */
  const releaseHeld = (target: Clause) => {
    const held = target.held;
    target.held = "";
    if (held) addWords(target, held);
  };

  connect();

  return {
    ready,
    get lastError() {
      return lastError;
    },
    message(text) {
      if (closed) return;
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      if (!parsed || typeof parsed !== "object") return;
      const frame = parsed as { type?: unknown; id?: unknown; text?: unknown; more?: unknown };
      // the page checks the socket is alive (a half-dead one never closes)
      if (frame.type === "ping") return send({ type: "pong" });
      const id = frame.id;
      if (typeof id !== "string" || !SPEECH_ID.test(id)) return;
      if (frame.type === "cancel") return cancel(id);
      if (frame.type === "append") {
        if (typeof frame.text !== "string" || !frame.text) return;
        const target = current && current.id === id && !current.cancelled ? current : queue.find((clause) => clause.id === id);
        if (!target || target.finished) return;
        const raw = frame.text.slice(0, SPEECH_APPEND_MAX);
        if (!deps.speakableDelta) return addWords(target, raw);
        // an identifier cut between two appends is cleaned whole: the last
        // unfinished word waits for the next append or finish (audio is
        // already playing then, so the wait is not heard). The opening
        // `say` is not held: its first words are the call's first audio.
        const { ready, held } = splitHeldDelta(`${target.held ?? ""}${raw}`);
        target.held = held;
        addWords(target, ready);
        return;
      }
      if (frame.type === "finish") {
        if (current && current.id === id && !current.cancelled) {
          releaseHeld(current);
          current.finished = true;
          if (open) {
            sendDone(current);
            watch();
          }
          return;
        }
        const queued = queue.find((clause) => clause.id === id);
        if (queued) {
          releaseHeld(queued);
          queued.finished = true;
        }
        return;
      }
      if (frame.type !== "say" || typeof frame.text !== "string") return;
      if (gone) return send({ type: "error", ids: [id] });
      const clean = deps.speakable(frame.text);
      const more = frame.more === true;
      // an open utterance with nothing to say yet stays open for its words
      if (!clean && !more) return send({ type: "skip", id });
      queue.push({ id, text: clean, more, finished: !more, sent: 0, bytes: 0 });
      // an utterance ended for idleness gives way to what comes next
      if (current?.sealed && current.sent === 0 && !current.doneSent) return finish();
      pump();
    },
    close() {
      if (closed) return;
      closed = true;
      disarm();
      unidle();
      clearAge();
      if (retry) clearTimeout(retry);
      retry = null;
      resolveReady(false);
      const socket = upstream;
      upstream = null;
      socket?.close();
    },
  };
}
