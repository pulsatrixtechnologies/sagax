// Who may choose whom a routine runs as (owner, 2026-10-08).
import { describe, expect, it } from "vitest";

import { runAsInScope, runAsOptions, runAsRefusal, runAsScope, type RunAsChooser, type RunAsPerson } from "./routine-run-as.ts";

const ADMIN: RunAsChooser = { principalId: "pr_admin", admin: true, managedTeamIds: [], manager: false };
const MANAGER: RunAsChooser = { principalId: "pr_mia", admin: false, managedTeamIds: ["team-t"], manager: true };
const LONE_MANAGER: RunAsChooser = { principalId: "pr_mia", admin: false, managedTeamIds: [], manager: true };
const MEMBER: RunAsChooser = { principalId: "pr_bob", admin: false, managedTeamIds: [], manager: false };

const PEOPLE: RunAsPerson[] = [
  { principalId: "pr_admin", name: "Alice", disabled: false },
  { principalId: "pr_bob", name: "Bob", disabled: false },
  { principalId: "pr_carol", name: "Carol", disabled: false, teams: [{ id: "team-t", manager: false }], avatarUrl: "/api/people/pr_carol/avatar" },
  { principalId: "pr_dave", name: "Dave", disabled: false, teams: [{ id: "team-u", manager: false }] },
  { principalId: "pr_mia", name: "Mia", disabled: false, teams: [{ id: "team-t", manager: true }] },
  { principalId: "pr_gone", name: "Gone", disabled: true, teams: [{ id: "team-t", manager: false }] },
  { principalId: "pr_robot", name: "Dispatch robot", disabled: false, service: true, teams: [{ id: "team-t", manager: false }] },
];
const OWNER = "pr_admin";
const mayRun = (id: string) => id !== "pr_dave";
const delegated = (id: string) => id !== "pr_carol";
const ids = (list: { principalId: string }[]) => list.map((person) => person.principalId);

describe("the reach of a run-as chooser", () => {
  it("an admin reaches everyone, a manager their teams, a manager with no team themselves and the owner, anyone else themselves", () => {
    expect(runAsScope(ADMIN)).toBe("all");
    expect(runAsScope(MANAGER)).toBe("teams");
    expect(runAsScope(LONE_MANAGER)).toBe("self_owner");
    expect(runAsScope(MEMBER)).toBe("self");
    expect(runAsInScope(MANAGER, PEOPLE[2]!, OWNER)).toBe(true);
    expect(runAsInScope(MANAGER, PEOPLE[3]!, OWNER)).toBe(false);
    expect(runAsInScope(LONE_MANAGER, PEOPLE[0]!, OWNER)).toBe(true);
    expect(runAsInScope(LONE_MANAGER, PEOPLE[2]!, OWNER)).toBe(false);
    expect(runAsInScope(MEMBER, PEOPLE[1]!, OWNER)).toBe(true);
  });
});

describe("the dropdown's people", () => {
  it("an admin sees every active person, never a disabled one or a service account", () => {
    const options = runAsOptions({ chooser: ADMIN, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated });
    expect(options.canChoose).toBe(true);
    expect(ids(options.people)).toEqual(["pr_admin", "pr_bob", "pr_carol", "pr_dave", "pr_mia"]);
  });

  it("a person without the right to run the bot is listed but cannot be chosen, with the reason", () => {
    const dave = runAsOptions({ chooser: ADMIN, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated }).people.find((person) => person.principalId === "pr_dave");
    expect(dave).toEqual({ principalId: "pr_dave", name: "Dave", selectable: false, reason: "no_right" });
  });

  it("a person with no delegation yet is marked pending, with their avatar kept", () => {
    const carol = runAsOptions({ chooser: ADMIN, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated }).people.find((person) => person.principalId === "pr_carol");
    expect(carol).toEqual({ principalId: "pr_carol", name: "Carol", avatarUrl: "/api/people/pr_carol/avatar", selectable: true, pending: true });
  });

  it("a manager sees the people of their teams and themselves", () => {
    expect(ids(runAsOptions({ chooser: MANAGER, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated }).people)).toEqual(["pr_carol", "pr_mia"]);
  });

  it("a manager with no team here sees themselves and the bot's owner", () => {
    expect(ids(runAsOptions({ chooser: LONE_MANAGER, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated }).people)).toEqual(["pr_admin", "pr_mia"]);
  });

  it("a regular person gets no dropdown", () => {
    expect(runAsOptions({ chooser: MEMBER, people: PEOPLE, botOwnerId: OWNER, mayRun, delegated })).toEqual({ canChoose: false, people: [] });
  });
});

describe("a run-as choice on save", () => {
  const person = (id: string) => PEOPLE.find((candidate) => candidate.principalId === id) ?? null;
  const refuse = (chooser: RunAsChooser, id: string) => runAsRefusal({ chooser, principalId: id, person: person(id), botOwnerId: OWNER, mayRun });

  it("an admin can set anyone active who may run the bot", () => {
    for (const id of ["pr_bob", "pr_carol", "pr_mia"]) expect(refuse(ADMIN, id)).toBeNull();
  });

  it("anyone may keep a routine as themselves", () => {
    expect(refuse(MEMBER, "pr_bob")).toBeNull();
  });

  it("a regular person cannot choose someone else", () => {
    expect(refuse(MEMBER, "pr_carol")).toMatchObject({ status: 403, code: "run_as_not_allowed" });
  });

  it("a manager stays within their teams", () => {
    expect(refuse(MANAGER, "pr_carol")).toBeNull();
    expect(refuse(MANAGER, "pr_bob")).toMatchObject({ status: 403, code: "run_as_out_of_scope" });
    expect(refuse(LONE_MANAGER, "pr_admin")).toBeNull();
    expect(refuse(LONE_MANAGER, "pr_carol")).toMatchObject({ status: 403, code: "run_as_out_of_scope" });
  });

  it("a person without rights on the bot is refused, with their name", () => {
    expect(refuse(ADMIN, "pr_dave")).toMatchObject({ status: 403, code: "run_as_no_right", error: expect.stringContaining("Dave cannot run this bot's routines") });
  });

  it("a disabled person, a service account or someone outside the directory is refused", () => {
    expect(refuse(ADMIN, "pr_gone")).toMatchObject({ status: 400, code: "run_as_not_person" });
    expect(refuse(ADMIN, "pr_robot")).toMatchObject({ status: 400, code: "run_as_not_person" });
    expect(refuse(ADMIN, "pr_stranger")).toMatchObject({ status: 400, code: "run_as_not_person" });
  });
});
