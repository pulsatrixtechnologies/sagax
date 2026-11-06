// The To: picker shows at most six results (bots and people together) under
// the two create rows, which always stay first. A search filters among all
// of them and keeps the six best; the shortcuts follow the visible rows.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus } from "@/state/store";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ bots: [] as unknown[], people: new Map<string, unknown>() }));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragStyle: undefined, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  useOrgPeople: () => fixture.people,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots as Bot[], botCreationPending: false, config: { viewer: { principalId: "pr_viewer" } } as unknown as ConfigStatus },
      dispatch: vi.fn(),
    }),
  };
});

import { COMPOSE_RESULT_LIMIT, ComposeToPicker, composeRows } from "./ComposeToPicker";

const bot = (id: string, name: string): Bot => ({
  id, threadId: id, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [],
});
const person = (principalId: string, name: string): OrgDirectoryPerson => ({ principalId, name, login: name.toLowerCase().replace(/\s+/g, "."), role: "member", disabled: false });

const bots = [bot("koda", "Koda"), bot("rocket", "Rocket")];
const people = [
  person("pr_felix", "Felix Roy"),
  person("pr_gaby", "Gaby Pelletier"),
  person("pr_mallory", "Mallory Dupuis"),
  person("pr_morgan", "Sam Taylor"),
  person("pr_marc", "Marc Roy"),
  person("pr_julie", "Julie Tremblay"),
];
const label = (row: ReturnType<typeof composeRows>[number]) =>
  row.kind === "bot" ? row.bot.id : row.kind === "person" ? row.person.principalId : row.kind;

describe("ComposeToPicker result limit", () => {
  it("keeps the two create rows first and at most six results after them", () => {
    expect(COMPOSE_RESULT_LIMIT).toBe(6);
    const rows = composeRows("browse", bots, true, people);
    expect(rows.map(label)).toEqual(["create-bot", "create-group", "koda", "rocket", "pr_felix", "pr_gaby", "pr_mallory", "pr_morgan"]);
    expect(composeRows("browse", bots, false, people).map(label)).toEqual(["create-group", "koda", "rocket", "pr_felix", "pr_gaby", "pr_mallory", "pr_morgan"]);
    const many = Array.from({ length: 9 }, (_, i) => bot(`b${i}`, `Bot ${i}`));
    expect(composeRows("group", many).map(label)).toEqual(["create-group", "b0", "b1", "b2", "b3", "b4", "b5"]);
  });

  it("filters among everyone, then shows the six best matches", () => {
    // "ma" matches Mallory and Marc by their first name, the bot Puma only inside.
    const matching = [...people].filter((p) => `${p.name} ${p.login}`.toLowerCase().includes("ma"));
    expect(composeRows("browse", [bot("puma", "Puma")], true, matching, "ma").map(label)).toEqual(["create-bot", "create-group", "pr_mallory", "pr_marc", "puma"]);
    // Name prefix beats a word prefix, which beats a match inside a word.
    const ro = [bot("aurora", "Aurora"), bot("rocket", "Rocket")];
    const roPeople = [person("pr_marc", "Marc Roy")];
    expect(composeRows("browse", ro, true, roPeople, "ro").map(label)).toEqual(["create-bot", "create-group", "rocket", "pr_marc", "aurora"]);
    // A long match list is still cut at six.
    const many = Array.from({ length: 10 }, (_, i) => person(`pr_${i}`, `Alex ${i}`));
    expect(composeRows("browse", [], true, many, "alex").filter((row) => row.kind === "person")).toHaveLength(6);
  });

  it("renders six results and numbers the shortcuts 1 to 8 with no gap", () => {
    fixture.bots = bots;
    fixture.people = new Map(people.map((p) => [p.principalId, p]));
    const html = renderToStaticMarkup(createElement(() => ComposeToPicker({ onClose: vi.fn() })));
    expect(html.match(/data-compose-(bot|person)=/g)).toHaveLength(6);
    expect(html).toContain("Sam Taylor");
    expect(html).not.toContain("Marc Roy");
    expect(html).not.toContain("Julie Tremblay");
    const keys = [...html.matchAll(/<kbd[^>]*>.*?<span>(\d)<\/span><\/kbd>/g)].map((m) => Number(m[1]));
    expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
