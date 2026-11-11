// #3462: every line the Coding section and a step's chat say about an
// orchestrator's work, in English and in French, built from the shared
// vectors (shared/team-work.vectors.json); no identifier reaches a label.
import { afterEach, describe, expect, it } from "vitest";

import vectors from "../../shared/team-work.vectors.json";
import { buildTeamWork, TEAM_SILENT_MS, type TeamStepFacts, type TeamWorkInput } from "../../shared/team-work";
import { setLocale } from "@/lib/i18n";
import {
  foldTeamEvent,
  liveAt,
  livePhrase,
  teamAge,
  teamCount,
  teamDoneLabel,
  teamNoteCount,
  teamNoteFolded,
  teamLineText,
  teamStepLine,
  teamStepMetaLine,
  teamStepOf,
  teamToComeLine,
  teamWorkAt,
  teamWorkLine,
  teamWorkSpend,
  type TeamNote,
} from "./team-work";

const NOW = 1_000_000;
const NAMES = new Map([
  ["dev", { name: "Builder", title: "Server builder" }],
  ["qa", { name: "Tester", title: "Test engineer" }],
  ["rev", { name: "Checker" }],
]);
const caseNamed = (name: string) => vectors.build.find((entry) => entry.name.startsWith(name))!;
const release = () => buildTeamWork({ ...(caseNamed("sums of time").input as unknown as TeamWorkInput), names: NAMES });
const nameOf = (botId: string) => NAMES.get(botId);
const IDS = /\b(h[123]|dev|qa|rev|orc|t[12]|step:|work:)\b/;

afterEach(() => setLocale("en"));

describe("team work words", () => {
  it("ages: seconds, minutes, hours", () => {
    setLocale("en");
    expect(teamAge(40_000)).toBe("40 s");
    expect(teamAge(6 * 60_000)).toBe("6 min");
    expect(teamAge(112 * 60_000)).toBe("1 h 52");
    expect(teamAge(120 * 60_000)).toBe("2 h");
  });

  it("the live phrases of every state, in English and in French", () => {
    const lives = vectors.live.map((entry) => liveAt(entry.expect as never, entry.now));
    setLocale("en");
    const en = lives.map((live, index) => livePhrase(live, vectors.live[index]!.now));
    expect(en).toContain("last action 40 s ago");
    expect(en).toContain("silent for 3 min");
    expect(en).toContain("silent for 6 min");
    expect(en).toContain("waiting to start");
    expect(en).toContain("waiting for your answer");
    expect(en).toContain("waiting for the computer");
    expect(en).toContain("waiting for another bot");
    expect(en).toContain("idle");
    setLocale("fr");
    const fr = lives.map((live, index) => livePhrase(live, vectors.live[index]!.now));
    expect(fr).toContain("dernière action il y a 40 s");
    expect(fr).toContain("silencieux depuis 6 min");
    expect(fr).toContain("attend de démarrer");
    expect(fr).toContain("attend ta réponse");
    expect(fr).toContain("attend l'ordinateur");
    expect(fr).toContain("attend un autre bot");
    expect(fr).toContain("inactif");
    for (const line of [...en, ...fr]) expect(line).not.toMatch(/[–—]/);
  });

  it("a working step turns silent on the clock alone, at exactly 3 minutes", () => {
    const live = { state: "working" as const, lastActionAt: NOW };
    expect(liveAt(live, NOW + TEAM_SILENT_MS - 1).state).toBe("working");
    expect(liveAt(live, NOW + TEAM_SILENT_MS)).toMatchObject({ state: "silent", silentMs: TEAM_SILENT_MS });
    // a tool call in flight is never silent
    expect(liveAt({ ...live, toolSince: NOW }, NOW + 60 * TEAM_SILENT_MS).state).toBe("working");
  });

  it("the header count, the work row's grey line, its spend and its steps (#3575)", () => {
    const work = release();
    setLocale("en");
    expect(teamCount(work.team)).toBe("1 working now");
    const item = work.live[0]!;
    const line = teamWorkLine(item, nameOf, NOW);
    expect(line).toEqual({ botId: "qa", who: "Tester", parts: ["1/3", "1 min ago"] });
    expect(teamLineText(line)).toBe("Tester · 1/3 · 1 min ago");
    // duration and tokens: the unfolded detail only, never the row
    expect(teamWorkSpend(item)).toBe("15 min · 12k tokens");
    expect(teamLineText(line)).not.toContain("tokens");
    const steps = item.steps.map((step) => teamStepLine(step, nameOf, NOW));
    expect(steps.map((step) => step.botId)).toEqual(["dev", "qa", "rev"]);
    expect(teamLineText(steps[2]!)).toBe("Checker · waiting to start");
    expect(teamLineText(teamToComeLine({ botId: "dev" }, nameOf))).toBe("Builder · to come");
    expect(teamLineText(teamToComeLine({}, nameOf))).toBe("to come");
    const lines = [teamCount(work.team), teamWorkSpend(item), teamLineText(line), ...steps.map(teamLineText)];
    setLocale("fr");
    const fr = [teamCount(work.team), teamWorkSpend(item), teamLineText(teamWorkLine(item, nameOf, NOW)), ...item.steps.map((step) => teamLineText(teamStepLine(step, nameOf, NOW)))];
    expect(fr[0]).toBe("1 au travail");
    expect(fr[2]).toBe("Tester · 1/3 · il y a 1 min");
    expect(fr.at(-1)).toBe("Checker · attend de démarrer");
    for (const text of [...lines, ...fr]) {
      expect(text).not.toMatch(IDS);
      expect(text).not.toMatch(/[–—]/);
    }
  });

  it("a silent bot reads in the grey line", () => {
    const item = release().live[0]!;
    const silent = { ...item, live: { state: "silent" as const, lastActionAt: NOW - 6 * 60_000, silentMs: 6 * 60_000 } };
    setLocale("en");
    expect(teamLineText(teamWorkLine(silent, nameOf, NOW))).toBe("Tester · 1/3 · silent for 6 min");
    setLocale("fr");
    expect(teamLineText(teamWorkLine(silent, nameOf, NOW))).toBe("Tester · 1/3 · silencieux depuis 6 min");
  });

  it("an unnamed bot reads as a neutral word, never its id", () => {
    const work = buildTeamWork(caseNamed("sums of time").input as unknown as TeamWorkInput);
    setLocale("en");
    expect(teamLineText(teamWorkLine(work.live[0]!, () => undefined, NOW))).toBe("A team bot · 1/3 · 1 min ago");
    setLocale("fr");
    expect(teamLineText(teamWorkLine(work.live[0]!, () => undefined, NOW))).toBe("Un bot de l'équipe · 1/3 · il y a 1 min");
  });

  it("done today: merged, mixed, none merged", () => {
    setLocale("en");
    expect(teamDoneLabel([{ merged: true }, { merged: true }])).toBe("Done today · 2 merged");
    expect(teamDoneLabel([{ merged: true }, { merged: false }])).toBe("Done today · 2 done, 1 merged");
    expect(teamDoneLabel([{ merged: false }])).toBe("Done today · 1");
    setLocale("fr");
    expect(teamDoneLabel([{ merged: true }, { merged: true }])).toBe("Fini aujourd'hui · 2 fusionnés");
    expect(teamDoneLabel([{ merged: true }, { merged: false }])).toBe("Fini aujourd'hui · 2 finis, 1 fusionnés");
  });

  it("a finished piece of work and its steps say how they ended", () => {
    const work = buildTeamWork({ ...(caseNamed("done today").input as unknown as TeamWorkInput), names: NAMES });
    setLocale("en");
    const [failed, merged] = work.doneToday;
    expect(teamLineText(teamWorkLine(merged!, nameOf, NOW))).toBe("Builder · 1/1 · merged 8 min ago");
    expect(teamLineText(teamWorkLine(failed!, nameOf, NOW))).toBe("Tester · 0/1 · failed 5 min ago");
    expect(teamLineText(teamStepLine(merged!.steps[0]!, nameOf, NOW))).toBe("Builder · Merged the fix. · 1 min");
    expect(teamLineText(teamStepLine(failed!.steps[0]!, nameOf, NOW))).toBe("Tester · The tests failed. · 1 min");
  });

  it("the step chat's meta line", () => {
    const work = release();
    setLocale("en");
    const place = teamStepOf(work, undefined);
    expect(place).toBeNull();
    const facts = (caseNamed("sums of time").input.steps as unknown as TeamStepFacts[]).map((step, index) => ({ ...step, threadId: `t${index + 1}` }));
    const threaded = buildTeamWork({ ...(caseNamed("sums of time").input as unknown as TeamWorkInput), steps: facts, names: NAMES });
    const done = teamStepOf(threaded, "t1")!;
    expect(teamStepMetaLine(done, NOW)).toBe("Release · step 1 of 3 · finished 11 min ago");
    const running = teamStepOf(threaded, "t2")!;
    expect(teamStepMetaLine(running, NOW)).toBe("Release · step 2 of 3 · last action 1 min ago");
    setLocale("fr");
    expect(teamStepMetaLine(done, NOW)).toBe("Release · étape 1 sur 3 · terminé il y a 11 min");
  });

  it("the stream's events move a step's last action and tool call, with no read", () => {
    const facts = (caseNamed("one name").input.steps as unknown as TeamStepFacts[]).map((step, index) => ({ ...step, threadId: `t${index + 1}` }));
    const work = buildTeamWork({ ...(caseNamed("one name").input as unknown as TeamWorkInput), steps: facts, names: NAMES });
    const later = NOW + 5 * 60_000;
    // no event: silent by now
    expect(teamWorkAt(work, new Map(), later).live[0]!.live.state).toBe("silent");
    // one output a second ago: working again
    const overlay = foldTeamEvent(undefined, { type: "content.delta" }, later - 1_000)!;
    const moved = teamWorkAt(work, new Map([["t2", overlay]]), later);
    expect(moved.live[0]!.live).toMatchObject({ state: "working", lastActionAt: later - 1_000 });
    expect(moved.team.find((bot) => bot.botId === "rev")!.live.state).toBe("working");
    // a tool call in flight stays working however long
    const tool = foldTeamEvent(overlay, { type: "item.started", itemType: "tool" }, later)!;
    expect(teamWorkAt(work, new Map([["t2", tool]]), later + 60 * 60_000).live[0]!.live.state).toBe("working");
    const ended = foldTeamEvent(tool, { type: "item.completed", itemType: "tool" }, later + 1_000)!;
    expect(ended.tools).toBe(0);
    expect(ended.toolSince).toBeUndefined();
    expect(foldTeamEvent(undefined, { type: "thread.token-usage.updated" }, later)).toBeNull();
  });

  it("a burst of notes folds into the newest, counted once each", () => {
    const note = (at: number, count = 1, threadId = "t1"): TeamNote => ({ botId: "dev", botName: "Builder", threadId, text: "hi", at, lastAt: at, count });
    expect(teamNoteFolded(note(0), note(60_000))).toBe(true);
    expect(teamNoteFolded(note(0), note(10 * 60_000))).toBe(false);
    expect(teamNoteFolded(note(0), note(1_000, 1, "t2"))).toBe(false);
    expect(teamNoteCount(note(60_000, 2), [note(0), note(30_000)])).toBe(4);
  });
});
