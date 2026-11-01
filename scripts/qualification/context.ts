// What a scenario drives and what the runner judges. A scenario sends,
// waits and checks; the generic rules (no accepted message lost, none
// answered twice, nothing left busy) are applied by `judge()` for every task
// the same way, so a scenario cannot forget them.
import { QualServer, SseTap, sleep, now, type TimedFrame } from "./harness.ts";
import type { EngineProfile } from "./engines.ts";
import type { TaskDefinition } from "./corpus.ts";
import { blankRecord, type TaskRecord } from "./model.ts";

export interface Bot { id: string; threadId: string; name: string }

export interface Accepted {
  marker: string;
  text: string;
  botId: string;
  threadId: string;
  status: number;
  messageId?: string;
  t0: number;
  /** The person stopped it: not delivering it is not a loss. */
  cancelled?: boolean;
  /** Not a latency sample (a send made to provoke a fault). */
  sample?: boolean;
}

export interface Check { name: string; ok: boolean; detail?: string }

export class TaskContext {
  readonly checks: Check[] = [];
  readonly accepted: Accepted[] = [];
  readonly notes: string[] = [];
  readonly bots: Bot[] = [];
  /** Per thread: how many bot text replies must exist at the end (no marker echo to count). */
  readonly expectedTexts = new Map<string, number>();
  /** Echo engines repeat the prompt: each marker must then appear in exactly one bot text. */
  echo = false;
  /** A text folded into a running turn counts as processed. False when the bot routes it to run after (busy-03). */
  foldIsProcessing = true;
  /** A delegated turn quotes the person's request by design: duplicates are judged on the assignments instead. */
  promptCountsDispatch = true;
  /** Another engine than the logged one may answer (failover): a bot reply after the message proves delivery. */
  deliveryByAnswer = false;
  /** Restart tasks fill this in. */
  restartRecovery: TaskRecord["restartRecovery"] = "n/a";
  /** Prompts the engine got that carry a marker, per marker, may legitimately be this many (a restart rerun). */
  allowedDispatches = 1;
  /** Latency windows: the send, the bot whose threads carry the answer. */
  private latency: Array<{ t0: number; botId: string }> = [];
  private counter = 0;
  sse!: SseTap;
  /** Frames of every connection this task opened. */
  readonly tapped: TimedFrame[] = [];

  readonly server: QualServer;
  readonly profile: EngineProfile;
  readonly def: TaskDefinition;

  constructor(server: QualServer, profile: EngineProfile, def: TaskDefinition) {
    this.server = server;
    this.profile = profile;
    this.def = def;
  }

  async openStream() {
    this.sse = await SseTap.open(this.server.url);
  }

  marker(): string {
    this.counter += 1;
    return `QM-${this.def.id.replace(/[^a-z0-9]/gi, "")}-${this.counter}`;
  }

  check(name: string, ok: boolean, detail?: string) {
    this.checks.push({ name, ok, ...(detail ? { detail } : {}) });
    return ok;
  }

  note(text: string) {
    this.notes.push(text);
  }

  api<T = any>(method: string, path: string, body?: unknown) {
    return this.server.api<T>(method, path, body);
  }

  /** Record a send a scenario made outside send() (a routine run, a delegation). */
  record(entry: Accepted) {
    this.accepted.push(entry);
    if (entry.sample) this.latency.push({ t0: entry.t0, botId: entry.botId });
  }

  async newBot(name: string, patch: Record<string, unknown> = {}, create: Record<string, unknown> = {}): Promise<Bot> {
    const created = await this.api("POST", "/api/bots", { name, ...create });
    if (created.status >= 300) throw new Error(`create bot ${name}: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    const bot = created.body.bot as { id: string; threadId: string };
    const modelled = await this.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: this.profile.model, ...patch });
    if (modelled.status >= 300) throw new Error(`set model for ${name}: ${modelled.status} ${JSON.stringify(modelled.body).slice(0, 200)}`);
    const result = { id: bot.id, threadId: bot.threadId, name };
    this.bots.push(result);
    return result;
  }

  async botSnapshot(botId: string): Promise<any> {
    const response = await this.api("GET", "/api/bots?messages=0");
    return (response.body.bots as any[]).find((bot) => bot.id === botId);
  }

  async threadIds(botId: string): Promise<string[]> {
    const bot = await this.botSnapshot(botId);
    const ids = new Set<string>((bot?.tasks ?? []).map((task: any) => task.threadId as string));
    if (bot?.threadId) ids.add(bot.threadId);
    return [...ids];
  }

  async messages(threadId: string): Promise<any[]> {
    const response = await this.api("GET", `/api/threads/${threadId}/messages?limit=500`);
    const messages = (response.body?.messages ?? []) as any[];
    // The bot's own first greeting is the bot's, not an answer to anyone.
    return messages.filter((message, index) => !(index === 0 && message.role === "bot" && message.kind === "text" && String(message.text ?? "").startsWith('Hi, I\'m ')));
  }

  /** All messages of every thread of a bot, in one list. */
  async allMessages(botId: string): Promise<any[]> {
    const out: any[] = [];
    for (const id of await this.threadIds(botId)) out.push(...await this.messages(id));
    return out;
  }

  /** A reply's own words: with folding off, what a reply merely quotes of a steered note is not an answer. */
  ownText(text: string): string {
    const own = stripContext(text);
    return this.foldIsProcessing ? own : own.split(" + steered:")[0]!;
  }

  /** The bot's text replies. The slow fake engine opens every turn with a fixed line before it echoes; that line is the fixture's, not a reply. */
  botTexts(messages: any[]): any[] {
    return messages.filter((message) => message.role === "bot" && message.kind === "text" && !(this.echo && message.text === "hello from fake claude"));
  }

  /** Send one message the way a person's app does and remember it for the judge. */
  async send(bot: Bot, text: string, options: { threadId?: string; routeWhileBusy?: boolean; sample?: boolean; marker?: string } = {}): Promise<Accepted> {
    const marker = options.marker ?? this.marker();
    const body = `${text}${text.includes(marker) ? "" : ` [${marker}]`}`;
    const threadId = options.threadId ?? bot.threadId;
    const t0 = now();
    const response = await this.api("POST", `/api/bots/${bot.id}/messages`, {
      text: body, threadId, ...(options.routeWhileBusy ? { routeWhileBusy: true } : {}),
    });
    const entry: Accepted = {
      marker, text: body, botId: bot.id, threadId, status: response.status, t0,
      messageId: response.body?.message?.id, sample: options.sample ?? false,
    };
    this.accepted.push(entry);
    if (entry.sample) this.latency.push({ t0, botId: bot.id });
    return entry;
  }

  /** Mark a send as one whose latency counts. */
  sampleFrom(entry: Accepted) {
    if (!this.latency.some((window) => window.t0 === entry.t0 && window.botId === entry.botId)) this.latency.push({ t0: entry.t0, botId: entry.botId });
  }

  /** Wait until every named bot (default: all) is idle with nothing queued, then a short quiet period. */
  async settle(timeoutMs = 30_000, bots: Bot[] = this.bots): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (Date.now() < deadline) {
      let idle = true;
      for (const bot of bots) {
        const snapshot = await this.botSnapshot(bot.id);
        if (!snapshot) continue;
        const busyTask = (snapshot.tasks ?? []).some((task: any) => task.busy || task.waitingForTeammates);
        if (snapshot.busy || snapshot.waitingForTeammates || busyTask) idle = false;
      }
      if (idle && this.queuedWords() === 0) {
        quiet += 1;
        if (quiet >= 3) return true;
      } else quiet = 0;
      await sleep(150);
    }
    return false;
  }

  /** Words the server still holds in a steer queue (last `bot.queued` frame). */
  queuedWords(): number {
    const last = [...this.sse.frames].reverse().find((entry) => entry.frame.kind === "bot.queued")?.frame;
    if (!last?.queues) return 0;
    const queues = last.queues as Record<string, unknown>;
    return Object.values(queues).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
  }

  /** Like waitUntil, but a miss is an answer, not a failed check. */
  async waitUntilQuiet(predicate: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await sleep(150);
    }
    return false;
  }

  async waitUntil(what: string, predicate: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await sleep(100);
    }
    this.check(`waited for ${what}`, false, `not seen in ${timeoutMs} ms`);
    return false;
  }

  /** Latency of each window, from the event stream. */
  async samples(): Promise<Array<{ ttftMs: number | null; finalMs: number | null }>> {
    const out: Array<{ ttftMs: number | null; finalMs: number | null }> = [];
    const frames = this.sse.frames;
    for (const window of this.latency) {
      const threads = new Set(await this.threadIds(window.botId));
      let first: number | null = null;
      let last: number | null = null;
      for (const { t, frame } of frames) {
        if (t < window.t0) continue;
        const event = frame.kind === "runtime" ? frame.event : null;
        const delta = event?.type === "content.delta" && String(event.streamKind ?? "").startsWith("assistant") && threads.has(event.threadId);
        const text = frame.kind === "message" && frame.message?.role === "bot" && frame.message?.kind === "text" && threads.has(frame.threadId);
        const done = event?.type === "turn.completed" && threads.has(event.threadId);
        if ((delta || text) && first === null) first = t - window.t0;
        if (text || done) last = t - window.t0;
      }
      out.push({ ttftMs: first === null ? null : Math.round(first), finalMs: last === null ? null : Math.round(last) });
    }
    return out;
  }
}

/** The request inside prompt text: without the harness's own context (memory notes and recalled passages quote earlier messages) and without the quoted "recent lines" a parallel task is briefed with. */
export function stripContext(input: string): string {
  let text = input;
  const reminderEnd = text.lastIndexOf("</system-reminder>");
  if (reminderEnd >= 0) text = text.slice(reminderEnd + "</system-reminder>".length);
  text = text.replace(/Recalled for this message[\s\S]*?\[end of recalled passages[^\]]*\]/g, "");
  return text.replace(/Recent lines of that conversation[^\n]*\n(?:- [^\n]*\n?)+/g, "");
}

/** What an engine prompt line asks for. */
export function promptRequestText(line: string): string {
  let text = line;
  try {
    const content = (JSON.parse(line) as any)?.message?.content;
    text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => (typeof part === "string" ? part : part?.text ?? "")).join("\n") : line;
  } catch { /* not JSON: use the line */ }
  return stripContext(text);
}

export function promptCount(prompts: string[], marker: string): number {
  return prompts.filter((line) => promptRequestText(line).includes(marker)).length;
}

/** Apply the generic rules and build the task record. */
export async function judge(ctx: TaskContext, wallMs: number, error?: unknown): Promise<TaskRecord> {
  const def = ctx.def;
  const record = blankRecord({ id: def.id, category: def.category, title: def.title, engine: ctx.profile.kind });
  record.timed = def.timed;
  record.wallMs = Math.round(wallMs);
  record.notes = [...ctx.notes];
  if (error) record.defects.push(`scenario error: ${error instanceof Error ? error.message : String(error)}`);

  // 1. nothing may be left busy, or holding words
  let settled = false;
  try { settled = ctx.sse ? await ctx.settle(20_000) : true; } catch { settled = false; }
  record.stuck = !settled;
  if (!settled) record.defects.push("a bot stayed busy or a queue kept words after the settle window (stuck state)");

  // 2. accepted sends: persisted, delivered, once
  record.acceptedSends = ctx.accepted.filter((entry) => entry.status === 202).length;
  const refused = ctx.accepted.filter((entry) => entry.status !== 202);
  for (const entry of refused) record.defects.push(`send ${entry.marker} refused with HTTP ${entry.status}`);
  const prompts = ctx.server.promptLog();
  const messagesByBot = new Map<string, any[]>();
  for (const botId of new Set(ctx.accepted.map((entry) => entry.botId))) {
    try { messagesByBot.set(botId, await ctx.allMessages(botId)); } catch { messagesByBot.set(botId, []); }
  }
  for (const entry of ctx.accepted.filter((item) => item.status === 202)) {
    const messages = messagesByBot.get(entry.botId) ?? [];
    const persisted = messages.some((message) => message.role === "user" && typeof message.text === "string" && message.text.includes(entry.marker));
    const inPrompt = promptCount(prompts, entry.marker);
    const echoed = ctx.botTexts(messages).filter((message) => ctx.ownText(String(message.text ?? "")).includes(entry.marker)).length;
    // A real engine keeps no prompt log: a bot message after the user's is the proof.
    const userAt = messages.find((message) => message.role === "user" && String(message.text ?? "").includes(entry.marker))?.at ?? 0;
    const answeredAfter = messages.some((message) => message.role === "bot" && (message.at ?? 0) >= userAt);
    const delivered = prompts.length > 0 && !ctx.deliveryByAnswer ? inPrompt > 0 || echoed > 0 : answeredAfter;
    if (!persisted) {
      record.lostAccepted += 1;
      record.defects.push(`accepted message ${entry.marker} is not in its thread`);
    } else if (!delivered && !entry.cancelled) {
      record.lostAccepted += 1;
      record.defects.push(`accepted message ${entry.marker} never reached an engine and was not cancelled`);
    }
    if (ctx.promptCountsDispatch && inPrompt > ctx.allowedDispatches) {
      record.duplicateDispatches += inPrompt - ctx.allowedDispatches;
      record.defects.push(`${entry.marker} was given to the engine ${inPrompt} times (allowed ${ctx.allowedDispatches})`);
    }
    if (ctx.echo && echoed > 1) {
      record.duplicateReplies += echoed - 1;
      record.defects.push(`${entry.marker} appears in ${echoed} bot replies`);
    }
  }
  for (const [threadId, expected] of ctx.expectedTexts) {
    let texts: any[] = [];
    try { texts = ctx.botTexts(await ctx.messages(threadId)); } catch { /* counted below */ }
    if (texts.length > expected) {
      record.duplicateReplies += texts.length - expected;
      record.defects.push(`thread ${threadId.slice(0, 8)} has ${texts.length} bot replies, expected ${expected}`);
    } else if (texts.length < expected) {
      ctx.check(`thread ${threadId.slice(0, 8)} has its ${expected} replies`, false, `only ${texts.length}`);
    }
  }

  // 3. the scenario's own checks
  for (const check of ctx.checks.filter((item) => !item.ok)) record.defects.push(`check failed: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);

  record.restartRecovery = ctx.restartRecovery;
  try {
    record.samples = ctx.sse ? await ctx.samples() : [];
  } catch { record.samples = []; }
  const ttfts = record.samples.map((sample) => sample.ttftMs).filter((v): v is number => v !== null);
  const finals = record.samples.map((sample) => sample.finalMs).filter((v): v is number => v !== null);
  record.ttftMs = ttfts.length ? Math.max(...ttfts) : null;
  record.finalMs = finals.length ? Math.max(...finals) : null;
  if (def.timed && record.samples.length === 0) record.notes.push("no latency sample recorded");

  record.completed = !error && record.defects.length === 0;
  record.status = error ? "error" : record.completed ? "completed" : "failed";
  return record;
}
