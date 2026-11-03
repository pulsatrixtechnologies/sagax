import { describe, expect, it } from "vitest";
import { answerApproval, approvalAnswerStatus, approvalAudience, approvalDelivery, receivesApprovalCard } from "./approval-audience.ts";

describe("approval audience", () => {
  it("sends the card to the owner session on the executing machine", () => {
    expect(approvalAudience({
      ownerUserId: "owner",
      host: { kind: "machine", userId: "owner", deviceId: "studio" },
    })).toEqual({ userId: "owner", deviceId: "studio" });
  });

  it("does not take channel members as an audience", () => {
    const audience = approvalAudience({ ownerUserId: "owner", host: { kind: "fleet" } });
    expect(audience.userId).toBe("owner");
    expect(Object.keys(audience)).toEqual(["userId", "deviceId"]);
  });

  it("keeps the card for that session and withholds the payload from everyone else", () => {
    const audience = approvalAudience({
      ownerUserId: "owner",
      host: { kind: "machine", userId: "owner", deviceId: "studio" },
    });
    const card = { id: "m1", kind: "options" as const, card: { title: "Approval needed", requestId: "r1", tool: "bash" } };
    expect(receivesApprovalCard({ userId: "owner", deviceId: "studio" }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "owner", deviceId: null }, audience)).toBe(false);
    expect(receivesApprovalCard({ userId: "owner", deviceId: "laptop" }, audience)).toBe(false);
    expect(approvalDelivery({
      audience,
      viewer: { userId: "owner", deviceId: "studio" },
      message: card,
      ownerName: "Alex",
    })).toBe(card);
    const other = approvalDelivery({
      audience,
      viewer: { userId: "morgan@example.test", deviceId: null },
      message: card,
      ownerName: "Alex",
    });
    expect(other).toEqual({
      id: "m1",
      kind: "options",
      state: "waiting-on-owner",
      ownerName: "Alex",
    });
    expect(other).not.toHaveProperty("card");
    const settled = approvalDelivery({
      audience,
      viewer: { userId: "morgan@example.test", deviceId: null },
      message: { ...card, card: { ...card.card, answered: "allow" } },
      ownerName: "Alex",
    });
    expect(settled).toEqual({
      id: "m1",
      kind: "options",
      state: "owner-settled",
      ownerName: "Alex",
      card: { title: "", subtitle: "", options: [], answered: "allow" },
    });
  });

  it("tells another viewer who settled a card, without its request or tool (S7-7)", () => {
    const audience = approvalAudience({ ownerUserId: "alice", host: { kind: "fleet" } });
    const message = {
      id: "m2",
      kind: "options" as const,
      card: { title: "Run rm -rf /tmp/x?", subtitle: "secret args", options: ["Allow once", "Deny"], requestId: "r2", tool: "bash", answered: "Allow once", answeredBy: { kind: "session", name: "alice (console)" } },
    };
    const bob = approvalDelivery({ audience, viewer: { userId: "bob", deviceId: null }, message, ownerName: "alice" });
    expect(bob).toMatchObject({ state: "owner-settled", card: { answered: "Allow once", answeredBy: { kind: "session", name: "alice (console)" } } });
    const card = (bob as { card: Record<string, unknown> }).card;
    expect(card).not.toHaveProperty("requestId");
    expect(card).not.toHaveProperty("tool");
    expect(JSON.stringify(bob)).not.toContain("rm -rf");
    expect(JSON.stringify(bob)).not.toContain("secret args");
    expect(approvalDelivery({ audience, viewer: { userId: "alice", deviceId: null }, message, ownerName: "alice" })).toBe(message);
  });

  it("refuses a non-owner answer and leaves the card unchanged", () => {
    const audience = approvalAudience({ ownerUserId: "owner", host: { kind: "fleet" } });
    const card = { id: "m1", kind: "options" as const, card: { title: "Approval needed", requestId: "r1", tool: "bash" } };
    const before = { ...card, card: { ...card.card } };
    const refused = answerApproval({ callerUserId: "morgan@example.test", audience, card });
    expect(refused).toEqual({ status: 403, card });
    expect(refused.card).toBe(card);
    expect(card).toEqual(before);
    expect(card.card).not.toHaveProperty("answered");
  });

  it("leaves questions and an approval with no live bot on the ordinary answer path", () => {
    const audience = approvalAudience({ ownerUserId: "owner", host: { kind: "fleet" } });
    expect(approvalAnswerStatus({
      question: true,
      audience,
      callerUserId: "morgan@example.test",
    })).toBeNull();
    expect(approvalAnswerStatus({
      question: false,
      audience: null,
      callerUserId: "morgan@example.test",
    })).toBeNull();
    expect(approvalAnswerStatus({
      question: false,
      audience,
      callerUserId: "morgan@example.test",
    })).toBe(403);
    expect(approvalAnswerStatus({
      question: false,
      audience,
      callerUserId: "owner",
    })).toBeNull();
  });

  it("matches the owner on any device when the host is the fleet", () => {
    const audience = approvalAudience({ ownerUserId: "owner", host: { kind: "fleet" } });
    expect(audience.deviceId).toBeNull();
    expect(receivesApprovalCard({ userId: "owner", deviceId: null }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "owner", deviceId: "studio" }, audience)).toBe(true);
    expect(receivesApprovalCard({ userId: "morgan@example.test", deviceId: null }, audience)).toBe(false);
  });
});
