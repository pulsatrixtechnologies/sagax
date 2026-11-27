// @vitest-environment happy-dom
// M-20261127-178 (M-20261126-119, D-20261126-037): every expert of a Heavy
// run is the conversation's bot, duplicated: the same character, shape,
// skin, colours or picture as the chat's header draws it, in the row's pile
// and in the Thoughts panel. Never a colour per expert, an owl or a generic
// shape. The real avatars here, no stand-in.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { HeavyTeamLine } from "../../shared/heavy-team";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BotAvatar, type BotAvatarProps } from "./Avatar";
import { HeavyLeaderContext, HeavyTeamRow } from "./HeavyTeamRow";
import { loadAllBakedStills } from "./shape-stills";
import { ThoughtsPanel } from "./ThoughtsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Bot = BotAvatarProps["bot"];

const T0 = 1_000_000;
/** A run that is over: the row is the pile at once. */
const done = (count: number): HeavyTeamLine => ({
  phase: "done", outcome: "agreed", startedAt: T0, updatedAt: T0 + 74_000, thoughtEndedAt: T0 + 74_000, maxRounds: 5,
  rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 30_000 }, { n: 2, kind: "critique", startedAt: T0 + 30_000, endedAt: T0 + 74_000, agreed: true }],
  agents: Array.from({ length: count }, (_, index) => ({ n: index + 1, persona: `Persona ${index + 1}`, engineLabel: "ada@example.com", modelLabel: "Nimbus 1", status: "done" as const, agrees: true, messages: ["Plan.", "Agreed."] })),
  leader: { engineLabel: "ada@example.com", modelLabel: "Nimbus 1", steps: [{ kind: "planned", at: T0 }, { kind: "agreed", at: T0 + 74_000, round: 2 }] },
});
const message = (line: HeavyTeamLine): Message => ({ id: "run", at: T0, role: "bot", kind: "activity", tool: { name: "Team of Experts", ok: true, team: line } } as Message);

/** The bots the owner names: a brown character as a shape (with its own free colour and a skin), a character, a photo, the owl. */
const BOTS: Array<[string, Bot]> = [
  ["a brown cat shape with its own colour and a skin", { name: "Ada", color: "brown", mascotLook: { character: "shape", shape: "cat", bodyColor: "#7a4a2a", skins: { shape: "glossy" } } } as Bot],
  ["a Shiba in a brown of its own", { name: "Ada", color: "brown", mascotLook: { character: "shiba", bodyColor: "#7a4a2a" } } as Bot],
  ["its own picture", { name: "Ada", color: "teal", avatarUrl: "/api/attachments/a.png", avatarCrop: "circle" } as Bot],
  ["the owl", { name: "Ada", color: "amber" } as Bot],
];
/** The colours the experts used to take, one each (blue, green, orange...): none may show any more. */
const EXPERT_COLOURS = ["blue", "green", "orange", "purple", "pink", "teal", "lime", "coral"].map((name) => MASCOT_COLOR_HEX[name as keyof typeof MASCOT_COLOR_HEX]!.toLowerCase());

let host: HTMLDivElement;
let root: Root;
const mount = (node: ReactNode) => act(() => root.render(node));
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
/** A drawing with each avatar's own generated ids taken out: two copies of one avatar read the same. */
const normal = (html: string) => html.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "ID");

/** What the chat's header draws for this bot at this size, with the expert's life (idle, still): BotAvatar with the bot unchanged. */
function headerAvatar(bot: Bot, size: number): string {
  const box = document.createElement("div");
  const own = createRoot(box);
  act(() => own.render(createElement(BotAvatar, { bot, size, state: "idle", agentState: "idle", animated: false, trackPointer: false, label: "" })));
  const html = box.innerHTML;
  act(() => own.unmount());
  return normal(html);
}

/** The colours an avatar paints, lower case. */
const colours = (html: string) => new Set((html.toLowerCase().match(/#[0-9a-f]{6}\b/g) ?? []));

beforeAll(async () => {
  await loadAllBakedStills();
});
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a Heavy run's experts are the conversation's bot, duplicated (M-20261127-178)", () => {
  it.each(BOTS)("the row's pile: every expert is %s, exactly as the header draws it, no colour of its own", (_, bot) => {
    mount(createElement(HeavyLeaderContext, { value: bot }, createElement(HeavyTeamRow, { message: message(done(3)), busy: false })));
    const row = host.querySelector("[data-heavy-open]")!;
    expect(row.textContent).toContain("Thought for 1m 14s");
    const painted = colours(row.innerHTML);
    const own = colours(headerAvatar(bot, 22));
    // no expert colour (blue, green, orange...) the bot does not wear itself
    expect([...painted].filter((hex) => EXPERT_COLOURS.includes(hex) && !own.has(hex))).toEqual([]);
    // no owl for a bot that is no owl
    if (bot.mascotLook || bot.avatarUrl) expect(row.querySelectorAll("[data-owl]")).toHaveLength(0);
    // three copies of the header's own avatar, the same to the last attribute
    const experts = $$("[data-heavy-pile] [data-heavy-expert-avatar] > span");
    expect(experts).toHaveLength(3);
    for (const expert of experts) expect(normal(expert.innerHTML)).toBe(headerAvatar(bot, 22));
  });

  it.each(BOTS)("the Thoughts panel: each expert is %s, exactly as the header draws it", (_, bot) => {
    mount(createElement(HeavyLeaderContext, { value: bot }, createElement(ThoughtsPanel, { line: done(3), running: false, onClose: () => {} })));
    const panel = host.querySelector("[data-thoughts-panel]")!;
    const own = colours(headerAvatar(bot, 24));
    expect([...colours(panel.innerHTML)].filter((hex) => EXPERT_COLOURS.includes(hex) && !own.has(hex))).toEqual([]);
    if (bot.mascotLook || bot.avatarUrl) expect(panel.querySelectorAll("[data-owl]")).toHaveLength(0);
    const experts = $$("[data-thoughts-agent] [data-thoughts-avatar]");
    expect(experts).toHaveLength(3);
    for (const expert of experts) expect(normal(expert.innerHTML)).toBe(headerAvatar(bot, 24));
  });

  it("the brown cat keeps its shape, its skin and its own brown in every expert, row and panel", () => {
    const [, cat] = BOTS[0]!;
    mount(createElement(HeavyLeaderContext, { value: cat }, createElement("div", null,
      createElement(HeavyTeamRow, { message: message(done(4)), busy: false }),
      createElement(ThoughtsPanel, { line: done(4), running: false, onClose: () => {} }))));
    const drawn = $$("[data-heavy-expert-avatar] [data-shape], [data-thoughts-avatar] [data-shape]");
    expect(drawn).toHaveLength(8);
    for (const avatar of drawn) {
      expect(avatar.dataset.shape).toBe("cat");
      expect(avatar.dataset.shapeSkin).toBe("glossy");
    }
  });
});
