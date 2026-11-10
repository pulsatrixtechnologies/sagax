// #3293: the prompt served to bots agrees with the product's own rules.
// One unified chat per bot (no thread rows, no "#Title" thread links, never
// "open a thread"), one table rule (TABLE_RULE, shared/output-style.ts) and
// no em or en dash in text a model reads and imitates.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OUTPUT_STYLE_RULE, OUTPUT_STYLE_RULE_SHORT, TABLE_RULE } from "../shared/output-style.ts";
import { WIDGET_TOOL_DEFINITIONS } from "./drivers/agents-widget-tools.ts";
import { COLD_RICH_OUTPUT_PROMPT } from "./context/cold-prompt-budget.ts";
import { onDemandPromptText, systemPromptReference } from "./context/prompt-references.ts";
import * as systemPrompt from "./system-prompt.ts";
import { MEMORY_ROUTING_GUIDANCE, SESSION_SEARCH_SYSTEM_PROMPT } from "./workspace/workspace.ts";

const KINDS = ["vm-private", "vm-shared", "box", "vps", "local"] as const;
// The peer roster has its own owner and is out of this check.
const REFERENCE_IDS = [
  "rich-output", "rich-output-no-email", "routine-execution", "recall", "credentials", "forms",
  "reactions", "memes", "threads", "routines", "profile", "profile-creator", "learn", "shell",
  "browser", "data", ...KINDS.filter((kind) => kind !== "local").map((kind) => `computer-${kind}`),
];

function servedTexts(): Array<[string, string]> {
  const texts: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(systemPrompt)) {
    if (typeof value !== "string") continue;
    texts.push([name, value]);
    texts.push([`${name} (brief)`, onDemandPromptText(value, true)]);
  }
  for (const kind of KINDS) texts.push([`computerPrompt(${kind})`, systemPrompt.computerPrompt(kind)]);
  texts.push(["richOutputPrompt(false)", systemPrompt.richOutputPrompt(false)]);
  texts.push(["longCommandsPrompt(vm-private)", systemPrompt.longCommandsPrompt("vm-private")]);
  texts.push(["cloudHomePrompt(true)", systemPrompt.cloudHomePrompt(true)]);
  texts.push(["cloudHomePrompt(false)", systemPrompt.cloudHomePrompt(false)]);
  texts.push(["mentionPrompt", systemPrompt.mentionPrompt([{ id: "a1", name: "Ana" }])]);
  texts.push(["OUTPUT_STYLE_RULE", OUTPUT_STYLE_RULE], ["OUTPUT_STYLE_RULE_SHORT", OUTPUT_STYLE_RULE_SHORT]);
  texts.push(["COLD_RICH_OUTPUT_PROMPT", COLD_RICH_OUTPUT_PROMPT]);
  texts.push(["SESSION_SEARCH_SYSTEM_PROMPT", SESSION_SEARCH_SYSTEM_PROMPT], ["MEMORY_ROUTING_GUIDANCE", MEMORY_ROUTING_GUIDANCE]);
  for (const id of REFERENCE_IDS) texts.push([`prompt:${id}`, systemPromptReference(`prompt:${id}`) ?? ""]);
  return texts;
}

const GOLDENS = join(dirname(fileURLToPath(import.meta.url)), "drivers", "agents-catalog-goldens");

/** Every tool description a model is served: the widget tools from source and
 * every tool of every pinned catalog profile. */
function servedToolDescriptions(): Array<[string, string]> {
  const out: Array<[string, string]> = WIDGET_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.description]);
  for (const file of readdirSync(GOLDENS).filter((name) => name.endsWith(".tools-list.json"))) {
    const golden = JSON.parse(readFileSync(join(GOLDENS, file), "utf8")) as { tools: Array<{ name: string; description?: string }> };
    for (const tool of golden.tools) out.push([`${file}:${tool.name}`, tool.description ?? ""]);
  }
  return out;
}

/** A table threshold stated in words: "3 or more columns", "6+ rows",
 * "more than 5 rows and 3 columns", "never a table for a short answer". */
const THRESHOLD = /\d+\+?\s*(?:or more\s+)?(?:columns|rows)\b|more than (?:about )?\d+ (?:rows|columns)|table for a short answer/i;

describe("served prompt agrees with the chat rules (#3293)", () => {
  it("describes one unified chat: no thread rows, no #Title thread links", () => {
    const offenders = servedTexts().filter(([, text]) => /rows under|as rows under|#Title|so it links/.test(text)).map(([name]) => name);
    expect(offenders).toEqual([]);
    expect(systemPrompt.THREADS_PROMPT).toContain("The person has one chat with you");
    expect(systemPrompt.THREADS_PROMPT).toContain("never tell the person to open a thread or go to another conversation");
  });

  it("states one table threshold, the shared TABLE_RULE", () => {
    const offenders = servedTexts()
      .filter(([, text]) => THRESHOLD.test(text.split(TABLE_RULE).join(" ")))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
    expect(systemPrompt.RICH_OUTPUT_PROMPT).toContain(TABLE_RULE);
    expect(COLD_RICH_OUTPUT_PROMPT).toContain(TABLE_RULE);
  });

  it("tool descriptions leave tables to TABLE_RULE: none sends data to a table by default", () => {
    const offenders = servedToolDescriptions()
      .filter(([, text]) => /\bin a (?:markdown )?table\b/i.test(text) || (/\btables?\b/i.test(text) && !text.includes("output style rule")))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
    const showWidget = WIDGET_TOOL_DEFINITIONS.find((tool) => tool.name === "show_widget")!;
    expect(showWidget.description).toContain("a table only as the output style rule allows");
  });

  it("holds no em or en dash", () => {
    const offenders = servedTexts().filter(([, text]) => /[–—]/.test(text)).map(([name]) => name);
    expect(offenders).toEqual([]);
  });
});
