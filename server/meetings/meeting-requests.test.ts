import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveCardKind, liveDecisionRefusal, liveProposal } from "../../shared/live-approval.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { MEETING_MAX_CONCURRENT, createMeetingService, type MeetingServiceDeps } from "./meeting-requests.ts";
import type { MeetingOutcome } from "./meeting-session.ts";

type Row = { id: string; card?: Record<string, unknown> & { requestId?: string } };

function setup(overrides: Partial<MeetingServiceDeps> = {}, outcome?: MeetingOutcome) {
  const dataDir = mkdtempSync(join(tmpdir(), "meetings-"));
  const threads = new Map<string, Row[]>();
  const summaries: Array<{ botId: string; threadId: string; prompt: string }> = [];
  let finish: (value: MeetingOutcome) => void = () => {};
  const runs: Array<{ leave: boolean }> = [];
  const store = {
    bot: (id: string) => id.startsWith("bot-") ? { id, name: id === "bot-1" ? "Ada" : id, color: "blue" } : null,
    messagesFor: (threadId: string) => threads.get(threadId) ?? [],
    appendMessage: (threadId: string, message: { card: Record<string, unknown> }) => {
      const row = { id: `m${(threads.get(threadId)?.length ?? 0) + 1}`, card: message.card as Row["card"] };
      threads.set(threadId, [...(threads.get(threadId) ?? []), row]);
      return { id: row.id };
    },
    patchMessage: (threadId: string, id: string, patch: { card: Record<string, unknown> }) => {
      const row = threads.get(threadId)?.find((candidate) => candidate.id === id);
      if (row) row.card = patch.card as Row["card"];
      return row ?? null;
    },
  };
  const service = createMeetingService({
    store: store as unknown as MeetingServiceDeps["store"],
    dataDir,
    now: () => 1_000,
    browserRefusal: () => null,
    openBrowser: async () => ({ open: async () => {}, eval: async () => null, click: async () => true, close: async () => {} }),
    transcriber: async () => ({ transcribe: async () => "hello" }),
    summarize: (botId, threadId, prompt) => summaries.push({ botId, threadId, prompt }),
    session: () => {
      const run = { leave: false };
      runs.push(run);
      return {
        run: () => outcome ? Promise.resolve(outcome) : new Promise<MeetingOutcome>((resolve) => { finish = resolve; }),
        requestLeave: () => { run.leave = true; },
      };
    },
    ...overrides,
  });
  const card = (threadId = "t1") => threads.get(threadId)?.[0]?.card as unknown as OptionCardData & { meetingRequest: NonNullable<OptionCardData["meetingRequest"]> };
  return { service, dataDir, summaries, runs, card, finish: (value: MeetingOutcome) => finish(value), cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("meeting requests", () => {
  it("posts a consent card that a Live call decides through its own resolver (#1098)", () => {
    const t = setup(); cleanups.push(t.cleanup);
    const result = t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "Weekly sync" });
    expect(result).toMatchObject({ supported: true, provider: "google-meet" });
    const card = t.card();
    expect(card.tool).toBe("join_meeting");
    expect(card.meetingRequest).toMatchObject({ status: "pending", displayName: "Ada (transcription)", supported: true, reason: "Weekly sync" });
    expect(card.options).toEqual(["Rejoindre et prendre des notes", "Pas cette fois"]);
    // #3367: Always allow keeps this provider for the bot
    expect(card.ownerRule).toEqual({
      tool: "sagax:meeting",
      scope: { provider: "google-meet" },
      description: "Join Google Meet meetings as a notetaker",
    });
    // #1286: a meeting proposal is decided by voice through its own resolver, never handed to the engine
    expect(liveProposal(card)).toBe(true);
    expect(liveCardKind(card)).toBe("approval");
    expect(liveDecisionRefusal(card)).toBeNull();
  });

  it("joins at once when Always allow was kept for that provider (#3367)", async () => {
    const t = setup({
      keptRule: () => ({
        id: "rule-meet",
        ownerId: "owner-1",
        behavior: "allow",
        description: "Join Google Meet meetings as a notetaker",
      }),
    });
    cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "Weekly sync" });
    await flush();
    expect(t.card().ruleSaved).toEqual({
      id: "rule-meet",
      behavior: "allow",
      description: "Join Google Meet meetings as a notetaker",
    });
    expect(t.card().answered).toBe("allow");
    expect(t.card().meetingRequest.status).toBe("joining");
    expect(t.runs).toHaveLength(1);
  });

  it("says Zoom and Teams are not supported yet, and never joins them", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    const result = t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://zoom.us/j/12345678901", reason: "" });
    expect(result).toMatchObject({ supported: false, provider: "zoom" });
    const requestId = t.card().requestId!;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toMatchObject({ outcome: "rejected" });
    expect(t.runs).toHaveLength(0);
  });

  it("refuses a link that is no meeting", () => {
    const t = setup(); cleanups.push(t.cleanup);
    expect(t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://example.com/abc-defg-hij", reason: "" })).toHaveProperty("error");
  });

  it("refuses when the bot has no browser", () => {
    const t = setup({ browserRefusal: () => "no browser" }); cleanups.push(t.cleanup);
    expect(t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" })).toEqual({ error: "no browser" });
  });

  it("declines on deny, and a second answer is already settled", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "deny", principalId: "p" })).toEqual({ claimed: true, outcome: "rejected" });
    expect(t.card().meetingRequest.status).toBe("declined");
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toMatchObject({ alreadySettled: true, outcome: "rejected" });
    expect(t.runs).toHaveLength(0);
  });

  it("stays open with a reason when speech to text is not available", async () => {
    const t = setup({ transcriber: async () => ({ error: "add an xAI key" }) }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toEqual({ claimed: true, status: 409, error: "add an xAI key" });
    expect(t.card().answered).toBeUndefined();
    expect(t.card().meetingRequest).toMatchObject({ status: "pending", detail: "add an xAI key" });
  });

  it("joins once on allow, refuses a second meeting, saves the transcript privately and asks for the summary", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p", personName: "Sam" })).toEqual({ claimed: true, outcome: "allowed-once" });
    expect(t.card().answered).toBe("allow");
    expect(t.card().meetingRequest.status).toBe("joining");
    expect(t.runs).toHaveLength(1);
    expect(t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/zzz-zzzz-zzz", reason: "" })).toHaveProperty("error");
    expect(t.service.leave("t1", requestId)).toEqual({ ok: true });
    expect(t.runs[0]!.leave).toBe(true);
    t.finish({ status: "ended", detail: "Left at the person's request.", lines: [{ at: 1_000, text: "We ship Friday." }], recorded: true });
    await flush();
    expect(t.card().meetingRequest.status).toBe("ended");
    // No transcript or audio file: only the live index, now empty.
    expect(readdirSync(join(t.dataDir, "meetings"))).toEqual(["live.json"]);
    expect(JSON.parse(readFileSync(join(t.dataDir, "meetings", "live.json"), "utf8"))).toEqual([]);
    if (process.platform !== "win32") expect(statSync(join(t.dataDir, "meetings", "live.json")).mode & 0o777).toBe(0o600);
    expect(t.summaries).toHaveLength(1);
    expect(t.summaries[0]!.prompt).toContain("We ship Friday.");
    expect(t.service.leave("t1", requestId)).toMatchObject({ ok: false, status: 409 });
  });

  it("asks for no summary when nothing was transcribed", async () => {
    const t = setup({}, { status: "failed", detail: "announcement failed", lines: [], recorded: false }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    await t.service.resolve({ threadId: "t1", requestId: t.card().requestId!, behavior: "allow", principalId: "p" });
    await flush();
    expect(t.card().meetingRequest).toMatchObject({ status: "failed", detail: "announcement failed" });
    expect(t.summaries).toHaveLength(0);
  });

  it("closes cards left live by a server that stopped", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" });
    // A new service over the same data, as after a restart.
    mkdirSync(join(t.dataDir, "meetings"), { recursive: true });
    writeFileSync(join(t.dataDir, "meetings", "live.json"), JSON.stringify([{ threadId: "t1", requestId }]));
    const again = createMeetingService({
      store: { bot: () => null, messagesFor: (threadId: string) => threadId === "t1" ? [{ id: "m1", card: t.card() as never }] : [], appendMessage: () => ({ id: "x" }), patchMessage: (_t: string, _m: string, patch: { card: unknown }) => Object.assign(t.card(), patch.card) },
      dataDir: t.dataDir,
      browserRefusal: () => null,
      openBrowser: async () => { throw new Error("unused"); },
      transcriber: async () => ({ error: "unused" }),
      summarize: () => {},
    });
    expect(again.recoverInterrupted()).toBe(1);
    expect(t.card().meetingRequest).toMatchObject({ status: "failed", detail: "The server stopped during the meeting." });
  });

  it("reserves the bot before any await: two taps on two cards start one meeting", async () => {
    let unblock: () => void = () => {};
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const t = setup({ transcriber: async () => { await gate; return { transcribe: async () => "x" }; } }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    t.service.submit({ botId: "bot-1", threadId: "t2", url: "https://meet.google.com/zzz-zzzz-zzz", reason: "" });
    const first = t.service.resolve({ threadId: "t1", requestId: t.card("t1").requestId!, behavior: "allow", principalId: "p" });
    const second = await t.service.resolve({ threadId: "t2", requestId: t.card("t2").requestId!, behavior: "allow", principalId: "p" });
    expect(second).toMatchObject({ claimed: true, status: 409 });
    expect(t.card("t2").meetingRequest).toMatchObject({ status: "pending", detail: expect.stringContaining("already in another meeting") });
    unblock();
    expect(await first).toEqual({ claimed: true, outcome: "allowed-once" });
    expect(t.runs).toHaveLength(1);
  });

  it("releases the reservation on every failure path", async () => {
    let fail = true;
    const t = setup({ transcriber: async () => fail ? { error: "no key" } : { transcribe: async () => "x" } }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toMatchObject({ status: 409 });
    fail = false;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toEqual({ claimed: true, outcome: "allowed-once" });
    const broken = setup({ openBrowser: async () => { throw new Error("no chrome"); } }); cleanups.push(broken.cleanup);
    broken.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    await broken.service.resolve({ threadId: "t1", requestId: broken.card().requestId!, behavior: "allow", principalId: "p" });
    expect(broken.card().meetingRequest.status).toBe("failed");
    // The bot is free again: a new card can be approved.
    broken.service.submit({ botId: "bot-1", threadId: "t3", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    expect(broken.card("t3").meetingRequest.status).toBe("pending");
  });

  it("caps the meeting browsers running at once on the server", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    for (let index = 0; index <= MEETING_MAX_CONCURRENT; index++) {
      t.service.submit({ botId: `bot-${index + 1}`, threadId: `t${index}`, url: "https://meet.google.com/abc-defg-hij", reason: "" });
    }
    for (let index = 0; index < MEETING_MAX_CONCURRENT; index++) {
      expect(await t.service.resolve({ threadId: `t${index}`, requestId: t.card(`t${index}`).requestId!, behavior: "allow", principalId: "p" })).toMatchObject({ outcome: "allowed-once" });
    }
    const over = `t${MEETING_MAX_CONCURRENT}`;
    expect(await t.service.resolve({ threadId: over, requestId: t.card(over).requestId!, behavior: "allow", principalId: "p" })).toMatchObject({ status: 409 });
    expect(t.card(over).meetingRequest.detail).toContain("already running on this server");
  });

  it("keeps nothing when a participant made the bot leave: no tail, no summary, no transcript", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" });
    // The live card showed some lines before the objection.
    t.card().meetingRequest.transcriptTail = ["We ship Friday."];
    t.card().meetingRequest.segments = 1;
    const lines = [{ at: 1, text: "We ship Friday." }];
    t.finish({ status: "ended", detail: "Left at a participant's request.", endReason: "participant", lines, recorded: true });
    await flush();
    expect(t.card().meetingRequest).toMatchObject({ status: "ended", endReason: "participant", detail: "Left at a participant's request: nothing was kept." });
    expect(t.card().meetingRequest.transcriptTail).toBeUndefined();
    expect(t.card().meetingRequest.segments).toBeUndefined();
    expect(t.summaries).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it("clears the live tail from the card once the summary turn is asked for", async () => {
    const t = setup(); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    await t.service.resolve({ threadId: "t1", requestId: t.card().requestId!, behavior: "allow", principalId: "p" });
    t.card().meetingRequest.transcriptTail = ["We ship Friday."];
    t.finish({ status: "ended", detail: "The meeting ended.", lines: [{ at: 1, text: "We ship Friday." }], recorded: true });
    await flush();
    expect(t.summaries).toHaveLength(1);
    expect(t.card().meetingRequest.transcriptTail).toBeUndefined();
  });

  it("releases the reservation when anything between it and the session throws", async () => {
    let explode = true;
    const t = setup({ session: (() => { if (explode) throw new Error("boom"); return { run: () => new Promise(() => {}), requestLeave: () => {} }; }) as never }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    await expect(t.service.resolve({ threadId: "t1", requestId: t.card().requestId!, behavior: "allow", principalId: "p" })).rejects.toThrow("boom");
    explode = false;
    t.service.submit({ botId: "bot-1", threadId: "t2", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    expect(await t.service.resolve({ threadId: "t2", requestId: t.card("t2").requestId!, behavior: "allow", principalId: "p" })).toEqual({ claimed: true, outcome: "allowed-once" });
  });

  it("stages, approves and leaves nothing while the notetaker is off", async () => {
    let on = true;
    const t = setup({ enabled: () => on }); cleanups.push(t.cleanup);
    t.service.submit({ botId: "bot-1", threadId: "t1", url: "https://meet.google.com/abc-defg-hij", reason: "" });
    const requestId = t.card().requestId!;
    on = false;
    expect(t.service.submit({ botId: "bot-1", threadId: "t2", url: "https://meet.google.com/abc-defg-hij", reason: "" })).toMatchObject({ code: "meetings_disabled" });
    // A card staged while it was on cannot be approved once it is off.
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toMatchObject({ claimed: true, status: 403, code: "meetings_disabled" });
    expect(t.card().meetingRequest.status).toBe("pending");
    expect(t.runs).toHaveLength(0);
    expect(t.service.leave("t1", requestId)).toMatchObject({ ok: false, status: 403, code: "meetings_disabled" });
    on = true;
    expect(await t.service.resolve({ threadId: "t1", requestId, behavior: "allow", principalId: "p" })).toEqual({ claimed: true, outcome: "allowed-once" });
  });
});
