import { describe, expect, it } from "vitest";

import {
  humanMessageDetail,
  heldSkipDetail,
  isHeld,
  reservedSlotAdmission,
  shouldDeliverInput,
  wakeKind,
} from "./hold.ts";
import { STAGE_DETAIL, type StageAssignment, type StageEvent } from "./stage.ts";

function assignment(patch: Partial<StageAssignment> = {}): StageAssignment {
  return {
    status: "failed",
    outcome: "provider_error",
    result: "API 500",
    finishedAt: 100,
    executions: 1,
    ...patch,
  };
}

function event(at: number, kind: StageEvent["kind"], detail?: string): StageEvent {
  return { at, kind, ...(detail !== undefined ? { detail } : {}) };
}

describe("isHeld", () => {
  it("holds after a failed report until a human message arrives", () => {
    const row = assignment();
    const failed = [event(100, "settled", "failed: provider_error")];
    expect(isHeld(row, failed)).toBe(true);

    const withHuman = [...failed, event(150, "progress", humanMessageDetail())];
    expect(isHeld(row, withHuman)).toBe(false);
  });

  it("survives a reread of the same events (restart-safe)", () => {
    const row = assignment({ status: "failed", outcome: "stalled", finishedAt: 40 });
    const events = [event(10, "started"), event(40, "settled", "failed: stalled")];
    const first = isHeld(row, events);
    const second = isHeld(row, events.map((item) => ({ ...item })));
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(second).toBe(first);
  });

  it("does not hold a stop the person asked for", () => {
    expect(isHeld(assignment({ outcome: "stopped", status: "cancelled" }), [
      event(100, "cancelled", "Stopped by user"),
    ])).toBe(false);
  });

  it("treats an answered park as a human message that lifts the hold", () => {
    const row = assignment();
    const events = [
      event(100, "settled", "failed: denied"),
      event(120, "answered", "yes, continue"),
    ];
    expect(isHeld(row, events)).toBe(false);
  });

  it("stays held when only automatic progress landed after the failure", () => {
    const row = assignment();
    const events = [
      event(100, "settled", "failed: provider_error"),
      event(110, "progress", heldSkipDetail("webhook")),
      event(111, "progress", "bot follow-up"),
    ];
    expect(isHeld(row, events)).toBe(true);
  });
});

describe("shouldDeliverInput", () => {
  const row = assignment();
  const heldEvents = [event(100, "settled", `failed|${STAGE_DETAIL.blocked}|`)];

  it("skips automatic sources while held and delivers a person message", () => {
    expect(shouldDeliverInput(row, heldEvents, "webhook")).toEqual({
      action: "skip",
      reason: "held_automatic",
    });
    expect(shouldDeliverInput(row, heldEvents, "bot")).toEqual({
      action: "skip",
      reason: "held_automatic",
    });
    expect(shouldDeliverInput(row, heldEvents, "routine")).toEqual({
      action: "skip",
      reason: "held_automatic",
    });
    expect(shouldDeliverInput(row, heldEvents, "person")).toEqual({
      action: "deliver",
      liftsHold: true,
    });
  });

  it("delivers everyone once the hold is lifted", () => {
    const lifted = [...heldEvents, event(200, "progress", humanMessageDetail())];
    expect(shouldDeliverInput(row, lifted, "webhook")).toEqual({
      action: "deliver",
      liftsHold: false,
    });
  });
});

describe("reservedSlotAdmission", () => {
  it("lets a person through when every ordinary slot is full", () => {
    expect(reservedSlotAdmission({
      wake: "automatic",
      usedSlots: 3,
      maxSlots: 3,
      hardBlocked: false,
    })).toBe("waiting for a free slot (one is reserved for a person message)");

    expect(reservedSlotAdmission({
      wake: "person",
      usedSlots: 3,
      maxSlots: 3,
      hardBlocked: false,
    })).toBe(true);

    expect(reservedSlotAdmission({
      wake: "person",
      usedSlots: 4,
      maxSlots: 3,
      hardBlocked: false,
    })).toBe(false);
  });

  it("still refuses when a hard blocker is set", () => {
    expect(reservedSlotAdmission({
      wake: "person",
      usedSlots: 0,
      maxSlots: 3,
      hardBlocked: true,
    })).toBe(false);
  });

  it("keeps automatic work under the configured max", () => {
    expect(reservedSlotAdmission({
      wake: "automatic",
      usedSlots: 2,
      maxSlots: 3,
      hardBlocked: false,
    })).toBe(true);
  });
});

describe("wakeKind", () => {
  it("marks a person requester or an answered turn as a person wake", () => {
    expect(wakeKind({ requester: { kind: "person", threadId: "chat" } })).toBe("person");
    expect(wakeKind({
      requester: { kind: "bot_turn", botId: "chief", threadId: "chat" },
      answer: "go ahead",
    })).toBe("person");
    expect(wakeKind({
      requester: { kind: "routine_run", botId: "chief", runId: "r1" },
    })).toBe("automatic");
    expect(wakeKind({
      requester: { kind: "bot_turn", botId: "chief", threadId: "chat" },
    })).toBe("automatic");
  });
});
