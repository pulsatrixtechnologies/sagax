import { describe, expect, it } from "vitest";

import { PersonSignalGate, type QuietHours } from "../../shared/signal-levels.ts";
import { ruleNotifyFrame } from "../notify.ts";
import { encodeSseDataFrame } from "../streams/sse-fanout.ts";
import { createSseFrameFor } from "./sseFrameFor.ts";

// #4233 Q6: each person's quiet hours and day budget rule their own streams.
// A frame for two people goes notify false on the held person's streams and
// still rings on the other's.
describe("each viewer's stream follows their own signal verdict (#4233)", () => {
  const at = Date.UTC(2026, 10, 13, 3, 0);
  const night: QuietHours = { start: "22:00", end: "07:00", timeZone: "UTC" };
  const host = (local = "person-1") => ({
    STREAM_ID: "s",
    PHONE_TOOLS_FRAME: "phone-tools",
    DEVICE_SETTINGS_FRAME: "device-settings",
    IDENTITY: { kind: "perspicax" },
    localPrincipalId: () => local,
    peopleDmFrameAllowed: () => true,
    temporaryAgentFrame: () => false,
    viewerNotificationMuted: () => false,
    botTasksFrameAllowed: () => true,
    approvalViewerOf: () => undefined,
    scopeChannelApproval: () => ({ action: "keep" }),
    privateThreads: () => false,
    memberFrame: (_client: unknown, _seq: number, _payload: unknown, clientFrame: string) => clientFrame
  });
  const notified = (out: string | null) => {
    const data = JSON.parse(String(out).split("\ndata: ")[1]) as { notification: { notify?: boolean } };
    return data.notification.notify;
  };
  const twoPeople = () => {
    const gate = new PersonSignalGate((person) => ({ budget: 20, quiet: person === "person-1" ? night : null }), () => at);
    const raw = { kind: "notify", notification: { kind: "proposal", botId: "b1", botName: "Scout", threadId: "t1", title: "Renew", body: "x", proposalId: "p1" } };
    return ruleNotifyFrame(raw, {
      signal: () => ["person-1", "person-2"].map((person) => ({ person, decision: gate.decide({ personId: person, botId: "b1", kind: "proposal", title: "Renew", body: "x", threadId: "t1" } as never) }))
    });
  };

  it("goes notify false to the held person's stream and rings on the other's", () => {
    const payload = twoPeople();
    const frame = encodeSseDataFrame("s", 1, { ...payload, seq: 1 });
    const frameFor = createSseFrameFor(() => host());
    expect(notified(frameFor({ viewerId: "person-1", admin: false }, 1, payload, frame, frame))).toBe(false);
    expect(notified(frameFor({ viewerId: "person-2", admin: false }, 1, payload, frame, frame))).toBeUndefined();
    // an admin stream is projected the same way
    expect(notified(frameFor({ viewerId: "person-1", admin: true }, 1, payload, frame, frame))).toBe(false);
  });

  it("names a stream with no viewer by the local person", () => {
    const payload = twoPeople();
    const frame = encodeSseDataFrame("s", 1, { ...payload, seq: 1 });
    expect(notified(createSseFrameFor(() => host("person-1"))({ viewerId: "", admin: true }, 1, payload, frame, frame))).toBe(false);
    expect(notified(createSseFrameFor(() => host("person-2"))({ viewerId: "", admin: true }, 1, payload, frame, frame))).toBeUndefined();
  });
});
