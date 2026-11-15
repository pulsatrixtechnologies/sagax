// #4329 lot 5, end to end through the real server with fake engines and
// synthetic data only: what runs a bot ("Runs with") is in the data. One bot,
// one conversation, a key-paid model listed by two engines (the built in
// runtime on a mock OpenAI protocol upstream, and pi):
//
//   - a bot made before any choice keeps running where its model was picked;
//   - choosing pi moves the bot's model to pi's own id for it, and the same
//     conversation goes on there;
//   - a pair the matrix does not offer is refused with its sentence;
//   - the person's default for the provider moves a bot with no choice of its own,
//     and clearing it puts that bot back on the recommended engine.
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

const FAKE_PI = fileURLToPath(new URL("./testing/fake-pi-cli.ts", import.meta.url));
const BUILT_IN = { instanceId: "openrouter", model: "fixture-model" };

it("moves a bot to the engine it is told to run with, keeps the conversation, and leaves bots with no choice alone", async () => {
  const seen: string[] = [];
  const upstream = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer synthetic-fixture-key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (req.url?.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as { messages?: Array<{ role: string; content?: unknown }> };
    seen.push(JSON.stringify(request.messages?.findLast((message) => message.role === "user")?.content ?? ""));
    const frame = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(frame({ content: "hello from the built in runtime" }, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("fixture provider address missing");
  const base = `http://127.0.0.1:${address.port}`;

  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, {
    prepareDataDir(dataDir) {
      const configPath = join(dataDir, "config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.openrouter = { key: "synthetic-fixture-key" };
      config.instances = {
        ...config.instances,
        openrouter: { driver: "openai-compat", displayName: "OpenRouter", access: "api", config: { url: `${base}/v1`, key: "synthetic-fixture-key", managedModels: ["fixture-model"] } },
        pi: { driver: "piAgent", displayName: "pi", config: { cli: FAKE_PI }, environment: { FAKE_PI_MODELS: "openrouter/fixture-model" } },
      };
      writeFileSync(configPath, JSON.stringify(config));
    },
  }).catch(async (error) => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    throw error;
  });
  const { url } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, expected?: number) => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as any;
    if (expected === undefined) expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
    return result;
  };
  const control = async (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const botNow = async (id: string) => (await api("GET", "/api/bots?messages=0")).bots.find((entry: any) => entry.id === id);

  try {
    for (const id of ["openrouter", "pi"]) await api("POST", `/api/instances/${id}/refresh-models`, {});
    const catalog = await api("GET", "/api/me/providers/catalog");
    const openrouter = catalog.providers.find((provider: any) => provider.id === "openrouter");
    expect(openrouter.models.find((model: any) => model.id === "fixture-model").engines.map((engine: any) => `${engine.harness}:${engine.model}`).sort())
      .toEqual(["openai-compat:fixture-model", "piAgent:openrouter/fixture-model"]);

    const { bot } = await control("new-bot", "--name", "Engine choice");
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: BUILT_IN, updateBotDefault: true });
    // Upgrade: a bot with no choice (every bot before this lot) runs exactly where its model was picked.
    let current = await botNow(bot.id);
    expect(current.harness).toBeUndefined();
    expect(current.modelSelection).toMatchObject(BUILT_IN);
    const send = async (text: string) => {
      expect((await control("send", "--bot", bot.id, "--task", threadId, "--text", text)).success).toBe(true);
      expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
    };
    await send("First line, on the built in runtime.");
    expect(seen.some((line) => line.includes("First line, on the built in runtime."))).toBe(true);

    // Runs with pi: the model moves to pi's own id for it; the routing key is still the instance.
    const chosen = await api("PATCH", `/api/bots/${bot.id}`, { harness: "piAgent" });
    expect(chosen.bot.harness).toBe("piAgent");
    expect(chosen.bot.modelSelection).toMatchObject({ instanceId: "pi", model: "openrouter/fixture-model" });
    current = await botNow(bot.id);
    expect(current.tasks.find((task: any) => task.threadId === threadId).modelSelection).toMatchObject({ instanceId: "pi" });
    const before = seen.length;
    await send("Second line, on pi.");
    // The same conversation goes on, on the other engine.
    expect(seen.length).toBe(before);
    const messages = (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    expect(messages.filter((message) => message.role === "user").map((message) => message.text))
      .toEqual(["First line, on the built in runtime.", "Second line, on pi."]);
    expect(messages.filter((message) => message.role === "bot" && message.kind === "text").length).toBeGreaterThanOrEqual(2);

    // A pair the matrix does not offer: refused by name, nothing moves.
    const refused = await api("PATCH", `/api/bots/${bot.id}`, { harness: "claudeAgent" }, 400);
    expect(refused.error).toMatch(/^Claude Code cannot run OpenRouter here\./);
    expect((await botNow(bot.id)).modelSelection).toMatchObject({ instanceId: "pi" });

    // Back to no choice: the bot stays where it runs until a default says otherwise.
    const cleared = await api("PATCH", `/api/bots/${bot.id}`, { harness: null });
    expect(cleared.bot.harness).toBeUndefined();
    expect(cleared.bot.modelSelection).toMatchObject({ instanceId: "pi" });
    const defaults = await api("PUT", "/api/me/models", { harnessByProvider: { openrouter: "openai-compat" } });
    expect(defaults.harnessByProvider).toEqual({ openrouter: "openai-compat" });
    expect((await botNow(bot.id)).modelSelection).toMatchObject(BUILT_IN);
    const impossible = await api("PUT", "/api/me/models", { harnessByProvider: { openrouter: "claudeAgent" } }, 400);
    expect(impossible.error).toMatch(/^Claude Code cannot run OpenRouter here\./);
    expect((await api("GET", "/api/me/models")).harnessByProvider).toEqual({ openrouter: "openai-compat" });

    // A bot made after a default lands on that engine, from its first model.
    await api("PUT", "/api/me/models", { harnessByProvider: { openrouter: "piAgent" } });
    const made = await api("POST", "/api/bots", { name: "Made after the default", modelSelection: BUILT_IN });
    expect(made.bot.harness).toBeUndefined();
    expect(made.bot.modelSelection).toMatchObject({ instanceId: "pi", model: "openrouter/fixture-model" });

    // Clearing the default puts the bots that followed it back on the
    // recommended engine; a bot with its own choice stays where it runs.
    const pinned = await api("POST", "/api/bots", { name: "Its own choice", modelSelection: BUILT_IN });
    expect((await api("PATCH", `/api/bots/${pinned.bot.id}`, { harness: "piAgent" })).bot.modelSelection).toMatchObject({ instanceId: "pi" });
    expect((await api("PUT", "/api/me/models", { harnessByProvider: { openrouter: null } })).harnessByProvider).toEqual({});
    expect((await botNow(made.bot.id)).modelSelection).toMatchObject(BUILT_IN);
    expect((await botNow(bot.id)).modelSelection).toMatchObject(BUILT_IN);
    expect((await botNow(pinned.bot.id)).modelSelection).toMatchObject({ instanceId: "pi", model: "openrouter/fixture-model" });
  } finally {
    await fixture.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 180_000);
