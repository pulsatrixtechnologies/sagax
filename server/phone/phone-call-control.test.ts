import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboundCalls } from "../outbound/outbound-calls.ts";
import { hangUpLiveCall, sendDtmfLiveCall, takeOverLiveCall, type LiveCallPatch } from "./phone-call-control.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SID = `CA${"c".repeat(32)}`;
const NOW = 1_700_000_000_000;

function liveRow() {
  const dir = mkdtempSync(join(tmpdir(), "phone-control-"));
  dirs.push(dir);
  const calls = new OutboundCalls(dir, () => NOW);
  calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
  const opened = calls.open({
    principalId: "jean",
    botId: "bot-a",
    threadId: "t-1",
    request: {
      to: "+15145550142",
      from: "",
      purpose: "Book the visit",
      message: "",
      language: "fr",
      mode: "conversation",
      maxMinutes: 5,
    },
    names: { botName: "Rocket", personName: "Jean" },
  });
  calls.autoApprove("jean", opened.record.id);
  const claimed = calls.claim(opened.record.id);
  expect(claimed).toBe(true);
  const settled = calls.settle(opened.record.id, { callSid: SID })!;
  calls.attachMessage(settled.id, "m1");
  return { calls, row: settled };
}

describe("phone-call-control", () => {
  it("hangs up a live call and patches the card to ended", async () => {
    const { calls } = liveRow();
    const patches: LiveCallPatch[] = [];
    const twilio = vi.fn(async () => ({ ok: true as const, isError: false, value: { status: "completed" } }));
    const answer = await hangUpLiveCall({
      calls,
      twilio,
      patchLive: (_row, change) => { patches.push(change); },
      now: () => NOW + 5_000,
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1" });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Hung up");
    expect(twilio).toHaveBeenCalledWith(expect.objectContaining({
      resource: "Calls",
      action: "update",
      id: SID,
      set: { Status: "completed" },
    }));
    expect(patches[0]?.phase).toBe("ended");
  });

  it("sends DTMF digits and records a live event", async () => {
    const { calls } = liveRow();
    const patches: LiveCallPatch[] = [];
    const twilio = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true as const, isError: false, value: {} }));
    const answer = await sendDtmfLiveCall({
      calls,
      twilio,
      patchLive: (_row, change) => { patches.push(change); },
      now: () => NOW + 1_000,
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1", digits: "1w2#" });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Sent keys");
    const sent = twilio.mock.calls[0]?.[0] as { set?: { Twiml?: string } } | undefined;
    expect(sent?.set?.Twiml).toContain('digits="1w2#"');
    expect(patches[0]?.liveEvents?.[0]).toMatchObject({ kind: "dtmf", detail: "1w2#" });
  });

  it("refuses bad DTMF and missing live calls", async () => {
    const { calls } = liveRow();
    const twilio = vi.fn();
    const bad = await sendDtmfLiveCall({
      calls, twilio, patchLive: () => {}, now: () => NOW,
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1", digits: "nope" });
    expect(bad.isError).toBe(true);
    expect(twilio).not.toHaveBeenCalled();
    const none = await hangUpLiveCall({
      calls, twilio, patchLive: () => {}, now: () => NOW,
    }, { principalId: "alex", botId: "bot-a", threadId: "t-1" });
    expect(none.isError).toBe(true);
  });

  it("takes the live call over through Perspicax voice_call control take_over, with the Reach me number", async () => {
    const { calls, row } = liveRow();
    const patches: LiveCallPatch[] = [];
    const voice = vi.fn(async () => ({ ok: true as const, isError: false, value: JSON.stringify({ taken_over: true, ref: row.id, to: "+15145550177", status: "dialing" }) }));
    const answer = await takeOverLiveCall({
      calls,
      voice,
      patchLive: (_row, change) => { patches.push(change); },
      now: () => NOW + 2_000,
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1", takeOverTo: "+1 514 555 0177" });
    expect(voice).toHaveBeenCalledWith({ control: "take_over", ref: row.id, take_over_to: "+15145550177" });
    expect(answer.isError).toBeUndefined();
    expect(answer.to).toBe("+15145550177");
    expect(answer.text).toContain("+1 514 ••• •• 77");
    expect(patches).toEqual([{ phase: "transferred", takeOver: { state: "transferring", at: NOW + 2_000 } }]);
  });

  it("reports a refused take over to its caller and leaves the card as it is (the bot keeps talking)", async () => {
    const { calls } = liveRow();
    const patches: LiveCallPatch[] = [];
    const refused = vi.fn(async () => ({ ok: true as const, isError: true, value: "denied: no_take_over_number: your person has no verified number" }));
    const answer = await takeOverLiveCall({ calls, voice: refused, patchLive: (_row, change) => { patches.push(change); } }, { principalId: "jean", botId: "bot-a", threadId: "t-1" });
    expect(answer).toMatchObject({ isError: true, code: "no_take_over_number" });
    expect(refused).toHaveBeenCalledWith({ control: "take_over", ref: expect.stringMatching(/^call_/) });
    const failed = await takeOverLiveCall({
      calls, voice: async () => ({ ok: true as const, isError: true, value: "Twilio refused the redirect (502)" }), patchLive: (_row, change) => { patches.push(change); },
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1" });
    expect(failed).toMatchObject({ isError: true, code: "takeover_failed" });
    const down = await takeOverLiveCall({
      calls, voice: async () => ({ ok: false as const, code: "unreachable", error: "unreachable" }), patchLive: (_row, change) => { patches.push(change); },
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1" });
    expect(down.isError).toBe(true);
    expect(patches).toEqual([]);
    // someone else's conversation has no live call to take over
    const none = await takeOverLiveCall({ calls, voice: refused, patchLive: () => {} }, { principalId: "alex", botId: "bot-a", threadId: "t-1" });
    expect(none).toMatchObject({ isError: true, code: "not_live" });
  });
});
