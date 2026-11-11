import { describe, expect, it } from "vitest";

import { QuietMode } from "./quiet-mode.ts";

function world() {
  const bots = [
    { id: "nova", owner: "ada" },
    { id: "atlas", owner: "ada" },
    { id: "other", owner: "grace" },
  ];
  const lines: Array<{ botId: string; text: string }> = [];
  let saved: unknown = null;
  const storage = { load: () => saved, save: (state: unknown) => { saved = JSON.parse(JSON.stringify(state)); } };
  const make = () => new QuietMode({
    storage,
    bot: (id) => bots.find((bot) => bot.id === id),
    bots: () => bots,
    owner: (bot) => bot.owner,
    language: (person) => person === "ada" ? "fr-CA" : "en",
    line: (bot, text) => { lines.push({ botId: bot.id, text }); },
    now: () => 1_000,
  });
  return { make, lines, bots };
}

describe("quiet mode per bot and for all the person's bots (#3480)", () => {
  it("one bot's switch quiets that bot only", () => {
    const { make } = world();
    const quiet = make();
    const view = quiet.setBot("nova", true);
    expect(view).toMatchObject({ botId: "nova", bot: true, all: false, quiet: true });
    expect(view.said).toBe("C'est fait : je reste silencieux et je te joins seulement quand j'ai besoin de ta réponse.");
    expect(quiet.quiet("nova")).toBe(true);
    expect(quiet.quiet("atlas")).toBe(false);
  });

  it("the person's switch quiets all their bots, never another person's", () => {
    const { make } = world();
    const quiet = make();
    const view = quiet.setPerson("Ada", true);
    expect(view.all).toBe(true);
    expect(view.bots.map((bot) => [bot.botId, bot.quiet])).toEqual([["nova", true], ["atlas", true]]);
    expect(quiet.quiet("other")).toBe(false);
  });

  it("counts each kept run once, and writes the line with the counts when it goes off", () => {
    const { make, lines } = world();
    const quiet = make();
    quiet.setBot("nova", true);
    expect(quiet.keep("nova", "r1", false)).toBe(true);
    expect(quiet.keep("nova", "r1", false)).toBe(false);
    quiet.keep("nova", "r2", true);
    quiet.keep("nova", "r3", false);
    expect(quiet.keep("atlas", "r4", false)).toBe(false);
    expect(quiet.view("nova").kept).toMatchObject({ runs: 3, problems: 1 });
    const off = quiet.setBot("nova", false);
    expect(off.summary).toBe("Mode silencieux terminé : 3 exécutions gardées en silence, dont 1 avec des problèmes. Tu les retrouves dans Automatisations, sous Exécutions de chaque routine.");
    expect(lines).toEqual([{ botId: "nova", text: off.summary }]);
    expect(quiet.view("nova").kept).toEqual({ runs: 0, problems: 0 });
  });

  it("the bot's own switch off while all bots stay quiet writes nothing yet", () => {
    const { make, lines } = world();
    const quiet = make();
    quiet.setBot("nova", true);
    quiet.setPerson("ada", true);
    quiet.keep("nova", "r1", false);
    const view = quiet.setBot("nova", false);
    expect(view.quiet).toBe(true);
    expect(view.summary).toBeUndefined();
    expect(lines).toEqual([]);
    quiet.setPerson("ada", false);
    expect(lines).toEqual([{ botId: "nova", text: expect.stringContaining("1 exécution gardée en silence") }]);
  });

  it("the person's switch off writes a line only in the bots that kept something", () => {
    const { make, lines } = world();
    const quiet = make();
    quiet.setPerson("ada", true);
    quiet.keep("atlas", "r1", true);
    quiet.setPerson("ada", false);
    expect(lines.map((line) => line.botId)).toEqual(["atlas"]);
  });

  it("survives a restart", () => {
    const { make } = world();
    const first = make();
    first.setBot("nova", true);
    first.setPerson("grace", true);
    first.keep("nova", "r1", true);
    const again = make();
    expect(again.quiet("nova")).toBe(true);
    expect(again.quiet("other")).toBe(true);
    expect(again.view("nova").kept).toMatchObject({ runs: 1, problems: 1 });
    expect(again.keep("nova", "r1", true)).toBe(false);
  });
});
