import { describe, expect, it } from "vitest";

import {
  parseQuietModeWrite,
  QUIET_MODE_BOT_ROUTE,
  quietModeBotPath,
  quietModeLevel,
  quietModeNotification,
  quietModeSaid,
  quietModeSummary,
  quietRunHadProblems,
} from "./quiet-mode.ts";

describe("quiet mode contract (#3480)", () => {
  it("names the bot route the interface reads and writes", () => {
    const path = quietModeBotPath("bot one");
    expect(path).toBe("/api/bots/bot%20one/quiet");
    expect(decodeURIComponent(QUIET_MODE_BOT_ROUTE.exec(path)![1]!)).toBe("bot one");
  });

  it("reads a PUT body as on or off, and the words that set it", () => {
    expect(parseQuietModeWrite({ on: true })).toEqual({ on: true });
    expect(parseQuietModeWrite({ on: false, via: "words" })).toEqual({ on: false, via: "words" });
    expect(typeof parseQuietModeWrite({})).toBe("string");
    expect(typeof parseQuietModeWrite(null)).toBe("string");
  });

  it("is never louder than the quiet level of a wake's feedback", () => {
    expect(quietModeLevel("normal", true)).toBe("quiet");
    expect(quietModeLevel(undefined, true)).toBe("quiet");
    expect(quietModeLevel("muted", true)).toBe("muted");
    expect(quietModeLevel("normal", false)).toBe("normal");
  });

  it("drops background news, silences an ask, leaves the person's own conversation alone", () => {
    const base = { botId: "b", botName: "Nova", threadId: "t", title: "x", body: "y" };
    for (const kind of ["routine-failed", "routine-deferred", "incident", "delegation-settled", "proposal"] as const) {
      expect(quietModeNotification({ ...base, kind }, true), kind).toBeNull();
    }
    expect(quietModeNotification({ ...base, kind: "done", routineRunId: "r1" }, true)).toBeNull();
    expect(quietModeNotification({ ...base, kind: "question" }, true)).toMatchObject({ kind: "question", notify: false });
    expect(quietModeNotification({ ...base, kind: "approval" }, true)).toMatchObject({ kind: "approval", notify: false });
    expect(quietModeNotification({ ...base, kind: "done" }, true)).toEqual({ ...base, kind: "done" });
    expect(quietModeNotification({ ...base, kind: "routine-failed" }, false)).toEqual({ ...base, kind: "routine-failed" });
  });

  it("counts a failed, blocked or partial run as one with problems", () => {
    expect(quietRunHadProblems({ status: "failed" })).toBe(true);
    expect(quietRunHadProblems({ status: "blocked" })).toBe(true);
    expect(quietRunHadProblems({ status: "completed", problems: "one step failed" })).toBe(true);
    expect(quietRunHadProblems({ status: "completed" })).toBe(false);
  });

  it("says in one line what was kept quiet and where to see it, in the person's language", () => {
    expect(quietModeSummary({ runs: 4, problems: 1 }, "fr")).toBe("Mode silencieux terminé : 4 exécutions gardées en silence, dont 1 avec des problèmes. Tu les retrouves dans Automatisations, sous Exécutions de chaque routine.");
    expect(quietModeSummary({ runs: 2, problems: 0 }, "en")).toBe("Quiet mode is off: 2 runs kept quiet, none with problems. See them in Automations, under each routine's Runs.");
    expect(quietModeSummary({ runs: 0, problems: 0 }, "fr")).toBe("Mode silencieux terminé : aucune exécution n'a été gardée en silence.");
    for (const line of [quietModeSummary({ runs: 3, problems: 2 }, "fr"), quietModeSaid(true, "bot", "fr"), quietModeSaid(false, "all", "fr")]) {
      expect(line).not.toMatch(/[–—\n]/);
      expect(line).not.toMatch(/\bvous\b/i);
    }
  });
});
