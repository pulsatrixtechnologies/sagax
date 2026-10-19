import { describe, expect, it } from "vitest";
import { MEMORY_MAX_LINES, readMemoryFile, readMemoryTopic, updateMemory, writeMemoryFile } from "../workspace.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";

function context(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    botId: "bot-voice",
    threadId: "thread-voice",
    depth: 0,
    externalRuntime: false,
    sharedComputers: false,
    client: {
      api: async () => ({}),
      apiResponse: async () => ({ ok: true, status: 200, body: {} }),
    },
    ...overrides,
  };
}

describe("act", () => {
  it("refuses an external runtime before it calls the harness", async () => {
    let called = false;
    const result = await callTool("act", { method: "GET", path: "/api/bots" }, context({
      externalRuntime: true,
      client: {
        api: async () => ({}),
        apiResponse: async () => {
          called = true;
          return { ok: true, status: 200, body: {} };
        },
      },
    }));
    expect(result).toEqual({ text: "Unknown tool: act", isError: true });
    expect(called).toBe(false);
  });

  it("returns a held write as text and a refused route as an error", async () => {
    const held = await callTool("act", { method: "POST", path: "/api/bots" }, context({
      client: {
        api: async () => ({}),
        apiResponse: async () => ({
          ok: true,
          status: 200,
          body: { held: true, text: "Approval needed. POST /api/bots A card is waiting in the conversation. Do not retry this action." },
        }),
      },
    }));
    expect(held.isError).toBeFalsy();
    expect(held.text).toContain("Approval needed.");
    expect(held.text).toContain("Do not retry");

    const refused = await callTool("act", { method: "POST", path: "/api/admin/settings" }, context({
      client: {
        api: async () => ({}),
        apiResponse: async () => ({ ok: false, status: 403, body: { error: "This person cannot call that route." } }),
      },
    }));
    expect(refused).toEqual({ text: "This person cannot call that route.", isError: true });
  });
});

describe("send_voice_note", () => {
  it("refuses a missing or blank note with the shape a retry needs", async () => {
    for (const args of [{}, { text: "" }, { text: "   " }]) {
      const result = await callTool("send_voice_note", args, context());
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).toContain("send_voice_note needs text");
    }
  });

  it("refuses a note over 1000 characters and reports the length", async () => {
    const result = await callTool("send_voice_note", { text: "a".repeat(1001) }, context());
    expect(result.isError).toBe(true);
    expect(result.text).toContain("1000 characters");
    expect(result.text).toContain("1001");
  });

  it("posts the trimmed verbatim note to the harness route", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("send_voice_note", { text: "  Ship it.  " }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("Voice note recorded");
    expect(calls).toEqual([
      { path: "/api/internal/voice-note", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice", text: "Ship it." } },
    ]);
  });

  it("surfaces missing voice setup as a tool error, never a thrown turn", async () => {
    const result = await callTool("send_voice_note", { text: "Hello" }, context({
      client: {
        api: async () => { throw new Error("Pick a voice in the agent profile."); },
        apiResponse: async () => ({ ok: false, status: 409, body: { error: "Pick a voice in the agent profile." } }),
      },
    }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Pick a voice in the agent profile.");
  });
});

describe("create_bot", () => {
  it("passes a working folder through to the internal create route", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("create_bot", { name: "Scout", role: "Ops", instructions: "Work.", cwd: "  /tmp/ops  " }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { id: "b1", name: "Scout", section: "Work" };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      { path: "/api/internal/create-bot", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice", name: "Scout", role: "Ops", instructions: "Work.", cwd: "/tmp/ops" } },
    ]);
  });
});

describe("add_mcp_server", () => {
  it("posts the arguments and tells the model the server was saved off", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const result = await callTool("add_mcp_server", {
      name: "notes",
      command: "npx",
      args: ["-y", "notes-mcp"],
      env: { NOTES_TOKEN: "super-secret" },
    }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { name: "notes", enabled: false, transport: "command", target: "npx", envKeys: ["NOTES_TOKEN"], headerKeys: [] };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain("Saved MCP server “notes” (command npx) switched off.");
    expect(result.text).toContain("MCP server settings");
    expect(result.text).toContain("runs that command on their computer");
    expect(result.text).toContain("NOTES_TOKEN");
    expect(result.text).not.toContain("super-secret");
    expect(calls).toEqual([{
      path: "/api/internal/mcp-servers",
      body: { name: "notes", command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "super-secret" } },
    }]);
  });

  it("returns the route's error sentence without echoing a secret", async () => {
    const result = await callTool("add_mcp_server", {
      name: "docs",
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer hidden" },
      enabled: true,
    }, context({
      client: {
        api: async () => { throw new Error("A bot cannot change the on/off switch. The server is saved off, and only the user can turn it on in MCP server settings."); },
        apiResponse: async () => ({ ok: false, status: 400, body: {} }),
      },
    }));
    expect(result).toEqual({
      text: "A bot cannot change the on/off switch. The server is saved off, and only the user can turn it on in MCP server settings.",
      isError: true,
    });
    expect(result.text).not.toContain("hidden");
  });
});

describe("propose_profile", () => {
  it("rejects a non-boolean toggle without proposing the valid half", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const ctx = context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    });
    const result = await callTool("propose_profile", { description: "Calmer replies.", notifications: "on" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("propose_profile notifications and speakReplies must be true or false.");
    expect(calls).toEqual([]);
  });

  it("passes boolean toggles through with the other fields", async () => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("propose_profile", { description: "Calmer replies.", notifications: false, speakReplies: true, reason: "Use calmer replies." }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return {};
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      {
        path: "/api/internal/profile-requests",
        body: {
          fromBotId: "bot-voice",
          fromThreadId: "thread-voice",
          changes: { description: "Calmer replies.", notifications: false, speakReplies: true },
          reason: "Use calmer replies.",
        },
      },
    ]);
  });
});

describe("memory_update", () => {
  // The harness route, in process: the real updateMemory behind the tool.
  const harness = (botId: string): ToolCallContext["client"] => ({
    api: async () => ({}),
    apiResponse: async (_path, init) => {
      const body = JSON.parse(String(init?.body));
      const result = updateMemory(botId, { action: body.action, text: body.text, oldText: body.oldText }, { source: 'chat "Turn"' });
      return { ok: result.ok, status: result.ok ? 200 : result.code === "conflict" ? 409 : 400, body: result };
    },
  });

  it("saves every note in a turn on a full file, saying what moved to the archive, and never closes the tool", async () => {
    const bot = "bot-memory-full";
    writeMemoryFile(bot, Array.from({ length: MEMORY_MAX_LINES }, (_, i) => `- 2026-09-01 · old ${i}\n`).join(""));
    const ctx = context({ botId: bot, client: harness(bot) });
    // refusals of another kind (a stale passage) do not close it either
    for (let i = 0; i < 4; i += 1) {
      const stale = await callTool("memory_update", { action: "remove", old_text: "no such passage" }, ctx);
      expect(stale).toMatchObject({ isError: true });
    }
    for (let i = 0; i < 10; i += 1) {
      const result = await callTool("memory_update", { action: "append", text: `note ${i}` }, ctx);
      expect(result.isError, result.text).toBeFalsy();
      expect(result.text).toMatch(new RegExp(`^Memory updated\\. Entry: - \\d{4}-\\d{2}-\\d{2} · from chat "Turn" · note ${i}\\n`));
      expect(result.text).toMatch(new RegExp(`\\nTo stay within what loads each session, moved 1 older entry to memory/archive\\.md \\(session_search finds them\\):\\n- 2026-09-01 · old ${i}$`));
    }
    const text = readMemoryFile(bot).text;
    for (let i = 0; i < 10; i += 1) expect(text).toContain(` · note ${i}\n`);
    expect(readMemoryTopic(bot, "archive.md")).toContain("- 2026-09-01 · old 9 · moved");
  });

  it("names only the first few entries a write moved, each by its first line, and counts the rest", async () => {
    const bot = "bot-memory-grown";
    // a file grown far past the budget by hand: one write moves hundreds
    const grown = Array.from({ length: 600 }, (_, i) => `- 2026-09-01 · old ${i}`);
    grown[0] = "- 2026-08-01 · Deploy command:\n  ```sh\n  railway up\n  ```";
    writeMemoryFile(bot, `${grown.join("\n")}\n`);
    const result = await callTool("memory_update", { action: "append", text: "one more" }, context({ botId: bot, client: harness(bot) }));
    expect(result.isError).toBeFalsy();
    expect(result.text.split("\nTo stay")[1]).toBe(
      " within what loads each session, moved 401 older entries to memory/archive.md (session_search finds them):\n" +
      "- 2026-08-01 · Deploy command:\n- 2026-09-01 · old 1\n- 2026-09-01 · old 2\n- 2026-09-01 · old 3\n- 2026-09-01 · old 4\n…and 396 more",
    );
    expect(readMemoryTopic(bot, "archive.md")).toContain("- 2026-08-01 · Deploy command: · moved");
  });

  it("tells the bot plainly when hand-written lines fill what loads", async () => {
    const bot = "bot-memory-hand";
    writeMemoryFile(bot, Array.from({ length: MEMORY_MAX_LINES }, (_, i) => `- note ${i}\n`).join(""));
    const result = await callTool("memory_update", { action: "append", text: "kept anyway" }, context({ botId: bot, client: harness(bot) }));
    expect(result.isError).toBeFalsy();
    expect(result.text).toMatch(/^Memory updated\. Entry: - \d{4}-\d{2}-\d{2} · from chat "Turn" · kept anyway\nSaved, but the lines that never move out of MEMORY\.md \(hand-written ones, health and safety facts\) fill what loads each session, so the newest entries do not load\. Ask the person to trim MEMORY\.md in Settings\.$/);
    expect(readMemoryFile(bot).text).toContain(" · kept anyway\n");
  });
});

describe("propose_team_memory", () => {
  it.each(["person", "place", "decision", "term"])("sends the %s proposal with exact identity and never claims immediate publication", async (kind) => {
    const calls: Array<{ path: string; body: any }> = [];
    const result = await callTool("propose_team_memory", { kind, name: "  Fixture name  ", detail: "  Unreviewed detail  ", aliases: ["Alias"] }, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { status: "proposed", requestId: "proposal-fixture", summary: "Needs admin review" };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).not.toBe(true);
    expect(result.text).toMatch(/confirm|wait/i);
    expect(result.text).not.toContain("Remembered for the team");
    expect(calls).toEqual([{ path: "/api/internal/team-memory", body: {
      fromBotId: "bot-voice", fromThreadId: "thread-voice", kind, name: "Fixture name", detail: "Unreviewed detail", aliases: ["Alias"],
    } }]);
  });
});

describe("react_to_message and remove_reaction", () => {
  it("sends the turn's reaction to the harness and says no message was posted", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      api: async (path: string, init?: RequestInit) => {
        calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
        const body = calls.at(-1)!.body as { remove?: boolean };
        return body.remove ? { ok: true, changed: true, removed: ["👀"] } : { ok: true, changed: true, emoji: "👍", messageId: "m1" };
      },
      apiResponse: async () => ({ ok: true, status: 200, body: {} }),
    };
    const reacted = await callTool("react_to_message", { emoji: " 👍 " }, context({ client }));
    expect(reacted.isError).toBeFalsy();
    expect(reacted.text).toContain("Reacted 👍");
    expect(reacted.text).toContain("end your turn now with an empty reply");
    expect(calls[0]).toEqual({ path: "/api/internal/reaction", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice", emoji: "👍", remove: false } });

    const removed = await callTool("remove_reaction", { message_id: "m1" }, context({ client }));
    expect(removed.text).toBe("Removed your 👀.");
    expect(calls[1]!.body).toEqual({ fromBotId: "bot-voice", fromThreadId: "thread-voice", messageId: "m1", remove: true });
  });

  it("asks for an emoji before calling, and passes a refusal through as an error", async () => {
    let called = false;
    const missing = await callTool("react_to_message", {}, context({ client: { api: async () => { called = true; return {}; }, apiResponse: async () => ({ ok: true, status: 200, body: {} }) } }));
    expect(missing.isError).toBe(true);
    expect(called).toBe(false);
    const refused = await callTool("react_to_message", { emoji: "✅" }, context({
      client: { api: async () => ({ error: "Never react to your own message." }), apiResponse: async () => ({ ok: true, status: 200, body: {} }) },
    }));
    expect(refused).toEqual({ text: "Never react to your own message.", isError: true });
  });
});

describe("end_call", () => {
  it("asks the harness to end the live call when this turn finishes", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const result = await callTool("end_call", {}, context({
      client: {
        api: async (path, init) => {
          calls.push({ path, body: JSON.parse(String(init?.body)) });
          return { ending: true };
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("The call will end when you finish this turn.");
    expect(result.text).toContain("Do not start new work.");
    expect(calls).toEqual([
      { path: "/api/internal/voice-call/end", body: { fromBotId: "bot-voice", fromThreadId: "thread-voice" } },
    ]);
  });

  it("tells the bot to stop when there is no live call", async () => {
    const result = await callTool("end_call", {}, context({
      client: {
        api: async () => { throw new Error("There is no live phone call on this conversation. Do not call end_call."); },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(result).toEqual({
      text: "There is no live phone call on this conversation. Do not call end_call.",
      isError: true,
    });
  });

  it("refuses an external runtime without calling the harness", async () => {
    let called = false;
    const result = await callTool("end_call", {}, context({
      externalRuntime: true,
      client: {
        api: async () => { called = true; return {}; },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    }));
    expect(called).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no live phone call");
  });
});
