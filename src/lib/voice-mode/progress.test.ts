import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { tIn } from "@/lib/i18n";
import {
  CallProgress,
  PROGRESS_FIRST_MS,
  PROGRESS_GAP_MS,
  PROGRESS_MAX_LINES,
  PROGRESS_QUIET_MS,
  progressKind,
  progressLocale,
  progressText,
  turnToolAuthor,
  turnTools,
  type ProgressInput,
  type ProgressTool,
} from "./progress";
import { looksFrench } from "./turns";

const idle = (now: number, tools: ProgressTool[], extra: Partial<ProgressInput> = {}): ProgressInput => ({
  now,
  thinking: true,
  botBusy: true,
  botSpeaking: false,
  awaitingAnswer: false,
  queued: false,
  tools,
  ...extra,
});

describe("progressKind: the category of a real tool, never its name", () => {
  it("maps each engine's built-in tools", () => {
    expect(progressKind("Bash")).toBe("command");
    expect(progressKind("shell")).toBe("command");
    expect(progressKind("exec_command")).toBe("command");
    expect(progressKind("Read")).toBe("check");
    expect(progressKind("Edit")).toBe("change");
    expect(progressKind("apply_patch")).toBe("change");
    expect(progressKind("Grep")).toBe("search");
    expect(progressKind("WebSearch")).toBe("web");
    expect(progressKind("web_fetch")).toBe("web");
    expect(progressKind("screenshot")).toBe("screen");
    expect(progressKind("ask_bot")).toBe("teammate");
  });

  it("reads a connector tool's verb, whatever its server prefix", () => {
    expect(progressKind("mcp__helpdesk__find_tickets")).toBe("search");
    expect(progressKind("mcp__claude_ai_Example__psa__get_ticket")).toBe("check");
    expect(progressKind("psa__update_ticket")).toBe("change");
    expect(progressKind("tickets.list")).toBe("check");
    expect(progressKind("createInvoice")).toBe("change");
    expect(progressKind("mcp__x__frobnicate")).toBe("work");
  });

  it("stays silent for tools whose own card or words are spoken", () => {
    expect(progressKind("end_call")).toBeNull();
    expect(progressKind("AskUserQuestion")).toBeNull();
    expect(progressKind("TodoWrite")).toBeNull();
    expect(progressKind("update_plan")).toBeNull();
    expect(progressKind("auto-approved: Bash")).toBeNull();
    expect(progressKind("error: timeout")).toBeNull();
    expect(progressKind("")).toBeNull();
  });
});

describe("CallProgress", () => {
  it("says nothing before a turn is sent", () => {
    const p = new CallProgress();
    expect(p.next(idle(10_000, [{ id: "a", name: "Bash" }]))).toBeNull();
  });

  it("the first line comes when a tool has run PROGRESS_FIRST_MS with nothing said: the quick first sentence on every engine", () => {
    const p = new CallProgress();
    p.turnSent(0);
    const tools = [{ id: "a", name: "mcp__psa__find_tickets" }];
    expect(p.next(idle(1_000, tools))).toBeNull();
    expect(p.next(idle(1_000 + PROGRESS_FIRST_MS - 1, tools))).toBeNull();
    expect(p.next(idle(1_000 + PROGRESS_FIRST_MS, tools))).toEqual({ kind: "search" });
  });

  it("a quick tool that finished gets no line; thinking with no tool gets none (the thinking cue covers it)", () => {
    const p = new CallProgress();
    p.turnSent(0);
    expect(p.next(idle(500, [{ id: "a", name: "Read" }]))).toBeNull();
    expect(p.next(idle(5_000, [{ id: "a", name: "Read", ok: true }]))).toBeNull();
    expect(p.next(idle(20_000, []))).toBeNull();
  });

  it("no quick first line once the bot said something (its own words or the opener)", () => {
    const p = new CallProgress();
    p.turnSent(0);
    p.heard(200);
    const tools = [{ id: "a", name: "Bash" }];
    p.next(idle(300, tools));
    expect(p.next(idle(300 + PROGRESS_FIRST_MS, tools))).toBeNull();
    // later, after a real silence, a line is due
    expect(p.next(idle(200 + PROGRESS_QUIET_MS, tools))).toEqual({ kind: "command" });
  });

  it("never while the bot speaks, the person talks, an answer is awaited, or something else waits to be said", () => {
    const tools = [{ id: "a", name: "Bash" }];
    for (const extra of [{ botSpeaking: true }, { thinking: false }, { awaitingAnswer: true }, { queued: true }, { botBusy: false }]) {
      const p = new CallProgress();
      p.turnSent(0);
      p.next(idle(0, tools));
      expect(p.next(idle(PROGRESS_FIRST_MS * 2, tools, extra)), JSON.stringify(extra)).toBeNull();
    }
  });

  it("speech resets the silence: a later line needs PROGRESS_QUIET_MS after the bot was last heard", () => {
    const p = new CallProgress();
    p.turnSent(0);
    const tools = [{ id: "a", name: "Bash" }];
    p.next(idle(0, tools));
    expect(p.next(idle(2_000, tools))).toEqual({ kind: "command" });
    p.next(idle(3_000, tools, { botSpeaking: true }));
    expect(p.next(idle(3_000 + PROGRESS_QUIET_MS - 1, tools))).toBeNull();
    expect(p.next(idle(3_000 + PROGRESS_GAP_MS, tools))).toEqual({ kind: "still" });
  });

  it("at most one line every PROGRESS_GAP_MS, and PROGRESS_MAX_LINES per turn", () => {
    const p = new CallProgress();
    p.turnSent(0);
    const tools = [{ id: "a", name: "Bash" }];
    p.next(idle(0, tools));
    const said: number[] = [];
    for (let now = PROGRESS_FIRST_MS; now < 200_000; now += 500) if (p.next(idle(now, tools))) said.push(now);
    expect(said).toHaveLength(PROGRESS_MAX_LINES);
    for (let i = 1; i < said.length; i++) expect(said[i]! - said[i - 1]!).toBeGreaterThanOrEqual(PROGRESS_GAP_MS);
  });

  it("a new kind of work gets its own line; the same work counts the finished steps once, then says it is still on it", () => {
    const p = new CallProgress();
    p.turnSent(0);
    let now = 0;
    const tick = (tools: ProgressTool[]) => {
      now += PROGRESS_GAP_MS;
      return p.next(idle(now, tools));
    };
    p.next(idle(0, [{ id: "a", name: "Read" }]));
    expect(tick([{ id: "a", name: "Read" }])).toEqual({ kind: "check" });
    expect(tick([{ id: "a", name: "Read", ok: true }, { id: "b", name: "Bash" }])).toEqual({ kind: "command" });
    expect(tick([{ id: "a", name: "Read", ok: true }, { id: "b", name: "Bash", ok: true }, { id: "c", name: "Bash" }]))
      .toEqual({ kind: "steps", count: 2 });
    expect(tick([{ id: "a", name: "Read", ok: true }, { id: "b", name: "Bash", ok: true }, { id: "c", name: "Bash" }]))
      .toEqual({ kind: "still" });
  });

  it("a barge-in stops the lines until the next turn is sent", () => {
    const p = new CallProgress();
    p.turnSent(0);
    const tools = [{ id: "a", name: "Bash" }];
    p.next(idle(0, tools));
    p.stop();
    expect(p.active).toBe(false);
    expect(p.next(idle(PROGRESS_FIRST_MS, tools))).toBeNull();
    p.turnSent(10_000);
    const next = [{ id: "b", name: "Bash" }];
    p.next(idle(10_000, next));
    expect(p.next(idle(10_000 + PROGRESS_FIRST_MS, next))).toEqual({ kind: "command" });
  });
});

describe("the words", () => {
  it("are the call language's own, and a language without them says nothing", () => {
    expect(progressText({ kind: "check" }, (key, params) => tIn("fr", key, params))).toBe("Je vérifie.");
    expect(progressText({ kind: "steps", count: 3 }, (key, params) => tIn("fr", key, params))).toBe("3 étapes faites, je continue.");
    expect(progressText({ kind: "check" }, (key, params) => tIn("en", key, params))).toBe("I'm checking.");
    expect(progressText({ kind: "work" }, (key, params) => tIn("pt-BR", key, params))).toBe("Estou cuidando disso.");
    expect(progressText({ kind: "check" }, (key, params) => tIn("it", key, params))).toBeNull();
    expect(progressText({ kind: "check" }, (key, params) => tIn("ja", key, params))).toBeNull();
  });

  it("never carry an identifier, whatever a pack says", () => {
    expect(progressText({ kind: "check" }, () => "Je vérifie 3f2a9c1e-7b4d-4e2a-9f10-0c5b8d7e6a21.")).toBe("Je vérifie.");
  });

  it("the call's chosen language wins; on auto, French words pick French, else the page's", () => {
    expect(progressLocale({ callLanguage: "de", lastUserText: "je regarde", pageLocale: "en", looksFrench })).toBe("de");
    expect(progressLocale({ callLanguage: "auto", lastUserText: "peux-tu vérifier le billet pour moi", pageLocale: "en", looksFrench })).toBe("fr");
    expect(progressLocale({ callLanguage: "auto", lastUserText: "can you check the ticket", pageLocale: "fr", looksFrench })).toBe("en");
    expect(progressLocale({ lastUserText: "kannst du das prüfen", pageLocale: "de", looksFrench })).toBe("de");
  });

  it("on auto, a locale the call already settled on is kept, so the spoken lines do not flip French and English", () => {
    // the person first spoke French: the call's lines settle on French, and a
    // later English-looking turn (or a short ambiguous one) does not flip them
    expect(progressLocale({ callLanguage: "auto", lastUserText: "can you check the ticket", pageLocale: "en", looksFrench, sticky: "fr" })).toBe("fr");
    expect(progressLocale({ callLanguage: "auto", lastUserText: "ok", pageLocale: "en", looksFrench, sticky: "fr" })).toBe("fr");
    // the other way: settled on English, a French turn does not flip it
    expect(progressLocale({ callLanguage: "auto", lastUserText: "peux-tu vérifier le billet", pageLocale: "fr", looksFrench, sticky: "en" })).toBe("en");
    // a language picked in the panel still wins over a sticky guess
    expect(progressLocale({ callLanguage: "fr", lastUserText: "can you check the ticket", pageLocale: "en", looksFrench, sticky: "en" })).toBe("fr");
  });
});

describe("turnTools", () => {
  it("keeps the activity rows after the person's last own line, not a parallel topic's", () => {
    const rows = [
      { id: "u0", role: "user", kind: "text" },
      { id: "t0", role: "bot", kind: "activity", tool: { name: "Read", ok: true } },
      { id: "u1", role: "user", kind: "text" },
      { id: "p", role: "user", kind: "text", parallelTask: { role: "request" } },
      { id: "t1", role: "bot", kind: "activity", tool: { name: "Bash", ok: true } },
      { id: "t2", role: "bot", kind: "activity", tool: { name: "Grep" }, parallelTask: { role: "card" } },
      { id: "t3", role: "bot", kind: "activity", tool: { name: "Grep" } },
    ];
    expect(turnTools(rows)).toEqual([{ id: "t1", name: "Bash", ok: true }, { id: "t3", name: "Grep" }]);
  });
});

describe("turnToolAuthor: a room turn may reach several bots", () => {
  it("names the one bot whose tools are all of this turn's rows", () => {
    const rows = [
      { id: "t0", role: "bot", kind: "activity", tool: { name: "Read", ok: true }, from: { botId: "b" } },
      { id: "u1", role: "user", kind: "text" },
      { id: "t1", role: "bot", kind: "activity", tool: { name: "Bash", ok: true }, from: { botId: "a" } },
      { id: "r1", role: "bot", kind: "text", from: { botId: "b" } },
      { id: "t2", role: "bot", kind: "activity", tool: { name: "Grep" }, from: { botId: "a" } },
    ];
    expect(turnToolAuthor(rows)).toBe("a");
  });

  it("names nobody when the turn's tools belong to several bots, none is named, or there are none", () => {
    const user = { id: "u1", role: "user", kind: "text" };
    expect(turnToolAuthor([
      user,
      { id: "t1", role: "bot", kind: "activity", tool: { name: "Bash" }, from: { botId: "a" } },
      { id: "t2", role: "bot", kind: "activity", tool: { name: "Grep" }, from: { botId: "b" } },
    ])).toBeNull();
    expect(turnToolAuthor([
      user,
      { id: "t1", role: "bot", kind: "activity", tool: { name: "Bash" }, from: { botId: "a" } },
      { id: "t2", role: "bot", kind: "activity", tool: { name: "Grep" } },
    ])).toBeNull();
    expect(turnToolAuthor([user])).toBeNull();
  });
});

describe("the older macOS call and the room call", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const calls = { CallView: read("../../components/CallView.tsx"), GroupCallView: read("../../components/GroupCallView.tsx") };

  it.each(Object.entries(calls))("%s never reads the server's chip narration: only the planner's line, in the call's words", (_name, source) => {
    expect(source).not.toMatch(/tool\??\.spoken/);
    expect(source).toContain("tools: turnTools(messagesRef.current),");
    expect(source).toContain("const text = progressText(line, (key, params) => tIn(locale, key, params));");
    expect(source).toContain("progress.current.turnSent(Date.now());");
    expect(source).toContain("progress.current.stop();");
  });

  it("the room says a line in a member's voice only when the turn's tools are all that member's", () => {
    expect(calls.GroupCallView).toContain("const author = turnToolAuthor(messagesRef.current);");
    expect(calls.GroupCallView).toContain("queued: queuedJobs.current.size > 0,");
  });
});
