// The words a bot is writing now, per thread (server/people/member-live-text.ts).
import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import { MEMBER_LIVE_TEXT_MAX, MemberLiveText } from "./member-live-text.ts";

const base = { eventId: "e", provider: "claudeAgent", createdAt: "2026-10-09T00:00:00Z" } as const;
const delta = (threadId: string, text: string, streamKind: "assistant_text" | "reasoning_text" = "assistant_text") =>
  ({ ...base, threadId, type: "content.delta", streamKind, delta: text }) as unknown as RuntimeEvent;
const event = (threadId: string, extra: Record<string, unknown>) => ({ ...base, threadId, ...extra }) as unknown as RuntimeEvent;

describe("MemberLiveText", () => {
  it("keeps the assistant text being written, never the reasoning, and clears it when the words land", () => {
    const live = new MemberLiveText();
    live.observe(delta("t1", "Half "));
    live.observe(delta("t1", "thinking...", "reasoning_text"));
    live.observe(delta("t1", "way."));
    live.observe(delta("t2", "Other"));
    expect(live.partial("t1")).toBe("Half way.");
    expect(live.partial("t2")).toBe("Other");
    live.observe(event("t1", { type: "item.completed", itemType: "assistant_text", text: "Half way." }));
    expect(live.partial("t1")).toBeNull();
    live.observe(delta("t2", " more"));
    live.observe(event("t2", { type: "item.completed", itemType: "tool", ok: true }));
    expect(live.partial("t2")).toBe("Other more");
    live.observe(event("t2", { type: "turn.completed", ok: true }));
    expect(live.partial("t2")).toBeNull();
  });

  it("keeps the newest characters only", () => {
    const live = new MemberLiveText();
    live.observe(delta("t1", "a".repeat(MEMBER_LIVE_TEXT_MAX)));
    live.observe(delta("t1", "END"));
    const text = live.partial("t1")!;
    expect(text.length).toBe(MEMBER_LIVE_TEXT_MAX);
    expect(text.endsWith("END")).toBe(true);
  });
});
