import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { parseOrgImportDocument } from "../../shared/org-import.ts";
import { DATA_DIR } from "../config.ts";
import { createLinkedSubjectsRoute, createOrgImportDocument, parseOrgExportChoices } from "./org-export.ts";
import { PrincipalRegistry } from "../principals.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RouteContext } from "../routes/table.ts";
import { RoutineManager } from "../routines/routines.ts";
import { Store, titleFromMessage } from "../store.ts";
import { appendMemoryLog, writeMemoryFile, writeMemoryTopic } from "../workspace.ts";

const SELF = "pr_11111111-1111-4111-8111-111111111111";
const DANA = "pr_22222222-2222-4222-8222-222222222222";
const KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE00";

function fixture() {
  const store = new Store(() => ({ instanceId: "fixture", model: "fixture-model" }));
  const routines = new RoutineManager({
    botState: (id) => (store.bot(id) ? "ready" : "missing"),
    goalState: (id, botId) => (store.group(id)?.memberIds.includes(botId) ? "ready" : "missing"),
    createTask: (id, title) => store.createTask(id, title),
    startTurn: async () => { throw new Error("never runs"); },
  });
  const atlas = store.createBot({ name: "Atlas" }, { seedMessages: false });
  const bolt = store.createBot({ name: "Bolt" }, { seedMessages: false });
  const cleo = store.createBot({ name: "Cleo" }, { seedMessages: false });
  store.patchBot(atlas.id, { ownerUserId: SELF, directGrants: [DANA],
    playbooks: [{ key: "p", name: "Deploy", summary: "", triggers: [], instructions: `use ${KEY}` }] });
  store.setSoul(atlas.id, `Never print password=hunter2hunter2`);
  store.patchBot(cleo.id, { ownerUserId: DANA });
  store.appendMessage(atlas.threadId, { role: "user", kind: "text", text: `my key is ${KEY}`, at: 1 });
  store.appendMessage(atlas.threadId, { role: "bot", kind: "text", text: "noted", at: 2 });
  store.appendMessage(bolt.threadId, { role: "user", kind: "text", text: "hello bolt", at: 3 });
  writeMemoryFile(atlas.id, `remember ${KEY}`);
  writeMemoryTopic(atlas.id, "people.md", "topic");
  appendMemoryLog(atlas.id, "a day");
  writeMemoryFile(bolt.id, "bolt memory");
  const pair = store.createGroup("Atlas and Bolt", [atlas.id, bolt.id], false);
  store.patchGroup(pair.id, { humanIds: [SELF] });
  const withDana = store.createGroup("With Dana", [atlas.id, bolt.id], false);
  store.patchGroup(withDana.id, { humanIds: [SELF, DANA] });
  const withCleo = store.createGroup("With Cleo", [atlas.id, cleo.id], false);
  routines.create({ name: "Hourly", prompt: "check", botId: atlas.id, enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 } });
  routines.create({ name: "Cleo job", prompt: "check", botId: cleo.id, enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 } });
  routines.create({ name: "Dana goal", prompt: "goal", target: "room-goal", groupId: withDana.id, botId: atlas.id, enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 0 } });
  return { store, routines, atlas, bolt, cleo, pair, withDana, withCleo };
}

const describePerson = (id: string) => (id === DANA ? "dana@example.test" : undefined);

describe("createOrgImportDocument", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("copies only the chosen bots, applies the choices, names people by id and scrubs secrets", () => {
    const f = fixture();
    const result = createOrgImportDocument(f.store, f.routines.listRoutines(), {
      localPrincipalId: SELF,
      choices: [{ id: f.atlas.id, threads: true, memory: true }, { id: f.bolt.id, threads: false, memory: false }],
      describe: describePerson,
      now: () => Date.UTC(2026, 9, 1),
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.filename).toBe("sagax-org-copy-2026-10-01.json");
    const doc = parseOrgImportDocument(JSON.parse(JSON.stringify(result.document)));
    expect(doc.backup.bots.map((b) => b.name).sort()).toEqual(["Atlas", "Bolt"]);
    const bolt = doc.backup.bots.find((b) => b.name === "Bolt")!;
    expect(bolt.tasks).toHaveLength(1);
    expect(bolt.tasks[0]!.messages).toHaveLength(0);
    expect(bolt.memory).toBeUndefined();
    const atlas = doc.backup.bots.find((b) => b.name === "Atlas")!;
    expect(atlas.memory?.topics).toHaveLength(1);
    expect(atlas.memory?.logs).toHaveLength(1);
    // Rooms: only the operator's own room with every bot chosen travels.
    expect(doc.backup.groups.map((g) => g.name)).toEqual(["Atlas and Bolt"]);
    // Routines: with their bot, and only when their room travels.
    expect(doc.backup.routines.map((r) => r.name)).toEqual(["Hourly"]);
    expect(doc.people.routines).toEqual([{ runAs: null }]);
    expect(doc.people.bots[f.atlas.id]).toEqual({ owner: SELF, grants: [DANA] });
    expect(doc.people.bots[f.bolt.id]).toEqual({ owner: null, grants: [] });
    expect(doc.people.groups[f.pair.id]).toEqual({ humans: [SELF] });
    const text = JSON.stringify(result.document);
    expect(text).not.toContain("dana@example.test");
    expect(text).not.toContain("sk-ant-api03");
    expect(text).not.toContain("hunter2hunter2");
    // The message, the instructions and the playbook (memory is scrubbed when written).
    expect(result.summary.redacted).toBe(3);
    expect(result.summary.bots.find((b) => b.name === "Atlas")).toMatchObject({ threads: 1, messages: 2, memoryFiles: 3 });
    expect(result.summary.bots.find((b) => b.name === "Bolt")).toMatchObject({ threads: 0, messages: 0, memoryFiles: 0 });
    expect(result.summary.notCopied).toEqual(expect.arrayContaining([
      { kind: "room", name: "With Dana", reason: "other_people", person: "dana@example.test" },
      { kind: "room", name: "With Cleo", reason: "bot_not_chosen" },
      { kind: "routine", name: "Dana goal", reason: "room_not_copied" },
      { kind: "grant", name: "Atlas", reason: "other_people", person: "dana@example.test" },
    ]));
    expect(result.summary.notCopied.some((entry) => entry.name === "Cleo job")).toBe(false);
  });

  it("scrubs routine prompts, room bulletins and titles and counts them", () => {
    const f = fixture();
    const hourly = f.routines.listRoutines().find((r) => r.name === "Hourly")!;
    f.routines.update(hourly.id, { prompt: `call the API with ${KEY}` });
    f.store.patchGroup(f.pair.id, { bulletin: `shared token ${KEY}` });
    f.store.createTask(f.atlas.id, `deploy with ${KEY}`);
    const result = createOrgImportDocument(f.store, f.routines.listRoutines(), {
      localPrincipalId: SELF,
      choices: [{ id: f.atlas.id, threads: true, memory: false }, { id: f.bolt.id, threads: true, memory: false }],
      describe: describePerson,
    });
    if (!result.ok) throw new Error(result.code);
    const doc = parseOrgImportDocument(JSON.parse(JSON.stringify(result.document)));
    expect(doc.backup.routines[0]!.prompt).toMatch(/«redacted \d+ chars»/);
    expect(doc.backup.groups[0]!.bulletin).toMatch(/«redacted \d+ chars»/);
    expect(JSON.stringify(result.document)).not.toContain("sk-ant-api03");
    // Message, soul, playbook, routine prompt, bulletin and task title.
    expect(result.summary.redacted).toBe(6);
  });

  it("masks the start of a key that a cut title kept, and names new titles after redacting", () => {
    const f = fixture();
    // An older automatic title: cut at 47 characters before any redaction.
    const task = f.store.createTask(f.atlas.id)!;
    f.store.renameTask(f.atlas.id, task.threadId, "Bonjour Atlas, voici la cle de test sk-ant-api0…");
    const result = createOrgImportDocument(f.store, f.routines.listRoutines(), {
      localPrincipalId: SELF,
      choices: [{ id: f.atlas.id, threads: true, memory: false }],
      describe: describePerson,
    });
    if (!result.ok) throw new Error(result.code);
    const json = JSON.stringify(result.document);
    expect(json).not.toContain("sk-ant-api0");
    expect(json).toContain("Bonjour Atlas, voici la cle de test «redacted 11 chars»…");
    expect(result.summary.redacted).toBeGreaterThanOrEqual(1);
    // New automatic titles redact first, so no key start survives the cut.
    expect(titleFromMessage(`Bonjour Atlas, voici la cle de test ${KEY} merci`)).not.toMatch(/sk-ant/);
  });

  it("refuses a bot owned by someone else and an unknown bot", () => {
    const f = fixture();
    const base = { localPrincipalId: SELF, describe: describePerson };
    expect(createOrgImportDocument(f.store, [], { ...base, choices: [{ id: f.cleo.id, threads: true, memory: true }] })).toMatchObject({ ok: false, status: 403, code: "not_your_bot" });
    expect(createOrgImportDocument(f.store, [], { ...base, choices: [{ id: "nope", threads: true, memory: true }] })).toMatchObject({ ok: false, status: 404, code: "unknown_bot" });
  });

  it("checks the request body", () => {
    expect(parseOrgExportChoices({ bots: [] })).toMatch(/between 1 and 200/);
    expect(parseOrgExportChoices({ bots: [{ id: "a", threads: true }] })).toMatch(/threads, memory/);
    expect(parseOrgExportChoices({ bots: [{ id: "a", threads: true, memory: false }, { id: "a", threads: true, memory: false }] })).toMatch(/twice/);
    expect(parseOrgExportChoices({ bots: [{ id: "a", threads: true, memory: false }] })).toEqual([{ id: "a", threads: true, memory: false }]);
  });
});

describe("linked subjects", () => {
  it("keeps one entry per issuer, subject and server on the local person, at most 20", () => {
    const registry = new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "linked-")), "principals.json") });
    registry.localOperator();
    registry.linkSubject({ iss: "http://px.test", sub: "B1", serverOrigin: "http://org.test" });
    const again = registry.linkSubject({ iss: "http://px.test", sub: "B1", serverOrigin: "http://org.test" });
    expect(again.linkedSubjects).toHaveLength(1);
    for (let i = 0; i < 25; i += 1) registry.linkSubject({ iss: "http://px.test", sub: `S${i}`, serverOrigin: "http://org.test" });
    const local = registry.local()!;
    expect(local.linkedSubjects).toHaveLength(20);
    expect(local.linkedSubjects!.at(-1)!.sub).toBe("S24");
    // Survives a reload.
    expect(new PrincipalRegistry({ path: (registry as unknown as { path: string }).path }).local()!.linkedSubjects).toHaveLength(20);
  });

  it("answers the operator on loopback only", async () => {
    const saved: unknown[] = [];
    const route = createLinkedSubjectsRoute({ list: () => [], link: (input) => { saved.push(input); return [{ ...input, linkedAt: 1 }]; } });
    const call = async (auth: RequestAuth, method: string, body: unknown = {}) => {
      const out: { status?: number; body?: unknown } = {};
      await route({
        req: {}, res: { setHeader: () => {} }, path: "/api/identity/linked-subjects", method, auth,
        json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
        readBody: async () => body,
      } as unknown as RouteContext);
      return out;
    };
    const loopback: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    const session = { kind: "session", via: "cookie", scopes: ["admin", "client"], session: { id: "s" } } as unknown as RequestAuth;
    expect(await call(session, "GET")).toMatchObject({ status: 403 });
    expect(await call(session, "POST", { iss: "http://px.test", sub: "B1", serverOrigin: "http://org.test" })).toMatchObject({ status: 403 });
    expect(await call({ kind: "loopback", scopes: ["client"], trust: "service" }, "GET")).toMatchObject({ status: 403 });
    expect(await call(loopback, "GET")).toMatchObject({ status: 200, body: { linkedSubjects: [] } });
    expect(await call(loopback, "POST", { iss: "nope", sub: "B1", serverOrigin: "http://org.test" })).toMatchObject({ status: 400 });
    expect(await call(loopback, "POST", { iss: "http://px.test", sub: "B1", serverOrigin: "http://org.test/x" })).toMatchObject({ status: 200 });
    expect(saved).toEqual([{ iss: "http://px.test", sub: "B1", serverOrigin: "http://org.test" }]);
  });
});
