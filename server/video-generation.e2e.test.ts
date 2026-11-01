import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { createHarnessClient } from "./drivers/agents-client.ts";
import { callTool, type ToolCallContext } from "./drivers/agents-call.ts";

const mp4 = readFileSync(new URL("./testing/fixtures/generated-video-blue.mp4", import.meta.url));
describe("make_video on the real isolated server", () => {
  it("dispatches the real tool, polls xAI, attaches a streamed MP4, retries without a second generation and serves durable bytes", async () => {
    const requests: Array<{ method?: string; path?: string; auth?: string; body?: Record<string, unknown> }> = [];
    const pollCounts = new Map<string, number>(); let generations = 0; let base = "";
    const upstream = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      requests.push({ method: req.method, path: req.url, auth: req.headers.authorization, ...(raw ? { body: JSON.parse(raw) } : {}) });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/videos/generations") return res.end(JSON.stringify({ request_id: `fixture-request-${++generations}` }));
      if (req.url?.startsWith("/v1/videos/fixture-request-")) {
        const polls = (pollCounts.get(req.url) ?? 0) + 1; pollCounts.set(req.url, polls);
        return res.end(JSON.stringify(polls < 2 ? { status: "pending", progress: 37 } : { status: "done", progress: 100, video: { url: base + "/temporary.mp4", duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 123 } }));
      }
      if (req.url === "/temporary.mp4") { res.setHeader("content-type", "video/mp4"); res.write(mp4.subarray(0, 5)); return res.end(mp4.subarray(5)); }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const capabilityKey = "synthetic-video-capability-key-at-least-32";
    const fixture = await launchVerificationServer({ ...process.env, SAGAX_TEST_INTERNAL_CAPABILITY_KEY: capabilityKey, SAGAX_TEST_VIDEO_URL: base + "/v1" });
    const api = async <T = Record<string, any>>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> => {
      const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json(); expect(response.ok, JSON.stringify(result)).toBe(true); return result as T;
    };
    try {
      await api("PUT", "/api/me/providers/keys/xai", { key: "synthetic-video-api-key" });
      const { bot } = await runControlOmb(["new-bot", "--name", "Video fixture", "--url", fixture.info.url]) as { bot: { id: string; threadId: string } };
      const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Video output" });
      bot.threadId = task.threadId;
      const minted = await api("POST", "/api/testing/internal-capability", { botId: bot.id, threadId: bot.threadId }, { "x-openmausbot-test-capability": capabilityKey });
      let currentToken = minted.token;
      const context: ToolCallContext = { botId: bot.id, threadId: bot.threadId, depth: 0, externalRuntime: false, coordinating: false, sharedComputers: false, client: createHarnessClient(fixture.info.url, () => currentToken) };
      const invoke = async (args: Record<string, unknown>) => {
        const result = await callTool("make_video", args, context);
        expect(result.isError, result.text).not.toBe(true); return JSON.parse(result.text);
      };
      const args = { prompt: "A synthetic blue test frame", request_key: "fixture-blue", duration: 1, generate_audio: false };
      const started = await invoke(args); expect(started.status).toBe("pending");
      const duplicate = await invoke(args); expect(duplicate.job_id).toBe(started.job_id);
      await expect.poll(async () => (await invoke({ action: "status", job_id: started.job_id })).progress, { timeout: 5_000 }).toBe(37);
      await expect.poll(async () => (await invoke({ action: "status", job_id: started.job_id })).status, { timeout: 15_000 }).toBe("completed");
      const completed = await invoke({ action: "retry", job_id: started.job_id });
      expect(completed).toMatchObject({ status: "completed", attached: true, payer: "solo", attachment: { mime: "video/mp4", bytes: mp4.length }, usage: { cost_in_usd_ticks: 123 } });
      expect(completed.attachment.url).toMatch(/^\/api\/threads\/.*\/files\/[a-f0-9]{24}$/);
      expect(JSON.stringify(completed)).not.toContain(base);
      const messages = await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      expect(messages.messages.filter((message: { attachments?: Array<{ mime: string }> }) => message.attachments?.some(file => file.mime === "video/mp4"))).toHaveLength(1);
      // The progress row became the video: no leftover status card.
      expect(messages.messages.filter((message: { kind: string }) => message.kind === "widget")).toHaveLength(0);
      expect(requests.filter(item => item.method === "POST")).toHaveLength(1);
      expect(requests[0]?.body).toMatchObject({ model: "grok-imagine-video-1.5", duration: 1, generate_audio: false });
      expect(requests.find(item => item.path === "/temporary.mp4")?.auth).toBeUndefined();
      const unauthorized = await fetch(fixture.info.url + "/api/internal/video", { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(args) });
      expect(unauthorized.status).toBe(401);
      const durable = await fetch(fixture.info.url + completed.attachment.url, { headers: { origin: fixture.info.url } });
      expect(durable.status).toBe(200); expect(durable.headers.get("content-type")).toBe("video/mp4"); expect(Buffer.from(await durable.arrayBuffer())).toEqual(mp4);
      const invalidImage = await callTool("make_video", { prompt: "blue", image: "/etc/passwd", request_key: "bad-image" }, context);
      expect(invalidImage.isError).toBe(true); expect(invalidImage.text).toContain("already attached");
      // A fresh provider capability after engine recovery still represents
      // the same person's message. Its default identity must not charge twice.
      await runControlOmb(["send", "--bot", bot.id, "--text", "Make a synthetic blue clip.", "--url", fixture.info.url]);
      await runControlOmb(["wait", "--bot", bot.id, "--timeout", "20", "--url", fixture.info.url]);
      const mint = async () => { currentToken = (await api("POST", "/api/testing/internal-capability", { botId: bot.id, threadId: bot.threadId }, { "x-openmausbot-test-capability": capabilityKey })).token; };
      await mint();
      const defaultArgs = { prompt: "Synthetic engine recovery clip", duration: 1, generate_audio: false };
      const beforeRecovery = await invoke(defaultArgs);
      await mint();
      expect((await invoke(defaultArgs)).job_id).toBe(beforeRecovery.job_id);
      expect(requests.filter(item => item.method === "POST")).toHaveLength(2);
      // Stop also reaches asynchronous work after the engine has settled.
      await api("POST", `/api/bots/${bot.id}/interrupt`, { threadId: bot.threadId });
      await mint();
      const stopped = await invoke({ action: "status", job_id: beforeRecovery.job_id });
      expect(stopped.status).toBe("cancelled"); expect(stopped.note).toContain("may continue and be billed");
      const receipts = await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      expect(receipts.messages.some((message: { kind: string; text?: string }) => message.kind === "widget" && message.text?.includes("may still finish and be billed"))).toBe(true);
      upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve()));
      const afterProviderClosed = await fetch(fixture.info.url + completed.attachment.url, { headers: { origin: fixture.info.url } });
      expect(afterProviderClosed.status).toBe(200); expect(Buffer.from(await afterProviderClosed.arrayBuffer())).toEqual(mp4);
    } finally {
      await fixture.close(); upstream.closeAllConnections(); if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  }, 60_000);
});
