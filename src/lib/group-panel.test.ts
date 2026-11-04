import { describe, expect, it } from "vitest";

import type { Group } from "@/state/store";
import type { Routine } from "@/lib/routines";
import { groupLeadBotId, groupRoutines, groupSuggestions, groupThreadIds, leadResponder, visibleGroupPanelTabs } from "./group-panel";

const members = [{ id: "osprey" }, { id: "wren" }];
const room = (defaultResponder: Group["defaultResponder"]) => ({ defaultResponder }) as Pick<Group, "defaultResponder">;

describe("group panel tabs", () => {
  it("orders Details, Members, Instructions, Memory, Library, Computer with no Advanced", () => {
    expect(visibleGroupPanelTabs({ advanced: true, hasComputer: true })).toEqual(["details", "members", "instructions", "memory", "library", "computer"]);
  });

  it("drops Computer in Simple or when no bot of the viewer works anywhere", () => {
    expect(visibleGroupPanelTabs({ advanced: false, hasComputer: true })).not.toContain("computer");
    expect(visibleGroupPanelTabs({ advanced: true, hasComputer: false })).not.toContain("computer");
  });
});

describe("group routines", () => {
  const group = { id: "ops", threadId: "t-open", tasks: [{ threadId: "t-old", title: "Older", createdAt: 1 }] } as Pick<Group, "id" | "threadId" | "tasks">;
  it("keeps the team goals and the routines that post in any of its conversations", () => {
    const routines = [
      { id: "goal", groupId: "ops" },
      { id: "posts", resultsThreadId: "t-old" },
      { id: "other", groupId: "elsewhere" },
      { id: "plain" },
    ] as Routine[];
    expect(groupRoutines(routines, group).map((routine) => routine.id)).toEqual(["goal", "posts"]);
    expect([...groupThreadIds(group)].sort()).toEqual(["t-old", "t-open"]);
  });
});

describe("group lead", () => {
  it("reads the lead, or an Auto room's fallback, and none for everyone or mentions", () => {
    expect(groupLeadBotId(room({ kind: "member", botId: "wren" }), members)).toBe("wren");
    expect(groupLeadBotId(room({ kind: "auto", fallbackBotId: "wren" }), members)).toBe("wren");
    expect(groupLeadBotId(room({ kind: "auto" }), members)).toBe("osprey");
    expect(groupLeadBotId(room({ kind: "everyone" }), members)).toBeUndefined();
  });

  it("keeps Auto when the lead changes, else answers through the new lead", () => {
    expect(leadResponder(room({ kind: "auto" }), members, "wren")).toEqual({ kind: "auto", fallbackBotId: "wren" });
    expect(leadResponder(room({ kind: "member", botId: "osprey" }), members, "wren")).toEqual({ kind: "member", botId: "wren" });
    expect(leadResponder(room({ kind: "mentions" }), members, "wren")).toEqual({ kind: "member", botId: "wren" });
  });
});

describe("group suggestions", () => {
  const base = { bulletin: "", botCount: 1, routineCount: 0, canEdit: true, canAddBot: true, canAddRoutine: true };
  it("suggests instructions, a second bot and a team goal", () => {
    expect(groupSuggestions(base).map((item) => item.action)).toEqual(["instructions", "members", "routine"]);
  });

  it("suggests nothing the viewer cannot do or that is already done", () => {
    expect(groupSuggestions({ ...base, bulletin: "Be brief.", botCount: 2, routineCount: 1 })).toEqual([]);
    expect(groupSuggestions({ ...base, canEdit: false, canAddBot: false, canAddRoutine: false })).toEqual([]);
  });
});
