// OpenAI's own API runs a bot's turns on /v1/responses (tools with
// reasoning), lists only conversation models, and a model it refuses gives
// way to another one in the same turn, with nothing raw in the chat. A fake
// OpenAI endpoint (stubbed fetch): no real call leaves the machine.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderInstance, RuntimeEvent } from "../contracts.ts";
import { RefusedModelsStore, setRefusedModelsStore } from "../models/refused-models.ts";
import { isOpenAIChatModel, isOpenAIReasoningModel, OpenAICompatDriver } from "./openai-compat.ts";
import { isEngineExhaustedRefusal, noModelLeftMessage } from "./openai-chat.ts";
import { providerReplyCutMessage } from "../../shared/provider-reply-cut.ts";
import { refusesModel, ResponsesReader, responsesInput } from "./openai-responses.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  setRefusedModelsStore(null);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OPENAI_URL = "https://api.openai.com/v1";

function toolServer(receipt: string) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-responses-mcp-"));
  dirs.push(dir);
  const script = join(dir, "fake-mcp.mjs");
  writeFileSync(script, `#!/usr/bin/env node
    import { appendFileSync } from "node:fs";
    const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\\n")) !== -1) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        const m = JSON.parse(line);
        if (m.method === "initialize") send({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2024-11-05",capabilities:{tools:{}}}});
        else if (m.method === "tools/list") send({jsonrpc:"2.0",id:m.id,result:{tools:[{name:"lookup",description:"Fixture lookup",inputSchema:{type:"object",properties:{q:{type:"string"}},additionalProperties:false}}]}});
        else if (m.method === "tools/call") {
          appendFileSync(process.env.RECEIPT, m.params.name + "\\n");
          send({jsonrpc:"2.0",id:m.id,result:{content:[{type:"text",text:"fixture answer"}]}});
        }
      }
    });
  `);
  chmodSync(script, 0o755);
  return { command: script, args: [], env: { RECEIPT: receipt } };
}

const sse = (events: unknown[]) => new Response(
  events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  { headers: { "content-type": "text/event-stream" } },
);
const completed = (usage = { input_tokens: 40, output_tokens: 8, input_tokens_details: { cached_tokens: 10 } }) =>
  ({ type: "response.completed", response: { status: "completed", model: "fixture", usage } });
const textReply = (text: string) => sse([
  { type: "response.output_text.delta", delta: text },
  { type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text }] } },
  completed(),
]);
const refusal = (message: string, status = 400) => new Response(
  JSON.stringify({ error: { message, type: "invalid_request_error", param: null, code: null } }),
  { status, headers: { "content-type": "application/json" } },
);

interface Call { url: string; body: any }

async function openai(models: string[], answer: (call: Call, calls: Call[]) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: models.map((id, index) => ({ id, created: models.length - index })) }));
    const call = { url, body: JSON.parse(String(init?.body)) };
    calls.push(call);
    return answer(call, calls);
  }));
  const instance = await OpenAICompatDriver.create({
    instanceId: "openai", displayName: "OpenAI", enabled: true,
    config: OpenAICompatDriver.decodeConfig({ url: OPENAI_URL, apiKeyEnv: "SAGAX_OPENAI_API_KEY", catalog: "openai" }),
    environment: { SAGAX_OPENAI_API_KEY: "sk-fixture" },
  });
  await vi.waitFor(() => expect(instance.models.options.map((option) => option.id)).toEqual(models.filter(isOpenAIChatModel)));
  return { instance, calls };
}

async function turn(instance: ProviderInstance, input: Record<string, unknown>) {
  const events: RuntimeEvent[] = [];
  const off = instance.adapter.onEvent((event) => {
    events.push(event);
    // #1982: a Full MCP ask reaches Sagax's gate (index.ts request.opened).
    // There is no harness here, so answer allow the way it would.
    if (input.approvalMode === "full" && event.type === "request.opened" && event.requestType === "permission" && event.requestId) {
      void instance.adapter.respondToRequest("thread", event.requestId, { behavior: "allow" });
    }
  });
  await instance.adapter.sendTurn({ threadId: "thread", text: "hi", ...input } as never);
  await vi.waitFor(() => expect(events.some((event) => event.type === "turn.completed")).toBe(true), { timeout: 10_000 });
  off();
  return events;
}

describe("OpenAI catalog", () => {
  it("keeps only conversation models that take tools", () => {
    for (const id of ["gpt-6.1-terra", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o", "o3", "o4-mini"]) expect(isOpenAIChatModel(id), id).toBe(true);
    for (const id of [
      "gpt-3.5-turbo-instruct", "davinci-002", "babbage-002", "text-embedding-3-large", "omni-moderation-latest",
      "gpt-4o-realtime-preview", "gpt-realtime", "gpt-4o-mini-tts", "gpt-4o-transcribe", "whisper-1", "tts-1",
      "dall-e-3", "gpt-image-1", "gpt-4o-audio-preview", "gpt-4o-search-preview", "chatgpt-4o-latest",
      "o1-mini", "o1-preview", "gpt-5-codex", "o3-deep-research", "gpt-5-pro", "computer-use-preview",
    ]) expect(isOpenAIChatModel(id), id).toBe(false);
    expect(isOpenAIReasoningModel("gpt-6.1-terra")).toBe(true);
    expect(isOpenAIReasoningModel("o3")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-5-chat-latest")).toBe(false);
    expect(isOpenAIReasoningModel("gpt-4.1")).toBe(false);
  });

  it("drops non-chat models from the live list and marks effort per model", async () => {
    const { instance } = await openai(["gpt-6.1-terra", "gpt-3.5-turbo-instruct", "gpt-realtime", "text-embedding-3-small", "gpt-4.1"], () => new Response("", { status: 500 }));
    expect(instance.models.options.map((option) => [option.id, option.effortLevels])).toEqual([
      ["gpt-6.1-terra", ["low", "medium", "high"]],
      ["gpt-4.1", []],
    ]);
    expect(instance.adapter.capabilities.effortLevels).toEqual(["low", "medium", "high"]);
    await instance.dispose();
  });
});

describe("OpenAI turns on /v1/responses", () => {
  it("runs a turn with tools and effort on /responses, replaying the tool round and encrypted reasoning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-responses-")); dirs.push(dir);
    const receipt = join(dir, "calls.txt");
    const { instance, calls } = await openai(["gpt-6.1-terra"], (_call, all) => all.length === 1
      ? sse([
          { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" } },
          { type: "response.output_item.done", item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "fx_lookup", arguments: "{\"q\":\"x\"}" } },
          completed(),
        ])
      : textReply("Done."));
    const events = await turn(instance, {
      model: "gpt-6.1-terra", effort: "high", approvalMode: "full",
      integrations: { custom: { fx: toolServer(receipt) } },
    });
    try {
      expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
      expect(calls.map((call) => call.url)).toEqual([`${OPENAI_URL}/responses`, `${OPENAI_URL}/responses`]);
      const [first, second] = calls.map((call) => call.body);
      expect(first).toMatchObject({
        model: "gpt-6.1-terra", stream: true, store: false,
        reasoning: { effort: "high" }, include: ["reasoning.encrypted_content"],
      });
      expect(first.reasoning_effort).toBeUndefined();
      expect(first.tools.find((tool: any) => tool.name === "fx_lookup")).toMatchObject({ type: "function", name: "fx_lookup", parameters: { type: "object" } });
      expect(readFileSync(receipt, "utf8")).toBe("lookup\n");
      const tail = second.input.slice(-3);
      expect(tail[0]).toMatchObject({ type: "reasoning", encrypted_content: "opaque" });
      expect(tail[1]).toEqual({ type: "function_call", call_id: "call_1", name: "fx_lookup", arguments: "{\"q\":\"x\"}" });
      expect(tail[2]).toMatchObject({ type: "function_call_output", call_id: "call_1" });
      expect(tail[2].output).toContain("fixture answer");
      expect(events.filter((event) => event.type === "content.delta").map((event) => (event as { delta: string }).delta).join("")).toBe("Done.");
      expect(events.some((event) => event.type === "thread.token-usage.updated")).toBe(true);
      expect(events.filter((event) => event.type === "runtime.error")).toEqual([]);
    } finally { await instance.dispose(); }
  }, 20_000);

  it("does not send reasoning or encrypted reasoning to a model that does not reason", async () => {
    const { instance, calls } = await openai(["gpt-4.1"], () => textReply("Hi."));
    const events = await turn(instance, { model: "gpt-4.1", effort: "high" });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    expect(calls[0]!.body.reasoning).toBeUndefined();
    expect(calls[0]!.body.include).toBeUndefined();
    await instance.dispose();
  });

  it.each([
    "Function tools with reasoning_effort are not supported for gpt-6.1-terra in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
    "This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?",
  ])("moves a refused model's turn to another model without a raw error: %s", async (message) => {
    const { instance, calls } = await openai(["gpt-6.1-terra", "gpt-5"], (call) => call.body.model === "gpt-6.1-terra" ? refusal(message) : textReply("Answered."));
    const events = await turn(instance, { model: "gpt-6.1-terra" });
    try {
      expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
      expect(events.filter((event) => event.type === "runtime.error")).toEqual([]);
      expect(events.filter((event) => event.type === "turn.retrying")).toEqual([]);
      expect(events).toContainEqual(expect.objectContaining({ type: "session.model-fallback", requested: "gpt-6.1-terra", actual: "gpt-5" }));
      expect(calls.map((call) => call.body.model)).toEqual(["gpt-6.1-terra", "gpt-5"]);
      // The refused model leaves the catalog: neither the picker nor Auto offers it.
      expect(instance.models.options.map((option) => option.id)).toEqual(["gpt-5"]);
      expect(instance.models.default).toBe("gpt-5");
      // A turn that still names it starts on the other model at once.
      const again = await turn(instance, { threadId: "thread", model: "gpt-6.1-terra" });
      expect(again.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
      expect(calls.slice(2).map((call) => call.body.model)).toEqual(["gpt-5"]);
    } finally { await instance.dispose(); }
  });

  it("ends in plain words when no model of the engine can answer", async () => {
    const { instance } = await openai(["gpt-6.1-terra"], () => refusal("This is not a chat model and thus not supported in the v1/chat/completions endpoint."));
    const events = await turn(instance, { model: "gpt-6.1-terra" });
    try {
      const errors = events.filter((event) => event.type === "runtime.error") as Array<{ message: string }>;
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toMatch(/^This model is not supported for conversations \(gpt-6\.1-terra\), and no other model of this engine could take over\. Choose another model\.$/);
      expect(errors[0]!.message).not.toMatch(/v1\/|chat\/completions|HTTP/);
      expect(isEngineExhaustedRefusal(errors[0]!.message)).toBe(true);
      expect(isEngineExhaustedRefusal(noModelLeftMessage("gpt-5"))).toBe(true);
      expect(isEngineExhaustedRefusal("401 Unauthorized")).toBe(false);
    } finally { await instance.dispose(); }
  });

  it("keeps a refused model out of the catalog after a restart (#1696)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-refused-"));
    dirs.push(dir);
    const file = join(dir, "refused-models.json");
    setRefusedModelsStore(new RefusedModelsStore({ file }));
    try {
      const { instance } = await openai(["gpt-6.1-terra", "gpt-5"], (call) =>
        call.body.model === "gpt-6.1-terra" ? refusal("This is not a chat model and thus not supported in the v1/chat/completions endpoint.") : textReply("Answered."));
      await turn(instance, { model: "gpt-6.1-terra" });
      expect(instance.models.options.map((option) => option.id)).toEqual(["gpt-5"]);
      await instance.dispose();

      // A new process store from the same file: the refused model stays out.
      setRefusedModelsStore(new RefusedModelsStore({ file }));
      vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "gpt-6.1-terra" }, { id: "gpt-5" }] }));
        return textReply("Still.");
      }));
      const again = await OpenAICompatDriver.create({
        instanceId: "openai", displayName: "OpenAI", enabled: true,
        config: OpenAICompatDriver.decodeConfig({ url: OPENAI_URL, apiKeyEnv: "SAGAX_OPENAI_API_KEY", catalog: "openai" }),
        environment: { SAGAX_OPENAI_API_KEY: "sk-fixture" },
      });
      try {
        await vi.waitFor(() => expect(again.models.options.map((option) => option.id)).toEqual(["gpt-5"]));
        expect(again.models.default).toBe("gpt-5");
      } finally { await again.dispose(); }
    } finally {
      setRefusedModelsStore(null);
    }
  });

  it("goes back to /chat/completions for a model /responses does not serve", async () => {
    const { instance, calls } = await openai(["gpt-4o"], (call) => call.url.endsWith("/responses")
      ? new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 })
      : new Response('data: {"choices":[{"index":0,"delta":{"content":"Chat."}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
    const events = await turn(instance, { model: "gpt-4o" });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    expect(calls.map((call) => call.url)).toEqual([`${OPENAI_URL}/responses`, `${OPENAI_URL}/chat/completions`]);
    expect(calls[1]!.body.reasoning_effort).toBeUndefined();
    await instance.dispose();
  });
});

describe("openai-responses helpers", () => {
  it("maps an incomplete Responses status to length or content_filter finish reasons", () => {
    const length = new ResponsesReader();
    length.event({ type: "response.output_text.delta", delta: "Almost done" });
    length.event({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 3, output_tokens: 2 } },
    });
    expect(length.reply()).toMatchObject({ text: "Almost done", finishReason: "length" });

    const filter = new ResponsesReader();
    filter.json({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output: [{ type: "message", content: [{ type: "output_text", text: "Partial." }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(filter.reply()).toMatchObject({ text: "Partial.", finishReason: "content_filter" });
    expect(providerReplyCutMessage("content_filter")).toContain("content filter");
  });

  it("reads a model refusal, never a key, balance or size refusal", () => {
    const body = (message: string, extra: Record<string, unknown> = {}) => JSON.stringify({ error: { message, type: "invalid_request_error", ...extra } });
    expect(refusesModel(400, body("This is not a chat model and thus not supported in the v1/chat/completions endpoint."))).toBe(true);
    expect(refusesModel(404, body("The model `gpt-x` does not exist or you do not have access to it.", { code: "model_not_found" }))).toBe(true);
    expect(refusesModel(401, body("Incorrect API key provided."))).toBe(false);
    expect(refusesModel(429, body("You exceeded your current quota."))).toBe(false);
    expect(refusesModel(400, body("Request too large."))).toBe(false);
  });

  it("turns images and tool results into Responses input items", () => {
    expect(responsesInput([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
    ])).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "input_text", text: "Look" }, { type: "input_image", image_url: "data:image/png;base64,AA==" }] },
      { type: "function_call", call_id: "c1", name: "t", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "{\"ok\":true}" },
    ]);
  });
});
