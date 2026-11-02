// A voice call is a realtime voice session (the maintainer, 2026-11-02: a call is never
// text to speech, it runs on the configured voice API).
//
// Before: every call ran a pipeline. The page streamed the microphone to
// xAI's speech to text, its own detector decided the end of a turn, the
// words became an ordinary chat turn on the bot (tools, a full model
// answer), and the answer was read by xAI's text to speech. Measured on
// the maintainer's call of 2026-11-02 (bot on Grok 4.7 Fast): 10 to 15 s from his last
// word to the bot's text, half sentences ("That's okay, I'm, I'm") sent as
// turns, and words said while the bot worked queued as a steer that drained
// as a second full answer (the same mail read twice).
//
// Now: the call is one realtime session at the configured voice API
// (xAI's Voice Agent API, wss://api.x.ai/v1/realtime). The realtime model
// listens and speaks natively; its own server-side turn detection ends a
// turn and cuts its speech on a barge-in. The bot stays the brain for real
// work: its tools, files, memory and approvals are bridged as function
// calls. `work` hands a request to the bot as an ordinary turn on the
// thread (attributed to the person, marked as said on the call); the
// realtime voice says one short sentence while it runs and speaks the
// result when the turn's answer comes back as the function's output.
// Chit-chat, "are you there", a repeat or a thank you are answered by the
// realtime voice at once, without a chat turn.
//
// Rules this module holds, whatever the model does:
//   - One answer per response id: audio of a response the person cut (a
//     barge-in, an interrupt) is dropped, never played later; a function's
//     output is sent once per call id.
//   - A permission card is asked aloud with its two options and decided
//     from the person's own words (spokenConsent "voice"), never from the
//     model's arguments; anything unclear asks again; never "always allow".
//   - The key stays on the server; the page only sends PCM and gets PCM.
//   - Nothing said on the call is logged: counters and milliseconds only.
import { randomUUID } from "node:crypto";

import { spokenConsent } from "../shared/call-consent.ts";

/** xAI's Voice Agent API. Tests point SAGAX_XAI_REALTIME_URL at a loopback fake. */
export const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
/** PCM16 mono at this rate both ways (the page resamples once). */
export const REALTIME_SAMPLE_RATE = 24_000;
/** How long a delegated piece of work may run before the voice is told it
 * is still going (it may say so once). */
export const WORK_STATUS_MS = 20_000;
/** The longest a delegated turn is waited for before the voice says it
 * continues in the chat. */
export const WORK_TIMEOUT_MS = 10 * 60_000;
/** Server turn detection: the silence that ends a turn. 500 ms is the
 * reference apps' default; a stutter ("I'm, I'm") is one turn. */
export const TURN_SILENCE_MS = 500;
const MAX_OUTPUT_CHARS = 6_000;

export function realtimeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SAGAX_XAI_REALTIME_URL?.trim() ?? "";
  return /^ws:\/\/127\.0\.0\.1:\d{1,5}(\/[\w/.-]*)?$/.test(override) ? override : XAI_REALTIME_URL;
}

/** Why a call ended on the voice's side, in words the page maps to a
 * plain sentence (src/lib/voice-mode/realtime-call.ts realtimeDropText):
 * the key refused, the network, or the voice service's own failure. */
export type RealtimeDropReason = "key" | "network" | "server";

/** The upstream close code (and the last error the socket said) as a drop
 * reason. 1008 and the 4xxx auth codes are a refused key, 1011 to 1014 a
 * failure of the voice service; anything else (1006: no close frame) the
 * network. */
export function realtimeDropReason(code: number | undefined, lastError?: string): RealtimeDropReason {
  if (code === 1008 || code === 4001 || code === 4003 || code === 4401 || code === 4403) return "key";
  if (lastError && /rejected the key|api key|permission|credits/i.test(lastError)) return "key";
  if (code !== undefined && code >= 1011 && code <= 1014) return "server";
  if (code !== undefined && code >= 4500 && code < 4600) return "server";
  return "network";
}

export interface RealtimeBot {
  name: string;
  title?: string;
  description?: string;
}

export interface RealtimeHistoryLine {
  role: "user" | "assistant";
  text: string;
}

/** The voice's instructions: who it is, the phone register, and when the
 * bot's own work is needed (the `work` function). */
export function realtimeInstructions(bot: RealtimeBot, options: { language?: string } = {}): string {
  const name = oneLine(bot.name) || "the assistant";
  const title = oneLine(bot.title ?? "");
  const description = oneLine(bot.description ?? "").slice(0, 400);
  const language = options.language && options.language !== "auto"
    ? `Speak ${options.language.startsWith("fr") ? "French (Québec French when the person speaks it)" : "English"} unless the person switches language.`
    : "Speak the language the person speaks (Québec French when they speak it).";
  return [
    `You are ${name}${title ? `, ${title}` : ""}, on a live phone call with the person you work for.${description ? ` ${description}` : ""}`,
    `You are one assistant, ${name}, and you speak in the first person. Never mention a backend, a function, a tool name, a transcript or another model.`,
    language,
    "Phone register: the verdict first, one to three short spoken sentences, no lists, no markdown, no URLs, no file paths, never an identifier read aloud. Numbers, times and dates the way a person says them. At most one question per turn.",
    "Speech recognition may mishear: infer what they meant. A false start or a repeated word (\"I'm, I'm\") is not a request; wait for the rest.",
    "",
    "Your real work (email, calendar, tickets, files, your memory, your settings, anything that needs facts this call does not hold, and every action) happens through the function `work`.",
    "Call `work` when the person asks a question that needs facts or asks for something to be done, gives a correction to work already asked, or answers a question your work asked. Put their request in `request`, complete and in their words.",
    "Do not call `work` for a greeting, thanks, small talk, \"are you there\", \"can you repeat\", or what you already said on this call: answer those yourself at once.",
    "When you call `work`, first say one short sentence that you are on it (\"I'm checking.\", \"Je regarde.\"). Never guess the result. Never say an action happened before the result says so.",
    "While work runs, if they ask whether you are there or still working, say yes in one short sentence; do not call `work` again for the same request.",
    "When a result comes back, say it in the phone register. Say it once: never repeat a result you already said unless they ask.",
    "A permission request comes to you as a note: ask it with its two options, allow once or deny, then call `answer_permission` after they answer. Never answer it yourself, never offer to always allow.",
    "When the person says goodbye or asks to hang up, say a short goodbye and call `end_call`.",
  ].join("\n");
}

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "work",
    description: "Your own work: your tools (email, calendar, tickets, files, the web), your memory, your settings and this conversation's history. It answers questions and does what is asked. Returns what to say.",
    parameters: {
      type: "object",
      properties: { request: { type: "string", description: "The person's request, complete, in their words and language." } },
      required: ["request"],
    },
  },
  {
    type: "function",
    name: "answer_permission",
    description: "After you asked a permission request aloud and the person answered: records their answer. Their own words decide.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "end_call",
    description: "Hang up, after a short goodbye, when the person says goodbye or asks to end the call.",
    parameters: { type: "object", properties: {}, required: [] },
  },
] as const;

/** The session's configuration (session.update). */
export function realtimeSessionUpdate(input: { bot: RealtimeBot; voice?: string; language?: string }) {
  const voice = input.voice && /^[A-Za-z][\w-]{0,39}$/.test(input.voice) ? input.voice : undefined;
  return {
    type: "session.update",
    session: {
      instructions: realtimeInstructions(input.bot, { language: input.language }),
      ...(voice ? { voice } : {}),
      turn_detection: { type: "server_vad", silence_duration_ms: TURN_SILENCE_MS, prefix_padding_ms: 300, threshold: 0.5 },
      audio: {
        input: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
        output: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
      },
      tools: REALTIME_TOOLS,
    },
  };
}

/** The latest lines of the conversation, as items the voice starts from:
 * "and the other one?" makes sense, and nothing older than the budget. */
export function realtimeHistoryItems(history: readonly RealtimeHistoryLine[], budget = { messages: 8, chars: 4_000, perMessage: 500 }) {
  const picked: RealtimeHistoryLine[] = [];
  let total = 0;
  for (const line of [...history].reverse()) {
    if (picked.length >= budget.messages) break;
    const text = oneLine(line.text).slice(0, budget.perMessage);
    if (!text) continue;
    if (total + text.length > budget.chars) break;
    total += text.length;
    picked.unshift({ role: line.role, text });
  }
  return picked.map((line) => ({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: line.role,
      content: [{ type: line.role === "user" ? "input_text" : "text", text: line.text }],
    },
  }));
}

// ── the bridge ─────────────────────────────────────────────────────────

export interface RealtimeSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** A permission card waiting on the person, as the voice asks it. */
export interface RealtimeCard {
  requestId: string;
  prompt: string;
}

export type RealtimeWorkResult =
  | { kind: "answer"; text: string }
  /** the turn waits on the person: `next` resolves once it goes on */
  | { kind: "card"; card: RealtimeCard; next: () => Promise<RealtimeWorkResult> }
  | { kind: "failed"; reason: string }
  | { kind: "timeout" };

export interface RealtimeBridgeDeps {
  /** Opens the upstream realtime session with the key (Authorization header). */
  openUpstream(): RealtimeSocket;
  /** To the page: JSON frames and PCM16 audio. */
  sendText(frame: Record<string, unknown>): void;
  sendBinary(pcm: Uint8Array): void;
  closePage(code?: number): void;
  /** Hands `request` to the bot as an ordinary turn on the call's thread and
   * resolves with its answer, a card it opened, or its failure. `signal`
   * ends the wait (the call hung up), never the bot's turn. */
  work(request: string, signal: AbortSignal): Promise<RealtimeWorkResult>;
  /** The person's decision on a card (allow once or deny). */
  respond(requestId: string, behavior: "allow" | "deny"): Promise<boolean>;
  /** The call's id (Message.callId on the lines it sends the bot). */
  callId?: string;
  bot: RealtimeBot;
  voice?: string;
  language?: string;
  history: RealtimeHistoryLine[];
  /** Usage: seconds of audio in and out. */
  usage?(seconds: { input: number; output: number }): void;
  log(line: string): void;
  now?(): number;
}

interface ResponseState {
  id: string;
  cancelled: boolean;
  audioBytes: number;
  firstAudioAt?: number;
}

const OPEN = 1;

/** One call: the upstream session, the page, and the rules between them. */
export class RealtimeCallBridge {
  readonly callId: string;
  private readonly deps: RealtimeBridgeDeps;
  private upstream: RealtimeSocket | null = null;
  private readonly responses = new Map<string, ResponseState>();
  private current: ResponseState | null = null;
  /** function call ids already answered (an output goes once) */
  private readonly answeredCalls = new Set<string>();
  /** work in flight, by request (a second identical request joins it) */
  private readonly work = new Map<string, { callIds: Set<string>; abort: AbortController }>();
  private card: (RealtimeCard & { next: () => Promise<RealtimeWorkResult> }) | null = null;
  private lastHeard = "";
  private speechStoppedAt: number | null = null;
  private closed = false;
  private readyResolve!: (ok: boolean) => void;
  readonly ready: Promise<boolean> = new Promise((resolve) => { this.readyResolve = resolve; });
  lastError: string | undefined;
  readonly stats = { turns: 0, works: 0, joined: 0, cancelled: 0, dropped: 0, answers: 0, approvals: 0, firstAudioMs: [] as number[] };
  private inputBytes = 0;
  private outputBytes = 0;

  constructor(deps: RealtimeBridgeDeps) {
    this.deps = deps;
    this.callId = deps.callId ?? randomUUID();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(): void {
    let socket: RealtimeSocket;
    try {
      socket = this.deps.openUpstream();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.readyResolve(false);
      return;
    }
    this.upstream = socket;
    socket.onopen = () => {
      this.send(realtimeSessionUpdate({ bot: this.deps.bot, voice: this.deps.voice, language: this.deps.language }));
      for (const item of realtimeHistoryItems(this.deps.history)) this.send(item);
    };
    socket.onmessage = (event) => this.onUpstream(event.data);
    socket.onerror = (event) => {
      const said = (event as { message?: unknown } | null)?.message;
      this.lastError = typeof said === "string" && said ? said : this.lastError ?? "The realtime voice is not reachable.";
    };
    socket.onclose = (event) => {
      this.readyResolve(false);
      const code = (event as { code?: unknown } | null)?.code;
      if (!this.closed) this.end("upstream", realtimeDropReason(typeof code === "number" ? code : undefined, this.lastError));
    };
  }

  /** PCM16 from the page's microphone. */
  audio(pcm: Uint8Array): void {
    if (this.closed || !pcm.byteLength) return;
    this.inputBytes += pcm.byteLength;
    this.send({ type: "input_audio_buffer.append", audio: Buffer.from(pcm).toString("base64") });
  }

  /** A JSON frame from the page. */
  pageMessage(text: string): void {
    let message: { type?: unknown } | null = null;
    try { message = JSON.parse(text) as { type?: unknown }; } catch { return; }
    if (message?.type === "interrupt") this.cut("interrupt");
    else if (message?.type === "ping") this.deps.sendText({ type: "pong" });
    else if (message?.type === "hangup") this.end("person");
  }

  /** The page went away, or the person hung up. */
  end(by: "person" | "bot" | "upstream" | "page" = "page", reason?: RealtimeDropReason): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.work.values()) entry.abort.abort();
    this.work.clear();
    try { this.upstream?.close(1000); } catch { /* already closed */ }
    this.deps.usage?.({ input: this.inputBytes / 2 / REALTIME_SAMPLE_RATE, output: this.outputBytes / 2 / REALTIME_SAMPLE_RATE });
    const first = this.stats.firstAudioMs;
    const median = first.length ? [...first].sort((a, b) => a - b)[Math.floor(first.length / 2)] : undefined;
    this.deps.log(`[voice-realtime] call ended by=${by}${reason ? ` reason=${reason}` : ""} turns=${this.stats.turns} works=${this.stats.works} joined=${this.stats.joined} cancelled=${this.stats.cancelled} dropped=${this.stats.dropped} answers=${this.stats.answers} approvals=${this.stats.approvals} firstAudioP50=${median ?? "?"}ms`);
    this.deps.sendText({ type: "ended", by, ...(reason ? { reason } : {}) });
    this.deps.closePage(1000);
  }

  private send(event: Record<string, unknown>): void {
    if (!this.upstream || this.upstream.readyState !== OPEN) return;
    try { this.upstream.send(JSON.stringify(event)); } catch { /* the close handler ends the call */ }
  }

  /** Barge-in or the interrupt button: the response being said stops, its
   * audio is dropped, and none of it is played later. */
  private cut(reason: "speech" | "interrupt"): void {
    const speaking = this.current;
    this.deps.sendText({ type: "clear", reason });
    if (!speaking || speaking.cancelled) return;
    speaking.cancelled = true;
    this.stats.cancelled++;
    this.current = null;
    // server VAD already cancels on speech; an explicit cancel covers the button
    if (reason === "interrupt") this.send({ type: "response.cancel" });
  }

  private onUpstream(data: unknown): void {
    if (this.closed) return;
    let event: Record<string, any>;
    try {
      event = JSON.parse(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8")) as Record<string, any>;
    } catch {
      return;
    }
    const type = String(event.type ?? "");
    switch (type) {
      case "session.created":
      case "session.updated":
      case "conversation.created":
        if (type !== "session.created") this.readyResolve(true);
        else if (this.upstream?.readyState === OPEN) this.readyResolve(true);
        return;
      case "input_audio_buffer.speech_started":
        this.speechStoppedAt = null;
        this.deps.sendText({ type: "hearing" });
        this.cut("speech");
        return;
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedAt = this.now();
        this.stats.turns++;
        this.deps.sendText({ type: "thinking" });
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(event.transcript ?? "").trim();
        if (!text) return;
        this.lastHeard = text;
        this.deps.sendText({ type: "transcript", who: "you", id: String(event.item_id ?? randomUUID()), text, final: true });
        return;
      }
      case "response.created": {
        const id = String(event.response?.id ?? event.response_id ?? "");
        if (!id) return;
        const state: ResponseState = { id, cancelled: false, audioBytes: 0 };
        this.responses.set(id, state);
        this.current = state;
        if (this.responses.size > 200) this.responses.delete(this.responses.keys().next().value!);
        return;
      }
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const id = String(event.response_id ?? "");
        const state = this.responses.get(id) ?? (id ? null : this.current);
        // a cut answer never plays, even when its audio is still arriving
        if (!state || state.cancelled) {
          this.stats.dropped++;
          return;
        }
        const pcm = Buffer.from(String(event.delta ?? ""), "base64");
        if (!pcm.byteLength) return;
        if (state.firstAudioAt === undefined) {
          state.firstAudioAt = this.now();
          if (this.speechStoppedAt !== null) {
            const waited = state.firstAudioAt - this.speechStoppedAt;
            this.stats.firstAudioMs.push(waited);
            this.deps.sendText({ type: "first-audio", ms: waited, responseId: id });
            this.speechStoppedAt = null;
          }
          this.deps.sendText({ type: "speaking", responseId: id });
        }
        state.audioBytes += pcm.byteLength;
        this.outputBytes += pcm.byteLength;
        this.deps.sendBinary(pcm);
        return;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const id = String(event.response_id ?? "");
        const state = this.responses.get(id);
        const text = String(event.transcript ?? "").trim();
        if (!text) return;
        this.deps.sendText({ type: "transcript", who: "bot", id: id || randomUUID(), text, final: true, ...(state?.cancelled ? { interrupted: true } : {}) });
        return;
      }
      case "response.function_call_arguments.done":
        this.onFunctionCall(String(event.call_id ?? ""), String(event.name ?? ""), String(event.arguments ?? "{}"));
        return;
      case "response.done": {
        const id = String(event.response?.id ?? event.response_id ?? "");
        const state = this.responses.get(id);
        const status = String(event.response?.status ?? "");
        if (state && (status === "cancelled" || status === "incomplete") && state.audioBytes > 0) state.cancelled = true;
        if (this.current?.id === id) this.current = null;
        this.deps.sendText({ type: "done", responseId: id });
        return;
      }
      case "error": {
        const message = String(event.error?.message ?? "the realtime voice failed");
        this.lastError = message;
        this.deps.log(`[voice-realtime] upstream error: ${String(event.error?.code ?? event.error?.type ?? "error").slice(0, 60)}`);
        // a cancel with nothing to cancel is not a failure
        if (/cancel/i.test(message)) return;
        this.deps.sendText({ type: "error", message: "The voice had a problem. Keep talking, or hang up and call again." });
        return;
      }
      default:
        return;
    }
  }

  private output(callId: string, output: string, speak = true): void {
    if (!callId || this.answeredCalls.has(callId) || this.closed) return;
    this.answeredCalls.add(callId);
    if (this.answeredCalls.size > 500) this.answeredCalls.delete(this.answeredCalls.values().next().value!);
    this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: output.slice(0, MAX_OUTPUT_CHARS) } });
    if (speak) this.send({ type: "response.create" });
  }

  private onFunctionCall(callId: string, name: string, rawArgs: string): void {
    if (!callId || this.answeredCalls.has(callId)) return;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs) as Record<string, unknown>; } catch { args = {}; }
    if (name === "end_call") {
      this.output(callId, JSON.stringify({ ok: true }), false);
      // the goodbye is being said: give it a moment
      setTimeout(() => this.end("bot"), 2_500).unref?.();
      return;
    }
    if (name === "answer_permission") {
      this.onPermission(callId);
      return;
    }
    if (name !== "work") {
      this.output(callId, JSON.stringify({ error: "unknown function" }));
      return;
    }
    const request = String(args.request ?? "").trim();
    if (!request) {
      this.output(callId, JSON.stringify({ error: "say what the person asked" }));
      return;
    }
    const key = request.toLowerCase().replace(/\s+/g, " ");
    const running = this.work.get(key);
    if (running) {
      // the same request again while it runs: it joins, nothing runs twice
      running.callIds.add(callId);
      this.stats.joined++;
      return;
    }
    const abort = new AbortController();
    const entry = { callIds: new Set([callId]), abort };
    this.work.set(key, entry);
    this.stats.works++;
    this.deps.sendText({ type: "working", busy: true });
    const status = setInterval(() => {
      if (this.closed || abort.signal.aborted) return;
      // a quiet note: the voice may say "still on it" if asked
      this.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: "[Status: your work on the last request is still running. Do not start it again.]" }] } });
    }, WORK_STATUS_MS);
    status.unref?.();
    void this.deps.work(request, abort.signal)
      .catch((error): RealtimeWorkResult => ({ kind: "failed", reason: error instanceof Error ? error.message : String(error) }))
      .then((result) => {
        clearInterval(status);
        this.work.delete(key);
        if (this.closed) return;
        this.deps.sendText({ type: "working", busy: this.work.size > 0 });
        const [first, ...joined] = [...entry.callIds];
        for (const id of joined) this.output(id, JSON.stringify({ note: "Same request: answered with the other one. Say nothing more for it." }), false);
        if (!first) return;
        if (result.kind === "answer") {
          this.stats.answers++;
          this.output(first, JSON.stringify({ result: result.text || "Done." }));
        } else if (result.kind === "card") {
          this.card = { ...result.card, next: result.next };
          this.output(first, JSON.stringify({ permission: `${result.card.prompt} Ask: allow once, or deny?` }));
        } else if (result.kind === "timeout") {
          this.output(first, JSON.stringify({ result: "This is taking longer. Say that it continues and the answer will be in the chat." }));
        } else {
          this.output(first, JSON.stringify({ error: "It did not work. Say so in one sentence and what they can do next; never the technical cause." }));
        }
      });
  }

  private onPermission(callId: string): void {
    const card = this.card;
    if (!card) {
      this.output(callId, JSON.stringify({ note: "No permission request is waiting." }));
      return;
    }
    const decision = spokenConsent(this.lastHeard, "voice");
    if (!decision) {
      this.output(callId, JSON.stringify({ ask_again: "Their answer was not clear. Ask again: allow once, or deny?" }));
      return;
    }
    this.card = null;
    this.stats.approvals++;
    void this.deps.respond(card.requestId, decision).then((ok) => {
      this.output(callId, JSON.stringify(ok
        ? { recorded: decision === "allow" ? "Allowed once. Say you continue; the result will follow." : "Denied. Say it is cancelled." }
        : { error: "The permission could not be recorded. Say so briefly." }));
      if (!ok || decision !== "allow") return;
      this.deps.sendText({ type: "working", busy: true });
      void card.next().catch((): RealtimeWorkResult => ({ kind: "failed", reason: "error" })).then((result) => this.later(result));
    });
  }

  /** The rest of a piece of work, after the person allowed it: said as a
   * note the voice reads out (no function call is open any more). */
  private later(result: RealtimeWorkResult): void {
    if (this.closed) return;
    this.deps.sendText({ type: "working", busy: this.work.size > 0 });
    if (result.kind === "card") {
      this.card = { ...result.card, next: result.next };
      this.note(`[Another permission request: ${result.card.prompt} Ask: allow once, or deny?]`);
      return;
    }
    if (result.kind === "answer") this.stats.answers++;
    this.note(result.kind === "answer"
      ? `[Result of the work you started: ${result.text || "Done."} Say it now, once.]`
      : result.kind === "timeout"
        ? "[The work is taking longer: say it continues and the answer will be in the chat.]"
        : "[The work did not succeed: say so in one sentence and what they can do next.]");
  }

  private note(text: string): void {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: text.slice(0, MAX_OUTPUT_CHARS) }] } });
    this.send({ type: "response.create" });
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
