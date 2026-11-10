// #3387: the peer roster text served to models holds no em or en dash. Every
// served roster surface is built from the real exports and scanned whole.
// Fixtures are dash free on purpose: names, roles and descriptions are text
// people type, so the scan has no exclusion logic.
import { describe, expect, it } from "vitest";

import {
  livePeerRoster,
  livePeerRosterBlock,
  peerRosterSystemPrompt,
  peerStatusWords,
  renderRoster,
  resolveTeammate,
  roomPeerRosterSystemPrompt,
  roomRosterLine,
  teammateAvailabilityPrompt,
  type LivePeer,
  type PeerStatus,
} from "./peer-roster.ts";

const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const make = (n: number, extra: Partial<LivePeer> = {}): LivePeer => ({
  id: `bot${n}`,
  name: `Bot ${n}`,
  title: `Role ${n}`,
  description: `About bot ${n}`,
  ...extra,
});

const team: LivePeer[] = [
  make(1),
  make(2, { activity: "working", lastActivityAt: 30 }),
  make(3, { activity: "waiting-on-you", lastActivityAt: 20 }),
  make(4, { activity: "no-signal", lastActivityAt: 10 }),
  make(5, { activity: "dead" }),
  make(6, { busy: true, lastActivityAt: 5 }),
  make(7, { chiefOfStaff: true }),
  { id: "twin1", name: "Twin", title: "Role twin" },
  { id: "twin2", name: "Twin", title: "Role twin" },
  ...[10, 11, 12, 13, 14].map((n) => make(n)),
];
const everyoneBusy: LivePeer[] = Array.from({ length: 14 }, (_, i) => make(i + 20, { activity: "working" }));
const twoDead: LivePeer[] = [make(1), make(2), make(3, { activity: "dead" }), make(4, { activity: "dead" })];
const oneDead: LivePeer[] = [make(1), make(2), make(3, { activity: "dead" })];
const self = { id: "self", name: "Self" };
const STATUSES: PeerStatus[] = ["available", "working", "waiting-on-user", "not-responding", "unavailable"];

function servedTexts(): Array<[string, string]> {
  const errorOf = (raw: string, bots = [self, ...team]): string => {
    const result = resolveTeammate(bots, self, raw);
    if (!("error" in result)) throw new Error(`expected a refusal for "${raw}"`);
    return result.error;
  };
  return [
    ["peerRosterSystemPrompt(team)", peerRosterSystemPrompt(team)],
    ["peerRosterSystemPrompt(team, true, true, about)", peerRosterSystemPrompt(team, true, true, () => true)],
    ["peerRosterSystemPrompt([])", peerRosterSystemPrompt([])],
    ["roomPeerRosterSystemPrompt(team)", roomPeerRosterSystemPrompt(team)],
    ["roomPeerRosterSystemPrompt([])", roomPeerRosterSystemPrompt([])],
    ["renderRoster(max 1, about)", renderRoster(team, { max: 1, empty: "", about: true })],
    ["teammateAvailabilityPrompt(team)", teammateAvailabilityPrompt(team)],
    ["teammateAvailabilityPrompt(everyone not free)", teammateAvailabilityPrompt(everyoneBusy)],
    ["teammateAvailabilityPrompt(all free)", teammateAvailabilityPrompt([make(1), make(2)])],
    ["livePeerRosterBlock(team, cap 1)", livePeerRosterBlock(livePeerRoster(team, 1))],
    ["livePeerRosterBlock(two dead, cap 1)", livePeerRosterBlock(livePeerRoster(twoDead, 1))],
    ["livePeerRosterBlock(one dead, cap 1)", livePeerRosterBlock(livePeerRoster(oneDead, 1))],
    ...STATUSES.map((status): [string, string] => [`peerStatusWords(${status})`, peerStatusWords(status)]),
    ["roomRosterLine", roomRosterLine({ name: "Ana", title: "Writer" })],
    ["resolveTeammate(blank)", errorOf("   ")],
    ["resolveTeammate(unknown name)", errorOf("Nobody Here")],
    ["resolveTeammate(duplicated name)", errorOf("Twin")],
  ];
}

describe("served peer roster texts (#3387)", () => {
  it("builds every surface with real content", () => {
    const texts = servedTexts();
    expect(texts.length).toBeGreaterThanOrEqual(20);
    for (const [label, text] of texts) expect(text.length, label).toBeGreaterThan(0);
    // the fixture reaches the branches the scan is meant to cover
    const byLabel = Object.fromEntries(texts);
    expect(byLabel["peerRosterSystemPrompt(team)"]).toContain("[TEAM ROSTER]");
    expect(byLabel["peerRosterSystemPrompt(team)"]).toContain("more (use list_bots");
    expect(byLabel["teammateAvailabilityPrompt(everyone not free)"]).toContain("more not free");
    expect(byLabel["livePeerRosterBlock(two dead, cap 1)"]).toContain("teammates are unavailable");
    expect(byLabel["livePeerRosterBlock(one dead, cap 1)"]).toContain("1 teammate is unavailable");
    expect(byLabel["resolveTeammate(duplicated name)"]).toContain("2 reachable teammates");
  });

  it("holds no em dash and no en dash", () => {
    const offenders = servedTexts()
      .filter(([, text]) => DASH.test(text))
      .map(([label, text]) => `${label}: ${text.split("\n").find((line) => DASH.test(line))}`);
    expect(offenders).toEqual([]);
  });
});
