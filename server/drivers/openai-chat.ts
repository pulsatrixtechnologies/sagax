import { createChatCompletions, ModelUnsupportedError } from "./openai-chat-completion.ts";
import type { Completion, RuntimeOptions } from "./openai-chat-types.ts";
import type { OpenAIChatMessage } from "./openai-chat-message.ts";
import { createHash } from "node:crypto";
import type { ProviderInstance, RuntimeEvent, RuntimeEventListener, SendTurnInput } from "../contracts.ts";
import { newEventId } from "../contracts.ts";
import { chatUserContent } from "./chat-images.ts";
import { promptHalves, sectionDelta, sectionFingerprints, volatileContextNote, volatileSectionsUpdate, withContextNote } from "./prompt-split.ts";
import { ChatProtocolError } from "./openai-chat-protocol.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { createOpenAIChatSendTurn } from "./openai-chat-turn.ts";
import { KEY_REJECTED_REASON, keyRejected } from "../key-rejections.ts";
import { DUPLEX_INTERRUPT_WAIT_MS } from "../voice/voice-call-duplex.ts";
import {
  MAX_DELIVERED_THREADS,
  MAX_MODEL_SWITCHES,
  TEXT_ONLY_ATTACHMENT_NOTE,
  noModelLeftMessage,
} from "./openai-chat-shared.ts";

export { ModelUnsupportedError } from "./openai-chat-completion.ts";

export type { OpenAIChatMessage } from "./openai-chat-message.ts";

/** #1696: the engine itself is out of conversation models; the host may move
 * the same turn to another engine (limit-failover-host.ts), as a usage limit does. */
export function isEngineExhaustedRefusal(message: string | undefined): boolean {
  return typeof message === "string" && /no other model of this engine could take over/i.test(message);
}

interface DeliveredUserMessage {
  /** The turn text the harness passed, recall left out, before any note. */
  text: string;
  /** That text as it went to the provider, which is how it is replayed. */
  sent: string;
  /** The trimmed volatile half, when this message carried its note. */
  volatile?: string;
  /** With a note: the volatile sections it carried (prompt-split.ts
   * sectionFingerprints), all of them (`full`) or only those it changed,
   * null for one it announced as gone. Replay merges them to know which
   * copy of each section the replayed history holds. */
  sections?: { full: boolean; prints: Record<string, string | null> };
  /** Fingerprint of the message just before it when it was sent ("" for
   * none), so an identical text sent elsewhere later is not mistaken for it. */
  after: string;
}

/** Bytes replaying messages as sent may add to the stored transcript, which
 * the harness already bounds. Spent oldest first: an earlier message keeps
 * its replayed form for as long as it stays in the window, so a request
 * that runs out of budget changes only at the end of the previous one. */
const MAX_REPLAY_EXTRA_BYTES = 24_000;
const fingerprint = (text: string) => createHash("sha256").update(text).digest("base64url");

/** Line a stored transcript up with what its user messages carried. The
 * stored text is what the person typed, which the turn text ends with after
 * whatever the harness put in front (the clock), so a record matches a
 * message that is its whole text or its last paragraph, and follows the
 * same message it followed when sent. The first message of the window
 * matches on text alone, since what came before it may have been dropped.
 * Matching runs newest first, because the window drops the oldest
 * messages; a message no record matches is replayed as stored. */
function replayDelivered(
  transcript: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  records: readonly DeliveredUserMessage[],
): { content: Map<number, string>; matched: DeliveredUserMessage[]; volatile: string | undefined; sections: Record<string, string> | undefined } {
  const found: Array<{ index: number; record: DeliveredUserMessage }> = [];
  let next = records.length - 1;
  for (let index = transcript.length - 1; index >= 0 && next >= 0; index--) {
    const message = transcript[index]!;
    if (message.role !== "user" || !message.text) continue;
    const after = index > 0 ? fingerprint(transcript[index - 1]!.text) : undefined;
    for (let at = next; at >= 0; at--) {
      const record = records[at]!;
      if (record.text !== message.text && !record.text.endsWith("\n\n" + message.text)) continue;
      if (after !== undefined && record.after !== after) continue;
      found.unshift({ index, record });
      next = at - 1;
      break;
    }
  }
  const content = new Map<number, string>();
  let volatile: string | undefined;
  // The copy of each volatile section the replayed notes hold: unknown
  // (undefined) until a full note is in the window, and again after a note
  // that recorded no sections.
  let sections: Record<string, string> | undefined;
  let budget = MAX_REPLAY_EXTRA_BYTES;
  for (const { index, record } of found) {
    const extra = Buffer.byteLength(record.sent) - Buffer.byteLength(transcript[index]!.text);
    if (extra > budget) break;
    budget -= extra;
    content.set(index, record.sent);
    if (record.volatile !== undefined) {
      volatile = record.volatile;
      if (!record.sections) sections = undefined;
      else if (!record.sections.full && !sections) {
        // Only a partial copy is in the window (its full note was trimmed
        // away): unknown, so the next turn delivers the whole half again.
        volatile = undefined;
      } else {
        const merged: Record<string, string> = record.sections.full ? {} : { ...sections };
        for (const [id, print] of Object.entries(record.sections.prints)) {
          if (print === null) delete merged[id];
          else merged[id] = print;
        }
        sections = merged;
      }
    }
  }
  return { content, matched: found.map(({ record }) => record), volatile, sections };
}

export { announcesAction, noModelLeftMessage } from "./openai-chat-shared.ts";

/** Shared runtime for the three providers that speak OpenAI chat completions. */
export function createOpenAIChatRuntime<Config>(options: RuntimeOptions<Config>): ProviderInstance {
  const { input } = options;
  const resolveKey = (turn?: SendTurnInput): string => {
    if (turn?.access?.via === "owner-key" || turn?.access?.via === "speaker-key") {
      if (turn.access.localKeyPrincipal && typeof options.apiKey === "function") return options.apiKey(turn).trim();
      return turn.access.environment?.SAGAX_PERSONAL_PROVIDER_KEY?.trim() || "";
    }
    return (typeof options.apiKey === "function" ? options.apiKey(turn) : options.apiKey).trim();
  };
  const listeners = new Set<RuntimeEventListener>();
  const active = new Map<string, {
    abort: AbortController;
    turnId: string;
    done: Promise<void>;
    approval: ReturnType<typeof createChatToolApproval>;
    /** Mid-turn user input parked by adapter.steer. Spliced into the
     * request array at the top of the next loop round — the one place the
     * array is between rounds, never mid-tool-batch — so the model reads
     * it before its next completion. Kept out of messages[] until then:
     * a parked item must never look like delivered input. */
    asides: Array<{ text: string; steerId?: string }>;
    /** Set once the turn stops taking rounds: a later steer is refused so the
     * harness sends it as the next turn instead of parking it where no round
     * will ever read it. */
    ending: boolean;
  }>();
  /** Models whose endpoint rejected an echoed `reasoning_content`. In memory
   * only: later rounds and turns omit the field instead of failing again. */
  const reasoningReplayRejected = new Set<string>();
  /** Voice-call threads whose HTTP pool we keep alive with GET /models.
   * There is no process to hold: Node's fetch idle timeout is a few seconds,
   * the call keepalive is minutes, so a ping while any thread is warm. */
  const warmThreads = new Set<string>();
  let warmPing: ReturnType<typeof setInterval> | null = null;

  const modelsUrl = () => `${options.apiUrl.replace(/\/$/, "")}/models`;
  const auth = (apiKey: string): Record<string, string> =>
    options.authHeaders ? options.authHeaders(apiKey) : { authorization: `Bearer ${apiKey}` };

  const pingModels = async (turn?: SendTurnInput) => {
    const apiKey = resolveKey(turn);
    try {
      const response = await fetch(modelsUrl(), {
        method: "GET",
        headers: auth(apiKey),
      });
      // Drain so undici returns the socket to the keep-alive pool.
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  };

  const startWarmPing = () => {
    if (warmPing) return;
    const ms = Number(process.env.FAKE_GROK_WARM_PING_MS ?? "2500");
    if (!Number.isFinite(ms) || ms <= 0) return;
    warmPing = setInterval(() => { void pingModels(); }, ms);
    warmPing.unref?.();
  };

  const stopWarmPing = () => {
    if (!warmPing) return;
    clearInterval(warmPing);
    warmPing = null;
  };

  const rememberWarm = (threadId: string) => {
    const empty = warmThreads.size === 0;
    warmThreads.add(threadId);
    if (empty) startWarmPing();
  };

  const releaseWarm = (threadId: string) => {
    warmThreads.delete(threadId);
    if (warmThreads.size === 0) stopWarmPing();
  };

  /** What each user message of a thread actually carried, oldest first. The
   * stored transcript holds only what the person typed, while the request
   * carried the turn text (the clock) and maybe a context note; replaying
   * the stored text would rewrite history the provider has cached. In memory
   * only: after a restart a thread replays as stored, as it always did. */
  const delivered = new Map<string, DeliveredUserMessage[]>();
  /** "Always allow this session" grants by thread and bot: the exact tools a
   * person allowed one bot for the rest of the conversation. A room runs
   * every member on the room's thread, and one bot's allow is not another's.
   * This runtime has no native session, so the conversation's lives as long
   * as this instance does, as an ACP agent's does with its process; none
   * survives a restart. Not cleared on `sessionReset`: with no cursor to
   * resume, the harness sends that on nearly every turn of this runtime. */
  const sessionGrants = new Map<string, Set<string>>();

  const emit = (event: RuntimeEvent) => {
    for (const listener of Array.from(listeners)) listener(event);
  };
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: options.driverKind,
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });

  /** Models whose /responses request refused an optional part, or that
   * /responses does not serve at all. In memory only. */
  /** Models the provider refused for a conversation (ModelUnsupportedError). */
  const unsupportedModels = new Set<string>();

  const { complete } = createChatCompletions(options, auth);

  /** A model refused for conversations leaves the catalog for good (this
   * process); the next one to try is the catalog's default, else its first
   * row, never one already refused or tried in this turn. */
  const refuseModel = (model: string) => {
    unsupportedModels.add(model);
    options.onModelUnsupported?.(model);
  };
  const nextModel = (tried: ReadonlySet<string>): string | undefined => {
    if (!options.modelFallback) return undefined;
    const catalog = options.models();
    const usable = (id: string) => !unsupportedModels.has(id) && !tried.has(id);
    if (catalog.default && usable(catalog.default)) return catalog.default;
    return catalog.options.find((option) => usable(option.id))?.id;
  };

  const seesImages = (turn: SendTurnInput) =>
    options.imageInput?.(turn.model || options.models().default) ?? true;
  const messagesFor = (turn: SendTurnInput): OpenAIChatMessage[] => {
    // The system message is the head of the resent prefix, so only the
    // stable half belongs there: a volatile edit must not re-price the
    // tools, instructions and transcript the provider already cached.
    // The volatile half rides a user message instead. Earlier user messages
    // are replayed as they were sent, notes included, so the previous
    // request stays a prefix of this one and a note the model already has
    // is not repeated; the newest message carries one only when the replayed
    // history does not already end on the current copy. Automatic recall
    // informed its own turn only and is not replayed.
    const halves = promptHalves(turn);
    const transcript = turn.transcript ?? [];
    const replay = replayDelivered(transcript, delivered.get(turn.threadId) ?? []);
    const volatile = halves.volatile.trim();
    // Only the sections that changed ride when the replayed notes hold a
    // known copy of each (2026-10-19 perf parity, point 4).
    const skip = halves.stable === null || (!turn.mentionTurn && replay.volatile === volatile);
    const sectionsNote = skip || replay.volatile === undefined ? null
      : volatileSectionsUpdate(turn.systemVolatileSections, replay.sections, Boolean(turn.mentionTurn));
    const note = skip ? "" : sectionsNote ?? volatileContextNote(volatile, Boolean(replay.volatile));
    const current = turn.systemVolatileSections ? sectionFingerprints(turn.systemVolatileSections) : undefined;
    const sectionsRecord = !note || !current ? undefined
      : sectionsNote === null ? { full: true, prints: current as Record<string, string | null> }
      : { full: false, prints: sectionDelta(current, replay.sections ?? {}, Boolean(turn.mentionTurn)) };
    const textOnly = (text: string) => !options.computerUse || seesImages(turn) || !turn.images?.length ? text
      : `${text}\n\n${TEXT_ONLY_ATTACHMENT_NOTE}`;
    const userTurn = note ? { ...turn, text: withContextNote(note, turn.text) } : turn;
    const content = options.computerUse && seesImages(turn) ? chatUserContent(userTurn) : textOnly(userTurn.text);
    const kept = turn.recalled ? turn.text.replace(`${turn.recalled}\n\n`, "") : turn.text;
    const record = {
      text: kept,
      sent: textOnly(withContextNote(note, kept)),
      ...(note ? { volatile } : {}),
      ...(sectionsRecord ? { sections: sectionsRecord } : {}),
      after: transcript.length ? fingerprint(transcript.at(-1)!.text) : "",
    };
    delivered.delete(turn.threadId);
    delivered.set(turn.threadId, [...replay.matched, record]);
    if (delivered.size > MAX_DELIVERED_THREADS) delivered.delete(delivered.keys().next().value!);
    const system = halves.stable ?? turn.system;
    return [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...transcript.map((message, index) => ({
        role: message.role,
        content: replay.content.get(index) ?? message.text,
      })),
      { role: "user", content },
    ];
  };

  const sendTurn = createOpenAIChatSendTurn({
    resolveKey, options, pingModels, rememberWarm, releaseWarm, active, warmThreads,
    messagesFor, unsupportedModels, nextModel, sessionGrants, emit, base, complete,
    reasoningReplayRejected, refuseModel, seesImages,
  });

  return {
    instanceId: input.instanceId,
    driverKind: options.driverKind,
    displayName: input.displayName,
    enabled: input.enabled,
    get models() {
      return options.models();
    },
    ...(options.refreshModels ? { refreshModels: options.refreshModels } : {}),
    snapshot: async () => {
      const apiKey = resolveKey();
      if (!apiKey && !options.allowNoKey) return { state: "unavailable", reason: options.unavailableReason };
      if (keyRejected(options.apiUrl, apiKey)) return { state: "available", authenticated: false, reason: KEY_REJECTED_REASON, version: null };
      return { state: "available", authenticated: true, version: null, ...(options.billing ? { billing: options.billing } : {}) };
    },
    adapter: {
      provider: options.driverKind,
      capabilities: { ...(options.computerUse ? { computerMcp: options.tools !== false,
        localComputerMcp: options.tools !== false,
        browserMcp: options.tools !== false, nativeImageInput: true, images: true } : {}),
        // Its tool loop only reaches MCP servers; nothing runs on this machine.
        withholdsHostTools: true,
        sessionModelSwitch: "in-session", customMcp: options.tools !== false, agentsMcp: options.tools !== false,
        dataMcp: options.tools !== false,
        // The runtime owns the whole tool loop, so it can always take a
        // user message mid-turn: park it, deliver before the next completion.
        queueing: true,
        // No shell and no file tool on the host at all: only MCP tools, each
        // call a card in Ask unless "Always allow this session" covers it,
        // and the harness's own agents tools none, as on Claude and Codex
        // (the Boat's `exec` runs on the Boat). A guest's turn is as confined
        // as it gets.
        guestTurns: "confined",
        // GET /models on warmOnly, then ping while the call thread is warm so
        // the next spoken turn reuses the HTTP pool (no billed completion).
        ...(options.warmSession ? { warmSession: true } : {}),
        ...(options.effortLevels ? { effortLevels: options.effortLevels } : {}) },
      sendTurn,
      // #1373: this engine keeps no copy of Ask, Edits or Auto (only Full
      // is read at launch). Every other call asks Sagax, which answers at
      // the live level, so a change applies to the next tool call as is.
      applyApprovalMode: async () => true,
      interruptTurn: async (threadId, turnId) => {
        const turn = active.get(threadId);
        if (!turn || (turnId && turn.turnId !== turnId)) return;
        turn.abort.abort();
        // Free the slot before turn.done: a hanging grok stream must not
        // block the next duplex send (real20 t9/t18 paid the leftover TTFB).
        if (active.get(threadId) === turn) active.delete(threadId);
        await Promise.race([
          turn.done,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, DUPLEX_INTERRUPT_WAIT_MS);
            timer.unref?.();
          }),
        ]);
      },
      respondToRequest: async (threadId, requestId, decision) =>
        active.get(threadId)?.approval.answer(requestId, decision.behavior, decision.message, decision.always) ?? "unavailable",
      steer: async (threadId, text, steerOptions) => {
        // This engine has no external session to respect — parking the
        // words in the live turn's entry IS delivery into the loop, so a
        // successful park is "steered"; a missing or ending turn is
        // refused, so the harness sends the words as the next turn. The
        // words ride the array at the next round boundary, and a final
        // answer that streamed meanwhile gets one more round to read them.
        const running = active.get(threadId);
        if (!running || running.ending) return "refused";
        running.asides.push({ text, ...(steerOptions?.steerId ? { steerId: steerOptions.steerId } : {}) });
        return "steered";
      },
      hasSession: (threadId) => active.has(threadId),
      releaseWarmSession: (threadId) => releaseWarm(threadId),
      stopAll: async () => {
        const turns = [...active.values()];
        for (const turn of turns) turn.abort.abort();
        await Promise.all(turns.map((turn) => turn.done));
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    generateText: async (prompt, { signal, onUsage, model: requested, system, onDelta, maxTokens } = {}) => {
      let model = requested ?? options.generateModel?.() ?? options.models().default;
      const tried = new Set<string>([model]);
      if (options.modelFallback && unsupportedModels.has(model)) model = nextModel(tried) ?? model;
      const messages: OpenAIChatMessage[] = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user", content: prompt },
      ];
      const stream = typeof onDelta === "function";
      let streamed = false;
      let reply: Completion;
      for (;;) {
        tried.add(model);
        try {
          reply = await complete(
            messages, model, stream, signal,
            onDelta ? (delta, kind) => { if (kind === "assistant_text") { streamed = true; onDelta(delta); } } : undefined,
            [], onUsage, maxTokens, resolveKey(),
          );
          break;
        } catch (error) {
          // A helper on a refused model goes on with the next one, as a turn does.
          if (!(error instanceof ModelUnsupportedError) || streamed || signal?.aborted) throw error;
          refuseModel(model);
          const next = tried.size <= MAX_MODEL_SWITCHES ? nextModel(tried) : undefined;
          if (!next) throw new ChatProtocolError(noModelLeftMessage(model));
          model = next;
        }
      }
      const { text, reasoning, toolCalls } = reply;
      if (toolCalls.length) throw new ChatProtocolError("provider returned tool calls to a text-only helper");
      return text.trim() ? text : reasoning;
    },
    ...(options.permissionReview ? {
      reviewPermission: async (prompt: string, signal?: AbortSignal) => {
        const model = options.generateModel?.() ?? options.models().default;
        const { text, reasoning, toolCalls } = await complete(
          [{ role: "user", content: prompt }], model, false, signal,
          undefined, [], undefined, 400, resolveKey(),
        );
        if (toolCalls.length) throw new ChatProtocolError("permission review returned a tool call");
        const answer = (text.trim() ? text : reasoning).trim();
        if (!answer) throw new ChatProtocolError("permission review returned no text");
        return answer;
      },
    } : {}),
    dispose: async () => {
      const turns = [...active.values()];
      for (const turn of turns) turn.abort.abort();
      await Promise.all(turns.map((turn) => turn.done));
      listeners.clear();
      warmThreads.clear();
      stopWarmPing();
    },
  };
}
