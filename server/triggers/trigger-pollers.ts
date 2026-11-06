// Pollers for typed triggers whose provider cannot push to Sagax: a mailbox
// read over IMAP (Outlook mail source, `email.received`) and a calendar read
// from a private ICS link or a CalDAV collection (Outlook Calendar source,
// `event.starting`). Each new message or upcoming start goes through
// `WebhookManager.ingest()`: the trigger's events, filters, deduplication,
// rate limit and untrusted-data fence, like a signed delivery.
//
// Rules, covered by server/triggers/trigger-pollers.test.ts:
// - The password or ICS link comes from TriggerPollerCredentials (sealed,
//   write only). It is sent to the mail or calendar server only, over TLS,
//   and never reaches a status, a log, an event, a prompt or an export: a
//   failure is a fixed code, never the server's own text.
// - The destination is resolved and checked before the socket opens
//   (server/media/media-proxy-guard.ts ranges): cloud metadata, link-local and
//   reserved addresses are always refused; loopback and private ranges only
//   on a personal server (`allowPrivate`).
// - IMAP is read only (EXAMINE, BODY.PEEK): nothing is marked read. The
//   first read only notes where the mailbox is; messages that were already
//   there never start a run.
// - Seen keys for handed-over items live in trigger-seen-store (SQLite,
//   30-day purge) so a restart does not re-log the same calendar instance
//   (DEL-04). Source cursor (uid) moves only after storage; a poller
//   reports error only after three failed reads in a row; a malformed
//   VEVENT skipped by parseIcs is counted (SEC-02).
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";

import {
  POLLER_INTERVAL_DEFAULT,
  POLLER_LEAD_DEFAULT,
  type NormalizedTriggerEvent,
  type TriggerAutomationStatus,
} from "../../shared/trigger-sources.ts";
import { instancesBetween, parseIcs } from "../calendar/ics.ts";
import { blockedAddressReason } from "../media/media-proxy-guard.ts";
import type { PollerCredential } from "./trigger-poller-credentials.ts";
import { openTriggerSeenStore, type TriggerSeenStore } from "./trigger-seen-store.ts";
import type { AutomationPatch, AutomationTarget, WebhookReceiveResult } from "./webhooks.ts";

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGES_PER_POLL = 25;
const TICK_MS = 60_000;
const MAX_CONCURRENT = 4;
/** A poller reports error only after this many failed reads in a row (SEC-02). */
export const POLLER_ERROR_THRESHOLD = 3;

/** A failure the editor can show: a code, never a server's own words. */
export class PollerError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PollerError";
    this.code = code;
  }
}

// ── destination check ────────────────────────────────────────────────────

const ALWAYS_REFUSED = new Set(["metadata", "link-local", "unspecified", "multicast", "reserved", "ipv4-mapped", "unresolved"]);

export type HostResolver = (host: string) => Promise<Array<{ address: string; family: number }>>;
const defaultResolver: HostResolver = (host) => dnsLookup(host, { all: true, verbatim: true });

/** The address to connect to, after every address the name resolves to
 * passed: one refused answer refuses the name. */
export async function checkPollerHost(host: string, allowPrivate: boolean, resolver: HostResolver = defaultResolver): Promise<string> {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  let addresses: Array<{ address: string }>;
  if (isIP(name)) addresses = [{ address: name }];
  else {
    if (name === "localhost" || name.endsWith(".localhost")) {
      if (!allowPrivate) throw new PollerError("blocked-address");
    }
    try {
      addresses = await resolver(name);
    } catch {
      throw new PollerError("unreachable");
    }
  }
  if (!addresses.length) throw new PollerError("unreachable");
  for (const entry of addresses) {
    const reason = blockedAddressReason(entry.address);
    if (!reason) continue;
    if (ALWAYS_REFUSED.has(reason) || !allowPrivate) throw new PollerError("blocked-address");
  }
  return addresses[0]!.address;
}

// ── IMAP ─────────────────────────────────────────────────────────────────

interface ImapUnit {
  /** The line(s), literals replaced by `{n}` markers. */
  text: string;
  literals: Buffer[];
}

/** Just enough IMAP4rev1 to read new message headers. */
export class ImapSession {
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private closed = false;
  private tagCounter = 0;
  private readonly socket: Duplex;

  constructor(socket: Duplex) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > MAX_RESPONSE_BYTES) {
        this.closed = true;
        socket.destroy();
      }
      this.wake();
    });
    const end = () => { this.closed = true; this.wake(); };
    socket.on("end", end);
    socket.on("close", end);
    socket.on("error", end);
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  private async more(deadline: number): Promise<void> {
    if (this.closed) throw new PollerError("unreachable");
    const left = deadline - Date.now();
    if (left <= 0) throw new PollerError("timeout");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, left);
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  private async readUnit(deadline: number): Promise<ImapUnit> {
    let text = "";
    const literals: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const end = this.buffer.indexOf("\r\n", offset);
      if (end === -1) {
        await this.more(deadline);
        continue;
      }
      const line = this.buffer.subarray(offset, end).toString("latin1");
      const literal = /\{(\d{1,9})\}$/.exec(line);
      if (!literal) {
        text += line;
        this.buffer = this.buffer.subarray(end + 2);
        return { text, literals };
      }
      const size = Number(literal[1]);
      if (size > MAX_RESPONSE_BYTES) throw new PollerError("protocol");
      while (this.buffer.length < end + 2 + size) await this.more(deadline);
      literals.push(Buffer.from(this.buffer.subarray(end + 2, end + 2 + size)));
      text += line;
      offset = end + 2 + size;
      // keep the consumed part until the unit is complete; then drop it
      this.buffer = this.buffer.subarray(offset);
      offset = 0;
    }
  }

  async greeting(): Promise<void> {
    const unit = await this.readUnit(Date.now() + COMMAND_TIMEOUT_MS);
    if (!/^\* (OK|PREAUTH)\b/i.test(unit.text)) throw new PollerError("protocol");
  }

  /** Sends one command; `continuation` answers a `+` prompt once. */
  async command(command: string, continuation?: string): Promise<{ untagged: ImapUnit[]; status: string }> {
    const tag = `s${++this.tagCounter}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    const untagged: ImapUnit[] = [];
    for (;;) {
      const unit = await this.readUnit(deadline);
      if (unit.text.startsWith("+")) {
        if (continuation === undefined) throw new PollerError("protocol");
        this.socket.write(`${continuation}\r\n`);
        continuation = undefined;
        continue;
      }
      if (unit.text.startsWith(`${tag} `)) {
        const status = unit.text.slice(tag.length + 1).split(" ")[0]!.toUpperCase();
        return { untagged, status };
      }
      untagged.push(unit);
    }
  }

  close(): void {
    try { this.socket.write("z LOGOUT\r\n"); } catch { /* closing anyway */ }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1_000).unref?.();
  }
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_all, charset: string, encoding: string, data: string) => {
    try {
      const bytes = encoding.toUpperCase() === "B"
        ? Buffer.from(data, "base64")
        : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch {
      return data;
    }
  }).replace(/\?=\s+=\?/g, "?==?");
}

export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!out[name]) out[name] = decodeWords(line.slice(colon + 1).trim()).slice(0, 500);
  }
  return out;
}

function addressOf(from: string): string {
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
}

export interface ImapMessage {
  uid: number;
  headers: Record<string, string>;
}

export interface ImapReadResult {
  uidValidity: string;
  lastUid: number;
  messages: ImapMessage[];
}

/** Reads the messages after `cursor` (none on a first read). */
export async function readImap(
  socket: Duplex,
  credentials: { username: string; password: string },
  mailbox: string,
  cursor: { uidValidity?: string; lastUid?: number } | undefined,
): Promise<ImapReadResult> {
  const session = new ImapSession(socket);
  try {
    await session.greeting();
    const { username, password } = credentials;
    // LOGIN takes quoted ASCII; anything else goes through SASL PLAIN.
    const ascii = /^[\x20-\x7e]*$/.test(username) && /^[\x20-\x7e]*$/.test(password);
    const login = ascii
      ? await session.command(`LOGIN ${quoted(username)} ${quoted(password)}`)
      : await session.command("AUTHENTICATE PLAIN", Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64"));
    if (login.status !== "OK") throw new PollerError("sign-in-refused");
    const examined = await session.command(`EXAMINE ${quoted(mailbox)}`);
    if (examined.status !== "OK") throw new PollerError("mailbox");
    let uidValidity = "";
    let uidNext: number | undefined;
    for (const unit of examined.untagged) {
      const validity = /\[UIDVALIDITY (\d+)\]/i.exec(unit.text);
      if (validity) uidValidity = validity[1]!;
      const next = /\[UIDNEXT (\d+)\]/i.exec(unit.text);
      if (next) uidNext = Number(next[1]);
    }
    if (!uidValidity) throw new PollerError("protocol");
    const fresh = !cursor || cursor.uidValidity !== uidValidity || cursor.lastUid === undefined;
    if (fresh) {
      let last = uidNext !== undefined ? uidNext - 1 : 0;
      if (uidNext === undefined) {
        const all = await session.command("UID SEARCH ALL");
        for (const unit of all.untagged) for (const uid of searchUids(unit.text)) last = Math.max(last, uid);
      }
      return { uidValidity, lastUid: Math.max(0, last), messages: [] };
    }
    const from = cursor.lastUid! + 1;
    const search = await session.command(`UID SEARCH UID ${from}:*`);
    if (search.status !== "OK") throw new PollerError("protocol");
    const uids = search.untagged.flatMap((unit) => searchUids(unit.text)).filter((uid) => uid >= from).sort((a, b) => a - b).slice(0, MAX_MESSAGES_PER_POLL);
    if (!uids.length) return { uidValidity, lastUid: cursor.lastUid!, messages: [] };
    const fetched = await session.command(`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`);
    if (fetched.status !== "OK") throw new PollerError("protocol");
    const messages: ImapMessage[] = [];
    for (const unit of fetched.untagged) {
      const uid = /\bUID (\d+)/i.exec(unit.text);
      if (!uid || !/FETCH/i.test(unit.text)) continue;
      messages.push({ uid: Number(uid[1]), headers: parseHeaders(unit.literals.map((literal) => literal.toString("utf8")).join("\r\n")) });
    }
    messages.sort((a, b) => a.uid - b.uid);
    return { uidValidity, lastUid: uids[uids.length - 1]!, messages };
  } finally {
    session.close();
  }
}

function searchUids(text: string): number[] {
  const match = /^\* SEARCH\b(.*)$/i.exec(text);
  if (!match) return [];
  return match[1]!.trim().split(/\s+/).filter(Boolean).map(Number).filter((value) => Number.isInteger(value) && value > 0);
}

export function emailEvent(message: ImapMessage): NormalizedTriggerEvent {
  const subject = message.headers.subject ?? "";
  const from = message.headers.from ?? "";
  const date = message.headers.date ? Date.parse(message.headers.date) : NaN;
  return {
    source: "email",
    kind: "email.received",
    title: subject || "(no subject)",
    fields: { ...(from ? { sender: addressOf(from) } : {}), subject },
    text: from ? `From: ${from}` : "",
    ...(Number.isFinite(date) ? { occurredAt: new Date(date).toISOString() } : {}),
    ...(message.headers["message-id"] ? { resource: message.headers["message-id"].slice(0, 300) } : {}),
  };
}

// ── HTTP (ICS link, CalDAV) ──────────────────────────────────────────────

export interface PollerHttpRequest {
  url: string;
  method: "GET" | "REPORT";
  headers?: Record<string, string>;
  body?: string;
}
export type PollerHttp = (request: PollerHttpRequest) => Promise<{ status: number; text: string }>;

/** https only, every address checked before the socket opens, no redirect
 * to an unchecked host, 4 MB at most. */
export function guardedHttp(allowPrivate: boolean, resolver: HostResolver = defaultResolver): PollerHttp {
  const once = async (request: PollerHttpRequest, hops: number): Promise<{ status: number; text: string }> => {
    const url = new URL(request.url);
    if (url.protocol !== "https:") throw new PollerError("blocked-address");
    const address = await checkPollerHost(url.hostname, allowPrivate, resolver);
    const result = await new Promise<{ status: number; text: string; location?: string }>((resolve, reject) => {
      const req = https.request(url, {
        method: request.method,
        headers: { "user-agent": "Sagax calendar poller", ...request.headers, ...(request.body ? { "content-length": String(Buffer.byteLength(request.body)) } : {}) },
        // Connect to the address that was checked, never a second lookup.
        lookup: (_host, _options, callback) => callback(null, [{ address, family: isIP(address) as 4 | 6 }] as never, undefined as never),
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: COMMAND_TIMEOUT_MS,
        minVersion: "TLSv1.2",
      }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new PollerError("too-large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), ...(typeof res.headers.location === "string" ? { location: res.headers.location } : {}) }));
        res.on("error", () => reject(new PollerError("unreachable")));
      });
      req.on("timeout", () => { req.destroy(); reject(new PollerError("timeout")); });
      req.on("error", (error) => reject(error instanceof PollerError ? error : new PollerError(/certificate|tls|ssl/i.test(String((error as NodeJS.ErrnoException).code ?? "")) ? "tls" : "unreachable")));
      if (request.body) req.write(request.body);
      req.end();
    });
    if (result.status >= 300 && result.status < 400 && result.location && request.method === "GET") {
      if (hops >= 3) throw new PollerError("redirect");
      return once({ ...request, url: new URL(result.location, url).toString() }, hops + 1);
    }
    return { status: result.status, text: result.text };
  };
  return (request) => once(request, 0);
}

function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function xmlUnescape(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function caldavQuery(from: number, to: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-data><C:expand start="${icsTime(from)}" end="${icsTime(to)}"/></C:calendar-data></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${icsTime(from)}" end="${icsTime(to)}"/></C:comp-filter></C:comp-filter></C:filter>
</C:calendar-query>`;
}

export function caldavCalendarData(xml: string): string {
  const out: string[] = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?calendar-data>/g)) out.push(xmlUnescape(match[1]!));
  return out.join("\n");
}

export function calendarEvent(instance: ReturnType<typeof instancesBetween>[number]): NormalizedTriggerEvent {
  const { event, start } = instance;
  const text = [event.location ? `Location: ${event.location}` : "", event.description ?? ""].filter(Boolean).join("\n").slice(0, 1_000);
  return {
    source: "calendar",
    kind: "event.starting",
    title: event.summary || "Calendar event",
    occurredAt: new Date(start).toISOString(),
    fields: {
      subject: event.summary,
      ...(event.organizer ? { organizer: event.organizer } : {}),
      ...(event.rrule || event.recurrenceId !== undefined ? { series: event.uid } : {}),
    },
    text,
    ...(event.url && /^https:\/\//i.test(event.url) ? { url: event.url } : {}),
  };
}

// ── the poller loop ──────────────────────────────────────────────────────

export interface PollerHost {
  automationTargets(): AutomationTarget[];
  automationTargetFor(id: string): AutomationTarget | null;
  setAutomation(id: string, patch: AutomationPatch): boolean;
  ingest(id: string, normalized: NormalizedTriggerEvent, dedupeKey: string): WebhookReceiveResult | null;
}

export interface TriggerPollersOptions {
  webhooks: PollerHost;
  credentials: { get(id: string): PollerCredential | undefined };
  /** Loopback and private addresses are allowed (a personal server). */
  allowPrivate: boolean;
  /** Durable seen keys (DEL-04). Absent: an in-memory SQLite file for tests. */
  seen?: TriggerSeenStore;
  now?: () => number;
  resolver?: HostResolver;
  /** Opens the IMAP connection (TLS); tests pass a plain socket. */
  connectImap?: (host: string, port: number, address: string) => Promise<Duplex>;
  http?: PollerHttp;
}

function connectTls(host: string, port: number, address: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: address, port, servername: isIP(host) ? undefined : host, minVersion: "TLSv1.2", timeout: COMMAND_TIMEOUT_MS });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("timeout", () => { socket.destroy(); reject(new PollerError("timeout")); });
    socket.once("error", (error: NodeJS.ErrnoException) => reject(new PollerError(/CERT|TLS|SSL/i.test(String(error.code ?? "")) ? "tls" : "unreachable")));
  });
}

export class TriggerPollers {
  private readonly options: TriggerPollersOptions;
  private readonly now: () => number;
  private readonly http: PollerHttp;
  private readonly seen: TriggerSeenStore;
  private readonly ownsSeen: boolean;
  private readonly inFlight = new Set<string>();
  /** Failed reads in a row per trigger; cleared by a successful read (SEC-02). */
  private readonly consecutiveFailures = new Map<string, number>();
  /** Malformed items skipped since the process started, per trigger (SEC-02). */
  private readonly malformed = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly lastStatus = new Map<string, TriggerAutomationStatus>();

  constructor(options: TriggerPollersOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.http = options.http ?? guardedHttp(options.allowPrivate, options.resolver);
    if (options.seen) {
      this.seen = options.seen;
      this.ownsSeen = false;
    } else {
      this.seen = openTriggerSeenStore(":memory:", { now: this.now });
      this.ownsSeen = true;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ownsSeen) this.seen.close();
  }

  /** How many malformed items this trigger skipped since start (tests / health). */
  malformedCount(id: string): number {
    return this.malformed.get(id) ?? 0;
  }

  /** Failed polls in a row for this trigger (tests). */
  consecutiveFailureCount(id: string): number {
    return this.consecutiveFailures.get(id) ?? 0;
  }

  /** Polls every enabled poller whose interval has passed. */
  async tick(): Promise<void> {
    const due = this.options.webhooks.automationTargets().filter((target) => {
      const poller = target.source.poller;
      if (!poller || !target.enabled || this.inFlight.has(target.id)) return false;
      const cursor = target.pollerCursor?.scope === target.pollerScope ? target.pollerCursor : undefined;
      const interval = (poller.intervalMinutes ?? POLLER_INTERVAL_DEFAULT) * 60_000;
      return !cursor?.lastPolledAt || this.now() - cursor.lastPolledAt >= interval - 5_000;
    });
    const queue = [...due];
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await this.poll(next.id);
    });
    await Promise.all(workers);
  }

  /** One read of one trigger's source. Never throws. */
  async poll(id: string): Promise<TriggerAutomationStatus | null> {
    if (this.inFlight.has(id)) return null;
    const target = this.options.webhooks.automationTargetFor(id);
    const poller = target?.source.poller;
    if (!target || !poller) return null;
    this.inFlight.add(id);
    const previous = target.pollerCursor?.scope === target.pollerScope ? target.pollerCursor : undefined;
    // Source cursor (uid) only moves after items are stored. lastPolledAt
    // advances on every finished round so the interval paces retries.
    let cursor = {
      scope: target.pollerScope,
      ...(previous ? { uidValidity: previous.uidValidity, lastUid: previous.lastUid } : {}),
      lastPolledAt: this.now(),
    };
    let status: TriggerAutomationStatus | undefined;
    let roundOk = false;
    try {
      const credential = this.options.credentials.get(id);
      if (poller.kind === "imap") {
        if (!credential?.password || !poller.host || !poller.username) throw new PollerError("no-credentials");
        const port = poller.port ?? 993;
        const address = await checkPollerHost(poller.host, this.options.allowPrivate, this.options.resolver);
        const socket = await (this.options.connectImap ?? connectTls)(poller.host, port, address);
        const read = await readImap(socket, { username: poller.username, password: credential.password }, poller.mailbox || "INBOX", previous);
        // The position moves past each message once it is handed over.
        let lastUid = read.messages.length ? previous?.lastUid ?? 0 : read.lastUid;
        for (const message of read.messages) {
          let event: NormalizedTriggerEvent;
          try {
            event = emailEvent(message);
          } catch {
            this.noteMalformed(id);
            lastUid = message.uid;
            continue;
          }
          // Over the trigger's rate limit: stop here, the rest waits for the next read.
          if (!this.deliver(id, event, `imap:${target.pollerScope.slice(0, 12)}:${read.uidValidity}:${message.uid}`)) break;
          lastUid = message.uid;
        }
        if (read.messages.length && lastUid === read.messages[read.messages.length - 1]!.uid) lastUid = read.lastUid;
        cursor = { ...cursor, uidValidity: read.uidValidity, lastUid };
      } else {
        const lead = (poller.leadMinutes ?? POLLER_LEAD_DEFAULT) * 60_000;
        const interval = (poller.intervalMinutes ?? POLLER_INTERVAL_DEFAULT) * 60_000;
        const now = this.now();
        const from = now - interval - 60_000;
        const to = now + lead;
        let text: string;
        if (poller.kind === "ics") {
          if (!credential?.url) throw new PollerError("no-credentials");
          const response = await this.http({ url: credential.url, method: "GET", headers: { accept: "text/calendar" } });
          if (response.status < 200 || response.status >= 300) throw new PollerError(response.status === 401 || response.status === 403 ? "sign-in-refused" : "http-status");
          text = response.text;
        } else {
          if (!credential?.password || !poller.url || !poller.username) throw new PollerError("no-credentials");
          const response = await this.http({
            url: poller.url,
            method: "REPORT",
            headers: { authorization: `Basic ${Buffer.from(`${poller.username}:${credential.password}`, "utf8").toString("base64")}`, depth: "1", "content-type": "application/xml; charset=utf-8" },
            body: caldavQuery(from, to + 60_000),
          });
          if (response.status === 401 || response.status === 403) throw new PollerError("sign-in-refused");
          if (response.status !== 207 && (response.status < 200 || response.status >= 300)) throw new PollerError("http-status");
          text = caldavCalendarData(response.text);
        }
        if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text) && poller.kind === "ics") throw new PollerError("protocol");
        const veventCount = (text.match(/BEGIN:VEVENT\b/gi) ?? []).length;
        const events = parseIcs(text);
        // parseIcs drops a VEVENT with no UID or no start; count those here (SEC-02).
        const dropped = Math.max(0, veventCount - events.length);
        if (dropped) this.malformed.set(id, (this.malformed.get(id) ?? 0) + dropped);
        for (const instance of instancesBetween(events, from, to)) {
          // Fires once the start is within the lead time, until shortly after it.
          if (instance.start - lead > now) continue;
          if (!instance.event.uid || !Number.isFinite(instance.start)) {
            this.noteMalformed(id);
            continue;
          }
          try {
            this.deliver(id, calendarEvent(instance), `cal:${target.pollerScope.slice(0, 12)}:${instance.event.uid}@${new Date(instance.start).toISOString()}`);
          } catch {
            this.noteMalformed(id);
          }
        }
      }
      this.consecutiveFailures.set(id, 0);
      roundOk = true;
      status = { kind: "poller", state: "ok", code: "ok", at: this.now() };
    } catch (error) {
      const failures = (this.consecutiveFailures.get(id) ?? 0) + 1;
      this.consecutiveFailures.set(id, failures);
      const code = error instanceof PollerError ? error.code : "protocol";
      // Source cursor stays where it was: only lastPolledAt moved above.
      if (!roundOk) {
        cursor = {
          scope: target.pollerScope,
          ...(previous ? { uidValidity: previous.uidValidity, lastUid: previous.lastUid } : {}),
          lastPolledAt: this.now(),
        };
      }
      // Error only after the threshold; earlier failures keep the last status.
      if (failures >= POLLER_ERROR_THRESHOLD) {
        status = { kind: "poller", state: "error", code, at: this.now() };
      }
    } finally {
      this.inFlight.delete(id);
    }
    const patch: AutomationPatch = { pollerCursor: cursor };
    if (status) {
      const last = this.lastStatus.get(id);
      const changed = !last || last.state !== status.state || last.code !== status.code;
      this.lastStatus.set(id, status);
      if (changed) patch.automation = status;
    }
    this.options.webhooks.setAutomation(id, patch);
    return status ?? this.lastStatus.get(id) ?? null;
  }

  /** False when the trigger refused for now (rate limit, run cap). */
  private deliver(id: string, event: NormalizedTriggerEvent, key: string): boolean {
    if (this.seen.has(id, key)) return true;
    try {
      this.options.webhooks.ingest(id, event, key);
    } catch (error) {
      // Paused or gone: nothing to retry. Too many: retried on the next read.
      if ((error as { status?: number }).status === 429) return false;
    }
    this.seen.add(id, key, this.now());
    return true;
  }

  private noteMalformed(id: string): void {
    this.malformed.set(id, (this.malformed.get(id) ?? 0) + 1);
  }

  /** The trigger is gone or its poller removed. */
  forget(id: string): void {
    this.lastStatus.delete(id);
    this.consecutiveFailures.delete(id);
    this.malformed.delete(id);
    this.seen.forget(id);
  }
}
