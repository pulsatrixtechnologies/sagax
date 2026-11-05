// Measure what a bot turn on an organization server sends to its model
// (#1276): the real Claude Code CLI, launched by the real server for a real
// turn, talks to a loopback stand-in for a local model server that records
// each /v1/messages request. Nothing reaches a real model or a real account.
//
//   node --experimental-strip-types scripts/local-prompt/measure.ts \
//     --cli /absolute/path/to/claude [--out DIR] [--turns 2] [--model local-35b]
//
// It prints, for the first request of each new conversation: the system
// prompt, the tool definitions and the messages, in characters and estimated
// tokens, the tool count per MCP server, and how many leading characters two
// new conversations share (the part a prefix cache can reuse).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcUser } from "../../server/testing/fake-oidc-provider.ts";
import { perspicaxLikeCatalog } from "../../server/testing/perspicax-like-catalog.ts";
import { freePortBlock } from "../../server/testing/ports.ts";
import { promptShape, sharedPrefix } from "./shape.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = join(ROOT, "server", "index.ts");

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

const CLI = arg("cli");
if (!CLI) {
  console.error("usage: measure.ts --cli /absolute/path/to/claude [--out DIR] [--turns N] [--model ID] [--env KEY=VALUE ...]");
  process.exit(2);
}
const TURNS = Number(arg("turns", "2"));
const MODEL = arg("model", "local-35b")!;
const OUT = arg("out") ?? mkdtempSync(join(tmpdir(), "sagax-prompt-"));
const EXTRA_ENV: Record<string, string> = {};
for (let index = 0; index < process.argv.length; index++) {
  if (process.argv[index] !== "--env") continue;
  const [key, ...rest] = (process.argv[index + 1] ?? "").split("=");
  if (key) EXTRA_ENV[key] = rest.join("=");
}

const ALICE: FakeOidcUser = { sub: "01J9S5ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const PROFILE = { id: "01J9S5PROFILEOPERATIONS001", slug: "operations", name: "Operations", description: "Tickets, endpoints, backups" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A loopback stand-in for a local model server: lists one model, answers
 * every /v1/messages with a short text, and keeps each request body. */
async function captureServer(dir: string): Promise<{ server: Server; port: number; bodies: () => string[] }> {
  mkdirSync(dir, { recursive: true });
  let count = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.url?.startsWith("/v1/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: MODEL }] }));
        return;
      }
      if (!req.url?.startsWith("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
      if (req.url.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      count += 1;
      writeFileSync(join(dir, `request-${String(count).padStart(3, "0")}.json`), body);
      let parsed: { stream?: boolean; model?: string } = {};
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }
      const text = "Measured.";
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const event = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        event("message_start", { type: "message_start", message: { id: `m${count}`, type: "message", role: "assistant", model: parsed.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
        event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
        event("content_block_stop", { type: "content_block_stop", index: 0 });
        event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } });
        event("message_stop", { type: "message_stop" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `m${count}`, type: "message", role: "assistant", model: parsed.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  const bodies = () => readdirSync(dir).filter((name) => name.startsWith("request-")).sort().map((name) => readFileSync(join(dir, name), "utf8"));
  return { server, port, bodies };
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "sagax-prompt-home-"));
  const capture = await captureServer(join(OUT, "requests"));
  const idp = await startFakeOidcProvider({ user: ALICE });
  idp.profiles = [PROFILE];
  idp.profilesBySub.set(ALICE.sub, [PROFILE.id]);
  idp.directoryPeople = [idp.personOf(ALICE)];
  idp.mcpTools = perspicaxLikeCatalog();
  // The real CLI, pointed at the stand-in whatever the turn asks for.
  const wrapper = join(home, "claude-local");
  writeFileSync(wrapper, `#!/bin/sh\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:${capture.port}\nexport ANTHROPIC_API_KEY=local\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\nexec ${JSON.stringify(CLI)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const data = join(home, ".sagax");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
  writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
    version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: base, link_token: idp.linkToken,
  }), { mode: 0o640 });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    organization: { memberBotsUseOrgKey: true },
    instances: { claude: { driver: "claudeAgent", ...(Object.keys(EXTRA_ENV).length ? { environment: EXTRA_ENV } : {}), config: { cli: wrapper, fullAuto: true } } },
  }));
  let log = "";
  let child: ChildProcess | null = null;
  try {
    child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: base,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-measure-0000000", SAGAX_ORG_NAME: "Example",
        SAGAX_CONTENT_ENCRYPTION: "off",
        // the before/after switch (#1276): SAGAX_LOCAL_PROMPT=full sends the whole prompt
        ...(process.env.SAGAX_LOCAL_PROMPT ? { SAGAX_LOCAL_PROMPT: process.env.SAGAX_LOCAL_PROMPT } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (log += chunk));
    child.stderr!.on("data", (chunk) => (log += chunk));
    for (const deadline = Date.now() + 30_000; ;) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log.slice(-3000)}`);
      await sleep(150);
    }
    const cookiePair = (value: string) => value.split(";")[0]!;
    const startSignIn = await fetch(`${base}/auth/oidc/start`, { redirect: "manual" });
    const binding = cookiePair(startSignIn.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
    const authorize = await fetch(startSignIn.headers.get("location")!, { redirect: "manual" });
    const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
    const cookie = cookiePair(callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="))!);
    const api = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: parsed, text };
    };
    for (const deadline = Date.now() + 20_000; ;) {
      const people = (await api("GET", "/api/org/directory")).body.people;
      if (Array.isArray(people) && people.length) break;
      if (Date.now() > deadline) throw new Error("the directory never loaded");
      await sleep(200);
    }
    const created = await api("POST", "/api/bots", { name: "Dispatch" });
    if (created.status !== 201) throw new Error(`bot: ${created.text}`);
    const botId = created.body.bot.id as string;
    const set = await api("PATCH", `/api/bots/${botId}`, { modelSelection: { instanceId: "claude", model: MODEL } });
    if (set.status !== 200) throw new Error(`model: ${set.text}`);
    const profiles = await api("PUT", `/api/bots/${botId}/perspicax`, { profiles: [PROFILE.id] });
    // 0.8.44: one Perspicax connection per account, no per-bot profile list.
    if (profiles.status !== 200 && profiles.status !== 404) throw new Error(`profiles: ${profiles.text}`);
    const firsts: string[] = [];
    for (let index = 0; index < TURNS; index++) {
      const before = capture.bodies().length;
      const thread = await api("POST", `/api/bots/${botId}/tasks`, {});
      const threadId = (thread.body.threadId ?? thread.body.task?.threadId ?? thread.body.bot?.threadId) as string | undefined;
      const sent = await api("POST", `/api/bots/${botId}/messages`, { text: "How many endpoint threats this week?", ...(threadId ? { threadId } : {}) });
      if (sent.status !== 202) throw new Error(`send: ${sent.text}`);
      for (const deadline = Date.now() + 120_000; capture.bodies().length === before;) {
        if (Date.now() > deadline) throw new Error(`no model request:\n${log.slice(-4000)}`);
        await sleep(200);
      }
      firsts.push(capture.bodies()[before]!);
      // the turn ends before the next conversation starts
      for (const deadline = Date.now() + 60_000; ;) {
        const bots = (await api("GET", "/api/bots?messages=0")).body.bots as Array<{ id: string; busy?: boolean }>;
        if (!bots.find((bot) => bot.id === botId)?.busy) break;
        if (Date.now() > deadline) break;
        await sleep(300);
      }
    }
    const shapes = firsts.map((body) => promptShape(JSON.parse(body)));
    writeFileSync(join(OUT, "summary.json"), JSON.stringify({ shapes, sharedPrefix: firsts.length > 1 ? sharedPrefix(JSON.parse(firsts[0]!), JSON.parse(firsts[1]!)) : null }, null, 2));
    for (const [index, shape] of shapes.entries()) {
      console.log(`conversation ${index + 1}: ~${shape.tokens.total} tokens (system ~${shape.tokens.system}, tools ~${shape.tokens.tools} in ${shape.toolCount}, messages ~${shape.tokens.messages})`);
      console.log(`  tools by server: ${Object.entries(shape.toolsByServer).map(([name, value]) => `${name} ${value.count}/~${value.tokens}t`).join(", ")}`);
    }
    if (firsts.length > 1) {
      const shared = sharedPrefix(JSON.parse(firsts[0]!), JSON.parse(firsts[1]!));
      console.log(`shared prefix between two new conversations: system ${shared.system}, tools ${shared.tools}; ~${shared.tokens} tokens of ~${shapes[0]!.tokens.system + shapes[0]!.tokens.tools}`);
    }
    console.log(`requests kept in ${join(OUT, "requests")}`);
  } finally {
    if (child) { child.kill("SIGTERM"); await waitForExit(child); }
    await idp.close();
    capture.server.close();
    removeTempDir(home);
  }
}

await main();
