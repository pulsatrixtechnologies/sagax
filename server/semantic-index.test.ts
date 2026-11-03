// The local semantic index: the built-in encoder, passages, memory and
// conversation search, updates, scope, sealing and erasure, and the
// person's embedding endpoint with its fallback.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { WORKSPACE_OWNER } from "./encryption/content-keys.ts";
import { closeMessageDb, configureContentEncryption, deleteThread, eraseContentOwner, insertMessage, updateMessage, type ContentOwnerResolver } from "./messages/message-db.ts";
import { buildRecall } from "./recall.ts";
import { cosine, embeddingsAddress, HASHED_MIN_SCORE, hashedVector } from "./semantic-encoder.ts";
import { LocalSemanticIndex, MESSAGE_PASSAGE_CHARS, MESSAGE_PASSAGES, memoryLines, messagePassages, semanticIndexFile } from "./semantic-index.ts";
import { setSemanticIndex } from "./semantic-recall.ts";
import type { Message } from "./store.ts";
import { WORKSPACES_DIR, writeMemoryTopic } from "./workspace.ts";

const BOT = "bot-semantic-test";
const msg = (id: string, text: string, at = 1_000): Message => ({ id, role: "user", kind: "text", text, at });

let owners: Record<string, { owner: string; confidential: boolean }> = {};
const resolveOwner: ContentOwnerResolver = (threadId) => owners[threadId] ?? { owner: WORKSPACE_OWNER, confidential: false };
let index: LocalSemanticIndex | null = null;
let endpoint: { url: string; model: string } | null = null;
let enabled = true;

function makeIndex(fetcher?: typeof fetch): LocalSemanticIndex {
  index = new LocalSemanticIndex({ file: semanticIndexFile(DATA_DIR), enabled: () => enabled, endpoint: () => endpoint, ...(fetcher ? { fetcher } : {}) });
  index.start(60_000);
  return index;
}
const everything = () => ({ threadIds: ["t1", "t2"] });

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  owners = {};
  endpoint = null;
  enabled = true;
  configureContentEncryption({ mode: "off", resolveOwner, autoMigrate: false });
});
afterEach(() => {
  index?.stop();
  index = null;
  setSemanticIndex(null);
  closeMessageDb();
});

describe("the built-in encoder", () => {
  it("brings a typo and another ending close, and keeps unrelated text apart", () => {
    const note = hashedVector("The dentist appointment is on Thursday at 3pm");
    expect(cosine(note, hashedVector("when is my dentst apointment"))).toBeGreaterThan(HASHED_MIN_SCORE);
    expect(cosine(hashedVector("Marc a une allergie aux arachides"), hashedVector("est-il allergique ?"))).toBeGreaterThan(HASHED_MIN_SCORE);
    expect(cosine(note, hashedVector("the quarterly invoice is overdue"))).toBeLessThan(HASHED_MIN_SCORE);
    expect(cosine(note, hashedVector("Prefers green tea in the morning"))).toBeLessThan(HASHED_MIN_SCORE);
  });

  it("cuts messages into bounded passages and memory into lines", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about the garden shed.`).join(" ");
    const passages = messagePassages(long);
    expect(passages.length).toBeLessThanOrEqual(MESSAGE_PASSAGES);
    expect(passages.every((passage) => passage.length <= MESSAGE_PASSAGE_CHARS)).toBe(true);
    expect(memoryLines("---\ntitle: Health\naliases: [doctor]\n---\n# Health\n- Dentist on Thursday\n\n- ok\n")).toEqual(["- Dentist on Thursday"]);
  });

  it("reads an endpoint address as an OpenAI-compatible embeddings URL", () => {
    expect(embeddingsAddress("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1/embeddings");
    expect(embeddingsAddress("http://localhost:1234/v1/embeddings")).toBe("http://localhost:1234/v1/embeddings");
    expect(embeddingsAddress("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000/v1/embeddings");
    expect(embeddingsAddress("file:///etc/passwd")).toBeNull();
  });
});

describe("the local semantic index", () => {
  it("finds a memory line FTS5 misses, and recall puts it in the block", () => {
    writeMemoryTopic(BOT, "health.md", "- The dentist appointment is on Thursday at 3pm\n- Prefers green tea\n");
    const local = makeIndex();
    const hits = local.search(BOT, "when is my dentst apointment", 4, { threadIds: [] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "memory", label: "memory/health.md", snippet: "- The dentist appointment is on Thursday at 3pm" });
    const input = { botId: BOT, message: "when is my dentst apointment?", threadIds: [] as string[], label: () => "", author: () => "" };
    expect(buildRecall(input)).toBeNull();
    setSemanticIndex(local);
    expect(buildRecall({ ...input, semantic: true })?.text).toContain("dentist appointment is on Thursday");
  });

  it("follows memory edits, removes deleted lines and hides expired ones", () => {
    writeMemoryTopic(BOT, "health.md", "- The dentist appointment is on Thursday\n");
    const local = makeIndex();
    expect(local.search(BOT, "dentst apointment", 4, { threadIds: [] })).toHaveLength(1);
    writeMemoryTopic(BOT, "health.md", "- Physiotherapy session moved to Friday\n- 2020-01-01 · Dentist appointment Monday · until 2020-01-05\n");
    expect(local.search(BOT, "dentst apointment", 4, { threadIds: [] })).toEqual([]);
    expect(local.search(BOT, "physio sesion", 4, { threadIds: [] })[0]?.snippet).toContain("Physiotherapy");
  });

  it("searches only the conversations it is given, and follows edits and deletes", () => {
    insertMessage("t1", msg("m1", "The spare key is under the blue flowerpot by the door."));
    insertMessage("t2", msg("m2", "The wifi password is on the fridge."));
    const local = makeIndex();
    expect(local.search(BOT, "where did we hide the spare kee, flowerpots?", 4, { threadIds: ["t2"] })).toEqual([]);
    const hit = local.search(BOT, "where did we hide the spare kee, flowerpots?", 4, everything())[0];
    expect(hit).toMatchObject({ source: "conversation", threadId: "t1", role: "user", label: "t1" });
    expect(hit?.snippet).toContain("blue flowerpot");

    updateMessage("t1", msg("m1", "The spare key moved to the mailbox."));
    expect(local.search(BOT, "flowerpots", 4, everything())).toEqual([]);
    expect(local.search(BOT, "mailboxes", 4, everything())[0]?.snippet).toContain("mailbox");

    deleteThread("t1");
    expect(local.search(BOT, "mailboxes", 4, everything())).toEqual([]);
    const db = new DatabaseSync(semanticIndexFile(DATA_DIR), { readOnly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM passages WHERE scope = 't:t1'").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("catches up in the background and keeps its place across a restart", () => {
    insertMessage("t1", msg("m1", "Grandma's birthday dinner is at the Lebanese restaurant."));
    const first = makeIndex();
    first.tick(1_000);
    first.stop();
    const db = new DatabaseSync(semanticIndexFile(DATA_DIR), { readOnly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM passages WHERE scope = 't:t1'").get() as { n: number }).n).toBe(1);
    db.close();
    const second = makeIndex();
    expect(second.search(BOT, "grandmother birthday diner", 4, everything())[0]?.snippet).toContain("Lebanese");
    expect(second.status(BOT, ["t1"])).toMatchObject({ enabled: true, encoder: "built-in", conversationPassages: 1 });
  });

  it("does nothing when switched off", () => {
    writeMemoryTopic(BOT, "health.md", "- The dentist appointment is on Thursday\n");
    enabled = false;
    const local = makeIndex();
    expect(local.ready(BOT)).toBe(false);
    expect(local.search(BOT, "dentst apointment", 4, { threadIds: [] })).toEqual([]);
  });
});

describe("sealed like the transcripts", () => {
  it("seals vectors under the thread's key and forgets them when the key is erased", () => {
    configureContentEncryption({ mode: "on", resolveOwner, autoMigrate: false });
    owners = { t1: { owner: "alice", confidential: false } };
    insertMessage("t1", msg("m1", "The orchid greenhouse code is 4417."));
    const local = makeIndex();
    expect(local.search(BOT, "orchids greenhouse", 4, everything())[0]?.snippet).toContain("orchid greenhouse");
    local.stop();
    const db = new DatabaseSync(semanticIndexFile(DATA_DIR), { readOnly: true });
    const row = db.prepare("SELECT key_id, payload FROM passages WHERE scope = 't:t1'").get() as { key_id: string | null; payload: Uint8Array };
    db.close();
    expect(row.key_id).toBeTruthy();
    const file = readFileSync(semanticIndexFile(DATA_DIR)).toString("latin1");
    expect(file).not.toContain("orchid");

    eraseContentOwner("alice");
    const after = makeIndex();
    expect(after.search(BOT, "orchids greenhouse", 4, everything())).toEqual([]);
    after.stop();
    const check = new DatabaseSync(semanticIndexFile(DATA_DIR), { readOnly: true });
    expect((check.prepare("SELECT COUNT(*) AS n FROM passages WHERE scope = 't:t1'").get() as { n: number }).n).toBe(0);
    check.close();
  });
});

describe("the person's embedding endpoint", () => {
  // a fake model that knows two words mean the same thing
  const meaning = (text: string) => (/\b(car|automobile|vehicle)\b/i.test(text) ? [1, 0, 0] : /\btea\b/i.test(text) ? [0, 1, 0] : [0, 0, 1]);
  const fakeEndpoint = (calls: string[][]): typeof fetch => (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    calls.push(body.input);
    return new Response(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: meaning(text) })) }), { status: 200 });
  }) as typeof fetch;

  it("finds a synonym the built-in vectors cannot", async () => {
    writeMemoryTopic(BOT, "garage.md", "- The automobile is parked in bay seven\n- Prefers green tea\n");
    endpoint = { url: "http://127.0.0.1:9/v1", model: "fake-embed" };
    const calls: string[][] = [];
    const local = makeIndex(fakeEndpoint(calls));
    expect(local.search(BOT, "where is my car", 4, { threadIds: [] })).toEqual([]);
    await local.embedSome();
    await local.prepare(BOT, "where is my car");
    const hits = local.search(BOT, "where is my car", 4, { threadIds: [] });
    expect(hits[0]).toMatchObject({ label: "memory/garage.md", snippet: "- The automobile is parked in bay seven" });
    expect(calls.flat()).toContain("where is my car");
    expect(local.status(BOT, [])).toMatchObject({ encoder: "endpoint", model: "fake-embed", endpointOk: true });
  });

  it("falls back to the built-in vectors when the endpoint fails", async () => {
    writeMemoryTopic(BOT, "health.md", "- The dentist appointment is on Thursday\n");
    endpoint = { url: "http://127.0.0.1:9/v1", model: "fake-embed" };
    const local = makeIndex((async () => { throw new Error("connection refused"); }) as typeof fetch);
    await local.prepare(BOT, "dentst apointment");
    expect(local.search(BOT, "dentst apointment", 4, { threadIds: [] })[0]?.snippet).toContain("dentist");
    expect(local.status(BOT, [])).toMatchObject({ encoder: "endpoint", endpointOk: false });
  });
});
