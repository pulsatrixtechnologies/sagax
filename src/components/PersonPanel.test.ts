import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { resetPublicAchievementsForTests } from "@/lib/public-achievements";
import { resetPersonLabelsForTests } from "@/lib/person-labels";

const fixture = vi.hoisted(() => ({ role: "member" as "admin" | "member", groups: [] as unknown[], bots: [] as unknown[], selectedId: "", activeView: "chat" }));
vi.mock("./DesktopCapabilities", () => ({ useCaptionChrome: () => ({ padClass: "" }), useMacInsetChrome: () => ({ macInset: false, browser: false }) }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => ({ org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: fixture.role, settings: {} }),
}));
vi.mock("./GroupPeoplePicker", () => ({ useOrgDirectory: () => null }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: { viewer: { principalId: "pr_me" } }, groups: fixture.groups, bots: fixture.bots, selectedId: fixture.selectedId, activeView: fixture.activeView }, dispatch: vi.fn() }) };
});

const { PersonPanel } = await import("./PersonPanel");

const ada = { principalId: "pr_ada", name: "Ada Example", login: "ada", email: "ada@example.test", role: "member" as const, disabled: false, teams: [{ id: "t1", manager: false }], manageUrl: "https://px.example.test/console/users/u1" };
const directory = { people: [ada], teams: [{ id: "t1", name: "Support", managers: [], members: [] }] };

function render(personId = "pr_ada", given: typeof directory & { viewer?: { principalId: string | null; orgRole: "admin" | "member"; managedTeamIds: string[] } } = directory) {
  return renderToStaticMarkup(createElement(PersonPanel, { personId, directory: given }));
}

describe("PersonPanel", () => {
  beforeEach(() => {
    resetPublicAchievementsForTests();
    fixture.role = "member";
    fixture.groups = [
      { id: "ops", name: "Operations", humanIds: ["pr_me", "pr_ada"], memberIds: [], messages: [], unread: false } as unknown as Group,
      { id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], memberIds: [], messages: [], unread: false } as unknown as Group,
    ];
    fixture.bots = [];
    fixture.selectedId = "";
    fixture.activeView = "chat";
  });

  it("shows who the person is from the directory, the groups in common and Message", () => {
    const html = render();
    expect(html).toContain('data-person-panel="pr_ada"');
    expect(html).toContain("Ada Example");
    expect(html).toContain("ada@example.test");
    expect(html).toContain("Support");
    expect(html).not.toContain(">Member<");
    expect(html).toContain("Operations");
    expect(html).toContain('data-person-action="message"');
    expect(html).not.toContain('data-person-action="close"');
    expect(html).not.toContain("Close conversation");
    expect(html).not.toContain('data-person-action="hide"');
    expect(html).not.toContain('data-person-action="show"');
    expect(html).not.toContain("Manage in Perspicax");
    expect(html).not.toContain('data-person-section="connections"');
  });

  it("never shows their connections nor a console link, even to an admin (#2117)", () => {
    fixture.role = "admin";
    const html = render();
    expect(html).not.toContain('data-person-section="connections"');
    expect(html).not.toContain("Connections");
    expect(html).not.toContain("Remove all");
    expect(html).not.toContain("data-person-manage");
    expect(html).not.toContain("Manage in Perspicax");
  });

  it("draws no In common section when there is no group in common and no bot of theirs (#2117)", () => {
    fixture.groups = [{ id: "dm", name: "dm", peopleDm: true, humanIds: ["pr_me", "pr_ada"], memberIds: [], messages: [], unread: false } as unknown as Group];
    fixture.bots = [];
    const html = render();
    expect(html).not.toContain("In common");
    expect(html).not.toContain('data-person-section="groups"');
    expect(html).not.toContain('data-person-section="bots"');
  });

  it("shows only the parts of In common that have content (#2117)", () => {
    const groupsOnly = render();
    expect(groupsOnly).toContain("In common");
    expect(groupsOnly).toContain('data-person-section="groups"');
    expect(groupsOnly).not.toContain('data-person-section="bots"');
    expect(groupsOnly).not.toContain("No bots");
    fixture.groups = [];
    fixture.bots = [{ id: "rex", name: "Rex", ownerUserId: "pr_ada", color: "green", messages: [], unread: false } as unknown as Bot];
    const botsOnly = render();
    expect(botsOnly).toContain("In common");
    expect(botsOnly).toContain('data-person-section="bots"');
    expect(botsOnly).not.toContain('data-person-section="groups"');
  });

  it("offers a Library tab between Profile and Achievements (#2117)", () => {
    const html = render();
    expect(html).toMatch(/data-person-tab="profile"[\s\S]*data-person-tab="library"[\s\S]*data-person-tab="achievements"/);
    expect(html).toContain(">Library<");
    const open = renderToStaticMarkup(createElement(PersonPanel, { personId: "pr_ada", directory, initialTab: "library" }));
    expect(open).toContain('data-person-tabpanel="library"');
    expect(open).toContain("data-library=");
  });

  it("offers no Message to yourself and says when someone is not in the directory", () => {
    const html = render("pr_ghost");
    expect(html).not.toContain('data-person-action="message"');
    expect(html).toContain("not in your organization");
  });

  it("lists their bots shared with you", () => {
    fixture.bots = [{ id: "rex", name: "Rex", title: "Reports", ownerUserId: "pr_ada", color: "green", messages: [], unread: false } as unknown as Bot];
    expect(render()).toContain("Rex");
  });

  it("draws the achievements tab for a narrow column: summary, recent tiles, then a grid", () => {
    resetPublicAchievementsForTests({
      pr_ada: {
        points: 220,
        level: 3,
        title: "rookie",
        unlocked: [
          { id: "first-words", points: 5, unlockedAt: Date.UTC(2026, 9, 1) },
          { id: "hello-bot", points: 10, unlockedAt: Date.UTC(2026, 9, 20) },
        ],
      },
    });
    const html = render();
    const nameAt = html.indexOf("person-panel-title");
    const panelAt = html.indexOf("data-achievements-panel");
    expect(nameAt).toBeGreaterThan(-1);
    expect(panelAt).toBeGreaterThan(nameAt);
    const tab = html.slice(panelAt);
    // no second avatar and name: the header already shows them
    expect(tab).not.toContain("data-member-card");
    expect(tab).not.toContain("Ada Example");
    // the summary: level, title, points and the bar to the next level (300)
    expect(tab).toContain("data-achievements-summary");
    expect(tab).toContain("Level 3");
    expect(tab).toContain("data-member-title");
    expect(tab).toContain("Rookie");
    expect(tab).toContain("data-member-points");
    expect(tab).toMatch(/role="progressbar"[^>]*aria-valuemax="150"[^>]*aria-valuenow="70"/);
    expect(tab).toContain("300 pts");
    // recent unlocks, newest first
    expect(tab.indexOf('data-recent-achievement="hello-bot"')).toBeLessThan(tab.indexOf('data-recent-achievement="first-words"'));
    // every achievement as an icon tile, unlocked in colour, the others locked
    expect(tab).toMatch(/class="achievement-panel-tile" data-achievement="hello-bot" data-unlocked=""/);
    expect(tab).toMatch(/data-achievement="small-family" data-locked=""/);
    expect(tab).toContain('data-achievement-category="onboarding"');
    // a secret stays out until it unlocks
    expect(tab).not.toContain('data-achievement="konami"');
    // a colleague's panel has no View all: the full page is your own record
    expect(tab).not.toContain("data-achievements-open");
    expect(html).toContain('data-person-tab="achievements"');
    expect(html).toContain('data-person-tabpanel="achievements"');
    expect(html).toMatch(/data-person-tab="profile"[^>]*aria-selected="true"/);
    expect(html).not.toContain("data-member-line");
  });

  it("offers View all on your own panel, drawn the same way", () => {
    resetPublicAchievementsForTests({ pr_me: { points: 40, level: 1, unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] } });
    const html = render("pr_me", { ...directory, people: [...directory.people, { ...ada, principalId: "pr_me", name: "Me Example" }] });
    expect(html).toContain("data-achievements-panel");
    expect(html).toContain("data-achievements-open");
    expect(html).toContain("View all");
  });

  it("hides Message while you are already in their conversation, keeps it elsewhere", () => {
    fixture.selectedId = "dm";
    expect(render()).not.toContain('data-person-action="message"');
    fixture.selectedId = "ops";
    expect(render()).toContain('data-person-action="message"');
    fixture.selectedId = "dm";
    fixture.activeView = "team-map";
    expect(render()).toContain('data-person-action="message"');
  });

  it("orders the header: name, label, then the buttons, with no Member line", () => {
    resetPublicAchievementsForTests({ pr_ada: { title: "rookie", points: 220, unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] } });
    resetPersonLabelsForTests({ pr_ada: "CTO" });
    const html = render();
    const headerStart = html.indexOf("person-panel-title");
    const order = ["Ada Example", ">CTO<", 'data-person-action="message"'].map((marker) => html.indexOf(marker, headerStart));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf("data-achievements-panel", headerStart)).toBeGreaterThan(html.indexOf('data-person-action="message"', headerStart));
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain(">Member<");
    expect(html).not.toContain("Administrator");
  });

  it("keeps the role line for an administrator and for a disabled account", () => {
    const admin = render("pr_ada", { ...directory, people: [{ ...ada, role: "admin" as never }] });
    expect(admin).toContain("Administrator");
    const disabled = render("pr_ada", { ...directory, people: [{ ...ada, disabled: true }] });
    expect(disabled).toContain("Disabled");
    expect(disabled).not.toContain(">Member<");
  });

  it("follows the person's own Show my title and Show my points choices", () => {
    // the server leaves off the card what the person hid (server/achievements.ts)
    resetPublicAchievementsForTests({
      pr_ada: { points: 220, level: 3, unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] },
    });
    const noTitle = render();
    expect(noTitle).not.toContain("data-member-title");
    expect(noTitle).toContain("data-member-points");
    expect(noTitle).toContain(">220<");
    expect(noTitle).toContain('data-achievement="hello-bot"');
    resetPublicAchievementsForTests({
      pr_ada: { title: "rookie", unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] },
    });
    const noPoints = render();
    expect(noPoints).toContain("data-member-title");
    expect(noPoints).toContain("Rookie");
    expect(noPoints).not.toContain("data-member-points");
    // both hidden: no score on the card, the list stays on its tab
    resetPublicAchievementsForTests({
      pr_ada: { unlocked: [{ id: "hello-bot", points: 10, unlockedAt: 1 }] },
    });
    const bare = render();
    expect(bare).not.toContain("data-member-line");
    expect(bare).not.toContain("data-member-title");
    expect(bare).not.toContain("data-member-points");
    expect(bare).not.toContain("Rookie");
    expect(bare).toContain('data-achievement="hello-bot"');
    expect(bare).not.toContain("This person keeps their achievements private.");
  });

  it("keeps a private card off the sheet and says so on the achievements tab", () => {
    const html = render();
    expect(html).not.toContain("data-member-line");
    expect(html).not.toContain("data-achievements-panel");
    expect(html).not.toContain("data-achievement=");
    expect(html).toContain('data-person-tab="achievements"');
    expect(html).toContain("This person keeps their achievements private.");
  });

  it("shows the summary and a locked grid when they shared a card but have no achievements", () => {
    resetPublicAchievementsForTests({ pr_ada: { points: 0, level: 1, unlocked: [] } });
    const html = render();
    expect(html).toContain("data-achievements-panel");
    expect(html).toContain("data-member-points");
    expect(html).toContain("No achievements yet.");
    expect(html).not.toContain("data-recent-achievement");
    expect(html).not.toMatch(/data-achievement="[^"]+" data-unlocked/);
    expect(html).not.toContain("This person keeps their achievements private.");
  });

  describe("label", () => {
    const editLabel = 'aria-label="Edit label"';
    beforeEach(() => resetPersonLabelsForTests());

    it("shows a colleague's label under the name as plain text to a member", () => {
      resetPersonLabelsForTests({ pr_ada: "CTO" });
      const html = render();
      expect(html.indexOf(">CTO<")).toBeGreaterThan(html.indexOf("Ada Example"));
      expect(html).not.toContain(editLabel);
      expect(html).not.toContain("Add a label");
    });

    it("shows nothing to a member when the colleague has no label", () => {
      expect(render()).not.toContain("Add a label");
    });

    it("offers Add a label to an admin, to a manager of their team and on your own sheet", () => {
      fixture.role = "admin";
      const admin = render();
      expect(admin).toContain(editLabel);
      expect(admin).toContain("Add a label");
      fixture.role = "member";
      const managed = render("pr_ada", { ...directory, viewer: { principalId: "pr_me", orgRole: "member", managedTeamIds: ["t1"] } });
      expect(managed).toContain(editLabel);
      const otherTeam = render("pr_ada", { ...directory, viewer: { principalId: "pr_me", orgRole: "member", managedTeamIds: ["t9"] } });
      expect(otherTeam).not.toContain(editLabel);
      expect(render("pr_me")).toContain(editLabel);
    });

    it("lets an editor change an existing label in place", () => {
      resetPersonLabelsForTests({ pr_ada: "CTO" });
      fixture.role = "admin";
      const html = render();
      expect(html).toMatch(/aria-label="Edit label"[^>]*data-inline-edit="text"[\s\S]*?>CTO</);
    });
  });
});
