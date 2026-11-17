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

// #4451: the organization approvals frame names each admin's own Primary Bot,
// where the cards wait, so the notification opens it; a member gets nothing.
describe("org.approvals names each admin's own Primary Bot (#4451)", () => {
  const host = {
    STREAM_ID: "s",
    IDENTITY: { kind: "perspicax" },
    localPrincipalId: () => "local",
    orgAdminStream: (client: { viewerId?: string }) => client.viewerId !== "member",
    adminApprovalHomeBot: (principalId: string) => ({ ada: "atlas", lin: "nova" } as Record<string, string>)[principalId],
    PHONE_TOOLS_FRAME: "phone-tools",
    DEVICE_SETTINGS_FRAME: "device-settings",
    peopleDmFrameAllowed: () => true,
    temporaryAgentFrame: () => false,
    viewerNotificationMuted: () => false,
    botTasksFrameAllowed: () => true,
    approvalViewerOf: () => undefined,
    scopeChannelApproval: () => ({ action: "keep" }),
    privateThreads: () => false,
    memberFrame: (_client: unknown, _seq: number, _payload: unknown, clientFrame: string) => clientFrame,
  };
  const frameFor = createSseFrameFor(() => host);
  const payload = { kind: "org.approvals", count: 1, added: [{ requestId: "r1", botName: "Nimbus" }] };
  const raw = encodeSseDataFrame("s", 7, { ...payload, seq: 7 });
  const read = (viewerId: string) => {
    const out = frameFor({ viewerId, admin: false } as never, 7, payload, raw, raw);
    return out === null ? null : JSON.parse(String(out).split("\ndata: ")[1]) as { home?: { botId: string } };
  };
  it("each admin reads their own bot, never another admin's", () => {
    expect(read("ada")?.home).toEqual({ botId: "atlas" });
    expect(read("lin")?.home).toEqual({ botId: "nova" });
    expect(read("max")?.home).toBeUndefined();
    expect(read("member")).toBeNull();
  });
});

// #4504 review: a person's update count reaches that person's own streams only
describe("capability.updates reaches its person only (#4504)", () => {
  const host = {
    STREAM_ID: "s",
    IDENTITY: { kind: "perspicax" },
    localPrincipalId: () => "local",
    orgAdminStream: () => true,
    PHONE_TOOLS_FRAME: "phone-tools",
    DEVICE_SETTINGS_FRAME: "device-settings",
    peopleDmFrameAllowed: () => true,
    temporaryAgentFrame: () => false,
    viewerNotificationMuted: () => false,
    botTasksFrameAllowed: () => true,
    approvalViewerOf: () => undefined,
    scopeChannelApproval: () => ({ action: "keep" }),
    privateThreads: () => false,
    memberFrame: (_client: unknown, _seq: number, _payload: unknown, clientFrame: string) => clientFrame,
  };
  const frameFor = createSseFrameFor(() => host);
  const payload = { kind: "capability.updates", audience: "ada", count: 2, checkedAt: 1 };
  const frame = encodeSseDataFrame("s", 1, { ...payload, seq: 1 });

  it("goes to the person it names, never to another member nor an admin's stream", () => {
    expect(frameFor({ viewerId: "ada", admin: false }, 1, payload, frame, frame)).not.toBeNull();
    expect(frameFor({ viewerId: "bob", admin: false }, 1, payload, frame, frame)).toBeNull();
    expect(frameFor({ viewerId: "bob", admin: true }, 1, payload, frame, frame)).toBeNull();
    // a stream with no viewer is the local person's
    expect(frameFor({ viewerId: "", admin: true }, 1, { ...payload, audience: "local" }, frame, frame)).not.toBeNull();
  });
});
