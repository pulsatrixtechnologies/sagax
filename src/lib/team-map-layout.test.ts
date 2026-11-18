import { describe, expect, it } from "vitest";

import { BLOCK_W, GAP_X, GAP_Y, SHOW, TRAY_GAP, centreOut, columnsFor, layoutOrgChart, orderTeamBots, type OrgSection } from "./team-map-layout";
import type { TeamMapPair } from "./team-map";

const bot = (id: string, name = id, extra: Record<string, unknown> = {}) => ({ id, name, ...extra });
const pair = (a: string, b: string, count: number, extra: Partial<TeamMapPair> = {}): TeamMapPair =>
  ({ sourceBotId: a, targetBotId: b, count, kind: "delegates", live: null, connected: false, ...extra });
const section = (key: string, chiefs: ReturnType<typeof bot>[], members: ReturnType<typeof bot>[]): OrgSection<ReturnType<typeof bot>> => ({ key, name: key || "Unassigned", chiefs, members });

const atlas = bot("atlas", "Atlas", { chiefOfStaff: true });
const world = () => [
  section("mine", [atlas], [bot("boreas"), bot("cirrus"), bot("delta")]),
  section("fin", [], [bot("juno"), bot("kestrel"), bot("lumen"), bot("mica")]),
  section("field", [], [bot("nova"), bot("pike"), bot("onyx")]),
  section("desk", [], ["echo", "fjord", "gale", "harbor", "iris"].map((id) => bot(id))),
  section("docs", [], [bot("quill"), bot("rune")]),
  section("", [], [bot("tide"), bot("umber")]),
];
const pairs = [
  pair("atlas", "boreas", 12, { live: "running" }), pair("atlas", "cirrus", 8), pair("atlas", "juno", 5), pair("atlas", "nova", 4),
  pair("boreas", "echo", 9, { live: "running" }), pair("echo", "fjord", 6, { live: "queued" }), pair("fjord", "gale", 4, { kind: "reviews" }),
  pair("delta", "cirrus", 3, { kind: "reviews" }), pair("juno", "kestrel", 14), pair("nova", "pike", 7),
];
const base = { columns: 3, leadId: "atlas", pairs };

describe("team map org chart placement", () => {
  it("centre-out column order", () => {
    expect(centreOut(3)).toEqual([1, 0, 2]);
    expect(centreOut(4)).toEqual([1, 2, 0, 3]);
    expect(centreOut(5)).toEqual([2, 1, 3, 0, 4]);
  });

  it("puts the lead on top and the lead's busiest team in the middle, in one row under it", () => {
    const layout = layoutOrgChart(world(), base);
    const row = layout.blocks.filter((block) => block.tier === 0);
    expect(row.map((block) => block.key).sort()).toEqual(["field", "fin", "mine"]);
    const mine = row.find((block) => block.key === "mine")!;
    expect(mine.col).toBe(1);
    expect(row.find((block) => block.key === "fin")!.col).toBe(0);
    expect(row.find((block) => block.key === "field")!.col).toBe(2);
    expect(new Set(row.map((block) => block.y)).size).toBe(1);
    expect(layout.lead!.y).toBeLessThan(mine.y);
    expect(layout.lead!.cx).toBeCloseTo(mine.x + mine.w / 2, 5);
  });

  it("places a team that receives work from another team under it, never beside the lead", () => {
    const layout = layoutOrgChart(world(), base);
    const mine = layout.blocks.find((block) => block.key === "mine")!;
    const desk = layout.blocks.find((block) => block.key === "desk")!;
    expect(desk.col).toBe(mine.col);
    expect(desk.y).toBeGreaterThanOrEqual(mine.y + mine.h + GAP_Y);
  });

  it("fills unlinked teams from the left of the second row and keeps 72 px between teams", () => {
    const layout = layoutOrgChart(world(), base);
    const docs = layout.blocks.find((block) => block.key === "docs")!;
    expect(docs.tier).toBeGreaterThanOrEqual(1);
    expect(docs.col).toBe(0);
    const xs = layout.blocks.filter((block) => block.tier === 0).sort((a, b) => a.col - b.col);
    expect(xs[1].x - (xs[0].x + xs[0].w)).toBe(GAP_X);
    const fin = layout.blocks.find((block) => block.key === "fin")!;
    expect(docs.y - (fin.y + fin.h)).toBeGreaterThanOrEqual(GAP_Y);
  });

  it("puts Sans équipe last, apart and below every team", () => {
    const layout = layoutOrgChart(world(), base);
    const lowest = Math.max(...layout.blocks.map((block) => block.y + block.h));
    expect(layout.tray!.y).toBeGreaterThanOrEqual(lowest + TRAY_GAP);
    expect(layout.tray!.bots.map((b) => b.id)).toEqual(["tide", "umber"]);
    expect(layout.tray!.open).toBe(false);
    expect(layoutOrgChart(world(), { ...base, trayOpen: true }).tray!.placed).toHaveLength(2);
  });

  it("shows the first four bots then +N, and all of them once expanded", () => {
    const closed = layoutOrgChart(world(), base).blocks.find((block) => block.key === "desk")!;
    expect(closed.bots).toHaveLength(SHOW);
    expect(closed.hidden).toBe(1);
    expect(closed.total).toBe(5);
    const open = layoutOrgChart(world(), { ...base, expanded: new Set(["desk"]) }).blocks.find((block) => block.key === "desk")!;
    expect(open.bots).toHaveLength(5);
    expect(open.hidden).toBe(0);
    expect(open.expanded).toBe(true);
    expect(open.h).toBeGreaterThan(closed.h);
  });

  it("orders a delegation chain top to bottom and a hand-off to another team last", () => {
    const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);
    const desk = layoutOrgChart(world(), base).blocks.find((block) => block.key === "desk")!;
    expect(ids(desk.ordered).slice(0, 3)).toEqual(["echo", "fjord", "gale"]);
    const mine = layoutOrgChart(world(), base).blocks.find((block) => block.key === "mine")!;
    expect(ids(mine.ordered)).toEqual(["delta", "cirrus", "boreas"]);
  });

  it("a person's own card order wins", () => {
    const members = [bot("a"), bot("b"), bot("c")];
    expect(orderTeamBots(members, [pair("a", "b", 3)], new Set(["a", "b", "c"]), ["c", "a", "b"]).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("draws a link from the lead to each team it hands to, with the team's count, and mine to desk with 9", () => {
    const layout = layoutOrgChart(world(), base);
    const lead = layout.links.filter((link) => link.kind === "lead");
    expect(lead.map((link) => [link.toKey, link.badge?.text]).sort()).toEqual([["field", "4"], ["fin", "5"], ["mine", "20"]]);
    expect(lead.find((link) => link.toKey === "mine")!.state).toBe("running");
    const team = layout.links.filter((link) => link.kind === "team");
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ fromKey: "mine", toKey: "desk", count: 9, state: "running" });
  });

  it("draws in-team delegation down and reviews as a dashed side link, with a count each", () => {
    const layout = layoutOrgChart(world(), base);
    const bots = layout.links.filter((link) => link.kind === "bot");
    const juno = bots.find((link) => link.fromBot === "juno")!;
    expect(juno).toMatchObject({ toBot: "kestrel", reviews: false, count: 14 });
    expect(juno.badge?.text).toBe("14");
    const review = bots.find((link) => link.fromBot === "delta")!;
    expect(review).toMatchObject({ toBot: "cirrus", reviews: true, count: 3 });
  });

  it("never draws a link through a team block", () => {
    const layout = layoutOrgChart(world(), { ...base, pairs: [...pairs, pair("juno", "quill", 2), pair("quill", "tide", 1)] });
    for (const link of layout.links.filter((item) => item.kind === "team")) {
      const numbers = [...link.path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      expect(numbers.every(Number.isFinite)).toBe(true);
    }
    const crossing = layout.links.find((link) => link.kind === "team" && link.fromKey === "fin" && link.toKey === "docs");
    expect(crossing).toBeDefined();
  });

  it("skips a link that would cross another team", () => {
    // desk is two rows under mine; a link from fin (col 0) to field (col 2) side by side crosses mine
    const layout = layoutOrgChart(world(), { ...base, pairs: [...pairs, pair("juno", "nova", 3)] });
    expect(layout.links.some((link) => link.kind === "team" && link.fromKey === "fin" && link.toKey === "field")).toBe(false);
  });

  it("without a lead it roots at the teams that only send", () => {
    const layout = layoutOrgChart(world().map((s) => ({ ...s, chiefs: [] })), { columns: 3, pairs: pairs.filter((p) => p.sourceBotId !== "atlas") });
    expect(layout.lead).toBeNull();
    const row = layout.blocks.filter((block) => block.tier === 0).map((block) => block.key).sort();
    expect(row).toEqual(["mine"]);
  });

  it("keeps an empty team as a block and sizes the chart by columns", () => {
    const layout = layoutOrgChart([...world(), section("blank", [], [])], { ...base, columns: 4 });
    expect(layout.blocks.find((block) => block.key === "blank")!.bots).toHaveLength(0);
    expect(layout.width).toBe(4 * BLOCK_W + 3 * GAP_X + 88);
    expect(columnsFor(880)).toBe(3);
    expect(columnsFor(1168)).toBe(4);
    expect(columnsFor(1160)).toBe(3);
    expect(columnsFor(300)).toBe(3);
  });
});
