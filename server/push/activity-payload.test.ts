import { describe, expect, it } from "vitest";

import {
  buildLiveActivityContentState,
  cocoaSince,
  COCOA_REFERENCE_OFFSET_SEC,
  doneContentState,
  liveActivityRelevance,
} from "./activity-content.ts";
import { buildLiveActivityRequest, liveActivityTopic } from "./activity-payload.ts";

describe("Live Activity content-state (BotActivityContent)", () => {
  it("encodes Date since as Cocoa reference seconds (Swift default JSONEncoder)", () => {
    const unixMs = 1_800_000_000_000;
    expect(cocoaSince(unixMs)).toBe(1_800_000_000 - COCOA_REFERENCE_OFFSET_SEC);
    expect(cocoaSince(unixMs)).toBe(821_692_800);
  });

  it("builds working, needsYou and done shapes the phone decodes", () => {
    const working = buildLiveActivityContentState({
      phase: "working",
      botName: "Scout",
      line: "Reading the report",
      threadId: "t1",
      sinceMs: 1_800_000_000_000,
    });
    expect(working).toEqual({
      face: "working",
      kind: "working",
      headline: "Scout is working",
      line: "Reading the report",
      threadId: "t1",
      options: [],
      isPermission: false,
      since: 821_692_800,
    });
    expect(liveActivityRelevance(working.kind)).toBe(50);

    const needsYou = buildLiveActivityContentState({
      phase: "needsYou",
      botName: "Scout",
      line: "Run npm install?",
      threadId: "t1",
      requestId: "r1",
      options: ["Allow", "Deny"],
      isPermission: true,
      sinceMs: 1_800_000_000_000,
    });
    expect(needsYou).toMatchObject({
      face: "alerting",
      kind: "needsYou",
      headline: "Scout needs you",
      requestId: "r1",
      options: ["Allow", "Deny"],
      isPermission: true,
    });
    expect(liveActivityRelevance(needsYou.kind)).toBe(100);

    const done = doneContentState(needsYou, 1_800_000_060_000);
    expect(done.kind).toBe("done");
    expect(done.face).toBe("happy");
    expect(done.options).toEqual([]);
    expect(done.requestId).toBeUndefined();
    expect(done.isPermission).toBe(false);
  });

  it("redacts a confidential thread", () => {
    const state = buildLiveActivityContentState({
      phase: "needsYou",
      botName: "Scout",
      line: "secret ask",
      options: ["Allow", "Deny"],
      isPermission: true,
      confidential: true,
      sinceMs: 0,
    });
    expect(state.headline).toBe("Fil confidentiel");
    expect(state.line).toBe("");
    expect(state.options).toEqual([]);
    expect(state.requestId).toBeUndefined();
  });
});

describe("Live Activity APNs payload (Apple ActivityKit push)", () => {
  it("uses apns-push-type liveactivity and topic <bundle>.push-type.liveactivity", () => {
    expect(liveActivityTopic("ca.pulsatrix.sagax")).toBe("ca.pulsatrix.sagax.push-type.liveactivity");
    expect(liveActivityTopic("ca.pulsatrix.sagax.push-type.liveactivity")).toBe("ca.pulsatrix.sagax.push-type.liveactivity");

    const contentState = buildLiveActivityContentState({
      phase: "working",
      botName: "Scout",
      line: "Writing",
      threadId: "t1",
      sinceMs: 1_800_000_000_000,
    });
    const request = buildLiveActivityRequest({
      event: "update",
      contentState,
      bundleId: "ca.pulsatrix.sagax",
      nowMs: 1_800_000_000_000,
      staleDateSec: 1_800_000_000 + 300,
      relevanceScore: 50,
      priority: 5,
    });
    expect(request.headers).toMatchObject({
      "apns-push-type": "liveactivity",
      "apns-topic": "ca.pulsatrix.sagax.push-type.liveactivity",
      "apns-priority": "5",
    });
    const body = JSON.parse(request.body);
    expect(body.aps.event).toBe("update");
    expect(body.aps.timestamp).toBe(1_800_000_000);
    expect(body.aps["stale-date"]).toBe(1_800_000_300);
    expect(body.aps["relevance-score"]).toBe(50);
    expect(body.aps["content-state"]).toEqual(contentState);
    expect(body.aps["dismissal-date"]).toBeUndefined();
  });

  it("ends with content-state, dismissal-date and priority 10 by default", () => {
    const final = buildLiveActivityContentState({
      phase: "done",
      botName: "Scout",
      line: "report ready",
      threadId: "t1",
      sinceMs: 1_800_000_000_000,
    });
    const request = buildLiveActivityRequest({
      event: "end",
      contentState: final,
      bundleId: "ca.pulsatrix.sagax",
      nowMs: 1_800_000_120_000,
      dismissalDateSec: 1_800_000_240,
    });
    expect(request.headers["apns-push-type"]).toBe("liveactivity");
    expect(request.headers["apns-priority"]).toBe("10");
    const body = JSON.parse(request.body);
    expect(body.aps.event).toBe("end");
    expect(body.aps["dismissal-date"]).toBe(1_800_000_240);
    expect(body.aps["content-state"].kind).toBe("done");
  });

  it("needsYou updates default to priority 10", () => {
    const request = buildLiveActivityRequest({
      event: "update",
      contentState: buildLiveActivityContentState({ phase: "needsYou", botName: "Scout", sinceMs: 0 }),
      bundleId: "x",
      nowMs: 1_000,
    });
    expect(request.headers["apns-priority"]).toBe("10");
  });
});
