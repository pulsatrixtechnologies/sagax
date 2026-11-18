// Push to Talk (PushToTalk framework, docs/ios-push.md "Push to Talk"): a
// person holds to talk to a bot from the lock screen or the Dynamic Island,
// and the bot's spoken reply arrives as an incoming PTT push that wakes the
// app. One channel per person: the phone's ephemeral PTT token (valid only
// while the channel is joined), the bot of the channel and the channel id.
// Files: `<data>/ptt-channels/<principal>.json` (mode 0600). The token never
// reaches a log line (maskSecret).
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { maskSecret, type ApnsEnvironment } from "./config.ts";
import type { ApnsRequest } from "./payload.ts";
import type { SendOutcome } from "./apns.ts";

/** The call id prefix the phone gives a Push to Talk turn (Message.voiceCall.callId). */
export const PTT_CALL_PREFIX = "ptt-";
/** The PTT token is variable length (Apple), hex. */
export const PTT_TOKEN = /^[0-9a-f]{32,400}$/;
const PERSON = /^[\w:.@-]{1,128}$/;
/** Spoken words in the payload; the whole push stays under APNs's 4 KB. */
export const PTT_TEXT_MAX_BYTES = 3000;

export interface PttChannel {
  token: string;
  channelId: string;
  botId: string;
  environment: ApnsEnvironment;
  appVersion: string;
  updatedAt: number;
}

export const pttRegistrationSchema = z.object({
  token: z.string().trim().toLowerCase().regex(PTT_TOKEN),
  channelId: z.string().trim().toLowerCase().regex(/^[0-9a-f-]{36}$/),
  botId: z.string().trim().min(1).max(128),
  environment: z.enum(["sandbox", "production"]).optional(),
  appVersion: z.string().trim().max(40).default(""),
}).strict();

const fileSchema = z.object({
  version: z.literal(1),
  channel: z.object({
    token: z.string(), channelId: z.string(), botId: z.string(),
    environment: z.enum(["sandbox", "production"]), appVersion: z.string(), updatedAt: z.number(),
  }),
});

export interface PttChannelStore {
  get(person: string): PttChannel | undefined;
  /** Every person whose channel talks to this bot. */
  forBot(botId: string): { person: string; channel: PttChannel }[];
  set(person: string, channel: Omit<PttChannel, "updatedAt">): PttChannel;
  remove(person: string): boolean;
  /** APNs said the token is dead: gone for whoever had it. */
  prune(token: string): boolean;
}

export function createPttChannelStore(dataDir: string, now: () => number = Date.now): PttChannelStore {
  const dir = join(dataDir, "ptt-channels");
  let channels: Map<string, PttChannel> | null = null;
  const fileOf = (person: string) => join(dir, `${person}.json`);
  const load = () => {
    if (channels) return channels;
    channels = new Map();
    if (!existsSync(dir)) return channels;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const person = name.slice(0, -5);
      if (!PERSON.test(person)) continue;
      try {
        channels.set(person, fileSchema.parse(JSON.parse(readFileSync(join(dir, name), "utf8"))).channel);
      } catch (error) {
        console.warn(`ptt: ${name} could not be read (${error instanceof Error ? error.message : String(error)}); ignored`);
      }
    }
    return channels;
  };
  const key = (person: string) => person.trim().toLowerCase();
  const drop = (person: string) => {
    load().delete(person);
    try { unlinkSync(fileOf(person)); } catch { /* already gone */ }
  };
  return {
    get: (person) => load().get(key(person)),
    forBot: (botId) => [...load()].filter(([, channel]) => channel.botId === botId).map(([person, channel]) => ({ person, channel })),
    set(person, input) {
      const who = key(person);
      if (!PERSON.test(who)) throw Object.assign(new Error("not a person"), { status: 403 });
      const channel: PttChannel = { ...input, updatedAt: now() };
      // a phone that signed in as someone else moves
      for (const [other, entry] of load()) if (other !== who && entry.token === channel.token) drop(other);
      load().set(who, channel);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(fileOf(who), `${JSON.stringify({ version: 1, channel }, null, 2)}\n`, { mode: 0o600 });
      return { ...channel };
    },
    remove(person) {
      const who = key(person);
      if (!load().has(who)) return false;
      drop(who);
      return true;
    },
    prune(token) {
      for (const [person, channel] of load()) if (channel.token === token) { drop(person); return true; }
      return false;
    },
  };
}

const clipBytes = (text: string, max: number) => {
  if (Buffer.byteLength(text) <= max) return text;
  let out = text.slice(0, max);
  while (Buffer.byteLength(out) > max - 3) out = out.slice(0, -1);
  return `${out}...`;
};

/** The incoming PTT push: `pushtotalk` type, topic `<bundle>.voip-ptt`,
 * priority 10, expiration 0 (Apple: no older push is delivered later). */
export function buildPttRequest(input: { bundleId: string; botName: string; botId: string; threadId: string; text: string; at: number }): ApnsRequest {
  const payload = {
    activeSpeaker: input.botName.slice(0, 80) || "Bot",
    botId: input.botId,
    threadId: input.threadId,
    text: clipBytes(input.text, PTT_TEXT_MAX_BYTES),
    at: input.at,
  };
  return {
    headers: {
      "apns-push-type": "pushtotalk",
      "apns-topic": `${input.bundleId}.voip-ptt`,
      "apns-priority": "10",
      "apns-expiration": "0",
    },
    body: JSON.stringify(payload),
  };
}

/** A person's PTT turn: the thread's latest line from the person was sent from the PTT channel. */
export function isPttTurn(lastPersonMessage: { voiceCall?: { callId?: unknown } } | undefined): boolean {
  const id = lastPersonMessage?.voiceCall?.callId;
  return typeof id === "string" && id.startsWith(PTT_CALL_PREFIX);
}

export interface PttReplyDeps {
  store: PttChannelStore;
  topic(): string;
  /** The server's own APNs sender (PushHub.relaySend); null when it has no key. */
  send(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome> | null;
  botName(botId: string): string;
  warn?(line: string): void;
  now?(): number;
}

/** Sends the bot's answer to every person whose PTT channel is this bot's.
 * True when a PTT push went out (the ordinary banner stays quiet then). */
export async function sendPttReply(deps: PttReplyDeps, input: { botId: string; threadId: string; text: string }): Promise<boolean> {
  const text = input.text.trim();
  if (!text || !deps.topic()) return false;
  const targets = deps.store.forBot(input.botId);
  let sent = false;
  for (const { channel } of targets) {
    const request = buildPttRequest({ bundleId: deps.topic(), botName: deps.botName(input.botId), botId: input.botId, threadId: input.threadId, text, at: (deps.now ?? Date.now)() });
    const pending = deps.send({ token: channel.token, environment: channel.environment }, request);
    if (!pending) continue;
    const outcome = await pending;
    if (outcome.ok) sent = true;
    else {
      if (outcome.prune) deps.store.prune(channel.token);
      (deps.warn ?? console.warn)(`ptt: push to ${maskSecret(channel.token)} failed (${outcome.reason})`);
    }
  }
  return sent;
}
