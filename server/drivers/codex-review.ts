// One isolated Codex review (lot A1b). A fresh app-server, an empty folder,
// read-only sandbox, no MCP servers. The prompt travels in the turn input,
// never in argv or the environment. Any command, tool, file change or
// approval request fails the call: the card stays with the person.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { killCliTree, spawnCli } from "../procs.ts";

export const CODEX_REVIEW_TIMEOUT_MS = 60_000;

const TOOL_ITEM = new Set(["commandExecution", "mcpToolCall", "fileChange", "webSearch", "imageGeneration"]);

export function reviewCodexPermission(input: {
  cli: string;
  env: Record<string, string | undefined>;
  prompt: string;
  signal?: AbortSignal;
  model?: string;
}): Promise<string> {
  if (input.signal?.aborted) return Promise.reject(new Error("Codex review aborted"));
  const cwd = mkdtempSync(join(tmpdir(), "omb-codex-review-"));
  const child = spawnCli(input.cli, ["app-server"], {
    cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let settled = false;
  let buffer = "";
  let output = "";
  let nextId = 1;
  let threadId = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  const finish = (error?: Error, text?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    for (const waiter of pending.values()) waiter.reject(error ?? new Error("Codex review closed"));
    pending.clear();
    void killCliTree(child).catch(() => undefined).finally(() => {
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* the OS reclaims a temp folder */ }
    });
    if (error) reject(error);
    else if (!text?.trim()) reject(new Error("Codex review returned no text"));
    else resolve(text.trim());
  };
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((ok, fail) => { resolve = ok; reject = fail; });
  const onAbort = () => finish(new Error("Codex review aborted"));
  const timer = setTimeout(() => finish(new Error("Codex review timed out")), CODEX_REVIEW_TIMEOUT_MS);
  timer.unref?.();

  const send = (message: unknown) => {
    if (settled) return;
    try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch { /* close reports a dead child */ }
  };
  const request = (method: string, params: unknown): Promise<any> => new Promise((ok, fail) => {
    if (settled) return fail(new Error("Codex review closed"));
    const id = nextId++;
    pending.set(id, { resolve: ok, reject: fail });
    send({ jsonrpc: "2.0", id, method, params });
  });

  const onMessage = (msg: any) => {
    if (msg?.id !== undefined && msg.method === undefined) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (!waiter) return;
      if (msg.error) waiter.reject(new Error("Codex review request failed"));
      else waiter.resolve(msg.result);
      return;
    }
    if (msg?.id !== undefined && typeof msg.method === "string") {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Sagax review allows no tools" } });
      finish(new Error(`Codex review asked for ${msg.method}`));
      return;
    }
    const params = msg?.params;
    if (threadId && params?.threadId && params.threadId !== threadId) return;
    const item = params?.item;
    const itemType = typeof item?.type === "string" ? item.type : "";
    if (TOOL_ITEM.has(itemType)) {
      finish(new Error("Codex review tried to use a tool"));
      return;
    }
    if (msg?.method === "item/agentMessage/delta" && typeof params?.delta === "string") {
      output += params.delta;
      if (output.length > 20_000) finish(new Error("Codex review answer exceeded its limit"));
      return;
    }
    if (msg?.method === "item/completed" && itemType === "agentMessage" && typeof item?.text === "string" && !output) {
      output = item.text;
    }
    if (msg?.method === "turn/completed") {
      const status = params?.turn?.status;
      if (status === "completed") finish(undefined, output);
      else finish(new Error("Codex review did not finish"));
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.resume();
  child.on("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
  child.on("close", () => { if (!settled) finish(new Error("Codex review process exited")); });
  child.stdout.on("data", (chunk: string) => {
    if (settled) return;
    buffer += chunk;
    if (buffer.length > 4_000_000) return finish(new Error("Codex review output exceeded its limit"));
    let newline: number;
    while (!settled && (newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try { onMessage(JSON.parse(line)); } catch { /* banners are not protocol */ }
    }
  });
  input.signal?.addEventListener("abort", onAbort, { once: true });

  void (async () => {
    await request("initialize", {
      clientInfo: { name: "sagax-review", title: "Sagax", version: "1" },
      capabilities: { experimentalApi: true },
    });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    const started = await request("thread/start", {
      cwd,
      ...(input.model ? { model: input.model } : {}),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "read-only",
      ephemeral: true,
      developerInstructions: "Reply with text only. Do not use tools, commands or files.",
    });
    threadId = typeof started?.thread?.id === "string" ? started.thread.id : "";
    if (!threadId) throw new Error("Codex review did not start a thread");
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt }],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "readOnly" },
      environments: [],
    });
  })().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));

  return promise;
}
