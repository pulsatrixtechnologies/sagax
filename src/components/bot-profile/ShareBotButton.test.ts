// The profile page's Share pill and its popover, Grok Bot style (2026-11-06):
// the title with Copy link, the field that adds people or groups, "Who has
// access" (the organization, the owner, each grant with its level and
// "Remove access" last), no outline on any row, and the same rights as the
// Sharing section (a viewer who may not share sees the levels as text).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { GrantAdministration, OrgDirectory, WireGrant } from "@/lib/perspicax-org";
import { setLocale } from "@/lib/i18n";

const OWNER = "pr_00000000-0000-4000-8000-0000000000a0";
const BOB = "pr_00000000-0000-4000-8000-0000000000b0";
const CAROL = "pr_00000000-0000-4000-8000-0000000000c0";

const fixture = vi.hoisted(() => ({
  viewerId: "" as string,
  org: null as unknown,
  sharing: null as null | {
    directory: unknown;
    rows: unknown[];
    administer: unknown;
    isOwner: boolean;
    mayShare: boolean;
  },
  editor: null as null | Record<string, unknown>,
}));

// The pill menu shows only its current value until opened: draw its
// choices as a plain list so the markup shows which levels are offered.
vi.mock("../SettingsPrimitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../SettingsPrimitives")>();
  const { createElement: h } = await import("react");
  return {
    ...actual,
    PillSelect: (props: { ariaLabel: string; value: string; options: ReadonlyArray<{ value: string; label: string }> }) =>
      h("ul", { "aria-label": props.ariaLabel, "data-value": props.value, "data-pill-select": "" }, props.options.map((option) => h("li", { key: option.value }, option.label))),
  };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async () => ({})),
    useStore: () => ({
      state: {
        ...original.initialState,
        config: {
          profile: { name: "Alice Example", email: "alice@example.test" },
          viewer: { principalId: fixture.viewerId, name: "Alice Example", email: "alice@example.test", role: "member" },
        },
      },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => fixture.org,
}));
vi.mock("../bot-settings/SharingSection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bot-settings/SharingSection")>()),
  useBotSharing: () => fixture.sharing,
}));
vi.mock("../bot-settings/GrantEditor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bot-settings/GrantEditor")>();
  return {
    ...actual,
    useGrantEditor: (input: Parameters<typeof actual.useGrantEditor>[0]) => {
      const real = actual.useGrantEditor(input);
      return fixture.editor ? { ...real, ...fixture.editor } : real;
    },
  };
});

const { ShareBotButton } = await import("./ShareBotButton");

const directory: OrgDirectory = {
  people: [
    { principalId: OWNER, name: "Alice Example", login: "alice", email: "alice@example.test", role: "admin", disabled: false },
    { principalId: BOB, name: "Bob Sample", login: "bob", email: "bob@example.test", role: "member", disabled: false },
    { principalId: CAROL, name: "Carol Test", login: "carol", email: "carol@example.test", role: "member", disabled: false },
  ],
  teams: [{ id: "support", name: "Support", managers: [], members: [BOB, CAROL] }],
};

const rows: WireGrant[] = [
  { target: `user:${BOB}`, level: "run", by: OWNER, at: 1, label: "Bob Sample", kind: "user" },
  { target: "team:support", level: "use", by: OWNER, at: 1, label: "Support", kind: "team" },
];

const ownerRights: GrantAdministration = { any: true, teamIds: [], maxLevel: "manage", canAdd: true };

const bot = { id: "bot-1", name: "Helper", ownerUserId: OWNER, grants: rows.map(({ target, level, by, at }) => ({ target, level, by, at })) } as unknown as Bot;

function render(open: boolean, overrides: Partial<NonNullable<typeof fixture.sharing>> = {}): string {
  fixture.sharing = { directory, rows, administer: ownerRights, isOwner: true, mayShare: true, ...overrides };
  return renderToStaticMarkup(createElement(ShareBotButton, { bot, open, onOpenChange: () => {} }));
}

/** The popover's markup without its own opening tag (its surface may keep
 * the popover outline; nothing inside it may). */
function inside(markup: string): string {
  const start = markup.indexOf("data-bot-share-popover");
  expect(start).toBeGreaterThan(-1);
  return markup.slice(markup.indexOf(">", start) + 1);
}

function classes(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]!);
}

describe("ShareBotButton", () => {
  beforeEach(() => {
    setLocale("en");
    fixture.viewerId = OWNER;
    fixture.org = { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://id.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    fixture.editor = null;
  });

  it("draws the Share pill, closed", () => {
    const markup = render(false);
    expect(markup).toContain("data-bot-profile-share");
    expect(markup).toContain(">Share<");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("data-bot-share-popover");
  });

  it("opens on the title, Copy link, the field and who has access", () => {
    const markup = render(true);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("data-bot-share-popover");
    expect(markup).toContain("Share this Bot");
    expect(markup).toMatch(/data-bot-share-copy[^>]*>.*Copy link/);
    expect(markup).toMatch(/placeholder="Add people or groups"[^>]*data-bot-share-search|data-bot-share-search[^>]*placeholder="Add people or groups"/);
    expect(markup).toContain('title="Search by name, login or email"');
    expect(markup).toContain("Who has access");
    // the organization: its name, its initials, the word for its access
    expect(markup).toMatch(/data-bot-share-org[^>]*>.*>EO<.*Example Org.*>Shared</);
    // the owner first, then each grant
    expect(markup).toMatch(new RegExp(`data-grant="user:${OWNER}"[^>]*data-bot-share-owner|data-bot-share-owner[^>]*data-grant="user:${OWNER}"`));
    expect(markup).toMatch(/data-bot-share-owner[^>]*>.*Alice Example.*alice · alice@example\.test.*>Owner</);
    const bobRow = markup.slice(markup.indexOf(`data-grant="user:${BOB}"`));
    expect(bobRow).toMatch(/^[^]*?Bob Sample.*bob · bob@example\.test.*data-value="run".*>Talk<.*>Run routines<.*>Edit<.*>Manage sharing<.*>Remove access</);
    expect(markup).toMatch(/data-grant="team:support".*Support.*Teams · 2 people/);
    // the Sharing section's notice stays with the editor
    expect(markup).toContain("People you add see this bot&#x27;s conversations");
  });

  it("draws no outline on any row, field or button inside the popover", () => {
    const body = inside(render(true));
    expect(classes(body).length).toBeGreaterThan(10);
    for (const value of classes(body)) {
      expect(value).not.toMatch(/(^|\s)border(-|\s|$)/);
      expect(value).not.toMatch(/divide-|underline|ui-button-primary|font-semibold/);
    }
  });

  it("names the organization by default and says the bot is private when nobody holds a grant", () => {
    fixture.org = null;
    const markup = render(true, { rows: [] });
    expect(markup).toMatch(/data-bot-share-org[^>]*>.*Your organization.*>Private</);
    expect(markup).toContain("Not shared with anyone yet.");
  });

  it("shows the organization's visibility word when the server sends it", () => {
    const visible = { ...bot, visibility: "everyone" } as Bot;
    fixture.sharing = { directory, rows, administer: ownerRights, isOwner: true, mayShare: true };
    const markup = renderToStaticMarkup(createElement(ShareBotButton, { bot: visible, open: true, onOpenChange: () => {} }));
    expect(markup).toMatch(/data-bot-share-org[^>]*>.*>Everyone who can sign in</);
  });

  it("lists matches with a level select and an Add pill, never a primary button", () => {
    fixture.editor = {
      query: "car",
      candidates: [
        { target: `user:${CAROL}`, kind: "user", label: "Carol Test", detail: "carol", email: "carol@example.test" },
        { target: "team:design", kind: "team", label: "Design", count: 3 },
      ],
    };
    const markup = render(true);
    const carol = markup.slice(markup.indexOf(`data-bot-share-candidate="user:${CAROL}"`));
    expect(carol).toMatch(/^[^]*?Carol Test.*carol · carol@example\.test.*data-value="use".*>Talk<.*>Manage sharing<.*data-bot-share-add.*>Add</);
    expect(markup).toMatch(/data-bot-share-candidate="team:design".*Design.*Teams · 3 people/);
    const adds = [...markup.matchAll(/<button[^>]*data-bot-share-add[^>]*>/g)].map((match) => match[0]);
    expect(adds.length).toBe(2);
    for (const tag of adds) expect(tag).not.toContain("ui-button-primary");
  });

  it("says nobody matches when the search finds no one", () => {
    fixture.editor = { query: "zzz", candidates: [] };
    expect(render(true)).toMatch(/data-bot-share-no-results[^>]*>Nobody matches\.</);
  });

  it("shows a viewer who may not share the levels as text, without the field or Remove access", () => {
    fixture.viewerId = BOB;
    const markup = render(true, { administer: null, isOwner: false });
    expect(markup).toContain("Only this bot&#x27;s owner can share it.");
    expect(markup).not.toContain("data-bot-share-search");
    expect(markup).not.toContain("Remove access");
    expect(markup).not.toContain("data-pill-select");
    expect(markup).toMatch(new RegExp(`data-grant="user:${BOB}".*>Run routines<`));
    expect(markup).toMatch(/data-bot-share-owner[^>]*>.*Alice Example.*>Owner</);
  });

  it("explains an owner whose profile lacks sharing", () => {
    const markup = render(true, { administer: null, isOwner: true, mayShare: false });
    expect(markup).toContain("data-sharing-permission");
  });
});
