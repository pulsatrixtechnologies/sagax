import { describe, expect, it } from "vitest";
import { contractFieldsChanged, newTurnLatency, engineGoneWhy, noteEngineClosed, noteEngineExited, noteEngineOpened, type TurnToolWait, noteTurnActivity, noteTurnShown, takeEngineClosed, turnFirstWords, turnLatencyLine, turnLatencyParts, turnToolsGap, turnToolsSlow } from "./turn-latency.ts";

describe("turn latency line", () => {
  it("logs every stage of a pooled one-tool turn, ids and numbers only", () => {
    const trace = newTurnLatency(1_000, 901);
    trace.path = "pooled";
    noteTurnActivity(trace, "agent_message_chunk", 1_010); // before the prompt: ignored
    trace.promptAt = 1_021;
    trace.promptChars = 1655;
    trace.full = false;
    noteTurnActivity(trace, "agent_thought_chunk", 2_000);
    noteTurnActivity(trace, "agent_message_chunk", 2_171);
    noteTurnActivity(trace, "tool_call", 2_290);
    noteTurnActivity(trace, "tool_call_update", 2_300);
    noteTurnActivity(trace, "agent_message_chunk", 3_000);
    trace.inputTokens = 18_225;
    trace.cachedTokens = 16_000;
    trace.stallMs = 10_000;
    expect(turnLatencyLine("grok", "800b207c-1a77-43fc-897a-2964d1c2d32f", trace, 3_132, "ok")).toBe(
      "[turn-latency] grok thread=800b207c path=pooled queue=99ms setup=21ms ttfa=979ms ttft=1150ms tools=1 total=2132ms prompt=1655ch full=no in=18225 cached=16000 firstWords=think:171 ttfc=1269ms stallGuard=10000ms ok",
    );
  });

  it("shows unknown stages as ? and drops an implausible received time", () => {
    const trace = newTurnLatency(5_000, 9_000);
    expect(trace.receivedAt).toBeUndefined();
    expect(turnLatencyLine("grok", "t1", trace, 5_500, "auth_required")).toBe(
      "[turn-latency] grok thread=t1 path=? queue=? setup=? ttfa=? ttft=? tools=0 total=500ms prompt=?ch full=? in=? cached=? auth_required",
    );
  });

  it("splits the time after the prompt into the tools' time and the rest, and counts the failed calls (#4394)", () => {
    // A browser task: 41 calls in 10 minutes. The line must say whether the
    // time went to the tools (the browser) or to the engine and its model.
    const trace = newTurnLatency(0);
    trace.promptAt = 1_000;
    noteTurnActivity(trace, "tool_call", 2_000, { toolCallId: "a" });
    noteTurnActivity(trace, "tool_call", 2_500, { toolCallId: "b" }); // beside a: counted once
    noteTurnActivity(trace, "tool_call_update", 2_600, { toolCallId: "a", status: "in_progress" });
    noteTurnActivity(trace, "tool_call_update", 3_000, { toolCallId: "a", status: "completed" });
    noteTurnActivity(trace, "tool_call_update", 4_000, { toolCallId: "b", status: "failed" });
    noteTurnActivity(trace, "tool_call", 6_000, { toolCallId: "c" });
    noteTurnActivity(trace, "tool_call_update", 6_000, { toolCallId: "c", status: "failed" });
    noteTurnActivity(trace, "tool_call", 9_000, { toolCallId: "d" }); // still running at the end
    const line = turnLatencyLine("grok", "t", trace, 10_000, "ok");
    expect(line).toContain(" toolTime=3000ms toolsFailed=2 modelTime=6000ms ");
    // A turn with no tool call keeps its line as it was.
    const plain = newTurnLatency(0);
    plain.promptAt = 10;
    expect(turnLatencyLine("grok", "t", plain, 500, "ok")).not.toMatch(/toolTime|toolsFailed|modelTime/);
  });

  it("marks a stall retry", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 10;
    trace.stallMs = 10_000;
    trace.stallRetried = true;
    expect(turnLatencyLine("grok", "t", trace, 20_000, "ok")).toContain("stallGuard=10000ms retried ok");
  });

  // #3679: compact named everything from the warm join to the fold check;
  // the admission, the connectors plan and the engines' read close their own
  it("names the admission, the connectors plan and the engines' read apart from the fold check", () => {
    const trace = newTurnLatency(10_000, 4_000);
    trace.promptAt = 5_000;
    const marks: Array<[string, number]> = [
      ["start", 4_010],
      ["prewarm-joined", 4_010],
      ["admitted", 4_150],
      ["connectors-planned", 4_160],
      ["engines-read", 4_200],
      ["compacted", 4_230],
      ["context-selected", 4_250],
    ];
    expect(turnLatencyParts(trace, marks).queueBy).toBe("admit:150,engines:40,compact:30,context:20,connector:10,dispatch:5750");
  });

  // #4215: the self-knowledge lookup before the engine is its own part, and
  // the main thread's busy time during the queue is named when it matters
  it("names the self-knowledge lookup apart from admission and the main thread's busy time", () => {
    const trace = newTurnLatency(10_000, 4_000);
    trace.promptAt = 5_000;
    const marks: Array<[string, number]> = [
      ["start", 4_010],
      ["help-start", 4_060],
      ["help-prefetched", 4_170],
      ["admitted", 4_200],
    ];
    expect(turnLatencyParts(trace, marks).queueBy).toBe("admit:90,help:110,dispatch:5800");
    trace.queueBusyMs = 120;
    expect(turnLatencyLine("grok", "t", trace, 6_000, "ok")).not.toContain("queueBusy=");
    trace.queueBusyMs = 640.4;
    expect(turnLatencyLine("grok", "t", trace, 6_000, "ok")).toContain(" queueBusy=640ms ");
  });

  // #3598: the line counts the process starts of the turn's wait and their
  // total synchronous time; nothing when there was none
  it("counts the process starts of the turn's queue and setup", () => {
    const trace = newTurnLatency(10_000, 4_000);
    trace.promptAt = 11_000;
    expect(turnLatencyLine("grok", "t", trace, 12_000, "ok")).not.toContain("starts=");
    trace.starts = { count: 0, ms: 0 };
    expect(turnLatencyLine("grok", "t", trace, 12_000, "ok")).not.toContain("starts=");
    trace.starts = { count: 3, ms: 212.6 };
    expect(turnLatencyLine("grok", "t", trace, 12_000, "ok")).toContain(" starts=3:213ms ");
  });

  // #3561: one production line tells which part of queue and setup is slow
  it("names the parts of queue and setup on the same line, existing fields unchanged", () => {
    const trace = newTurnLatency(10_000, 4_000);
    trace.path = "spawn";
    trace.promptAt = 15_000;
    const marks: Array<[string, number]> = [
      ["start", 4_010],
      ["prewarm-joined", 4_010],
      ["oauth-refreshed", 4_500], // beside the chain: closes no part
      ["compacted", 4_060],
      ["context-selected", 4_100],
      ["soul-drift", 4_110],
      ["skills-selected", 4_120],
      ["mcp-mounted", 6_120],
      ["integrations", 7_120],
      ["prompt-start", 7_620],
      ["prompt-sections", 7_700],
      ["state.prompt-built", 7_720],
      ["recall", 9_720],
      ["access", 9_800],
      ["command", 9_810],
      ["send", 9_900],
      ["acp-prepared", 10_050],
      ["acp-handshake", 11_050],
      ["acp-session-new", 11_300],
      ["acp-model", 11_300],
      ["acp-mcp-settled", 14_800],
      ["acp-session-configured", 14_900],
    ];
    const line = turnLatencyLine("grokAgent", "800b207c-1a77", trace, 20_000, "ok", marks);
    expect(line).toBe(
      "[turn-latency] grokAgent thread=800b207c path=spawn queue=6000ms setup=5000ms ttfa=? ttft=? tools=0 total=10000ms prompt=?ch full=? in=? cached=? " +
      "queueBy=admit:10,compact:50,context:60,mcp:2000,connector:1000,place:500,prompt:100,recall:2000,access:90,send:90,dispatch:100 " +
      "setupBy=prepare:50,init:1000,session:250,model:100,tools:3500,prompt:100 ok",
    );
    // the parts add up to the stage they break down
    const sum = (field: string | undefined) => (field ?? "").split(",").reduce((total, part) => total + Number(part.split(":")[1]), 0);
    const parts = turnLatencyParts(trace, marks);
    expect(sum(parts.queueBy)).toBe(6_000);
    expect(sum(parts.setupBy)).toBe(5_000);
  });

  it("splits place into the tool mounts, the plugin check, the checkpoint, the browser and the rest (#3619)", () => {
    const trace = newTurnLatency(10_000, 4_000);
    const marks: Array<[string, number]> = [
      ["integrations", 4_000],
      ["place-workspace", 4_020],
      ["mounts-ready", 4_320],
      ["plugins-synced", 7_320],
      ["place-computer", 7_340],
      ["checkpoint-taken", 7_540],
      ["place-browser", 7_550],
      ["browser-ready", 7_950],
      ["prompt-start", 8_000],
      ["send", 10_000],
    ];
    expect(turnLatencyParts(trace, marks).queueBy).toBe("place:100,mounts:300,plugins:3000,checkpoint:200,browser:400,send:2000");
    // a part that took 0 ms is not printed: no plugin copy, no checkpoint
    const quiet: Array<[string, number]> = [
      ["integrations", 4_000],
      ["place-workspace", 4_020],
      ["mounts-ready", 4_320],
      ["plugins-synced", 4_320],
      ["prompt-start", 4_400],
      ["send", 10_000],
    ];
    expect(turnLatencyParts(trace, quiet).queueBy).toBe("place:100,mounts:300,send:5600");
  });

  it("leaves queueBy out when the message time is unknown and ignores another turn's marks", () => {
    const trace = newTurnLatency(10_000);
    trace.promptAt = 10_400;
    const parts = turnLatencyParts(trace, [["send", 2_000], ["acp-session-loaded", 10_100]]);
    expect(parts).toEqual({ setupBy: "session:100,prompt:300" });
  });

  it("names the parts of a tool list that took more than 250 ms, and only those (#3623)", () => {
    const trace = newTurnLatency(1_000);
    trace.path = "spawn";
    trace.promptAt = 4_500;
    trace.toolWait = {
      waitedMs: 2_900, mounts: [], resolvedMs: 2_898,
      served: [
        ["perspicax", 361, 445, [["list", 80]]],
        ["connector", 570, 2_511, [["env", 12], ["open", 410], ["hello", 230], ["list", 980], ["kb", 85]]],
        ["messages", 676, 682],
      ],
    };
    expect(turnToolsSlow(trace.toolWait)).toBe("connector:env:12,open:410,hello:230,list:980,kb:85");
    const line = turnLatencyLine("grok", "800b207c-0000", trace, 9_000, "ok");
    expect(line).toContain("toolsServed=perspicax:361-445,connector:570-2511,messages:676-682 toolsSlow=connector:env:12,open:410,hello:230,list:980,kb:85 toolsGap=first:361,after:387 ok");
    // a fast list (served from the kept copy) prints no parts
    trace.toolWait.served = [["connector", 570, 600, [["env", 3]]]];
    expect(turnToolsSlow(trace.toolWait)).toBeUndefined();
    expect(turnLatencyLine("grok", "800b207c-0000", trace, 9_000, "ok")).not.toContain("toolsSlow");
  });

  it("names the time before the first request and after the last answer, each only over 250 ms (#3623)", () => {
    // a production turn of 2026-11-11: no list asked before 2510 ms
    const late: TurnToolWait = {
      waitedMs: 3_956, mounts: [], resolvedMs: 3_950,
      served: [["sagax-computer", 2_510, 2_511], ["connector", 3_050, 3_360], ["perspicax", 3_187, 3_357]],
    };
    expect(turnToolsGap(late)).toBe("first:2510,after:590");
    // another: every list answered by 735 ms, resolved at 3542
    const after: TurnToolWait = {
      waitedMs: 3_542, mounts: [], resolvedMs: 3_542,
      served: [["connector", 230, 621], ["perspicax", 662, 735]],
    };
    expect(turnToolsGap(after)).toBe("after:2807");
    // a mount the engine saw ready later (agents answers its own list) closes the gap
    expect(turnToolsGap({ ...after, mounts: [["agents", 3_400]] })).toBeUndefined();
    const trace = newTurnLatency(1_000);
    trace.path = "spawn";
    trace.promptAt = 5_000;
    trace.toolWait = late;
    expect(turnLatencyLine("grok", "800b207c-0000", trace, 9_000, "ok")).toContain(" toolsGap=first:2510,after:590 ok");
    // the server's own main thread busy through the gap: Sagax's share of it
    expect(turnToolsGap({ ...late, busyMs: 2_300 })).toBe("first:2510,after:590,busy:2300");
    expect(turnToolsGap({ ...late, busyMs: 120 })).toBe("first:2510,after:590");
    // a busy thread without a gap says nothing
    expect(turnToolsGap({ waitedMs: 400, mounts: [], resolvedMs: 390, served: [["data", 120, 300]], busyMs: 380 })).toBeUndefined();
    // a quick wait prints nothing
    trace.toolWait = { waitedMs: 400, mounts: [], resolvedMs: 390, served: [["data", 120, 300]] };
    expect(turnLatencyLine("grok", "800b207c-0000", trace, 9_000, "ok")).not.toContain("toolsGap");
  });
});

// #4394: ordinary turns took 22 to 27 s to their first words on a hosted
// server, path=spawn every time, and the line could not say whether those
// seconds were the model's or the engine's, nor why no warm engine took them.
// #4456: first text after 16 to 46 s; the line must say where it went: the
// first model token (ttfa), the first tool call (ttfc), the first text the
// person saw from their message (shown) and what of the opening block rode
// a follow-up (sent), beside the cached input tokens
describe("the split of the time to the first text shown (#4456)", () => {
  it("names the first tool call, the first text shown from the person's message and the sections sent", () => {
    const trace = newTurnLatency(2_000, 1_000);
    trace.path = "load";
    trace.promptAt = 2_500;
    trace.full = false;
    trace.sent = ["recent", "memory"];
    trace.inputTokens = 60_000;
    trace.cachedTokens = 58_000;
    noteTurnActivity(trace, "agent_thought_chunk", 3_000);
    noteTurnActivity(trace, "tool_call", 3_400, { toolCallId: "a", status: "pending" });
    noteTurnActivity(trace, "tool_call_update", 9_000, { toolCallId: "a", status: "completed" });
    noteTurnActivity(trace, "agent_message_chunk", 9_200);
    noteTurnShown(trace, 9_210);
    noteTurnShown(trace, 9_900); // only the first counts
    const line = turnLatencyLine("grok", "t", trace, 10_000, "ok");
    expect(line).toContain(" ttfa=500ms ttft=6700ms tools=1 ");
    expect(line).toContain(" in=60000 cached=58000 ");
    expect(line).toContain(" ttfc=900ms shown=8210ms sent=recent,memory ok");
  });

  it("says nothing of a tool, a shown text or sections a turn did not have", () => {
    const trace = newTurnLatency(0);
    noteTurnShown(trace, 50); // before the prompt: ignored
    trace.promptAt = 100;
    trace.full = true;
    trace.sent = ["soul"]; // a full block is never named section by section
    noteTurnActivity(trace, "agent_message_chunk", 900);
    const line = turnLatencyLine("grok", "t", trace, 1_000, "ok");
    expect(line).not.toMatch(/ ttfc=| shown=| sent=/);
  });
});

describe("what the line says of a spawn and of the time to the first words (#4394)", () => {
  it("splits the time to the first answer text into the first update's wait, reasoning, a tool and quiet gaps", () => {
    const trace = newTurnLatency(0);
    trace.path = "pooled";
    trace.promptAt = 1_000;
    noteTurnActivity(trace, "agent_thought_chunk", 2_700); // first update after 1.7 s
    noteTurnActivity(trace, "agent_thought_chunk", 3_200);
    noteTurnActivity(trace, "agent_thought_chunk", 3_900);
    noteTurnActivity(trace, "tool_call", 4_000, { toolCallId: "a", status: "pending" });
    noteTurnActivity(trace, "tool_call_update", 4_400, { toolCallId: "a", status: "completed" });
    noteTurnActivity(trace, "agent_thought_chunk", 4_500);
    // 20 s with nothing streamed: neither reasoning seen nor a tool
    noteTurnActivity(trace, "agent_message_chunk", 24_500);
    noteTurnActivity(trace, "agent_thought_chunk", 30_000); // after the first words: not counted
    expect(trace.firstTextAt).toBe(24_500);
    expect(turnFirstWords(trace)).toBe("think:1300,tool:500,quiet:20000");
    expect(turnLatencyLine("grok", "t", trace, 31_000, "ok")).toContain(" ttfa=1700ms ttft=23500ms tools=1 ");
    expect(turnLatencyLine("grok", "t", trace, 31_000, "ok")).toContain(" firstWords=think:1300,tool:500,quiet:20000 ttfc=3000ms ok");
  });

  it("counts a tool that runs several seconds without a progress update as tool, not quiet", () => {
    const trace = newTurnLatency(0);
    trace.path = "pooled";
    trace.promptAt = 1_000;
    noteTurnActivity(trace, "agent_thought_chunk", 2_000);
    noteTurnActivity(trace, "tool_call", 2_100, { toolCallId: "web", status: "in_progress" });
    // the tool runs 6 s with no update, then ends
    noteTurnActivity(trace, "tool_call_update", 8_100, { toolCallId: "web", status: "completed" });
    // the model is quiet 3 s after it before its words: that is quiet
    noteTurnActivity(trace, "agent_message_chunk", 11_100);
    expect(turnFirstWords(trace)).toBe("think:100,tool:6000,quiet:3000");
  });

  it("keeps a tool open until its own update says it ended, also when two run at once", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 0;
    noteTurnActivity(trace, "tool_call", 1_000, { toolCallId: "a", status: "pending" });
    noteTurnActivity(trace, "tool_call", 1_100, { toolCallId: "b", status: "pending" });
    noteTurnActivity(trace, "tool_call_update", 4_100, { toolCallId: "a", status: "in_progress" });
    noteTurnActivity(trace, "tool_call_update", 6_100, { toolCallId: "a", status: "completed" });
    noteTurnActivity(trace, "tool_call_update", 9_100, { toolCallId: "b", status: "failed" });
    noteTurnActivity(trace, "agent_message_chunk", 9_200);
    expect(turnFirstWords(trace)).toBe("tool:8200");
  });

  it("a tool reported already ended opens nothing", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 0;
    noteTurnActivity(trace, "tool_call", 500, { toolCallId: "a", status: "completed" });
    noteTurnActivity(trace, "agent_message_chunk", 5_500);
    expect(turnFirstWords(trace)).toBe("quiet:5000");
  });

  it("says nothing of the first words before there are any", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 10;
    noteTurnActivity(trace, "agent_thought_chunk", 20);
    expect(turnFirstWords(trace)).toBeUndefined();
    expect(turnLatencyLine("grok", "t", trace, 50, "failed")).not.toContain("firstWords=");
  });

  it("says why a turn started an engine, on a spawn only", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 10;
    trace.spawnWhy = "closed:idle";
    trace.path = "spawn";
    expect(turnLatencyLine("grok", "t", trace, 50, "ok")).toContain(" spawnWhy=closed:idle ");
    trace.path = "pooled";
    expect(turnLatencyLine("grok", "t", trace, 50, "ok")).not.toContain("spawnWhy=");
  });

  it("remembers why a conversation's engine closed, in a few plain words, once", () => {
    noteEngineClosed("thread-a", "warm budget");
    noteEngineClosed("thread-b", "Context full!");
    expect(takeEngineClosed("thread-a")).toBe("closed:warm-budget");
    expect(takeEngineClosed("thread-a")).toBeUndefined();
    expect(takeEngineClosed("thread-b")).toBe("closed:context-full");
    // an end of its own: the exit code, else the signal
    noteEngineExited("thread-c", 0);
    expect(takeEngineClosed("thread-c")).toBe("exited:0");
    noteEngineExited("thread-c", null, "SIGKILL");
    expect(takeEngineClosed("thread-c")).toBe("exited:sigkill");
  });

  it("tells a first start from a process kept under another engine (#4394)", () => {
    expect(engineGoneWhy("thread-d", "engine-a")).toBe("first");
    noteEngineOpened("thread-d", "engine-a");
    expect(engineGoneWhy("thread-d", "engine-b")).toBe("instance");
    noteEngineClosed("thread-d", "idle");
    expect(engineGoneWhy("thread-d", "engine-a")).toBe("closed:idle");
  });

  it("says why the whole opening block rode the prompt (#4394)", () => {
    const line = turnLatencyLine("grokAgent", "thread-e", { start: 0, promptAt: 10, path: "spawn", spawnWhy: "exited:0", full: true, fullWhy: "new:load-failed", tools: 0 }, 20, "ok");
    expect(line).toContain(" spawnWhy=exited:0 fullWhy=new:load-failed ");
    expect(turnLatencyLine("grokAgent", "thread-e", { start: 0, promptAt: 10, path: "pooled", full: false, fullWhy: "anchor", tools: 0 }, 20, "ok")).not.toContain("fullWhy=");
  });

  it("names the parts of a spawn contract that changed", () => {
    const key = (cwd: string, env: string) => JSON.stringify(["person", "bot", "grok", [], ["agent"], cwd, false, env, null, null, null]);
    expect(contractFieldsChanged(key("/w", "e1"), key("/w", "e2"))).toBe("envFingerprint");
    expect(contractFieldsChanged(key("/w", "e1"), key("/x", "e2"))).toBe("cwd+envFingerprint");
    expect(contractFieldsChanged("not json", key("/w", "e1"))).toBe("?");
  });
});
