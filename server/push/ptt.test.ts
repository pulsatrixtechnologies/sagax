import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildPttRequest, createPttChannelStore, isPttTurn, PTT_TEXT_MAX_BYTES, sendPttReply } from "./ptt.ts";

const TOKEN = "ab".repeat(40);
const CHANNEL = "11111111-2222-3333-4444-555555555555";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const store = () => { const dir = mkdtempSync(join(tmpdir(), "sagax-ptt-")); dirs.push(dir); return createPttChannelStore(dir); };
const channel = { token: TOKEN, channelId: CHANNEL, botId: "b1", environment: "sandbox" as const, appVersion: "1" };

describe("PTT push request", () => {
  it("is a pushtotalk push on the .voip-ptt topic, priority 10, expiring at once", () => {
    const request = buildPttRequest({ bundleId: "ca.example.app", botName: "Scout", botId: "b1", threadId: "t1", text: "Done.", at: 5 });
    expect(request.headers).toEqual({ "apns-push-type": "pushtotalk", "apns-topic": "ca.example.app.voip-ptt", "apns-priority": "10", "apns-expiration": "0" });
    expect(JSON.parse(request.body)).toEqual({ activeSpeaker: "Scout", botId: "b1", threadId: "t1", text: "Done.", at: 5 });
  });
  it("keeps the words under the payload budget", () => {
    const request = buildPttRequest({ bundleId: "x", botName: "S", botId: "b", threadId: "t", text: "é".repeat(5000), at: 0 });
    expect(Buffer.byteLength(JSON.parse(request.body).text)).toBeLessThanOrEqual(PTT_TEXT_MAX_BYTES);
  });
  it("knows a PTT turn by its call id", () => {
    expect(isPttTurn({ voiceCall: { callId: "ptt-abc" } })).toBe(true);
    expect(isPttTurn({ voiceCall: { callId: "call-1" } })).toBe(false);
    expect(isPttTurn(undefined)).toBe(false);
  });
});

describe("PTT channel store and reply", () => {
  it("keeps one channel per person and moves a token to its new person", () => {
    const s = store();
    s.set("pr_a", channel);
    s.set("pr_b", channel);
    expect(s.get("pr_a")).toBeUndefined();
    expect(s.get("pr_b")?.botId).toBe("b1");
    expect(s.forBot("b1").map((entry) => entry.person)).toEqual(["pr_b"]);
  });
  it("sends the answer to the bot's channels, prunes a dead token, and says whether it went", async () => {
    const s = store();
    s.set("pr_a", channel);
    const sent: string[] = [];
    const base = { store: s, topic: () => "ca.example.app", botName: () => "Scout", warn: () => {} };
    expect(await sendPttReply({ ...base, send: (device) => { sent.push(device.token); return Promise.resolve({ ok: true }); } }, { botId: "b1", threadId: "t", text: "Hi" })).toBe(true);
    expect(sent).toEqual([TOKEN]);
    expect(await sendPttReply({ ...base, send: () => null }, { botId: "b1", threadId: "t", text: "Hi" })).toBe(false);
    expect(await sendPttReply({ ...base, send: () => Promise.resolve({ ok: false, status: 410, reason: "Unregistered", prune: true }) }, { botId: "b1", threadId: "t", text: "Hi" })).toBe(false);
    expect(s.get("pr_a")).toBeUndefined();
    expect(await sendPttReply({ ...base, send: () => null }, { botId: "other", threadId: "t", text: "Hi" })).toBe(false);
  });
});
