import { describe, expect, it } from "vitest";
import { newTurnLatency, noteTurnActivity, turnLatencyLine, turnLatencyParts } from "./turn-latency.ts";

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
      "[turn-latency] grok thread=800b207c path=pooled queue=99ms setup=21ms ttfa=979ms ttft=1150ms tools=1 total=2132ms prompt=1655ch full=no in=18225 cached=16000 stallGuard=10000ms ok",
    );
  });

  it("shows unknown stages as ? and drops an implausible received time", () => {
    const trace = newTurnLatency(5_000, 9_000);
    expect(trace.receivedAt).toBeUndefined();
    expect(turnLatencyLine("grok", "t1", trace, 5_500, "auth_required")).toBe(
      "[turn-latency] grok thread=t1 path=? queue=? setup=? ttfa=? ttft=? tools=0 total=500ms prompt=?ch full=? in=? cached=? auth_required",
    );
  });

  it("marks a stall retry", () => {
    const trace = newTurnLatency(0);
    trace.promptAt = 10;
    trace.stallMs = 10_000;
    trace.stallRetried = true;
    expect(turnLatencyLine("grok", "t", trace, 20_000, "ok")).toContain("stallGuard=10000ms retried ok");
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
});
