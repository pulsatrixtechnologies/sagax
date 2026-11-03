// Who has a published page open, and its annotations as they change
// (server/pages/page-live.ts).
import { describe, expect, it } from "vitest";

import { LIVE_LIMITS, PageLive, presenceOf } from "./page-live.ts";

function stream() {
  const frames: string[] = [];
  let ended = false;
  return { frames, get ended() { return ended; }, res: { write: (frame: string) => { frames.push(frame); return true; }, end: () => { ended = true; } } as never };
}

describe("PageLive", () => {
  it("tells every open bar who is here, each person once, and who left", () => {
    const live = new PageLive();
    const a = stream();
    const b = stream();
    const leaveA = live.join("page1", { id: "pr_a", name: "A" }, a.res)!;
    live.join("page1", { id: "pr_b", name: "B" }, b.res);
    live.join("page1", { id: "PR_B", name: "B" }, stream().res);
    expect(live.people("page1")).toEqual([{ id: "pr_a", name: "A" }, { id: "pr_b", name: "B" }]);
    expect(a.frames.at(-1)).toBe(`event: presence\ndata: ${JSON.stringify({ people: [{ id: "pr_a", name: "A" }, { id: "pr_b", name: "B" }] })}\n\n`);
    leaveA();
    leaveA();
    expect(b.frames.at(-1)).toBe(`event: presence\ndata: ${JSON.stringify({ people: [{ id: "pr_b", name: "B" }] })}\n\n`);
    expect(live.people("other")).toEqual([]);
  });

  it("a change reaches only that page's bars, and carries no comment", () => {
    const live = new PageLive();
    const here = stream();
    const there = stream();
    live.join("page1", { id: "pr_a", name: "A" }, here.res);
    live.join("page2", { id: "pr_a", name: "A" }, there.res);
    const before = there.frames.length;
    live.changed("page1");
    expect(here.frames.at(-1)).toBe("event: threads\ndata: {}\n\n");
    expect(there.frames).toHaveLength(before);
    live.close("page1");
    expect(here.ended).toBe(true);
    expect(live.people("page1")).toEqual([]);
  });

  it("caps the streams of one person on one page", () => {
    const live = new PageLive();
    for (let i = 0; i < LIVE_LIMITS.perPerson; i += 1) expect(live.join("p", { id: "pr_a", name: "A" }, stream().res)).not.toBeNull();
    expect(live.join("p", { id: "pr_a", name: "A" }, stream().res)).toBeNull();
    expect(live.join("p", { id: "pr_b", name: "B" }, stream().res)).not.toBeNull();
    expect(presenceOf([{ id: "x", name: "1" }, { id: "X", name: "2" }])).toEqual([{ id: "x", name: "1" }]);
  });
});
