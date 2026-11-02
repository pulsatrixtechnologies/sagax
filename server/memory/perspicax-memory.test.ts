// Memory signals to a fake Perspicax over real HTTP (2026-10-11,
// server/memory/perspicax-memory.ts): the work feed in batches of 50, the duplicate
// check before a routine run, the feedback, and failing open.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PerspicaxDirectory } from "../perspicax-link.ts";
import {
  checkedWorkRow,
  DUPLICATES_PATH,
  duplicateNote,
  FEEDBACK_PATH,
  PerspicaxMemory,
  WORK_BATCH_MAX,
  WORK_PATH,
  type WorkRow,
} from "./perspicax-memory.ts";
import { PrincipalRegistry } from "../principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;

type Handler = (req: IncomingMessage, body: unknown, res: ServerResponse) => void | Promise<void>;
interface Seen { path: string; authorization: string; subject?: string; body: any }

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fakePerspicax(handler: Handler) {
  const seen: Seen[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;
      const subject = req.headers["x-perspicax-subject-token"];
      seen.push({ path: req.url ?? "", authorization: String(req.headers.authorization ?? ""), ...(typeof subject === "string" ? { subject } : {}), body });
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      res.on("close", () => { inflight -= 1; });
      void handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const dir = mkdtempSync(join(tmpdir(), "px-memory-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const linkFile = join(dir, "pulsabot.json");
  const writeLink = (token: string) => {
    writeFileSync(linkFile, JSON.stringify({ version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: SERVER_ID, origin: ORIGIN, link_token: token }));
    chmodSync(linkFile, 0o600);
  };
  writeLink(TOKEN_A);
  const directory = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    linkFile,
    expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
    principals: new PrincipalRegistry({ path: join(dir, "principals.json") }),
    onPersonOut: () => {},
    onRoleNarrowed: () => {},
    version: "0.1.101",
    log: () => {},
    // 2026-10-28: each person's own token, by their Perspicax user id
    subjectToken: async (sub) => (sub.startsWith("01J") ? `token-of-${sub}` : null),
  });
  const log: string[] = [];
  const memory = new PerspicaxMemory({ link: () => directory, log: (line) => log.push(line), flushDelayMs: 5 });
  return { seen, memory, log, writeLink, directory, maxInflight: () => maxInflight };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const row = (n: number): WorkRow => ({
  person: "01JPERSON", actor_kind: "bot", intent: `Routine run on Atlas ${n}`, action: "run",
  objects: [`sagax:thread:t${n}`], result: "partial", link: `${ORIGIN}/#thread=t${n}&bot=b1`,
});

async function settle(memory: PerspicaxMemory) {
  for (let i = 0; i < 200 && memory.pending(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  await memory.flush();
}

describe("the work feed (POST /api/v1/memory/work)", () => {
  it("sends the rows in batches of at most 50 with the link token, one batch at a time", async () => {
    const h = await fakePerspicax(async (_req, body, res) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      json(res, 200, { ids: (body as { rows: unknown[] }).rows.map((_r, i) => `w${i}`) });
    });
    for (let i = 0; i < 120; i++) h.memory.recordWork(row(i));
    await settle(h.memory);
    expect(h.seen.map((call) => [call.path, call.body.rows.length])).toEqual([[WORK_PATH, 50], [WORK_PATH, 50], [WORK_PATH, 20]]);
    expect(h.seen.every((call) => call.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
    expect(h.maxInflight()).toBe(1);
    expect(h.seen[0]!.body.rows[0]).toEqual(row(0));
    expect(WORK_BATCH_MAX).toBe(50);
  });

  it("2026-10-28: one person per batch, each with that person's own token, rows kept in order", async () => {
    const h = await fakePerspicax((_req, body, res) => json(res, 200, { ids: (body as { rows: unknown[] }).rows.map((_r, i) => `w${i}`) }));
    const of = (person: string, n: number): WorkRow => ({ ...row(n), person });
    h.memory.recordWork(of("01JALICE", 1));
    h.memory.recordWork(of("01JBOB", 2));
    h.memory.recordWork(of("01JALICE", 3));
    h.memory.recordWork(of("NOTOKEN", 4));
    await settle(h.memory);
    expect(h.seen.map((call) => [call.subject, call.body.rows.map((r: WorkRow) => r.intent)])).toEqual([
      ["token-of-01JALICE", ["Routine run on Atlas 1", "Routine run on Atlas 3"]],
      ["token-of-01JBOB", ["Routine run on Atlas 2"]],
      // no token at hand: the link token alone, as before
      [undefined, ["Routine run on Atlas 4"]],
    ]);
    expect(h.seen.every((call) => call.authorization === `Bearer ${TOKEN_A}`)).toBe(true);
  });

  it("follows a rotated link token after a 401", async () => {
    const h = await fakePerspicax((req, _body, res) => {
      if (req.headers.authorization !== `Bearer ${TOKEN_B}`) return json(res, 401, { error: "unauthorized" });
      json(res, 200, { ids: ["w1"] });
    });
    // the link file was read with the old token, then Perspicax rotated it
    expect(h.directory.linkTokenMatches(TOKEN_A)).toBe(true);
    h.writeLink(TOKEN_B);
    h.memory.recordWork(row(1));
    await settle(h.memory);
    expect(h.seen.map((call) => call.authorization)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
    expect(h.log).toEqual([]);
  });

  it("fails open: a refusal or a Perspicax without the feed drops the batch and says so once", async () => {
    const h = await fakePerspicax((_req, _body, res) => json(res, 404, { error: "not_found" }));
    h.memory.recordWork(row(1));
    await settle(h.memory);
    h.memory.recordWork(row(2));
    await settle(h.memory);
    expect(h.seen).toHaveLength(2);
    expect(h.memory.pending()).toBe(0);
    expect(h.log).toEqual(["perspicax memory: 1 work row(s) not recorded (this Perspicax has no work feed)"]);
    // nothing logged carries a token or a row
    expect(h.log.join("\n")).not.toContain(TOKEN_A);
  });

  it("keeps a row to what Perspicax accepts", () => {
    expect(checkedWorkRow({ ...row(1), intent: `line one\nline two ${"x".repeat(200)}`, objects: ["ok:1", "bad id", "x".repeat(200), "ok:1"], link: "javascript:alert(1)", tags: ["Client:Acme", "client:acme"] })).toEqual({
      person: "01JPERSON", actor_kind: "bot", intent: `line one line two ${"x".repeat(122)}`, action: "run", objects: ["ok:1"], result: "partial", tags: ["client:acme"],
    });
    expect(checkedWorkRow({ ...row(1), person: " " })).toBeNull();
    expect(checkedWorkRow({ ...row(1), action: "started" as WorkRow["action"] })).toBeNull();
    expect(checkedWorkRow({ ...row(1), result: "running" as WorkRow["result"] })).toBeNull();
  });
});

describe("the duplicate check (POST /api/v1/memory/duplicates)", () => {
  const answer = {
    turn: "01JTURN",
    duplicates: [
      { hint_id: "h1", pointer: "work:01JA", day: "2026-10-10", who: "team Dispatch", score: 0.72, matched_on: ["text"], readable: true, intent: "Triage the new tickets", tool: "sagax", action: "run", result: "ok", objects: ["sagax:run:1"], link: "/sagax/routines/r1" },
      { hint_id: "h2", pointer: "work:01JB", day: "2026-10-09", who: "a colleague", score: 0.61, matched_on: ["objects"], readable: false, intent: "must not be kept" },
      { hint_id: "h3", pointer: "not a pointer", day: "2026-10-09", who: "you", score: 0.6, readable: true },
    ],
    next: "someone is or was on this",
  };

  it("sends the person, the text and the objects, and keeps pointers and readable facts only", async () => {
    const h = await fakePerspicax((_req, _body, res) => json(res, 200, answer));
    const hint = await h.memory.checkDuplicates({ person: "01JPERSON", text: `Triage the new tickets ${"y".repeat(5000)}`, objects: ["sagax:routine:r1", "bad id"] });
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]!.path).toBe(DUPLICATES_PATH);
    expect(h.seen[0]!.authorization).toBe(`Bearer ${TOKEN_A}`);
    expect(h.seen[0]!.subject).toBe("token-of-01JPERSON");
    expect(h.seen[0]!.body).toEqual({ person: "01JPERSON", text: `Triage the new tickets ${"y".repeat(4000 - 23)}`, objects: ["sagax:routine:r1"], tags: [], participants: [] });
    expect(hint).toMatchObject({
      turn: "01JTURN",
      duplicates: [
        { hintId: "h1", pointer: "work:01JA", day: "2026-10-10", who: "team Dispatch", score: 0.72, readable: true, intent: "Triage the new tickets", link: "/sagax/routines/r1" },
        { hintId: "h2", pointer: "work:01JB", day: "2026-10-09", who: "a colleague", score: 0.61, readable: false },
      ],
    });
    expect(hint!.duplicates[1]).not.toHaveProperty("intent");
    expect(duplicateNote(hint!)).toBe([
      "Note from the organization memory (Perspicax): similar work was done or started recently.",
      "- work:01JA (2026-10-10, team Dispatch): Triage the new tickets",
      "- work:01JB (2026-10-09, a colleague)",
      "Before redoing it, open a pointer with the work_open tool, or ask its author with ask_person (person work:<id>), when your tools offer them.",
    ].join("\n"));
  });

  it("answers null, never throws, when nothing is similar, Perspicax refuses, or it is slow", async () => {
    const empty = await fakePerspicax((_req, _body, res) => json(res, 200, { turn: "t", duplicates: [] }));
    expect(await empty.memory.checkDuplicates({ person: "01JPERSON", text: "anything" })).toBeNull();
    const off = await fakePerspicax((_req, _body, res) => json(res, 409, { error: "memory_disabled" }));
    expect(await off.memory.checkDuplicates({ person: "01JPERSON", text: "anything" })).toBeNull();
    expect(off.log).toEqual(["perspicax memory: duplicate check unavailable (409)"]);
    const slow = await fakePerspicax(() => { /* never answers */ });
    const started = Date.now();
    expect(await slow.memory.checkDuplicates({ person: "01JPERSON", text: "anything" })).toBeNull();
    expect(Date.now() - started).toBeLessThan(4_000);
    // no person or no text: nothing is sent
    expect(await empty.memory.checkDuplicates({ person: "", text: "anything" })).toBeNull();
    expect(await empty.memory.checkDuplicates({ person: "01JPERSON", text: "  " })).toBeNull();
    expect(empty.seen).toHaveLength(1);
  });
});

describe("the feedback (POST /api/v1/memory/feedback)", () => {
  it("sends a verdict or the cards used, and refuses a half answer locally", async () => {
    const h = await fakePerspicax((_req, _body, res) => json(res, 200, { cards_marked: 1 }));
    expect(await h.memory.feedback({ person: "01JPERSON", hint: "h1", verdict: "same" })).toBe(true);
    expect(await h.memory.feedback({ person: "01JPERSON", turn: "01JTURN", used: ["hint:h1"] })).toBe(true);
    expect(await h.memory.feedback({ person: "01JPERSON", hint: "h1" })).toBe(false);
    expect(await h.memory.feedback({ person: "01JPERSON" })).toBe(false);
    expect(h.seen.map((call) => [call.path, call.body])).toEqual([
      [FEEDBACK_PATH, { person: "01JPERSON", hint: "h1", verdict: "same" }],
      [FEEDBACK_PATH, { person: "01JPERSON", turn: "01JTURN", used: ["hint:h1"], how: "cited" }],
    ]);
    expect(h.seen.map((call) => call.subject)).toEqual(["token-of-01JPERSON", "token-of-01JPERSON"]);
  });
});
