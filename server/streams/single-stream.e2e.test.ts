// Single stream (thread mode off) against the real server: a send from a
// client showing one conversation marks the thread a stream segment, "New
// topic" opens a fresh context whose turn carries a digest of the earlier
// topics, recall_topic reads one of them, and nothing confidential or hidden
// ever reaches the digest or the tool. A client showing threads sees none of
// it. docs/single-stream-orchestration.md.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

type Json = { [key: string]: any };

it("merges topics into one stream: digest, recall_topic, privacy exclusions, threads-on unchanged", async () => {
  const evidence = mkdtempSync(join(tmpdir(), "sagax-single-stream-"));
  const mcpDump = join(evidence, "mcp.json");
  const fixture = await launchVerificationServer({
    ...process.env,
    // 95e8f39e4 continues a turn ending on tools. Finish after the real MCP
    // calls so a continuation cannot overwrite their dump with no calls.
    FAKE_CLAUDE_TOOL_CALLS: "[]",
    FAKE_CLAUDE_MCP_DUMP: mcpDump,
    FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
      { server: "agents", tool: "recall_topic", arguments: {}, when: "RECALL_LIST" },
      { server: "agents", tool: "recall_topic", arguments: { topic_id: "$PROMPT_ID" }, when: "RECALL_READ" },
    ]),
  });
  const env = { SAGAX_URL: fixture.info.url };
  const api = async (method: string, path: string, body?: unknown): Promise<Json> => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as Json;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  const given = () => {
    // SAFETY: the fake CLI writes exactly this shape
    const sent = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt?: string; prompt?: unknown };
    return `${sent.systemPrompt ?? ""}\n${JSON.stringify(sent.prompt ?? "")}`;
  };
  const stored = (botId: string, threadId: string): Json =>
    JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8")).find((b: Json) => b.id === botId).tasks.find((t: Json) => t.threadId === threadId);
  try {
    // SAFETY: control-omb returns the created bot record under `bot`
    const { bot } = await runControlOmb(["new-bot", "--name", "Streamer"], { env }) as { bot: { id: string; activeTaskId: string } };
    const send = async (threadId: string, text: string, singleStream?: boolean) => {
      await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId, ...(singleStream === undefined ? {} : { singleStream }) });
      expect((await runControlOmb(["wait", "--bot", bot.id, "--task", threadId, "--timeout", "30"], { env }) as Json).status).toBe("settled");
    };
    const newThread = async (body: Json) => ((await api("POST", `/api/bots/${bot.id}/tasks`, body)).task as Json).threadId as string;
    const first = bot.activeTaskId;

    // Topic 1, from a client with threads off: the thread becomes a segment.
    await send(first, "Please audit the September invoices for ACME-42.", true);
    expect(stored(bot.id, first).streamSegment).toBe(true);
    // A segment's marks never reach a client.
    const wire = (await api("GET", "/api/bots?messages=0")).bots.find((b: Json) => b.id === bot.id);
    expect(JSON.stringify(wire)).not.toContain("streamSegment");
    expect(JSON.stringify(wire)).not.toContain("segmentDigest");

    // A confidential thread is never marked, even from a single-stream client.
    const confidential = await newThread({ confidential: true });
    await send(confidential, "CONFIDENTIAL-ZEBRA merger plan", true);
    expect(stored(bot.id, confidential).streamSegment).toBeUndefined();
    // 2026-10-26 (#1207): `hidden` from an older AI client is accepted and
    // ignored. No conversation is hidden any more: it is an ordinary thread,
    // so it is not excluded from the stream like a confidential one.
    const hidden = await newThread({ hidden: true });
    await send(hidden, "ASIDE-OTTER side work", true);
    expect(stored(bot.id, hidden).hidden).toBeFalsy();
    expect(stored(bot.id, hidden).streamSegment).toBe(true);

    // New topic: a fresh context, already a segment; the topic it closes gets
    // its digest written in the background.
    const second = await newThread({ stream: true });
    expect(second).not.toBe(first);
    expect(stored(bot.id, second).streamSegment).toBe(true);
    await expect.poll(() => typeof stored(bot.id, first).segmentDigest?.text, { timeout: 30_000 }).toBe("string");

    // Its first turn knows topic 1 from the digest, never the excluded ones,
    // and recall_topic lists only the stream's own topics.
    await send(second, "RECALL_LIST what did we settle earlier?", true);
    const prompt = given();
    expect(prompt).toContain("Earlier topics in this same conversation");
    expect(prompt).toContain(`id ${first}`);
    // Nothing confidential anywhere in the turn; the digest block itself
    // holds no confidential conversation.
    expect(prompt).not.toContain("CONFIDENTIAL-ZEBRA");
    const block = prompt.slice(prompt.indexOf("Earlier topics in this same conversation"), prompt.indexOf("[end of earlier topics]"));
    expect(block).not.toContain(`id ${confidential}`);
    const listed = JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ tool: string; ok: boolean; listed: boolean; text: string }> };
    expect(listed.calls[0]).toMatchObject({ tool: "recall_topic", ok: true, listed: true });
    expect(listed.calls[0]!.text).toContain(first);
    expect(listed.calls[0]!.text).not.toContain(confidential);

    // recall_topic reads topic 1 word for word, and refuses the confidential one.
    await send(second, `RECALL_READ PROMPT_ID=${first}`, true);
    const read = JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ ok: boolean; text: string }> };
    expect(read.calls[0]!.ok).toBe(true);
    expect(read.calls[0]!.text).toContain("ACME-42");
    await send(second, `RECALL_READ PROMPT_ID=${confidential}`, true);
    const refused = JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ ok: boolean; text: string }> };
    expect(refused.calls[0]!.ok).toBe(false);
    expect(refused.calls[0]!.text).not.toContain("CONFIDENTIAL-ZEBRA");

    // Threads on: the next send says so, the mark goes, the turn is as before.
    await send(second, "Plain thread-mode turn", false);
    expect(stored(bot.id, second).streamSegment).toBeUndefined();
    // The session was launched with the digest, and a live session keeps its
    // launch prompt (that is what the fake CLI dumps). Since the delta
    // context (a47c59ff2) the turn says the section is gone instead.
    expect(given()).toMatch(/The earlier \\?"stream\\?" context section no longer applies/);
    const plain = await newThread({});
    expect(stored(bot.id, plain).streamSegment).toBeUndefined();
    await send(plain, "Another plain turn");
    expect(given()).not.toContain("Earlier topics in this same conversation");

    // A topic made confidential later leaves the stream with its digest.
    await api("PATCH", `/api/bots/${bot.id}/tasks/${first}`, { confidential: true, confirmConfidential: true });
    expect(stored(bot.id, first).streamSegment).toBeUndefined();
    expect(stored(bot.id, first).segmentDigest).toBeUndefined();
    await send(second, "Back in the stream", true);
    expect(given()).not.toContain(`id ${first}`);
    expect(given()).not.toContain("ACME-42");
  } finally {
    await fixture.close();
    if (existsSync(evidence)) rmSync(evidence, { recursive: true, force: true });
  }
}, 240_000);
