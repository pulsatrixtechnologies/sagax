// #3461: one `team.work` frame per orchestrator and person within a second,
// from the runtime rows a bot's turn handed out.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Assignment } from "../runtime/types.ts";
import { handedOutChanges } from "../runtime-coordinator.ts";
import type { TeamWorkFrame } from "../../shared/team-work.ts";
import { queueTeamWorkFrames } from "./frames.ts";

afterEach(() => { vi.useRealTimers(); });

const row = (patch: Partial<Assignment>): Assignment => ({
  id: "x", rootId: "r", parentId: "r", depth: 1,
  origin: { kind: "person", source: "chat" },
  requester: { kind: "bot_turn", botId: "orc", threadId: "orc-chat" },
  assignee: { botId: "dev", destination: { kind: "work_thread", threadId: "dev-work" } },
  mode: "work", reply: "resume", brief: "b", status: "running", level: "ask", levelSource: "own",
  executions: 0, restarts: 0, createdAt: 0, lastActivityAt: 0, result: "", rework: false, person: "ana", version: 1,
  ...patch,
});

describe("team work frames", () => {
  it("names the orchestrators whose hand-overs changed, once each, never a root, a room or its own thread", () => {
    expect(handedOutChanges([
      row({ id: "a" }), row({ id: "b" }), row({ id: "c", person: "ben" }),
      row({ id: "root", parentId: undefined, requester: { kind: "person", threadId: "orc-chat" } }),
      row({ id: "room", assignee: { botId: "dev", destination: { kind: "room_thread", threadId: "g", groupId: "g" } } }),
      row({ id: "self", assignee: { botId: "orc", destination: { kind: "work_thread", threadId: "orc-2" } } }),
    ])).toEqual([{ botId: "orc", person: "ana" }, { botId: "orc", person: "ben" }]);
  });

  it("sends one frame per orchestrator and person within the window, the person as its audience", () => {
    vi.useFakeTimers();
    const sent: TeamWorkFrame[] = [];
    queueTeamWorkFrames([{ botId: "orc", person: "Ana" }], (frame) => sent.push(frame), true);
    queueTeamWorkFrames([{ botId: "orc", person: "ana" }, { botId: "orc", person: "ben" }], (frame) => sent.push(frame), true);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual([{ kind: "team.work", botId: "orc", audience: "ana" }, { kind: "team.work", botId: "orc", audience: "ben" }]);
    // a one-person server names no one
    queueTeamWorkFrames([{ botId: "orc", person: "ana" }], (frame) => sent.push(frame), false);
    vi.advanceTimersByTime(1_000);
    expect(sent.at(-1)).toEqual({ kind: "team.work", botId: "orc" });
  });
});
