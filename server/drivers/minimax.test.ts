import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordEvents } from "../testing/events.ts";
import { writeFileEngineKey } from "../engines/engine-api-keys.ts";
import { decodeMinimaxConfig, loadLocalMiniMaxConfig, MinimaxDriver } from "./minimax.ts";

describe("MinimaxDriver", () => {
  const saved = {
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
    key: process.env.MINIMAX_API_KEY,
    url: process.env.MINIMAX_BASE_URL,
  };
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sagax-minimax-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_BASE_URL;
  });

  afterEach(() => {
    if (saved.home === undefined) delete process.env.HOME;
    else process.env.HOME = saved.home;
    if (saved.userProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = saved.userProfile;
    if (saved.key === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.MINIMAX_BASE_URL;
    else process.env.MINIMAX_BASE_URL = saved.url;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers only current official text models", () => {
    expect(MinimaxDriver.models).toEqual({
      default: "MiniMax-M3",
      options: [
        { id: "MiniMax-M3", label: "MiniMax M3", contextWindow: 1_000_000, custom: true },
        { id: "MiniMax-M2.7", label: "MiniMax M2.7", contextWindow: 204_800, custom: true },
        { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed", contextWindow: 204_800, custom: true },
      ],
    });
  });

  it("flags every catalog model custom so the picker's custom-access pane lists them", () => {
    expect(MinimaxDriver.metadata.access).toBe("custom");
    expect(MinimaxDriver.models.options.every((option) => option.custom === true)).toBe(true);
  });

  it("normalizes custom API roots", () => {
    expect(decodeMinimaxConfig({ url: "https://example.test/", apiKeyEnv: "CUSTOM_KEY" }))
      .toEqual({ url: "https://example.test/v1" });
  });

  it("reads the official mmx-cli config and honors its region and model", () => {
    const dir = join(home, ".mmx");
    mkdirSync(dir);
    writeFileSync(join(dir, "config.json"), JSON.stringify({
      api_key: " local-key ",
      region: "cn",
      default_text_model: "MiniMax-M2.7-highspeed",
    }));

    expect(loadLocalMiniMaxConfig(home)).toEqual({
      apiKey: "local-key",
      url: "https://api.minimaxi.com/v1",
      defaultModel: "MiniMax-M2.7-highspeed",
    });
  });

  it("skips blank environment credentials and does not probe on snapshot", async () => {
    const dir = join(home, ".mmx");
    mkdirSync(dir);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ api_key: "local-key" }));
    process.env.MINIMAX_API_KEY = "   ";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const instance = await MinimaxDriver.create({
      instanceId: "minimax-test",
      displayName: "MiniMax",
      enabled: true,
      config: MinimaxDriver.defaultConfig(),
      environment: { MINIMAX_API_KEY: "" },
    });

    await expect(instance.snapshot()).resolves.toMatchObject({ state: "available", authenticated: true });
    expect(fetchMock).not.toHaveBeenCalled();
    await instance.dispose();
  });

  it("streams content and usage with the MiniMax OpenAI contract", async () => {
    const anySignal = vi.spyOn(AbortSignal, "any");
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response(
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n' +
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n' +
          "data: [DONE]\n",
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }));
    const instance = await MinimaxDriver.create({
      instanceId: "minimax-turn",
      displayName: "MiniMax",
      enabled: true,
      config: MinimaxDriver.defaultConfig(),
      environment: { MINIMAX_API_KEY: "secret" },
    });
    const recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "thread", text: "private prompt" });
    const completed = await recorder.until((event) => event.type === "turn.completed");
    const body = JSON.parse(String(request?.body));

    expect(body).toMatchObject({
      model: "MiniMax-M3",
      stream: true,
      reasoning_split: true,
      stream_options: { include_usage: true },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(anySignal).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({ ok: true, usage: { input: 12, output: 3 } });
    recorder.stop();
    await instance.dispose();
  });

  it("smoke: offers ask_user and returns the person's reply verbatim", async () => {
    const askBody = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"ask1","type":"function","function":{"name":"ask_user","arguments":'
      + JSON.stringify(JSON.stringify({ questions: [{ question: "Ship the fixture?", options: [{ label: "Yes" }, { label: "No" }] }] }))
      + '}}]}}]}\n'
      + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n'
      + 'data: [DONE]\n';
    const doneBody = 'data: {"choices":[{"delta":{"content":"done"}}]}\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n'
      + 'data: [DONE]\n';
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      bodies.push(String(init?.body));
      return new Response(bodies.length === 1 ? askBody : doneBody, { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const instance = await MinimaxDriver.create({
      instanceId: "minimax-ask", displayName: "MiniMax", enabled: true,
      config: MinimaxDriver.defaultConfig(), environment: { MINIMAX_API_KEY: "secret" },
    });
    const recorder = recordEvents(instance.adapter);
    await instance.adapter.sendTurn({ threadId: "thread", text: "hi" });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "question", tool: "ask_user", choices: ["Yes", "No"] });
    const reply = "The user answered your questions.\n\nQ: Ship the fixture?\nA: Yes";
    expect(await instance.adapter.respondToRequest("thread", opened.requestId!, { behavior: "answer", message: reply })).toBe("answered");
    const completed = await recorder.until((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({ ok: true });
    expect(bodies[0]).toContain('"ask_user"');
    expect(JSON.parse(JSON.parse(bodies[1]!).messages.at(-1).content).result).toBe(reply);
    recorder.stop();
    await instance.dispose();
  }, 20_000);

  it("reports a bodyless stream clearly and releases the turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const instance = await MinimaxDriver.create({
      instanceId: "minimax-empty",
      displayName: "MiniMax",
      enabled: true,
      config: MinimaxDriver.defaultConfig(),
      environment: { MINIMAX_API_KEY: "secret" },
    });
    const recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "thread", text: "hello" });
    const error = await recorder.until((event) => event.type === "runtime.error");
    const completed = await recorder.until((event) => event.type === "turn.completed");

    expect(error).toMatchObject({ message: "MiniMax returned no response body" });
    expect(completed).toMatchObject({ ok: false, stopReason: "error" });
    expect(instance.adapter.hasSession("thread")).toBe(false);
    recorder.stop();
    await instance.dispose();
  });

  it("reads the sealed key on each turn instead of the key captured at creation", async () => {
    const data = mkdtempSync(join(tmpdir(), "sagax-minimax-turn-key-"));
    const saved = {
      data: process.env.SAGAX_DATA_DIR,
      vault: process.env.SAGAX_MCP_OAUTH_KEY,
      identity: process.env.SAGAX_IDENTITY,
    };
    process.env.SAGAX_DATA_DIR = data;
    process.env.SAGAX_MCP_OAUTH_KEY = "ab".repeat(32);
    delete process.env.SAGAX_IDENTITY;
    const first = "witness-minimax-not-secret";
    const second = "witness-minimax-turned-not-secret";
    const ada = "pr_00000000-0000-4000-8000-00000000000a";
    const bob = "pr_00000000-0000-4000-8000-00000000000b";
    const headers: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }));
    try {
      writeFileEngineKey(data, { organization: false }, "minimax", "MINIMAX_API_KEY", first);
      const instance = await MinimaxDriver.create({
        instanceId: "minimax-live",
        displayName: "MiniMax",
        enabled: true,
        config: MinimaxDriver.defaultConfig(),
        environment: { MINIMAX_API_KEY: "frozen-at-create" },
      });
      await instance.adapter.sendTurn({ threadId: "t1", text: "one" });
      await vi.waitFor(() => expect(headers).toEqual([`Bearer ${first}`]));
      writeFileEngineKey(data, { organization: false }, "minimax", "MINIMAX_API_KEY", second);
      await instance.adapter.sendTurn({ threadId: "t2", text: "two" });
      await vi.waitFor(() => expect(headers).toEqual([`Bearer ${first}`, `Bearer ${second}`]));
      expect(headers.join(" ")).not.toContain("frozen-at-create");

      process.env.SAGAX_IDENTITY = "perspicax";
      writeFileEngineKey(data, { organization: true, principalId: ada }, "minimax", "MINIMAX_API_KEY", "witness-ada-not-secret");
      writeFileEngineKey(data, { organization: true, principalId: bob }, "minimax", "MINIMAX_API_KEY", "witness-bob-not-secret");
      await instance.adapter.sendTurn({
        threadId: "t3",
        text: "ada",
        access: { via: "speaker-key", identity: `speaker-key:${ada}:local`, localKeyPrincipal: ada },
      });
      await vi.waitFor(() => expect(headers.at(-1)).toBe("Bearer witness-ada-not-secret"));
      await instance.adapter.sendTurn({
        threadId: "t4",
        text: "bob",
        access: { via: "owner-key", identity: `owner-key:${bob}:local`, localKeyPrincipal: bob },
      });
      await vi.waitFor(() => expect(headers.at(-1)).toBe("Bearer witness-bob-not-secret"));
      const beforeAnonymous = headers.length;
      await expect(instance.adapter.sendTurn({ threadId: "t5", text: "nobody" })).rejects.toThrow(/no MiniMax key/);
      expect(headers).toHaveLength(beforeAnonymous);
      expect(headers.filter((header) => header.includes("witness-ada-not-secret"))).toHaveLength(1);
      expect(headers.filter((header) => header.includes("witness-bob-not-secret"))).toHaveLength(1);
      await instance.dispose();
    } finally {
      if (saved.data === undefined) delete process.env.SAGAX_DATA_DIR;
      else process.env.SAGAX_DATA_DIR = saved.data;
      if (saved.vault === undefined) delete process.env.SAGAX_MCP_OAUTH_KEY;
      else process.env.SAGAX_MCP_OAUTH_KEY = saved.vault;
      if (saved.identity === undefined) delete process.env.SAGAX_IDENTITY;
      else process.env.SAGAX_IDENTITY = saved.identity;
    }
  });
});


it("minimax preserves an explicit tools-off connection and rejects ambiguous flags", () => {
  expect(MinimaxDriver.decodeConfig({})).not.toHaveProperty("tools");
  expect(MinimaxDriver.decodeConfig({ tools: false })).toMatchObject({ tools: false });
  expect(MinimaxDriver.decodeConfig({ tools: true })).toMatchObject({ tools: true });
  expect(() => MinimaxDriver.decodeConfig({ tools: "false" })).toThrow("tools must be a boolean");
});
