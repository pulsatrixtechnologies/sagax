// #4100 lot "listening-session-store", on an isolated server: a person
// listens in their own conversation with their bot; the session, its one row
// and its transcript are theirs only (another person and an administrator get
// 404); final lines are idempotent by seq; stop settles the row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FakeOidcUser } from "../testing/fake-oidc-provider.ts";
import { startOrgServer, type Auth, type OrgServer } from "../testing/org-server-harness.ts";

const person = (name: string, role = "employee"): FakeOidcUser => ({
  sub: `01JLISTEN${name.toUpperCase().padEnd(17, "0")}`.slice(0, 26),
  email: `${name}@example.test`, name, preferred_username: name, role,
});
const BOSS = person("boss", "admin");
const ADA = person("ada");
const BOB = person("bob");

let org: OrgServer;
const auths = new Map<FakeOidcUser, Auth>();
const api = async (method: string, path: string, as: FakeOidcUser, body?: unknown) => org.api(method, path, auths.get(as), body);

describe.skipIf(process.platform === "win32")("listening sessions on an organization server (#4100)", () => {
  beforeAll(async () => {
    org = await startOrgServer({ user: BOSS, prefix: "sagax-listening-e2e-" });
    for (const who of [BOSS, ADA, BOB]) auths.set(who, await org.signIn(who));
  }, 90_000);

  afterAll(async () => {
    await org?.close();
  });

  it("keeps the session, its row and its transcript to the person who listens", async () => {
    const created = await api("POST", "/api/bots", ADA, { name: "Listener" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };

    const started = await api("POST", `/api/bots/${bot.id}/listening`, ADA, {});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const session = started.body.session as { sessionId: string; threadId: string; messageId: string; state: string; sources: unknown };
    expect(session).toMatchObject({ state: "listening", lineCount: 0, sources: { microphone: true, computer: false } });
    expect(session.sessionId).toMatch(/^ls_[a-f0-9]{20}$/);
    expect(JSON.stringify(started.body)).not.toContain("principalId");
    // starting again answers the live session
    expect((await api("POST", `/api/bots/${bot.id}/listening`, ADA, {})).body.session.sessionId).toBe(session.sessionId);

    const batch = { lines: [{ seq: 1, at: 1, speaker: "me", text: "Hello" }, { seq: 2, at: 2, speaker: "s1", text: "We ship Friday." }], speakers: [{ key: "s1", label: "Speaker 1" }] };
    const first = await api("POST", `/api/listening/${session.sessionId}/lines`, ADA, batch);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await api("POST", `/api/listening/${session.sessionId}/lines`, ADA, batch);
    expect(again.body.session.lineCount).toBe(2);
    expect((await api("POST", `/api/listening/${session.sessionId}/lines`, ADA, { lines: [{ seq: "x" }] })).status).toBe(400);

    const rows = async (as: FakeOidcUser) => ((await api("GET", `/api/threads/${session.threadId}/messages`, as)).body.messages ?? []) as Array<{ id: string; role: string; kind: string; text?: string; listening?: { sessionId: string; lineCount: number; state: string } }>;
    const mine = (await rows(ADA)).filter((row) => row.listening);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: session.messageId, role: "bot", kind: "text", text: "Listening to a conversation", listening: { sessionId: session.sessionId, lineCount: 2, state: "listening" } });

    // someone else, an administrator included, has no route to it
    for (const other of [BOB, BOSS]) {
      expect((await api("GET", `/api/listening/${session.sessionId}`, other)).status, other.name).toBe(404);
      expect((await api("POST", `/api/listening/${session.sessionId}/lines`, other, { lines: [{ seq: 9, speaker: "x", text: "planted" }] })).status, other.name).toBe(404);
      expect((await api("POST", `/api/listening/${session.sessionId}/stop`, other)).status, other.name).toBe(404);
    }
    expect((await api("POST", `/api/bots/${bot.id}/listening`, BOB, {})).status).toBe(404);

    const transcript = await api("GET", `/api/listening/${session.sessionId}?after=1`, ADA);
    expect(transcript.status).toBe(200);
    expect(transcript.body.lines).toEqual([{ seq: 2, at: 2, speaker: "s1", text: "We ship Friday." }]);

    // the last lines can come with the stop (a window that closes)
    expect((await api("POST", `/api/listening/${session.sessionId}/stop`, ADA, { lines: [{ seq: "x" }] })).status).toBe(400);
    const stopped = await api("POST", `/api/listening/${session.sessionId}/stop`, ADA, { lines: [{ seq: 3, at: 3, speaker: "s1", text: "Bye." }] });
    expect(stopped.status).toBe(200);
    expect(stopped.body.session.state).toBe("ended");
    const settled = (await rows(ADA)).filter((row) => row.listening);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.text).toBe("Listened 1 min, 2 speakers");
    expect(settled[0]!.listening!.state).toBe("ended");
    expect((await api("GET", `/api/listening/${session.sessionId}`, ADA)).body.lines.map((line: { text: string }) => line.text)).toEqual(["Hello", "We ship Friday.", "Bye."]);
  }, 60_000);

  // #5130: the watch starts an in-person meeting; a purpose it does not know is refused.
  it("starts a meeting when asked, and says the purpose of every session", async () => {
    const created = await api("POST", "/api/bots", ADA, { name: "Notes" });
    const bot = created.body.bot as { id: string };
    expect((await api("POST", `/api/bots/${bot.id}/listening`, ADA, { purpose: "lecture" })).status).toBe(400);
    const started = await api("POST", `/api/bots/${bot.id}/listening`, ADA, { purpose: "meeting" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.session).toMatchObject({ state: "listening", purpose: "meeting" });
    const stopped = await api("POST", `/api/listening/${started.body.session.sessionId}/stop`, ADA, {});
    expect(stopped.body.session).toMatchObject({ state: "ended", purpose: "meeting" });
  }, 60_000);
});
