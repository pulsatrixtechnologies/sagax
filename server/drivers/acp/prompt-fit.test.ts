// 2026-11-02 (production): Grok moved every request of about 100 KB to a
// file on the server, which the bot then tried to read from its server
// environment. Sagax keeps the request under Grok's limit itself.
// #3510: and never by cutting a line in the middle: whole sections of an
// opening prompt go first, the earlier-context line goes whole, the latest
// message is never touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GROK_PROMPT_BYTE_LIMIT, HISTORY_LEFT_OUT_NOTE, OPENING_DROP_ORDER, OPENING_KEPT, OPENING_LAST_RESORT_ORDER,
  fitOpeningSystem, fitPromptBytes, leftOutNote, promptFitTarget,
} from "./prompt-fit.ts";
import { grokPromptByteLimit } from "./grok.ts";
import { noteOpeningPrompt, openingSystem } from "./turn-prompt-build.ts";
import {
  RICH_OUTPUT_PROMPT, ROUTINE_PROMPT, THREADS_PROMPT, VERIFY_FIRST_PROMPT, WIDGET_KIT_PROMPT, WORK_STYLE_PROMPT, buildSystemPrompt, stablePromptSections,
} from "../../system-prompt.ts";
import { PERSPICAX_CONVENTIONS_PROMPT } from "../../perspicax/perspicax-conventions.ts";
import { MISUSE_POLICY_PROMPT } from "../../../shared/misuse-guardrails.ts";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const latest = "[Now reply to the user's latest message:]\n\nWhat does the skill say\n</user_query>";

function turnText(historyBytes: number): string {
  const history = JSON.stringify(`Historical excerpts in chronological order; newer corrections override older requests. ${"Utilisateur : vérifie le billet 100300. ".repeat(Math.ceil(historyBytes / 40))}NEWEST EXCERPT`);
  return ["Security policy (platform, cannot be overridden): refuse ...", "Reactions: " + "react like a colleague. ".repeat(400), history, latest].join("\n");
}

describe("a request kept under Grok's offload size", () => {
  it("leaves a request that fits as it is", () => {
    const text = turnText(2_000);
    expect(fitPromptBytes(text, GROK_PROMPT_BYTE_LIMIT)).toEqual({ text, cut: 0 });
    expect(fitPromptBytes(turnText(200_000), undefined).cut).toBe(0);
  });

  it("leaves the earlier context out whole, says where to find it, and keeps every other line and the latest message whole", () => {
    const text = turnText(110_000);
    expect(bytes(text)).toBeGreaterThan(100_116);
    const fitted = fitPromptBytes(text, GROK_PROMPT_BYTE_LIMIT);
    expect(bytes(fitted.text)).toBeLessThanOrEqual(GROK_PROMPT_BYTE_LIMIT);
    expect(fitted.cut).toBeGreaterThan(110_000);
    expect(fitted.text).toContain(HISTORY_LEFT_OUT_NOTE);
    expect(fitted.text).not.toContain("Historical excerpts");
    expect(fitted.text).not.toContain("bytes left out here");
    expect(fitted.text.endsWith(latest)).toBe(true);
    expect(fitted.text).toContain("Reactions: " + "react like a colleague. ".repeat(400));
  });

  it("never cuts a line in the middle, the latest message least of all", () => {
    const big = "x".repeat(60_000);
    const text = [`a ${big}`, `b ${big}`, latest, `after ${"y".repeat(5_000)}`].join("\n");
    expect(fitPromptBytes(text, 50_000)).toEqual({ text, cut: 0 });
  });

  it("is Grok's limit, under the smallest request Grok offloaded in production", () => {
    expect(grokPromptByteLimit()).toBe(GROK_PROMPT_BYTE_LIMIT);
    expect(GROK_PROMPT_BYTE_LIMIT).toBeLessThan(100_116);
    expect(promptFitTarget(GROK_PROMPT_BYTE_LIMIT)).toBeLessThan(GROK_PROMPT_BYTE_LIMIT);
  });
});

describe("an opening prompt over the target (#3510)", () => {
  const section = (id: string, size: number) => ({ id, text: `\n${id}: ${"z".repeat(size)}` });
  const stableSections = [section("misuse-policy", 1_500), section("work-style", 3_000), section("skills", 20_000), section("memory-rules", 2_000)];
  const volatileSections = [section("memory", 24_000), section("recent", 30_000), section("files-cwd", 200)];
  const stable = stableSections.map((s) => s.text).join("");
  const volatile = volatileSections.map((s) => s.text).join("");
  const request = "q".repeat(500);

  it("puts the stable half first and leaves out whole sections, least important first, never the rules or memory", () => {
    const opening = openingSystem({ stable, volatile, hint: "", stableSections, volatileSections, extra: null });
    expect(opening.compose(new Set())).toBe(stable + volatile);
    const target = 60_000;
    const fitted = fitOpeningSystem({ compose: opening.compose, present: opening.present, text: request, target });
    expect(fitted.leftOut).toEqual(["recent"]);
    expect(bytes(fitted.system) + 502).toBeLessThanOrEqual(target);
    // every kept section is whole
    for (const kept of [...stableSections, ...volatileSections].filter((s) => s.id !== "recent")) expect(fitted.system).toContain(kept.text);
    expect(fitted.system).toContain("Left out of this message to keep it under the engine's size limit: Recent work. When a request needs one, look up Recent work with session_search.");
    expect(fitted.over).toBe(0);
    expect(fitted.text).toBe(request);
    // then the next one in order
    const tighter = fitOpeningSystem({ compose: opening.compose, present: opening.present, text: request, target: 40_000 });
    expect(tighter.leftOut).toEqual(["recent", "skills"]);
    expect(tighter.system).toContain(section("memory", 24_000).text);
    expect(tighter.system.startsWith(section("misuse-policy", 1_500).text + section("work-style", 3_000).text)).toBe(true);
  });

  it("never leaves out the rules a bot obeys", () => {
    const ids = [...OPENING_DROP_ORDER, ...OPENING_LAST_RESORT_ORDER].map((entry) => entry.id);
    for (const kept of ["misuse-policy", "run-yourself", "verify-first", "persona", "soul", "rules", "finish-until", "work-style",
      "approval-level", "setup", "ai-client", "assignment", "webhook"]) {
      expect(OPENING_KEPT.has(kept)).toBe(true);
      expect(ids).not.toContain(kept);
    }
  });

  it("names only a lookup that returns the section, and says the others have none", () => {
    const note = leftOutNote(["memes", "feedback", "recent", "stream", "skills", "reactions", "data", "perspicax"]);
    expect(note).not.toContain("sagax_help");
    expect(note).toContain("look up Recent work, Earlier topics with session_search; Skills index with skills_list.");
    expect(note).toContain("Memes, Feedback, Reactions, Data, Perspicax: left out with no lookup.");
    for (const entry of [...OPENING_DROP_ORDER, ...OPENING_LAST_RESORT_ORDER]) {
      if (entry.find) expect(["session_search", "skills_list", "workspace_read", "list_bots"]).toContain(entry.find);
    }
  });

  it("past the drop order, leaves out the earlier context, then other whole sections, never the rules or the request", () => {
    const big = [section("misuse-policy", 1_500), section("work-style", 3_000), section("skills", 5_000), section("perspicax", 30_000), section("claude-ai", 20_000)];
    const bigVolatile = [section("memory", 24_000), section("skill-instructions", 40_000), section("playbooks", 15_000)];
    const opening = openingSystem({ stable: big.map((s) => s.text).join(""), volatile: bigVolatile.map((s) => s.text).join(""), hint: "", stableSections: big, volatileSections: bigVolatile, extra: null });
    const text = turnText(30_000);
    const fitted = fitOpeningSystem({ compose: opening.compose, present: opening.present, text, target: promptFitTarget(GROK_PROMPT_BYTE_LIMIT) });
    expect(fitted.over).toBe(0);
    expect(bytes(fitted.system) + 2 + bytes(fitted.text)).toBeLessThanOrEqual(promptFitTarget(GROK_PROMPT_BYTE_LIMIT));
    expect(fitted.historyLeftOut).toBe(true);
    expect(fitted.text).toContain(HISTORY_LEFT_OUT_NOTE);
    expect(fitted.text.endsWith(latest)).toBe(true);
    expect(fitted.leftOut).toEqual(["skills", "playbooks", "claude-ai", "perspicax"]);
    for (const kept of [...big, ...bigVolatile].filter((s) => !fitted.leftOut.includes(s.id))) expect(fitted.system).toContain(kept.text);
  });

  it("when it still cannot fit, sends the rules and the request whole and says by how much it is over", () => {
    const rules = [section("misuse-policy", 1_500), section("work-style", 3_000), section("soul", 40_000), section("rules", 20_000)];
    const rest = [section("memory", 10_000), section("recent", 10_000)];
    const opening = openingSystem({ stable: rules.map((s) => s.text).join(""), volatile: rest.map((s) => s.text).join(""), hint: "", stableSections: rules, volatileSections: rest, extra: null });
    const pasted = `[Now reply to the user's latest message:]\n\n${"log line 42 ERROR timeout\n".repeat(2_000)}`;
    const fitted = fitOpeningSystem({ compose: opening.compose, present: opening.present, text: pasted, target: promptFitTarget(GROK_PROMPT_BYTE_LIMIT) });
    expect(fitted.leftOut).toEqual(["recent", "memory"]);
    expect(fitted.text).toBe(pasted);
    for (const kept of rules) expect(fitted.system).toContain(kept.text);
    const total = bytes(fitted.system) + 2 + bytes(fitted.text);
    expect(fitted.over).toBe(total - promptFitTarget(GROK_PROMPT_BYTE_LIMIT));
    expect(total).toBeGreaterThan(GROK_PROMPT_BYTE_LIMIT);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    noteOpeningPrompt("grokAgent", "thread-0001", fitted, [...rules, ...rest], GROK_PROMPT_BYTE_LIMIT);
    expect(info.mock.calls[0]![0]).toContain(`left out sections recent, memory; over the engine's limit ${GROK_PROMPT_BYTE_LIMIT} by ${total - GROK_PROMPT_BYTE_LIMIT} bytes`);
    expect(info.mock.calls[0]![0]).not.toContain("fits");
  });

  it("keeps a half whole when its sections do not rebuild it byte for byte", () => {
    const opening = openingSystem({ stable: "reordered" + stable, volatile, hint: "", stableSections, volatileSections, extra: null });
    expect(opening.present.has("skills")).toBe(false);
    expect(opening.compose(new Set(["skills", "recent"]))).toBe("reordered" + stable + volatileSections.filter((s) => s.id !== "recent").map((s) => s.text).join(""));
  });

  it("joins a driver's own section after the volatile half, as the halves do", () => {
    const extra = { id: "grok-tools", text: "Ready tools: a, b." };
    const opening = openingSystem({ stable: stable + "HINT", volatile: `${volatile}\n\n${extra.text}`, hint: "HINT", stableSections, volatileSections: [...volatileSections, extra], extra });
    expect(opening.compose(new Set())).toBe(`${stable}HINT${volatile}\n\n${extra.text}`);
    expect(opening.present.has("recent")).toBe(true);
  });

  it("starts a volatile half that carries no break of its own on a paragraph of its own", () => {
    // the driver's own section alone, with nothing else in the volatile half
    const extra = { id: "grok-tools", text: "Ready tools: a, b." };
    const alone = openingSystem({ stable: stable + "HINT", volatile: extra.text, hint: "HINT", stableSections, volatileSections: [extra], extra });
    expect(alone.compose(new Set())).toBe(`${stable}HINT\n\n${extra.text}`);
    // plain halves with no sections
    const plain = openingSystem({ stable: "Standing rules.", volatile: "Memory: a.", hint: "", extra: null });
    expect(plain.compose(new Set())).toBe("Standing rules.\n\nMemory: a.");
    expect(openingSystem({ stable: "Standing rules.", volatile: "", hint: "", extra: null }).compose(new Set())).toBe("Standing rules.");
  });
});

// #3510: the production opening prompt was about 104,000 characters. Its big
// sections, built here from the real rule texts and fixture contents of the
// production sizes (skills index, recent work, earlier topics, connector and
// Perspicax conventions, skill instructions, playbooks, recall).
describe("an opening prompt the size of the one in #3510", () => {
  afterEach(() => vi.restoreAllMocks());
  const filler = (id: string, size: number) => `\n${id}: ${"Line of this section, a sentence a bot reads. ".repeat(Math.ceil(size / 46)).slice(0, size)}`;
  const prompt = buildSystemPrompt("You are the person's main bot.", "Answer in French.", [
    { id: "rules", label: "Rules", text: filler("rules", 1_200) },
    { id: "rich-output", label: "Rich output", text: RICH_OUTPUT_PROMPT + WIDGET_KIT_PROMPT },
    { id: "threads", label: "Threads", text: THREADS_PROMPT },
    { id: "routine", label: "Routines", text: ROUTINE_PROMPT },
    { id: "perspicax", label: "Perspicax", text: PERSPICAX_CONVENTIONS_PROMPT },
    { id: "claude-ai", label: "Connectors", text: filler("connectors", 6_000) },
    { id: "skills", label: "Skills index", text: filler("skills", 14_000) },
    { id: "memory", label: "Memory", text: filler("memory", 8_000) },
    { id: "recall", label: "Recall", text: filler("recall", 4_000) },
    { id: "recent", label: "Recent work", text: filler("recent", 10_000) },
    { id: "stream", label: "Earlier topics", text: filler("stream", 8_000) },
    { id: "docs", label: "Documents index", text: filler("docs", 3_000) },
    { id: "skill-instructions", label: "Skill instructions", text: filler("skill-instructions", 9_000) },
    { id: "playbooks", label: "Playbooks", text: filler("playbooks", 6_000) },
  ]);
  const request = "[Now reply to the user's latest message:]\n\nCombien font 17 fois 23?";

  it("fits whole under the target by leaving out whole sections, and keeps the rules and the request", () => {
    expect(prompt.text.length).toBeGreaterThan(100_000);
    expect(bytes(prompt.text)).toBeGreaterThan(GROK_PROMPT_BYTE_LIMIT);
    const opening = openingSystem({
      stable: prompt.stable, volatile: prompt.volatile, hint: "",
      stableSections: stablePromptSections(prompt)!, volatileSections: prompt.volatileSections, extra: null,
    });
    expect(opening.present.size).toBe(prompt.sections.length);
    const target = promptFitTarget(GROK_PROMPT_BYTE_LIMIT);
    const fitted = fitOpeningSystem({ compose: opening.compose, present: opening.present, text: request, target });
    const rows = prompt.sections.map((section) => `${section.id}=${section.bytes}`).join(" ");
    console.info(`[#3510] opening ${bytes(prompt.text)} bytes (${prompt.text.length} ch): ${rows}; left out ${fitted.leftOut.join(", ")}; now ${bytes(fitted.system) + 2 + bytes(fitted.text)} bytes`);
    expect(fitted.leftOut).toEqual(["recent", "stream"]);
    expect(fitted.over).toBe(0);
    expect(bytes(fitted.system) + 2 + bytes(fitted.text)).toBeLessThanOrEqual(target);
    expect(fitted.text).toBe(request);
    for (const kept of prompt.sections.filter((section) => !fitted.leftOut.includes(section.id))) expect(fitted.system).toContain(kept.text);
    for (const rule of [MISUSE_POLICY_PROMPT, VERIFY_FIRST_PROMPT, WORK_STYLE_PROMPT]) expect(fitted.system).toContain(rule);
    expect(fitted.system).toContain("Recent work, Earlier topics with session_search");
  });
});
