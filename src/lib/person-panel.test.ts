import { describe, expect, it } from "vitest";
import { canMessagePerson, findPanelPerson, personDmGroup, personSharedBots, personTeams, sharedGroups } from "./person-panel";

const ada = { principalId: "pr_ada", name: "Ada Example", login: "ada", email: "ada@example.test", role: "member" as const, disabled: false, teams: [{ id: "t2", manager: true }, { id: "t1", manager: false }, { id: "gone", manager: false }], manageUrl: "https://px.example.test/console/users/u1" };
const directory = { people: [ada], teams: [{ id: "t1", name: "Support", managers: [], members: [] }, { id: "t2", name: "Projects", managers: [], members: [] }] };

describe("person panel", () => {
  it("finds the person by principal id, whatever the case", () => {
    expect(findPanelPerson(directory, "PR_ADA")?.name).toBe("Ada Example");
    expect(findPanelPerson(directory, "pr_nobody")).toBeNull();
    expect(findPanelPerson(null, "pr_ada")).toBeNull();
  });

  it("names their teams, sorted, and drops unknown ones", () => {
    expect(personTeams(ada, directory)).toEqual([{ id: "t2", name: "Projects", manager: true }, { id: "t1", name: "Support", manager: false }]);
  });

  it("lists shared groups, their direct conversation and their bots shared with you", () => {
    const groups = [
      { id: "ops", name: "Ops", humanIds: ["PR_ADA", "pr_me"] },
      { id: "solo", name: "Solo", humanIds: ["pr_me"] },
      { id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"] },
      { id: "botchat", name: "bots", dm: true, humanIds: ["pr_ada"] },
    ];
    expect(sharedGroups(groups, "pr_ada").map((group) => group.id)).toEqual(["ops"]);
    expect(personDmGroup(groups, "pr_ada")?.id).toBe("dm");
    const bots = [{ id: "a", ownerUserId: "pr_ada" }, { id: "b", ownerUserId: "pr_me" }, { id: "c", ownerUserId: "pr_ada", hidden: true }];
    expect(personSharedBots(bots, "pr_ada").map((bot) => bot.id)).toEqual(["a"]);
  });

  it("offers Message for an active person other than you, never a service account", () => {
    expect(canMessagePerson(ada, "pr_me")).toBe(true);
    expect(canMessagePerson(ada, "PR_ADA")).toBe(false);
    expect(canMessagePerson({ ...ada, disabled: true }, "pr_me")).toBe(false);
    expect(canMessagePerson({ ...ada, service: true }, "pr_me")).toBe(false);
    expect(canMessagePerson(null, "pr_me")).toBe(false);
  });
});
