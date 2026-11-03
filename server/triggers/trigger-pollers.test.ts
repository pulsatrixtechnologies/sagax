// Pollers for typed triggers: a fake IMAP server and fake calendar answers
// drive the real WebhookManager. New mail and upcoming starts reach the run
// once, fenced; the password, the ICS link and the server's own words never
// reach a prompt, a status, a frame or a log.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, connect, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TriggerPollers, POLLER_ERROR_THRESHOLD, caldavCalendarData, checkPollerHost, parseHeaders, PollerError, type PollerHttpRequest } from "./trigger-pollers.ts";
import { openTriggerSeenStore } from "./trigger-seen-store.ts";
import { WebhookManager } from "./webhooks.ts";

const PASSWORD = "hunter2-SECRET-pass";
const ICS_LINK = "https://calendar.example.com/private-7f3a9c1e5b/basic.ics";
const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

interface Mail { uid: number; from: string; subject: string }
let server: Server;
let port = 0;
const mailbox: Mail[] = [];
const commands: string[] = [];
let refuseLogin = false;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.write("* OK fake IMAP ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, ...rest] = line.split(" ");
        const command = rest.join(" ");
        commands.push(command);
        const verb = command.split(" ")[0]!.toUpperCase();
        if (verb === "LOGIN") {
          const ok = !refuseLogin && command === `LOGIN "me@example.com" "${PASSWORD}"`;
          socket.write(ok ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] bad password ${PASSWORD}\r\n`);
        } else if (verb === "EXAMINE") {
          const next = (mailbox.at(-1)?.uid ?? 0) + 1;
          socket.write(`* ${mailbox.length} EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n* OK [UIDNEXT ${next}] ok\r\n${tag} OK [READ-ONLY] done\r\n`);
        } else if (command.startsWith("UID SEARCH UID ")) {
          const from = Number(command.slice("UID SEARCH UID ".length).split(":")[0]);
          let uids = mailbox.filter((mail) => mail.uid >= from).map((mail) => mail.uid);
          if (!uids.length && mailbox.length) uids = [mailbox.at(-1)!.uid]; // n:* always names the last message
          socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK done\r\n`);
        } else if (command.startsWith("UID FETCH ")) {
          const wanted = command.slice("UID FETCH ".length).split(" ")[0]!.split(",").map(Number);
          for (const [index, mail] of mailbox.entries()) {
            if (!wanted.includes(mail.uid)) continue;
            const header = `From: ${mail.from}\r\nSubject: ${mail.subject}\r\nDate: Fri, 16 Oct 2026 12:00:00 +0000\r\nMessage-ID: <m${mail.uid}@example.com>\r\n\r\n`;
            socket.write(`* ${index + 1} FETCH (UID ${mail.uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {${Buffer.byteLength(header)}}\r\n${header})\r\n`);
          }
          socket.write(`${tag} OK done\r\n`);
        } else if (verb === "LOGOUT") {
          socket.end(`* BYE\r\n${tag} OK bye\r\n`);
        } else {
          socket.write(`${tag} BAD unknown\r\n`);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  mailbox.length = 0;
  commands.length = 0;
  refuseLogin = false;
  vi.restoreAllMocks();
});

function harness(credential: { password?: string; url?: string }, http?: (request: PollerHttpRequest) => Promise<{ status: number; text: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "omb-pollers-"));
  dirs.push(dir);
  let now = Date.parse("2026-10-16T13:50:00Z");
  const queued: Array<{ prompt: string }> = [];
  const frames: string[] = [];
  const manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    now: () => now,
    botState: () => "ready",
    enqueue: (input) => { queued.push(input); return { id: `run-${queued.length}` }; },
    pendingRuns: () => 0,
    emit: (event) => frames.push(JSON.stringify(event)),
  });
  const httpCalls: PollerHttpRequest[] = [];
  const pollers = new TriggerPollers({
    webhooks: manager,
    credentials: { get: () => credential },
    allowPrivate: false,
    now: () => now,
    resolver: PUBLIC,
    connectImap: async () => connect(port, "127.0.0.1"),
    http: async (request) => { httpCalls.push(request); return http ? http(request) : { status: 500, text: "" }; },
  });
  const outputs = () => JSON.stringify([queued, frames, manager.list(), manager.listAttempts()]);
  return { manager, pollers, queued, frames, httpCalls, outputs, advance: (ms: number) => { now += ms; } };
}

const mailSource = (extra: Record<string, unknown> = {}) => ({
  name: "Inbox", prompt: "Triage the mail", botId: "b1",
  source: { type: "email", events: [], filters: { sender: ["*@partner.example"] }, poller: { kind: "imap", host: "imap.example.com", username: "me@example.com", ...extra } },
});

describe("IMAP poller", () => {
  it("skips mail already there, then hands each new message over once, fenced and filtered", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    mailbox.push({ uid: 1, from: "Old <old@partner.example>", subject: "Old news" });
    const h = harness({ password: PASSWORD });
    const { webhook } = h.manager.create(mailSource());
    expect(await h.pollers.poll(webhook.id)).toMatchObject({ state: "ok", code: "ok" });
    expect(h.queued).toHaveLength(0);
    mailbox.push({ uid: 2, from: "Ann <ann@partner.example>", subject: "=?UTF-8?B?UXVvdGUgZMOpY2VtYnJl?=" });
    mailbox.push({ uid: 3, from: "Spam <x@elsewhere.example>", subject: "Buy now" });
    h.advance(5 * 60_000);
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]!.prompt).toContain("Quote décembre");
    expect(h.queued[0]!.prompt).toMatch(/\[UNTRUSTED OUTLOOK EVENT DATA/);
    expect(h.manager.listAttempts().map((attempt) => attempt.outcome)).toEqual(expect.arrayContaining(["accepted", "ignored"]));
    // the same mail is never handed over twice
    h.advance(5 * 60_000);
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(1);
    // read only: no STORE, no SELECT, no flag change
    expect(commands.some((command) => /^(STORE|SELECT|UID STORE|EXPUNGE|COPY|MOVE)/i.test(command))).toBe(false);
    expect(commands.filter((command) => command.startsWith("UID FETCH")).every((command) => command.includes("BODY.PEEK"))).toBe(true);
    expect(h.outputs()).not.toContain(PASSWORD);
    for (const spy of [log, warn, error]) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
  });

  it("reports a refused sign-in as a code only after three failed reads, never the server's text", async () => {
    refuseLogin = true;
    const h = harness({ password: PASSWORD });
    const { webhook } = h.manager.create(mailSource());
    expect(await h.pollers.poll(webhook.id)).toBeNull();
    expect(h.manager.list()[0]!.automation).toBeUndefined();
    expect(h.pollers.consecutiveFailureCount(webhook.id)).toBe(1);
    h.advance(5 * 60_000);
    expect(await h.pollers.poll(webhook.id)).toBeNull();
    expect(h.pollers.consecutiveFailureCount(webhook.id)).toBe(2);
    h.advance(5 * 60_000);
    expect(await h.pollers.poll(webhook.id)).toMatchObject({ state: "error", code: "sign-in-refused" });
    expect(h.manager.list()[0]!.automation).toMatchObject({ kind: "poller", state: "error", code: "sign-in-refused" });
    expect(h.outputs()).not.toContain(PASSWORD);
    expect(h.outputs()).not.toContain("AUTHENTICATIONFAILED");
  });

  it("waits for a password and starts over on another mailbox", async () => {
    const h = harness({});
    const { webhook } = h.manager.create(mailSource());
    // no-credentials fails every read; error lands on the threshold.
    for (let i = 0; i < POLLER_ERROR_THRESHOLD - 1; i += 1) {
      expect(await h.pollers.poll(webhook.id)).toBeNull();
      h.advance(5 * 60_000);
    }
    expect(await h.pollers.poll(webhook.id)).toMatchObject({ code: "no-credentials" });
    const withPassword = harness({ password: PASSWORD });
    const second = withPassword.manager.create(mailSource());
    await withPassword.pollers.poll(second.webhook.id);
    expect(withPassword.manager.automationTargetFor(second.webhook.id)!.pollerCursor).toMatchObject({ uidValidity: "42", lastUid: 0 });
    withPassword.manager.update(second.webhook.id, { source: mailSource({ mailbox: "Projects" }).source });
    expect(withPassword.manager.automationTargetFor(second.webhook.id)!.pollerCursor).toBeUndefined();
  });

  it("keeps the IMAP cursor when a read fails before any message is stored", async () => {
    mailbox.push({ uid: 1, from: "Ann <ann@partner.example>", subject: "First" });
    const h = harness({ password: PASSWORD });
    const { webhook } = h.manager.create(mailSource());
    await h.pollers.poll(webhook.id);
    expect(h.manager.automationTargetFor(webhook.id)!.pollerCursor).toMatchObject({ uidValidity: "42", lastUid: 1 });
    refuseLogin = true;
    h.advance(5 * 60_000);
    await h.pollers.poll(webhook.id);
    expect(h.manager.automationTargetFor(webhook.id)!.pollerCursor).toMatchObject({ uidValidity: "42", lastUid: 1 });
  });
});

describe("destination check", () => {
  it("refuses metadata, link-local and private addresses on an organisation server", async () => {
    await expect(checkPollerHost("imap.example.com", false, async () => [{ address: "169.254.169.254", family: 4 }])).rejects.toMatchObject({ code: "blocked-address" });
    await expect(checkPollerHost("imap.example.com", true, async () => [{ address: "169.254.169.254", family: 4 }])).rejects.toMatchObject({ code: "blocked-address" });
    await expect(checkPollerHost("imap.example.com", false, async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])).rejects.toBeInstanceOf(PollerError);
    await expect(checkPollerHost("localhost", false)).rejects.toMatchObject({ code: "blocked-address" });
    await expect(checkPollerHost("mail.lan", true, async () => [{ address: "192.168.1.20", family: 4 }])).resolves.toBe("192.168.1.20");
  });
});

const ics = (start: string, extra = "") => [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:standup-1", `DTSTART;TZID=America/New_York:${start}`, "DTEND;TZID=America/New_York:20261001T100000",
  "SUMMARY:Daily standup", "ORGANIZER;CN=Lead:mailto:lead@example.com", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", extra,
  "BEGIN:VALARM", "TRIGGER:-PT5M", "END:VALARM",
  "END:VEVENT", "END:VCALENDAR",
].filter(Boolean).join("\r\n");

describe("calendar poller", () => {
  it("fires event.starting once inside the lead time, from a private ICS link kept out of every output", async () => {
    // 2026-10-16 is a Friday; 10:00 New York is 14:00 UTC; now is 13:50 UTC.
    const h = harness({ url: ICS_LINK }, async () => ({ status: 200, text: ics("20261001T100000") }));
    const { webhook } = h.manager.create({ name: "Standup", prompt: "Prepare notes", botId: "b1", source: { type: "calendar", events: ["event.starting"], filters: { organizer: ["*lead@example.com*"] }, poller: { kind: "ics", leadMinutes: 10 } } });
    await h.pollers.poll(webhook.id);
    expect(h.httpCalls[0]).toMatchObject({ url: ICS_LINK, method: "GET" });
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]!.prompt).toContain("Daily standup");
    expect(h.queued[0]!.prompt).toContain("2026-10-16T14:00:00.000Z");
    h.advance(5 * 60_000);
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(1);
    expect(h.outputs()).not.toContain("private-7f3a9c1e5b");
  });

  it("does not fire before the lead time and skips an excluded instance", async () => {
    const h = harness({ url: ICS_LINK }, async () => ({ status: 200, text: ics("20261001T100000") }));
    const { webhook } = h.manager.create({ name: "Standup", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics", leadMinutes: 5 } } });
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(0);
    const excluded = harness({ url: ICS_LINK }, async () => ({ status: 200, text: ics("20261001T100000", "EXDATE;TZID=America/New_York:20261016T100000") }));
    const second = excluded.manager.create({ name: "Standup", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics", leadMinutes: 15 } } });
    await excluded.pollers.poll(second.webhook.id);
    expect(excluded.queued).toHaveLength(0);
  });

  it("asks a CalDAV server for expanded instances with Basic auth sent to it only", async () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:review-9
RECURRENCE-ID:20261016T140000Z
DTSTART:20261016T140000Z
SUMMARY:Design review &amp; demo
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;
    const h = harness({ password: PASSWORD }, async () => ({ status: 207, text: xml }));
    const { webhook } = h.manager.create({ name: "Reviews", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "caldav", url: "https://dav.example.com/cal/me/work/", username: "me" } } });
    await h.pollers.poll(webhook.id);
    const call = h.httpCalls[0]!;
    expect(call).toMatchObject({ method: "REPORT", url: "https://dav.example.com/cal/me/work/" });
    expect(call.headers!.authorization).toBe(`Basic ${Buffer.from(`me:${PASSWORD}`).toString("base64")}`);
    expect(call.body).toContain("<C:expand");
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]!.prompt).toContain("Design review & demo");
    expect(h.outputs()).not.toContain(PASSWORD);
    expect(h.outputs()).not.toContain(Buffer.from(`me:${PASSWORD}`).toString("base64"));
  });

  it("maps a refused calendar sign-in to a code after three failed reads", async () => {
    const h = harness({ url: ICS_LINK }, async () => ({ status: 401, text: `denied ${ICS_LINK}` }));
    const { webhook } = h.manager.create({ name: "Cal", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics" } } });
    for (let i = 0; i < POLLER_ERROR_THRESHOLD - 1; i += 1) {
      expect(await h.pollers.poll(webhook.id)).toBeNull();
      h.advance(5 * 60_000);
    }
    expect(await h.pollers.poll(webhook.id)).toMatchObject({ state: "error", code: "sign-in-refused" });
    expect(h.outputs()).not.toContain("private-7f3a9c1e5b");
  });

  it("clears the failure streak on the first successful read", async () => {
    let refuse = true;
    const h = harness({ url: ICS_LINK }, async () => refuse
      ? { status: 401, text: "no" }
      : { status: 200, text: ics("20261001T100000") });
    const { webhook } = h.manager.create({ name: "Cal", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics", leadMinutes: 10 } } });
    await h.pollers.poll(webhook.id);
    await h.pollers.poll(webhook.id);
    expect(h.pollers.consecutiveFailureCount(webhook.id)).toBe(2);
    refuse = false;
    h.advance(5 * 60_000);
    expect(await h.pollers.poll(webhook.id)).toMatchObject({ state: "ok", code: "ok" });
    expect(h.pollers.consecutiveFailureCount(webhook.id)).toBe(0);
    expect(h.queued).toHaveLength(1);
  });

  it("skips a malformed calendar instance and keeps counting it", async () => {
    const bad = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:", "DTSTART:20261016T140000Z", "SUMMARY:Broken", "END:VEVENT",
      "BEGIN:VEVENT", "UID:standup-1", "DTSTART:20261016T140000Z", "SUMMARY:Daily standup", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const h = harness({ url: ICS_LINK }, async () => ({ status: 200, text: bad }));
    const { webhook } = h.manager.create({ name: "Cal", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics", leadMinutes: 10 } } });
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]!.prompt).toContain("Daily standup");
    expect(h.pollers.malformedCount(webhook.id)).toBeGreaterThanOrEqual(1);
  });
});

describe("persistent seen (DEL-04)", () => {
  it("does not re-queue a calendar instance after a simulated restart that keeps the seen file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-seen-poll-"));
    dirs.push(dir);
    const seenFile = join(dir, "trigger-seen.db");
    let now = Date.parse("2026-10-16T13:50:00Z");
    const make = () => {
      const queued: Array<{ prompt: string }> = [];
      const manager = new WebhookManager({
        file: join(dir, "webhooks.json"),
        now: () => now,
        botState: () => "ready",
        enqueue: (input) => { queued.push(input); return { id: `run-${queued.length}` }; },
        pendingRuns: () => 0,
        emit: () => undefined,
      });
      const seen = openTriggerSeenStore(seenFile, { now: () => now });
      const pollers = new TriggerPollers({
        webhooks: manager,
        credentials: { get: () => ({ url: ICS_LINK }) },
        allowPrivate: false,
        now: () => now,
        resolver: PUBLIC,
        seen,
        http: async () => ({ status: 200, text: ics("20261001T100000") }),
      });
      return { manager, pollers, queued, seen };
    };
    const first = make();
    const { webhook } = first.manager.create({ name: "Standup", prompt: "Prepare notes", botId: "b1", source: { type: "calendar", events: ["event.starting"], filters: {}, poller: { kind: "ics", leadMinutes: 10 } } });
    await first.pollers.poll(webhook.id);
    expect(first.queued).toHaveLength(1);
    first.pollers.stop();
    first.seen.close();

    now += 5 * 60_000;
    const second = make();
    // Same trigger id and endpoint live again from webhooks.json.
    await second.pollers.poll(webhook.id);
    expect(second.queued).toHaveLength(0);
    expect(second.manager.listAttempts().some((attempt) => attempt.outcome === "duplicate")).toBe(false);
    second.pollers.stop();
    second.seen.close();
  });

  it("accepting the same delivery twice returns a typed duplicate and one run", async () => {
    const h = harness({ url: ICS_LINK }, async () => ({ status: 200, text: ics("20261001T100000") }));
    const { webhook } = h.manager.create({ name: "Standup", prompt: "Prepare notes", botId: "b1", source: { type: "calendar", events: ["event.starting"], filters: {}, poller: { kind: "ics", leadMinutes: 10 } } });
    await h.pollers.poll(webhook.id);
    expect(h.queued).toHaveLength(1);
    const key = `cal:${h.manager.automationTargetFor(webhook.id)!.pollerScope.slice(0, 12)}:standup-1@2026-10-16T14:00:00.000Z`;
    const again = h.manager.ingest(webhook.id, {
      source: "calendar",
      kind: "event.starting",
      title: "Daily standup",
      fields: { subject: "Daily standup" },
      occurredAt: "2026-10-16T14:00:00.000Z",
    }, key);
    expect(again).toMatchObject({ duplicate: true, runId: "run-1" });
    expect(h.queued).toHaveLength(1);
  });
});

describe("parsing", () => {
  it("decodes folded, encoded headers and CalDAV calendar data", () => {
    expect(parseHeaders("Subject: =?ISO-8859-1?Q?R=E9union?=\r\n  du jour\r\nFrom: a@b.c\r\n")).toEqual({ subject: "Réunion du jour", from: "a@b.c" });
    expect(caldavCalendarData("<x:calendar-data>A &lt;b&gt;</x:calendar-data><calendar-data><![CDATA[C]]></calendar-data>")).toBe("A <b>\nC");
  });

  it("refuses an ICS link in the exported config and a poller on a source that has none", () => {
    const h = harness({});
    expect(() => h.manager.create({ name: "x", prompt: "", botId: "b1", source: { type: "calendar", events: [], filters: {}, poller: { kind: "ics", url: ICS_LINK } } })).toThrow(/password/);
    expect(() => h.manager.create({ name: "x", prompt: "", botId: "b1", source: { type: "github", events: [], filters: {}, poller: { kind: "imap", host: "imap.example.com" } } })).toThrow(/cannot use/);
    expect(() => h.manager.create({ name: "x", prompt: "", botId: "b1", source: { type: "email", events: [], filters: {}, poller: { kind: "imap", host: "imap.example.com" }, graph: { connector: "ms" } } })).toThrow(/not both/);
    expect(() => h.manager.create({ name: "x", prompt: "", botId: "b1", source: { type: "email", events: [], filters: {}, poller: { kind: "imap", host: "imap.example.com", mailbox: "IN\"BOX" } } })).toThrow();
  });
});
