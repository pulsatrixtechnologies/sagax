import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./plain-text.ts";
import { REPORT_BRIEF_MAX, reportBrief } from "./routine-result.ts";

type Case = { name: string; from: "end" | "start"; text: string; brief: string };
const { cases } = JSON.parse(readFileSync(new URL("./routine-result.vectors.json", import.meta.url), "utf8")) as { cases: Case[] };

describe("reportBrief (#3581): a result's one or two lines, from the bot's own words", () => {
  it("reads a paragraph's Markdown with the one plain-text reader every preview uses", () => {
    for (const line of [
      "**3 tickets** assigned, `1` waits on you, see [the board](https://example.com/board).",
      "The ~~old~~ new price list is saved and <attached-image path=\"/tmp/a.png\"/> attached.",
    ]) {
      expect(reportBrief(line, "end")).toBe(markdownToPlainText(line));
      expect(reportBrief(line, "start")).toBe(markdownToPlainText(line));
    }
  });

  for (const vector of cases) {
    it(vector.name, () => {
      expect(reportBrief(vector.text, vector.from)).toBe(vector.brief);
    });
  }

  it("never goes over 200 characters, never holds a Markdown block, never ends inside a word", () => {
    for (const vector of cases) {
      const brief = reportBrief(vector.text, vector.from);
      expect(brief.length).toBeLessThanOrEqual(REPORT_BRIEF_MAX);
      expect(brief).not.toMatch(/\n|^#|^\||```|RUN_STATUS|NOTHING_TO_REPORT/);
      if (brief.endsWith("…")) expect(vector.text).toMatch(new RegExp(`${brief.slice(-12, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`));
    }
  });
});
