// #3292: AGENTS.md holds the standing rules only, as a short file. A
// description of the code goes to docs/code/<domain>.md, the appearance rules
// to docs/design/ux-reference-grokbot-cursor.md (section 8), and a fix log
// stays in its PR and issue. This guard keeps the file from growing back into
// an 11 000-line code description: a size ceiling, no dated or journal
// heading, and every line under a heading is a short rule (a bullet of one or
// two lines). Listed in GUARD_TESTS (scripts/verify/release/verify-merge.mjs),
// so every PR runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** The ceiling, in bytes. The rules-only file was about 16 KB when it was
 * cut (#3292); 24 KiB leaves room for half as many rules again from the lots
 * in flight, and stays far below a file that describes code (the old one was
 * 740 KB). Raise it only by moving descriptions out, never to fit one in. */
export const AGENTS_MD_CEILING = 24 * 1024;
/** A rule is one or two lines. */
const MAX_RULE_LINES = 2;
const MAX_RULE_CHARS = 420;

const DATE = /\b20\d\d-\d\d-\d\d\b/;
const JOURNAL_WORD = /\b(?:journal|changelog|change log|fix(?:es)? log|what changed|release log|session notes?)\b/i;

/** Every way the text breaks the rules-only shape, one line each. */
export function agentsMdProblems(text: string): string[] {
  const problems: string[] = [];
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > AGENTS_MD_CEILING) problems.push(`AGENTS.md is ${bytes} bytes, over the ${AGENTS_MD_CEILING}-byte ceiling: move descriptions to docs/code/`);
  const lines = text.split("\n");
  let section = "";
  let rule: { start: number; lines: number; chars: number } | undefined;
  const closeRule = () => {
    if (rule && (rule.lines > MAX_RULE_LINES || rule.chars > MAX_RULE_CHARS)) {
      problems.push(`line ${rule.start}: a rule of ${rule.lines} lines and ${rule.chars} characters under "${section}" is a description: keep the rule to one or two lines, move the rest to docs/code/`);
    }
    rule = undefined;
  };
  lines.forEach((line, index) => {
    const at = index + 1;
    if (line.startsWith("```")) problems.push(`line ${at}: a code block is a description: move it to docs/code/`);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeRule();
      section = heading[2];
      if (DATE.test(section)) problems.push(`line ${at}: dated heading "${section}": a journal section belongs in the PR and the issue`);
      if (JOURNAL_WORD.test(section)) problems.push(`line ${at}: journal heading "${section}": the PR and the issue keep the history`);
      return;
    }
    if (line.trim() === "") { closeRule(); return; }
    // The intro under the title, before the first "##", may be a short paragraph.
    if (!lines.slice(0, index).some((earlier) => /^##\s/.test(earlier))) return;
    if (line.startsWith("- ")) {
      closeRule();
      rule = { start: at, lines: 1, chars: line.length };
      return;
    }
    if (rule && /^ {2}\S/.test(line)) {
      rule.lines++;
      rule.chars += line.trim().length + 1;
      return;
    }
    problems.push(`line ${at}: a paragraph under "${section}" is a description: write the rule as a bullet, move the text to docs/code/`);
  });
  closeRule();
  return problems;
}

describe("AGENTS.md is rules only (#3292)", () => {
  // the file as git holds it (LF): a Windows checkout hands it CRLF, which
  // reads every line as a paragraph and adds a byte per line to the ceiling
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8").replace(/\r\n/g, "\n");

  it("stays under its size ceiling and keeps the rules-only shape", () => {
    expect(agentsMdProblems(agents)).toEqual([]);
  });

  it("tells a contributor where each kind of text goes", () => {
    expect(agents).toMatch(/^## How to add to this file$/m);
    expect(agents).toContain("docs/code/");
    expect(agents).toContain("docs/design/ux-reference-grokbot-cursor.md");
  });

  it("refuses what the old file was made of", () => {
    expect(agentsMdProblems("# Rules\n\n## Busy sends: the bot routes them (2026-10-18)\n\n- A rule (2026-10-18).\n")).toHaveLength(1);
    expect(agentsMdProblems("# Rules\n\n## Fix log\n\n- A rule.\n")).toHaveLength(1);
    expect(agentsMdProblems("# Rules\n\n## Chat\n\nThe composer (`src/components/Composer.tsx`) draws the box.\n")).toHaveLength(1);
    expect(agentsMdProblems("# Rules\n\n## Chat\n\n- One.\n  two.\n  three.\n")).toHaveLength(1);
    expect(agentsMdProblems("# Rules\n\n## Chat\n\n```ts\nconst x = 1;\n```\n")).not.toEqual([]);
    expect(agentsMdProblems(`# Rules\n\n## Chat\n\n${"- A short rule (2026-11-10, #3292).\n".repeat(800)}`)).toHaveLength(1);
    expect(agentsMdProblems("# Rules\n\nAn intro paragraph is fine.\n\n## Chat\n\n- One rule,\n  on two lines (2026-11-10, #3292).\n")).toEqual([]);
  });

  it("points at descriptions that exist", () => {
    for (const path of agents.match(/docs\/code\/[a-z-]+\.md/g) ?? []) {
      expect(() => readFileSync(join(root, path)), path).not.toThrow();
    }
    for (const name of /`docs\/code\/chat\.md`([^\n]*)/.exec(agents)?.[1].match(/`([a-z-]+)\.md`/g) ?? []) {
      const path = `docs/code/${name.replace(/`/g, "")}`;
      expect(() => readFileSync(join(root, path)), path).not.toThrow();
    }
  });
});
