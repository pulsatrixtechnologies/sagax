import { describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { chatToolsFingerprint, createWarmToolSessions, withWarmTokens } from "./openai-chat-tools-warm.ts";
import { commsTokenFile } from "./spawn-contract.ts";

describe("openai-chat tools warm cache", () => {
  it("writes the comms token file so a kept agents process can change turns", () => {
    const turn = {
      threadId: `thread-warm-${process.pid}-${Date.now()}`,
      botId: "bot-1",
      text: "hi",
      integrations: {
        agents: {
          command: "node",
          args: ["agents.js"],
          env: { SAGAX_COMMS_TOKEN: "token-a", SAGAX_TURN_DEPTH: "0", SAGAX_BOT_ID: "bot-1" },
        },
      },
    };
    const warmed = withWarmTokens(turn as never, turn.threadId);
    const file = warmed.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE;
    expect(file).toBe(commsTokenFile(turn.threadId, turn.botId));
    expect(readFileSync(file!, "utf8")).toBe("token-a");
    const again = withWarmTokens({
      ...turn,
      integrations: {
        agents: {
          ...turn.integrations.agents,
          env: { ...turn.integrations.agents.env, SAGAX_COMMS_TOKEN: "token-b", SAGAX_TURN_DEPTH: "0" },
        },
      },
    } as never, turn.threadId);
    expect(again.integrations!.agents!.env.SAGAX_COMMS_TOKEN_FILE).toBe(file);
    expect(readFileSync(file!, "utf8")).toBe("token-b");
    // Fingerprint ignores the token value when the file is present.
    const fpA = chatToolsFingerprint(warmed.integrations, { computerUse: true, toolLimit: 128 });
    const fpB = chatToolsFingerprint(again.integrations, { computerUse: true, toolLimit: 128 });
    expect(fpA).toBe(fpB);
    rmSync(dirname(file!), { recursive: true, force: true });
  });

  it("reuses a session for the same fingerprint and drops it on mismatch", async () => {
    const cache = createWarmToolSessions();
    const closed: string[] = [];
    const session = {
      definitions: [],
      skipped: [],
      validate() {},
      view() { return { title: "t", input: {}, ask: false }; },
      async execute() { return { text: "ok", ok: true }; },
      async close() { closed.push("close"); },
    };
    cache.keep("thread-1", session as never, "fp-a");
    expect(cache.get("thread-1", "fp-a")).toBe(session);
    expect(cache.get("thread-1", "fp-b")).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toContain("close");
    await cache.releaseAll();
  });

  it("remounts after failed discovery closes a cached tool session", async () => {
    const cache = createWarmToolSessions();
    let closed = false;
    const session = {
      definitions: [], skipped: [],
      validate() {},
      view() { return { title: "t", input: {}, ask: false }; },
      async execute() { return { text: "write completed", ok: true }; },
      isClosed() { return closed; },
      async close() { closed = true; },
    };
    cache.keep("thread-1", session, "fp");
    expect(cache.get("thread-1", "fp")).toBe(session);
    await session.close();
    // finally must not keep a session closed by a post-write refresh either.
    cache.keep("thread-1", session, "fp");
    expect(cache.get("thread-1", "fp")).toBeUndefined();
    const replacement = { ...session, isClosed: () => false };
    cache.keep("thread-1", replacement, "fp");
    expect(cache.get("thread-1", "fp")).toBe(replacement);
    await cache.releaseAll();
  });

  it("retries the account MCP next turn when its initial mount was temporarily unavailable", async () => {
    const cache = createWarmToolSessions();
    let closed = false;
    const session = {
      definitions: [], skipped: [{server:"perspicax",reason:"temporarily unavailable"}],
      validate() {},
      view() { return { title: "t", input: {}, ask: false }; },
      async execute() { return { text: "ok", ok: true }; },
      async close() { closed = true; },
    };
    cache.keep("thread-1", session, "fp");
    expect(cache.get("thread-1", "fp")).toBeUndefined();
    expect(closed).toBe(true);
    const recovered = { ...session, skipped: [] };
    cache.keep("thread-1", recovered, "fp");
    expect(cache.get("thread-1", "fp")).toBe(recovered);
    await cache.releaseAll();
  });
});
