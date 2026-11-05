// One live call's ears (GET /api/bots/<id>/voice/listen): the page's socket
// on one side, xAI's streaming speech to text socket (server/tts/grok.ts
// openTranscriptionStream) on the other. The page sends 16 kHz PCM while the
// person speaks and `finalize` when a turn ends; xAI's transcripts go back.
//
// Stability: the page's socket outlives xAI's. When xAI's socket drops (its
// session limit, a network blip), it is reopened behind the same page socket
// with a backoff (LISTEN_BACKOFF_MS); once it is ready the page is told
// `reconnected` and sends again the utterance it was speaking (what xAI had
// of it is gone). Only after LISTEN_BACKOFF_MS.length failed reopens in a row
// does the page socket close (1011); the page then reconnects on its own. A
// reopen counts as working only once xAI sent a transcript on it or it lived
// LISTEN_STABLE_MS (xAI accepting then closing at once is still failing),
// and more than LISTEN_MAX_REOPENS_PER_MIN reopens in a minute close the
// page too, so a socket that flaps never reopens forever.
// Like the streaming voice, xAI's socket is rotated before its session
// limit: at LISTEN_SOCKET_AGE_MS, once nothing was heard or sent for
// LISTEN_IDLE_MS (no utterance open), the old one is closed and a new one
// opened; audio that arrives meanwhile waits and goes to the new one, so the
// page never notices. Pure of HTTP: the route (voice-mode.ts) wires the
// sockets, the tests drive it with fakes.
import type { TranscriptEvent, TranscriptionHandlers, TranscriptionStream } from "../tts/grok.ts";

/** The waits before each reopen of a dropped xAI socket (then the page is closed). */
export const LISTEN_BACKOFF_MS = [250, 750, 2_000] as const;
/** Rotate xAI's socket before its session limit, as the streaming voice does. */
export const LISTEN_SOCKET_AGE_MS = 540_000;
/** A reopened socket that lived this long (or sent a transcript) works. */
export const LISTEN_STABLE_MS = 10_000;
/** At most this many reopens in a minute; one more closes the page (1011). */
export const LISTEN_MAX_REOPENS_PER_MIN = 6;
/** No audio, finalize or transcript for this long: no utterance is open. */
export const LISTEN_IDLE_MS = 3_000;
/** Audio held while a rotation opens the next socket (10 s of 16 kHz PCM). */
const ROTATE_BUFFER_BYTES = 16_000 * 2 * 10;

/** What the listen socket says to the page (JSON text frames). */
export type ListenFrame =
  | { type: "ready" }
  | { type: "transcript"; text: string; requestId?: string; final: boolean; speechFinal: boolean; confidence?: number; endOfTurnConfidence?: number }
  | { type: "error"; message: string }
  /** xAI's side was replaced: send the open utterance again */
  | { type: "reconnected" };

export interface ListenSessionDeps {
  /** open xAI's socket (language, endpointing and keyterms already fixed) */
  open(handlers: TranscriptionHandlers): TranscriptionStream;
  sendText(frame: ListenFrame): void;
  /** close the page's socket */
  closePage(code: number): void;
  log(line: string): void;
  /** an xAI socket closed (book the usage heard on it) */
  onUpstreamClosed?(): void;
  /** an error message made safe for the page */
  scrub?(message: string): string;
  now?: () => number;
  backoffMs?: readonly number[];
  maxAgeMs?: number;
  idleMs?: number;
}

export interface ListenSession {
  /** true once xAI's socket first opened, false when it did not */
  ready: Promise<boolean>;
  /** xAI's last error on this session (scrubbed, never a key) */
  readonly lastError: string | undefined;
  /** PCM from the page */
  audio(pcm: Uint8Array): void;
  /** the page ended a turn */
  finalize(requestId?: string): void;
  /** the page left (or the route gives up): close everything */
  close(): void;
}

export function createListenSession(deps: ListenSessionDeps): ListenSession {
  const backoff = deps.backoffMs ?? LISTEN_BACKOFF_MS;
  const maxAge = deps.maxAgeMs ?? LISTEN_SOCKET_AGE_MS;
  const idleMs = deps.idleMs ?? LISTEN_IDLE_MS;
  const now = deps.now ?? Date.now;
  let closed = false;
  let everReady = false;
  let upstream: TranscriptionStream | null = null;
  /** the current upstream is ready for audio */
  let live = false;
  /** a rotation is opening the next socket: hold the page's audio for it */
  let holding = false;
  let held: Array<Uint8Array | { requestId?: string }> = [];
  let heldBytes = 0;
  let failures = 0;
  let lastError: string | undefined;
  let openedAt = 0;
  let reopens: number[] = [];
  let lastActivity = now();
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ageTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: (ok: boolean) => void;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });

  const clearAge = () => {
    if (ageTimer) clearTimeout(ageTimer);
    ageTimer = null;
  };

  const flushHeld = () => {
    const queue = held;
    held = [];
    heldBytes = 0;
    holding = false;
    for (const item of queue) {
      if (item instanceof Uint8Array) upstream?.send(item);
      else upstream?.finalize(item.requestId);
    }
  };

  const connect = (reason: "first" | "reconnect" | "rotate") => {
    let mine: TranscriptionStream | null = null;
    const handlers: TranscriptionHandlers = {
      onTranscript: (event: TranscriptEvent) => {
        if (upstream !== mine || closed) return;
        lastActivity = now();
        failures = 0;
        deps.sendText(listenTranscriptFrame(event));
      },
      onError: (message) => {
        if (upstream !== mine || closed) return;
        // a drop is reopened; the page hears about it only if that fails
        lastError = deps.scrub ? deps.scrub(message) : message;
        deps.log(`[voice-listen] xAI speech to text error: ${lastError}`);
      },
      onClose: () => {
        deps.onUpstreamClosed?.();
        if (upstream !== mine) return;
        dropped();
      },
    };
    mine = deps.open(handlers);
    upstream = mine;
    live = false;
    const opened = mine;
    opened.ready.then(() => {
      if (upstream !== opened || closed) return;
      live = true;
      openedAt = now();
      clearAge();
      ageTimer = setTimeout(rotateWhenIdle, maxAge);
      ageTimer.unref?.();
      if (!everReady) {
        everReady = true;
        resolveReady(true);
      } else if (reason === "reconnect") deps.sendText({ type: "reconnected" });
      flushHeld();
    }, () => { /* onClose decides */ });
  };

  const dropped = () => {
    upstream = null;
    live = false;
    clearAge();
    if (closed) return;
    if (!everReady) {
      // the first open failed: the route answers 502, the page uploads
      closed = true;
      resolveReady(false);
      return;
    }
    // what reached the dead socket is lost: the page sends it again after
    // `reconnected`, so nothing held is kept
    held = [];
    heldBytes = 0;
    holding = false;
    // a socket that lived a while worked: the count starts again
    if (openedAt && now() - openedAt >= LISTEN_STABLE_MS) failures = 0;
    openedAt = 0;
    const at = now();
    reopens = reopens.filter((time) => at - time < 60_000);
    if (failures >= backoff.length || reopens.length >= LISTEN_MAX_REOPENS_PER_MIN) {
      deps.log(`[voice-listen] xAI speech to text did not come back after ${failures} tries (${reopens.length} reopens this minute): the page reconnects`);
      closed = true;
      deps.closePage(1011);
      return;
    }
    reopens.push(at);
    const wait = backoff[failures]!;
    failures += 1;
    retry = setTimeout(() => {
      retry = null;
      if (!closed) connect("reconnect");
    }, wait);
    retry.unref?.();
  };

  /** Close the old socket and open the next one, while no utterance is open. */
  function rotateWhenIdle(): void {
    ageTimer = null;
    if (closed || !live || !upstream) return;
    const quiet = now() - lastActivity;
    if (quiet < idleMs) {
      ageTimer = setTimeout(rotateWhenIdle, Math.max(50, idleMs - quiet));
      ageTimer.unref?.();
      return;
    }
    const old = upstream;
    upstream = null;
    live = false;
    holding = true;
    try { old.close(); } catch { /* already closed */ }
    connect("rotate");
  }

  connect("first");

  return {
    ready,
    get lastError() {
      return lastError;
    },
    audio(pcm) {
      if (closed) return;
      lastActivity = now();
      if (live) upstream?.send(pcm);
      else if (holding && heldBytes + pcm.byteLength <= ROTATE_BUFFER_BYTES) {
        held.push(pcm);
        heldBytes += pcm.byteLength;
      }
    },
    finalize(requestId) {
      if (closed) return;
      lastActivity = now();
      if (live) upstream?.finalize(requestId);
      else if (holding) held.push({ requestId });
    },
    close() {
      if (closed && !upstream && !retry) return;
      closed = true;
      if (!everReady) resolveReady(false);
      if (retry) clearTimeout(retry);
      retry = null;
      clearAge();
      const current = upstream;
      upstream = null;
      live = false;
      held = [];
      try { current?.close(); } catch { /* already closed */ }
    },
  };
}

/** One xAI transcript event as the page reads it. */
export function listenTranscriptFrame(event: TranscriptEvent): ListenFrame {
  return {
    type: "transcript", text: event.text, final: event.final, speechFinal: event.speechFinal,
    ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
    ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
    ...(event.endOfTurnConfidence !== undefined ? { endOfTurnConfidence: event.endOfTurnConfidence } : {}),
  };
}
