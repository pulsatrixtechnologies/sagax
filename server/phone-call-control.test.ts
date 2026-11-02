import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboundCalls } from "./outbound-calls.ts";
import { hangUpLiveCall, sendDtmfLiveCall, transferLiveCall, type LiveCallPatch } from "./phone-call-control.ts";

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

  it("transfers to another Canadian number", async () => {
    const { calls } = liveRow();
    const patches: LiveCallPatch[] = [];
    const twilio = vi.fn(async () => ({ ok: true as const, isError: false, value: {} }));
    const answer = await transferLiveCall({
      calls,
      twilio,
      patchLive: (_row, change) => { patches.push(change); },
      now: () => NOW + 2_000,
    }, { principalId: "jean", botId: "bot-a", threadId: "t-1", to: "+1 514 555 0199" });
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Transferred");
    expect(patches[0]?.phase).toBe("transferred");
    expect(patches[0]?.liveEvents?.[0]?.kind).toBe("transfer");
  });
});
