// Grok driver contract tests — the API-backed driver rides fetch, so the
// fake is a stubbed globalThis.fetch that scripts HTTP failures and SSE
// bodies. Covers the auto-retry policy: transient (429/5xx) retried with
// backoff, terminal (401/400) never, partial streamed output never.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs, NATIVE_DIR } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { GrokDriver, grokHttpReasoningEffort, xaiModelLabel } from "./grok.ts";

const SSE_BODY = (text: string) =>
  [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    "data: [DONE]",
    "",
  ].join("\n");

const sseResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

describe("GrokDriver turns (fake fetch)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let previousFetch: typeof globalThis.fetch;
  /** Script of responses/errors consumed in order; empty = succeed with text. */
  let script: Array<{ status?: number; sse?: string }> = [];
  let calls = 0;
  let requestedModels: string[] = [];
  let requestedUrls: string[] = [];

  const create = async () => {
    instance = await GrokDriver.create({
      instanceId: "grok-test",
      displayName: "Grok Test",
      environment: { XAI_API_KEY: "xai-fake" },
      enabled: true,
      config: { url: "https://fake.xai.invalid/v1", apiKeyEnv: "XAI_API_KEY" },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    process.env.FAKE_GROK_RETRY_SCALE = "0.001";
    previousFetch = globalThis.fetch;
    calls = 0;
    requestedModels = [];
    requestedUrls = [];
    // SAFETY: the stub only returns real Response objects, the sole member
    // of fetch's return type this driver consumes. A call warm is GET
    // /models (no JSON body).
    globalThis.fetch = (async (url, init) => {
      requestedUrls.push(String(url));
      // The account's model list read at start (#4416) is not a scripted turn.
      if (String(url).endsWith("/language-models")) return Response.json({ models: [] });
      const raw = init?.body != null ? String(init.body) : "";
      if (raw) requestedModels.push((JSON.parse(raw) as { model: string }).model);
      const step = script.shift();
      calls++;
      if (!step || step.sse !== undefined) {
        if (!raw) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
        return sseResponse(step?.sse ?? SSE_BODY("done from fake grok"));
      }
      return new Response(`HTTP ${step.status} body`, { status: step.status });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    delete process.env.FAKE_GROK_RETRY_SCALE;
    delete process.env.FAKE_GROK_WARM_PING_MS;
    recorder?.stop();
    await instance?.dispose();
  });

  it("reviews a permission with a tool-free completion on the cheap model (lot A1b)", async () => {
    await create();
    let body: { model?: string; tools?: unknown; messages?: Array<{ content?: string }> } | undefined;
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"decision":"none"}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await expect(instance.reviewPermission!("judge this card")).resolves.toBe('{"decision":"none"}');
    expect(body?.model).toBe("grok-3-mini");
    expect(body?.tools).toBeUndefined();
    expect(body?.messages?.[0]?.content).toBe("judge this card");
  });

  it("sends the turn's reasoning effort, and high when the turn names none", async () => {
    const bodies: Array<{ model?: string; reasoning_effort?: string }> = [];
    script = [];
    await create();
    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/language-models") || String(url).endsWith("/models")) return Response.json({ models: [] });
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return sseResponse(SSE_BODY("ok"));
    }) as typeof fetch;
    await instance.adapter.sendTurn({ threadId: "t-effort", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");
    await instance.adapter.sendTurn({ threadId: "t-effort-low", text: "hi", effort: "low" });
    await recorder.until((event) => event.threadId === "t-effort-low" && event.type === "turn.completed");
    expect(bodies.map((body) => [body.model, body.reasoning_effort])).toEqual([
      ["grok-4.7", "high"],
      ["grok-4.7", "low"],
    ]);
    expect(grokHttpReasoningEffort("grok-3-mini", "low")).toBeUndefined();
    expect(grokHttpReasoningEffort("grok-4.5", "xhigh")).toBe("high");
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    script = [];
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-happy", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    expect(recorder.events.map((e) => e.type)).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed", // assistant_text
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "grok")).toBe(true);
    expect(recorder.events.find((e) => e.type === "item.completed")).toMatchObject({
      itemType: "assistant_text",
      text: "done from fake grok",
    });
  });

  it("records the resolved default model in native diagnostics", async () => {
    script = [];
    await create();
    const threadId = "t-default-model-log";
    await instance.adapter.sendTurn({ threadId, text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");

    const entries = readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { dir: string; msg: { model?: string } });
    expect(entries.find((entry) => entry.dir === "out")?.msg.model).toBe("grok-4.7");
    expect(requestedModels).toEqual(["grok-4.7"]);
    expect(instance.models.options).toContainEqual({ id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000, effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
  });

  it("smoke: offers ask_user and returns the person's reply verbatim", async () => {
    const askBody = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"ask1","type":"function","function":{"name":"ask_user","arguments":'
      + JSON.stringify(JSON.stringify({ questions: [{ question: "Ship the fixture?", options: [{ label: "Yes" }, { label: "No" }] }] }))
      + '}}]}}]}\n\n'
      + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n';
    const bodies: string[] = [];
    // SAFETY: the stub only returns real Response objects, the sole member
    // of fetch's return type this driver consumes.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      calls++;
      bodies.push(String(init?.body));
      return sseResponse(bodies.length === 1 ? askBody : SSE_BODY("done from fake grok"));
    }) as typeof fetch;
    await create();
    await instance.adapter.sendTurn({ threadId: "t-ask", text: "go" });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "question", tool: "ask_user", choices: ["Yes", "No"] });
    const reply = "The user answered your questions.\n\nQ: Ship the fixture?\nA: Yes";
    expect(await instance.adapter.respondToRequest("t-ask", opened.requestId!, { behavior: "answer", message: reply })).toBe("answered");
    const completed = await recorder.until((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({ ok: true });
    expect(bodies[0]).toContain('"ask_user"');
    expect(JSON.parse(JSON.parse(bodies[1]!).messages.at(-1).content).result).toBe(reply);
  }, 20_000);

  it("auto-retries transient 429/5xx responses, then completes once", async () => {
    script = [{ status: 429 }, { status: 503 }];
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-retry", text: "go" });
    await recorder.until((e) => e.type === "turn.completed" && e.ok === true);

    const retries = recorder.events.filter((e) => e.type === "turn.retrying");
    expect(retries.map((e) => e.attempt)).toEqual([1, 2]);
    expect(retries.every((e) => e.delayMs > 0)).toBe(true);
    expect(retries.map((e) => e.reason)).toEqual(["rate_limited", "server_error"]);
    // exactly one settled reply across all three attempts
    expect(recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text")).toHaveLength(1);
    expect(calls).toBe(3);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true, turnId });
  }, 20_000);

  it("stops at the attempt cap and settles as failed", async () => {
    script = [{ status: 500 }, { status: 500 }, { status: 500 }];
    await create();
    await instance.adapter.sendTurn({ threadId: "t-cap", text: "go" });
    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);

    const retries = recorder.events.filter((e) => e.type === "turn.retrying");
    expect(retries.map((e) => e.attempt)).toEqual([1, 2]);
    // original + two retries; the third failure is past the cap and fails
    expect(calls).toBe(3);
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(true);
  }, 20_000);

  it("never retries a terminal auth or invalid-request failure", async () => {
    script = [{ status: 401 }];
    await create();
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "go" });
    await recorder.until((e) => e.threadId === "t-auth" && e.type === "turn.completed" && e.ok === false);

    expect(recorder.events.filter((e) => e.threadId === "t-auth" && e.type === "turn.retrying")).toHaveLength(0);
    expect(calls).toBe(1);

    script = [{ status: 400 }];
    await instance.adapter.sendTurn({ threadId: "t-badreq", text: "go" });
    await recorder.until((e) => e.threadId === "t-badreq" && e.type === "turn.completed" && e.ok === false);
    expect(recorder.events.filter((e) => e.type === "turn.retrying" && e.threadId === "t-badreq")).toHaveLength(0);
  }, 20_000);

  it("never retries after assistant text already streamed (duplicate-text hazard)", async () => {
    // an SSE body whose stream ERRORS after delivering a delta — the
    // partial-output guard must forbid the retry that would duplicate it
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "half an answer" } }] })}\n\n`));
        setTimeout(() => controller.error(new Error("connection reset by peer")), 10);
      },
    });
    // SAFETY: a real Response built from a live stream, same as above.
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith("models")) return Response.json({ models: [] });
      calls++;
      return new Response(failingStream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    await create();
    await instance.adapter.sendTurn({ threadId: "t-partial", text: "go" });
    await recorder.until((e) => e.threadId === "t-partial" && e.type === "turn.completed" && e.ok === false);

    expect(recorder.events.some((e) => e.type === "content.delta" && e.streamKind === "assistant_text")).toBe(true);
    expect(recorder.events.filter((e) => e.threadId === "t-partial" && e.type === "turn.retrying")).toHaveLength(0);
    expect(calls).toBe(1);
  }, 20_000);

  it("an interrupt during the retry backoff cancels cleanly without another attempt", async () => {
    script = [{ status: 503 }];
    process.env.FAKE_GROK_RETRY_SCALE = "60"; // long backoff — we cancel inside it
    await create();
    await instance.adapter.sendTurn({ threadId: "t-cancel-backoff", text: "go" });
    await recorder.until((e) => e.type === "turn.retrying");

    await instance.adapter.interruptTurn("t-cancel-backoff");
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.retrying")).toHaveLength(1);
    expect(calls).toBe(1);
    expect(recorder.events.at(-1)).toMatchObject({
      type: "turn.completed",
      ok: false,
      stopReason: "interrupted",
    });
  }, 20_000);

  it("declares no interactive channels this engine cannot honor", async () => {
    script = [];
    await create();
    await expect(instance.adapter.respondToRequest("t-x", "r", { behavior: "allow" })).resolves.toBe("unavailable");
  });

  it("warms a voice call without a billed completion, then reuses that connection", async () => {
    script = [];
    await create();
    expect(instance.adapter.capabilities.warmSession).toBe(true);
    const warm = await instance.adapter.sendTurn({
      threadId: "t-call",
      text: "",
      keepWarm: true,
      warmOnly: true,
    });
    expect(warm.reused).toBeUndefined();
    expect(requestedUrls.some((url) => url.endsWith("/v1/models"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/chat/completions"))).toBe(false);
    expect(recorder.events.map((e) => e.type)).toEqual([]);

    const spoken = await instance.adapter.sendTurn({ threadId: "t-call", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(spoken.reused).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/chat/completions"))).toBe(true);
  });

  it("keeps the HTTP pool alive while the call is warm, and stops on hangup", async () => {
    process.env.FAKE_GROK_WARM_PING_MS = "40";
    script = [];
    await create();
    await instance.adapter.sendTurn({ threadId: "t-ping", text: "", keepWarm: true, warmOnly: true });
    const afterWarm = requestedUrls.filter((url) => url.endsWith("/v1/models")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(requestedUrls.filter((url) => url.endsWith("/v1/models")).length).toBeGreaterThan(afterWarm);
    instance.adapter.releaseWarmSession?.("t-ping");
    const afterHangup = requestedUrls.filter((url) => url.endsWith("/v1/models")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(requestedUrls.filter((url) => url.endsWith("/v1/models")).length).toBe(afterHangup);
  });

  it("bounds each warm /models ping so a stalled provider cannot pin the interval", async () => {
    process.env.FAKE_GROK_WARM_PING_MS = "40";
    script = [];
    const signals: AbortSignal[] = [];
    globalThis.fetch = (async (url, init) => {
      requestedUrls.push(String(url));
      if (init?.signal) signals.push(init.signal);
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await create();
    await instance.adapter.sendTurn({ threadId: "t-ping-bound", text: "", keepWarm: true, warmOnly: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    instance.adapter.releaseWarmSession?.("t-ping-bound");
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });
});


describe("GrokDriver live model list (#4416)", () => {
  let previousFetch: typeof globalThis.fetch;
  let instances: ProviderInstance[] = [];
  /** What each key's account lists, by key; a missing key answers 500. */
  let accounts: Record<string, { language?: unknown; models?: unknown; status?: number }> = {};
  let seenKeys: string[] = [];

  beforeEach(() => {
    previousFetch = globalThis.fetch;
    instances = [];
    seenKeys = [];
    globalThis.fetch = (async (url, init) => {
      const key = String(new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      seenKeys.push(key);
      const account = accounts[key];
      if (!account || account.status) return new Response("down", { status: account?.status ?? 500 });
      if (String(url).endsWith("/language-models")) {
        return account.language === undefined ? new Response("not found", { status: 404 }) : Response.json(account.language);
      }
      if (String(url).endsWith("/models")) return Response.json(account.models ?? { data: [] });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    await Promise.all(instances.map((instance) => instance.dispose()));
  });

  const create = async (key: string, instanceId = `grok-${key}`) => {
    const instance = await GrokDriver.create({
      instanceId, displayName: "Grok", enabled: true,
      environment: { XAI_API_KEY: key },
      config: { url: "https://fake.xai.invalid/v1", apiKeyEnv: "XAI_API_KEY" },
    });
    instances.push(instance);
    await instance.refreshModels?.();
    return instance;
  };
  const ids = (instance: ProviderInstance) => instance.models.options.map((option) => option.id);

  it("lists every model the account offers, with readable names, beyond the written list", async () => {
    accounts = { "key-a": { language: { models: [
      { id: "grok-4.7", aliases: [], input_modalities: ["text", "image"], output_modalities: ["text"] },
      { id: "grok-4.7-fast", input_modalities: ["text"], output_modalities: ["text"] },
      { id: "grok-4.6", input_modalities: ["text", "image"], output_modalities: ["text"] },
      { id: "grok-4.5", output_modalities: ["text"] },
      { id: "grok-4-1-fast-reasoning", output_modalities: ["text"] },
      { id: "grok-imagine-image", output_modalities: ["image"] },
    ] } } };
    const instance = await create("key-a");
    expect(ids(instance)).toEqual(["grok-4.7", "grok-4.7-fast", "grok-4.6", "grok-4.5", "grok-4-1-fast-reasoning"]);
    expect(instance.models.default).toBe("grok-4.7");
    expect(instance.models.options).toContainEqual({ id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000, effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
    expect(instance.models.options.find((option) => option.id === "grok-4.7-fast")?.label).toBe("Grok 4.7 Fast");
    expect(instance.models.options.find((option) => option.id === "grok-4-1-fast-reasoning")?.label).toBe("Grok 4.1 Fast Reasoning");
    // The name is not invented. grok-4.5 takes an effort and stops at high.
    expect(instance.models.options.find((option) => option.id === "grok-4.5")).toEqual({
      id: "grok-4.5", label: "Grok 4.5", effortLevels: ["low", "medium", "high"], defaultEffort: "high",
    });
  });

  it("drops a model the account lost, and keeps a written id that is only an alias", async () => {
    accounts = { "key-b": { language: { models: [
      { id: "grok-4-0709", aliases: ["grok-4", "grok-4-latest"], output_modalities: ["text"] },
    ] } } };
    const instance = await create("key-b");
    expect(instance.models.options).toEqual([{ id: "grok-4", label: "Grok 4" }]);
    expect(instance.models.default).toBe("grok-4");
  });

  it("reads the plain model list when the richer one is absent", async () => {
    accounts = { "key-c": { models: { data: [{ id: "grok-4.6" }, { id: "grok-2-image" }, { id: "grok-3-mini" }] } } };
    const instance = await create("key-c");
    expect(ids(instance)).toEqual(["grok-4.6", "grok-3-mini"]);
  });

  it("keeps the written list, then the last good list, when a lookup fails", async () => {
    accounts = { "key-d": { status: 503 } };
    const instance = await create("key-d");
    expect(ids(instance)).toEqual(["grok-4.7", "grok-4", "grok-4-fast", "grok-3-mini"]);
    accounts = { "key-d": { language: { models: [{ id: "grok-4.6", output_modalities: ["text"] }] } } };
    await instance.refreshModels?.();
    expect(ids(instance)).toEqual(["grok-4.6"]);
    accounts = { "key-d": { status: 500 } };
    await instance.refreshModels?.();
    expect(ids(instance)).toEqual(["grok-4.6"]);
    accounts = { "key-d": { language: { models: [] } } };
    await instance.refreshModels?.();
    expect(ids(instance)).toEqual(["grok-4.6"]);
  });

  it("gives two accounts their own lists", async () => {
    accounts = {
      "key-e": { language: { models: [{ id: "grok-4.7", output_modalities: ["text"] }, { id: "grok-4.5", output_modalities: ["text"] }] } },
      "key-f": { language: { models: [{ id: "grok-3-mini", output_modalities: ["text"] }] } },
    };
    const first = await create("key-e");
    const second = await create("key-f");
    expect(ids(first)).toEqual(["grok-4.7", "grok-4.5"]);
    expect(ids(second)).toEqual(["grok-3-mini"]);
    expect(second.models.default).toBe("grok-3-mini");
    expect(new Set(seenKeys)).toEqual(new Set(["key-e", "key-f"]));
  });

  const personAccess = (key: string) => ({ via: "speaker-key" as const, identity: `speaker-key:person:${key}`, environment: { XAI_API_KEY: key, SAGAX_PERSONAL_PROVIDER_KEY: key } });

  it("gives two people with their own keys on one instance their own lists", async () => {
    accounts = {
      "server-key": { language: { models: [{ id: "grok-3-mini", output_modalities: ["text"] }] } },
      "person-a": { language: { models: [{ id: "grok-4.7", output_modalities: ["text"] }, { id: "grok-4.5", output_modalities: ["text"] }] } },
      "person-b": { language: { models: [{ id: "grok-4.6", output_modalities: ["text"] }] } },
    };
    const instance = await create("server-key");
    const forA = await instance.modelsForAccess!(personAccess("person-a"));
    const forB = await instance.modelsForAccess!(personAccess("person-b"));
    expect(forA.options.map((option) => option.id)).toEqual(["grok-4.7", "grok-4.5"]);
    expect(forB.options.map((option) => option.id)).toEqual(["grok-4.6"]);
    // the instance's own account keeps its own list
    expect(ids(instance)).toEqual(["grok-3-mini"]);
    expect((await instance.modelsForAccess!({ via: "org-key", identity: "org-key" })).options.map((option) => option.id)).toEqual(["grok-3-mini"]);
  });

  it("reads a person's key with no server key, and keeps their last good list", async () => {
    accounts = { "person-c": { language: { models: [{ id: "grok-4.6", output_modalities: ["text"] }, { id: "grok-4.7-fast", output_modalities: ["text"] }] } } };
    const instance = await GrokDriver.create({
      instanceId: "grok-nokey", displayName: "Grok", enabled: true, environment: {},
      config: { url: "https://fake.xai.invalid/v1", apiKeyEnv: "SAGAX_TEST_NO_XAI_KEY" },
    });
    instances.push(instance);
    expect(ids(instance)).toEqual(["grok-4.7", "grok-4", "grok-4-fast", "grok-3-mini"]);
    const listed = await instance.modelsForAccess!(personAccess("person-c"));
    expect(listed.options.map((option) => option.id)).toEqual(["grok-4.6", "grok-4.7-fast"]);
    expect(seenKeys).not.toContain("");
  });

  it("labels an id the written list does not know", () => {
    expect(xaiModelLabel("grok-4-1-fast-reasoning")).toBe("Grok 4.1 Fast Reasoning");
    expect(xaiModelLabel("grok-4-0709")).toBe("Grok 4 0709");
    expect(xaiModelLabel("grok-code-fast-1")).toBe("Grok Code Fast 1");
  });
});

it("grok preserves an explicit tools-off connection and rejects ambiguous flags", () => {
  expect(GrokDriver.decodeConfig({})).not.toHaveProperty("tools");
  expect(GrokDriver.decodeConfig({ tools: false })).toMatchObject({ tools: false });
  expect(GrokDriver.decodeConfig({ tools: true })).toMatchObject({ tools: true });
  expect(() => GrokDriver.decodeConfig({ tools: "false" })).toThrow("tools must be a boolean");
});
