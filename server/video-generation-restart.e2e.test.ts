import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { createHarnessClient } from "./drivers/agents-client.ts";
import { callTool, type ToolCallContext } from "./drivers/agents-call.ts";
import { waitForExit } from "./testing/cleanup.ts";

// Synthetic person, bot, key and provider only. The provider is an owned
// loopback stand-in for xAI's documented Videos API.
const mp4 = readFileSync(new URL("./testing/fixtures/generated-video-blue.mp4", import.meta.url));
type Row = { id: string; kind: string; text?: string; widget?: unknown; attachments?: Array<{ mime: string }> };

it("a crash after xAI acknowledged the job: the restarted server resumes polling, replaces the progress row with the MP4 and shows a failure receipt", async () => {
  let ready = false; let base = "";
  const posts: string[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/videos/generations") {
      const key = String(JSON.parse(raw).prompt).includes("expire") ? "expiring" : "crash";
      posts.push(key);
      return res.end(JSON.stringify({ request_id: `fixture-${key}` }));
    }
    if (req.url === "/v1/videos/fixture-expiring") return res.end(JSON.stringify({ status: "expired" }));
    if (req.url === "/v1/videos/fixture-crash") {
      return res.end(JSON.stringify(ready
        ? { status: "done", video: { url: base + "/temporary.mp4", duration: 1, respect_moderation: true }, model: "grok-imagine-video-1.5" }
        : { status: "pending", progress: 42 }));
    }
    if (req.url === "/temporary.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(mp4); }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const capabilityKey = "synthetic-video-restart-capability-key-32";
  const parentEnv = { ...process.env, SAGAX_TEST_INTERNAL_CAPABILITY_KEY: capabilityKey, SAGAX_TEST_VIDEO_URL: base + "/v1" };
  const fixture = await launchVerificationServer(parentEnv);
  let restarted: ChildProcess | undefined;
  const api = async <T = Record<string, any>>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json(); expect(response.ok, JSON.stringify(result)).toBe(true); return result as T;
  };
  try {
    await api("PUT", "/api/me/providers/keys/xai", { key: "synthetic-video-api-key" });
    const { bot } = await runControlOmb(["new-bot", "--name", "Video restart fixture", "--url", fixture.info.url]) as { bot: { id: string } };
    const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Video restart" });
    const threadId: string = task.threadId;
    let token = "";
    const mint = async () => { token = (await api("POST", "/api/testing/internal-capability", { botId: bot.id, threadId }, { "x-openmausbot-test-capability": capabilityKey })).token; };
    const context: ToolCallContext = { botId: bot.id, threadId, depth: 0, externalRuntime: false, coordinating: false, sharedComputers: false, client: createHarnessClient(fixture.info.url, () => token) };
    const rows = async () => (await api<{ messages: Row[] }>("GET", `/api/threads/${threadId}/messages?limit=100`)).messages;
    await mint();
    const started = JSON.parse((await callTool("make_video", { prompt: "Synthetic crash clip", request_key: "crash", duration: 1 }, context)).text);
    expect(started.status).toBe("pending");
    // The person sees progress without asking the bot.
    let progressRow: Row | undefined;
    await expect.poll(async () => { progressRow = (await rows()).find(row => row.kind === "widget" && row.text?.includes("42 %")); return Boolean(progressRow); }, { timeout: 15_000 }).toBe(true);

    fixture.child.kill("SIGKILL");
    await waitForExit(fixture.child);
    ready = true;
    const env = verificationServerEnvironment(parentEnv, fixture.info.dataDir, Number(new URL(fixture.info.url).port));
    restarted = spawn(process.execPath, verificationServerArgs(env), { cwd: process.cwd(), env, stdio: "ignore" });
    await expect.poll(async () => {
      try { return (await fetch(`${fixture.info.url}/api/config`)).status; } catch { return 0; }
    }, { timeout: 30_000 }).toBe(200);

    // Recovery polls the same request; the progress row becomes the video.
    await expect.poll(async () => (await rows()).find(row => row.id === progressRow!.id)?.attachments?.[0]?.mime, { timeout: 20_000 }).toBe("video/mp4");
    const after = await rows();
    expect(after.filter(row => row.attachments?.some(file => file.mime === "video/mp4"))).toHaveLength(1);
    expect(after.find(row => row.id === progressRow!.id)).toMatchObject({ kind: "text" });
    expect(after.find(row => row.id === progressRow!.id)?.widget).toBeUndefined();
    expect(posts).toEqual(["crash"]);
    await mint();
    const completed = JSON.parse((await callTool("make_video", { action: "status", job_id: started.job_id }, context)).text);
    expect(completed).toMatchObject({ status: "completed", attached: true, attachment: { bytes: mp4.length } });
    const served = await fetch(fixture.info.url + completed.attachment.url, { headers: { origin: fixture.info.url } });
    expect(served.status).toBe(200); expect(Buffer.from(await served.arrayBuffer())).toEqual(mp4);

    // A provider failure after the turn: a receipt row in the conversation.
    const expiring = await callTool("make_video", { prompt: "Synthetic expire clip", request_key: "expire", duration: 1 }, context);
    expect(JSON.parse(expiring.text).job_id).toEqual(expect.any(String));
    await expect.poll(async () => (await rows()).some(row => row.kind === "widget" && row.text?.includes("expired the request")), { timeout: 15_000 }).toBe(true);
    const failed = await callTool("make_video", { action: "status", job_id: JSON.parse(expiring.text).job_id }, context);
    expect(failed.isError).toBe(true); expect(JSON.parse(failed.text)).toMatchObject({ status: "failed", code: "expired" });
    expect(posts).toEqual(["crash", "expiring"]);
  } finally {
    if (restarted && restarted.exitCode === null) { restarted.kill("SIGTERM"); await waitForExit(restarted); }
    await fixture.close();
    upstream.closeAllConnections(); if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
}, 90_000);
