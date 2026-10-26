// Harness-held Perspicax MCP bridge (slice 5).
//
// The engine sees one stdio MCP server per Perspicax profile of its bot. Every
// JSON-RPC frame it writes is forwarded, unchanged, to the harness
// (POST <harness>/api/internal/perspicax/mcp?profile=<id>) with this turn's
// capability; the harness exchanges the speaker's sign-in for a short MCP
// token, relays to Perspicax /mcp and answers. No Perspicax token ever
// reaches this process, its environment or the engine's transcript: the
// capability dies with the turn, and Perspicax journals every call under the
// person who spoke.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 ("Injection par engine"), decision D1 of the slice 5 plan.
//
// stdout is the MCP transport. Never log there.
import { readFileSync } from "node:fs";
import readline from "node:readline";

type Json = Record<string, unknown>;

const HARNESS = (process.env.SAGAX_HARNESS_URL ?? "http://127.0.0.1:8799").replace(/\/+$/, "");
const LAUNCH_TOKEN = process.env.SAGAX_PERSPICAX_TOKEN ?? "";
// A kept or pre-warmed engine process outlives the turn it was launched
// for: the harness rewrites the current turn's capability in this file
// (server/drivers/spawn-contract.ts warmPerspicaxEnv). Read on every frame;
// the launch value is the fallback. Never logged, never sent to stdout.
const TOKEN_FILE = process.env.SAGAX_PERSPICAX_TOKEN_FILE ?? "";
function turnToken(): string {
  if (!TOKEN_FILE) return LAUNCH_TOKEN;
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim() || LAUNCH_TOKEN;
  } catch {
    return LAUNCH_TOKEN;
  }
}
const PROFILE = process.env.SAGAX_PERSPICAX_PROFILE ?? "";
const BOT_ID = process.env.SAGAX_BOT_ID ?? "";
const THREAD_ID = process.env.SAGAX_THREAD_ID ?? "";
const RELAY_TIMEOUT_MS = 10 * 60_000 + 30_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const UNAVAILABLE = "Perspicax is unavailable";

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

function unavailable(id: unknown): Json {
  return { jsonrpc: "2.0", id, error: { code: -32000, message: UNAVAILABLE } };
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function forward(message: Json): Promise<void> {
  const id = message.id;
  const url = new URL(`${HARNESS}/api/internal/perspicax/mcp`);
  url.searchParams.set("profile", PROFILE);
  if (BOT_ID) url.searchParams.set("botId", BOT_ID);
  if (THREAD_ID) url.searchParams.set("fromThreadId", THREAD_ID);
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${turnToken()}` },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    text = await readBounded(response);
    if (!response.ok && response.status !== 202) {
      if (id !== undefined) send(unavailable(id));
      return;
    }
  } catch {
    if (id !== undefined) send(unavailable(id));
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    if (id !== undefined) send(unavailable(id));
    return;
  }
  send(parsed);
}

const input = readline.createInterface({ input: process.stdin, terminal: false });
// Frames are answered in the order they are handled; the harness runs them
// one after another per profile anyway (one MCP session).
let queue: Promise<void> = Promise.resolve();
input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: Json;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    message = value as Json;
  } catch {
    return;
  }
  queue = queue.then(() => forward(message)).catch(() => {});
});
input.on("close", () => {
  void queue.finally(() => process.exit(0));
});
