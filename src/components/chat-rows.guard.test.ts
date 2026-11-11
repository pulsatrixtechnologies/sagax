// Guard (#3581, the owner 2026-11-10: "the way it works, with the look of
// the reference product"): the rows that tell a trace between bots or a
// background task are drawn in the application's own font and rows. No
// terminal font, no `⎿`, no `Agent(` (a branch name on the coding card is
// the one monospace that stays: it is a branch). And quiet mode is gone
// from the screens: what it did is how every bot behaves. Listed in
// GUARD_TESTS (scripts/verify/release/guard-tests.mjs).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
/** The source without its comments, so a comment may name what it replaced. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CHAT_ROWS = [
  "./BotNamesLine.tsx",
  "./HandoffRow.tsx",
  "./RelayViaLabel.tsx",
  "./SendReceiptRow.tsx",
  "./ThreadChip.tsx",
  "./MessagedLine.tsx",
  "./AskLine.tsx",
  "./TeamNoteLine.tsx",
  "./StepRow.tsx",
  "./ParallelTaskCard.tsx",
  "./ChatView.tsx-parts/MessagesListItem.tsx",
];

describe("chat rows guard", () => {
  it.each(CHAT_ROWS)("%s draws no terminal font and no terminal syntax", (path) => {
    const source = code(path);
    expect(source).not.toContain("font-mono");
    expect(source).not.toContain("⎿");
    expect(source).not.toContain("Agent(");
    expect(source).not.toMatch(/>●</);
  });

  it("keeps monospace on the coding card for the branch name only", () => {
    const lines = code("./CodingJobCard.tsx").split("\n").filter((line) => line.includes("font-mono"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{job.branch}");
    expect(code("./CodingJobCard.tsx")).not.toMatch(/⎿|Agent\(/);
  });

  it("gives every card of a chat the approval card's width: no cap of its own", () => {
    expect(code("./AskCard.tsx")).toMatch(/className="w-full rounded-3xl bg-composer/);
    expect(code("./ProactiveChoiceCard.tsx")).not.toContain("max-w-[600px]");
    expect(code("./QuestionSheet.tsx")).not.toMatch(/max-w-\[min\(80%/);
  });

  it("has no quiet mode switch on the bot's page nor in Settings, and no words for one", () => {
    expect(existsSync(new URL("./bot-settings/QuietModeRow.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../lib/quiet-mode.ts", import.meta.url))).toBe(false);
    for (const path of ["./bot-settings/BotFollowsRows.tsx", "./settings/ProactiveReceiveSettings.tsx", "./bot-profile/BotProfilePage.tsx-parts/BotProfileHeader.tsx", "./bot-profile/BotProfilePage.tsx"]) {
      expect(code(path)).not.toMatch(/quiet-?mode|QuietMode|onOpenQuiet/i);
    }
    for (const catalog of [en, fr] as Record<string, string>[]) {
      for (const key of ["quietMode.label", "quietMode.all.label", "quietMode.botSwitch", "quietMode.markAll"]) expect(catalog).not.toHaveProperty(key);
    }
  });

  it("has no words for a quoted request or a terminal delegation line", () => {
    for (const catalog of [en, fr] as Record<string, string>[]) {
      for (const key of ["chat.askLine.words", "chat.relayVia.ask", "chat.parallel.backgrounded", "chat.parallel.result"]) expect(catalog).not.toHaveProperty(key);
    }
    expect(en["chat.parallel.state.done"]).not.toMatch(/answer below/i);
  });

  it("says one state with one set of words: no second pager or trace wording", () => {
    for (const catalog of [en, fr] as Record<string, string>[]) {
      for (const key of ["chat.incoming.position", "chat.relayVia.trace.failed", "chat.relayVia.trace.stopped", "chat.relayVia.trace.silent"]) expect(catalog).not.toHaveProperty(key);
    }
    // a relayed request's entry is built in one place (lib/incoming-line)
    expect(code("./RelayViaLabel.tsx")).toContain("relayAskEntry(");
    expect(code("./RelayViaLabel.tsx")).not.toContain("AGENT_OPENER_PREFIX");
  });
});
