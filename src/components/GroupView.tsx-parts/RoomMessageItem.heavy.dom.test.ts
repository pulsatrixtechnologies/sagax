// @vitest-environment happy-dom
// A Heavy run in a room (M-20261127-178): its experts are the room's bot that
// ran it, whoever owns it, looked up the room's way (memberOf, the bots of the
// room as every person in it sees them), never only among the viewer's own
// bots. BotAvatar is a stand-in here that says which bot it drew.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Bot, Group, Message } from "@/state/store";
import type { HeavyTeamLine } from "../../../shared/heavy-team";

vi.mock("../Avatar", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BotAvatar: (props: { bot: { name?: string; color: string } }) => ({ $$typeof: Symbol.for("react.transitional.element"), type: "span", key: null, ref: null, props: { "data-avatar-bot": `${props.bot.name}/${props.bot.color}` }, _owner: null, _store: {} }),
}));

const { RoomMessageItem } = await import("./RoomMessageItem");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_000_000;
const line: HeavyTeamLine = {
  phase: "done", outcome: "agreed", startedAt: T0, updatedAt: T0 + 8_000, thoughtEndedAt: T0 + 8_000, maxRounds: 5,
  rounds: [{ n: 1, kind: "propose", startedAt: T0, endedAt: T0 + 8_000, agreed: true }],
  agents: [1, 2, 3].map((n) => ({ n, persona: `Persona ${n}`, engineLabel: "ada@example.com", modelLabel: "Nimbus 1", status: "done" as const, messages: ["Plan."] })),
  leader: { engineLabel: "ada@example.com", modelLabel: "Nimbus 1", steps: [] },
};
/** A bot of another member of the room: not among the viewer's own bots. */
const theirs = { id: "bot-of-a-member", name: "Nimbus", color: "brown", mascotLook: { character: "shiba" } } as unknown as Bot;
const message = { id: "run", at: T0, role: "bot", kind: "activity", from: { botId: theirs.id, name: theirs.name, color: theirs.color }, tool: { name: "Team of Experts", ok: true, team: line } } as unknown as Message;

let host: HTMLDivElement;
let root: Root;
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

describe("a Heavy run in a room", () => {
  it("draws every expert as the room's bot that ran it, even a bot another member owns", () => {
    const props = {
      message, run: { author: { kind: "bot", key: theirs.id }, joinsAbove: true, joinsBelow: false }, newDay: false, divider: null,
      group: { id: "room-1", threadId: "room-thread", memberIds: [theirs.id] } as unknown as Group, members: [theirs], mentionPeers: [], transcript: [message],
      onReply: () => {}, reactionSelf: [], seen: new Map(), retryRequest: null, roomBusy: false, liveTools: new Set<string>(),
      retryRoom: () => {}, stopGoalRun: () => {}, runGoalAgain: () => {}, showToolCalls: true,
      memberOf: (id?: string) => (id === theirs.id ? theirs : undefined),
      // the viewer owns no bot of the room
      state: { bots: [], routines: [], config: {} } as never, dispatch: () => {},
    } as unknown as Parameters<typeof RoomMessageItem>[0];
    act(() => root.render(createElement(RoomMessageItem, props)));
    expect([...host.querySelectorAll<HTMLElement>("[data-heavy-pile] [data-heavy-expert-avatar] [data-avatar-bot]")].map((avatar) => avatar.dataset.avatarBot)).toEqual(["Nimbus/brown", "Nimbus/brown", "Nimbus/brown"]);
  });
});
