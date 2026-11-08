// "Me joindre" by text (2026-10-26): Perspicax Voice texts the person's own
// verified number only. No network, no real text: `voice` is a mock.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReachOutbound } from "./channel.ts";
import { reachMeSmsReply, setReachMeSmsHandler } from "./inbound.ts";
import { createSmsChannel, lineVerifies, type VoiceAnswer } from "./sms.ts";
import { createReachMeStore } from "./store.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); setReachMeSmsHandler(null); });

const OUT: ReachOutbound = { person: "pr_a", botId: "b1", botName: "Nimbus", code: "KM3X", kind: "approval", title: "Run a command?", line: "npm test", confidential: false, needsKey: false, language: "fr" };

function setup(line: unknown, sms: VoiceAnswer = { ok: true, value: { sent: true, sid: "SM1" } }) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-reach-sms-"));
  dirs.push(dir);
  const store = createReachMeStore(dir);
  store.set("pr_a", "b1", { channels: ["sms"], smsNumber: "+15145550123", hours: { always: true } });
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const channel = createSmsChannel({
    settings: store,
    linked: () => true,
    voice: async (_person, _bot, tool, args) => {
      calls.push({ tool, args });
      return tool === "voice_line" ? { ok: true, value: line } : sms;
    },
  });
  return { channel, calls };
}

describe("Reach me by text", () => {
  it("texts the person's own number once the line lists it as verified", async () => {
    const { channel, calls } = setup({ line: { active: true, callers: [{ number: "***0123", verified: true }] } });
    expect(await channel.send(OUT)).toEqual({ ok: true });
    expect(calls.map((call) => call.tool)).toEqual(["voice_line", "voice_sms"]);
    expect(calls[1]!.args.to).toBe("+15145550123");
    expect(String(calls[1]!.args.body)).toContain("KM3X oui");
    expect(calls[1]!.args.dry_run).toBeUndefined();
  });
  it("sends nothing to a number the line has not verified, or when the line is off", async () => {
    for (const line of [
      { line: { active: true, callers: [{ number: "***0123", verified: false }] } },
      { line: { active: true, callers: [{ number: "***9999", verified: true }] } },
      { line: { active: false, inactive_reason: "line_off", callers: [{ number: "***0123", verified: true }] } },
      { line: null },
    ]) {
      const { channel, calls } = setup(line);
      expect((await channel.send(OUT)).ok).toBe(false);
      expect(calls.map((call) => call.tool)).toEqual(["voice_line"]);
    }
    expect(lineVerifies(undefined, "+15145550123")).toBe(false);
  });
  it("the inbound route's entry point: nothing without a handler, the handler's answer with one", async () => {
    expect(await reachMeSmsReply({ ownerPrincipalId: "pr_a", from: "+15145550123", text: "KM3X oui" })).toEqual({ handled: false, outcome: "no_code" });
    setReachMeSmsHandler(async (input) => ({ handled: input.text.startsWith("KM3X"), outcome: "allowed" }));
    expect(await reachMeSmsReply({ ownerPrincipalId: "pr_a", from: "+15145550123", text: "KM3X oui" })).toEqual({ handled: true, outcome: "allowed" });
  });
});
