// Electron side of scripts/verify/dev/verify-desktop-bridge.ts: the app's own desktop
// bridge (electron/desktop-bridge.mjs) wired the way electron/main.mjs wires
// it in server mode (Electron's session fetch and cookies, its network stack
// for fetch_url, an offscreen window for browse), signed in as the person.
import { app, BrowserWindow, session } from "electron";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { createDesktopBridge } from "../../../electron/desktop-bridge.mjs";

const origin = process.env.VERIFY_ORIGIN;
const cookie = process.env.VERIFY_COOKIE;
const lanPort = Number(process.env.VERIFY_LAN_PORT);
const attachmentsDir = process.env.VERIFY_ATTACHMENTS;
const home = process.env.VERIFY_HOME;
const log = (line) => console.log(`[bridge] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => { checks.push(ok); log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, predicate, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await wait(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

app.whenReady().then(async () => {
  try {
    mkdirSync(home, { recursive: true });
    const [name, value] = cookie.split("=");
    await session.defaultSession.cookies.set({ url: origin, name, value, httpOnly: true });
    // main's own calls to the server
    const call = async (method, route, body, type = "application/json") => {
      const response = await session.defaultSession.fetch(`${origin}${route}`, {
        method, bypassCustomProtocolHandlers: true, headers: body === undefined ? {} : { "content-type": type },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: response.status, json, text };
    };
    const browseSession = session.fromPartition("sagax-bridge-browse");
    const bridge = createDesktopBridge({
      environment: () => ({ id: "org", name: "Acme", origin }),
      fetch: (url, init) => session.defaultSession.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
      cookieHeader: async (url) => (await session.defaultSession.cookies.get({ url })).map((entry) => `${entry.name}=${entry.value}`).join("; "),
      home, attachmentsDir, protectedPaths: [app.getPath("userData")],
      activityFile: path.join(app.getPath("userData"), "desktop-bridge-activity.jsonl"),
      fetchUrl: (url, init) => session.fromPartition("sagax-bridge-net").fetch(url, init),
      resolveProxy: (url) => session.defaultSession.resolveProxy(url),
      // This desktop's own network: intranet.sagax.test is a LAN address
      // only it knows (10.77.0.5), which its routes reach.
      lookup: async (host) => host === "intranet.sagax.test" ? [{ address: "10.77.0.5", family: 4 }] : Promise.reject(new Error("nx")),
      tunnelConnect: ({ host, port }) => new Promise((resolve, reject) => {
        import("node:net").then(({ connect }) => {
          const socket = host === "10.77.0.5" ? connect(lanPort, "127.0.0.1") : connect(port, host);
          socket.once("connect", () => resolve(socket));
          socket.once("error", reject);
        });
      }),
      browse: async (url) => {
        const win = new BrowserWindow({ show: false, webPreferences: { session: browseSession, offscreen: true, sandbox: true } });
        try { await win.loadURL(url); return { content: [{ type: "text", text: String(await win.webContents.executeJavaScript("document.documentElement.outerHTML")) }] }; }
        finally { win.destroy(); }
      },
      hostname: "Ada-Mac",
      retryMs: 500,
    });
    bridge.sync();
    const status = await until("the bridge and its tunnel", async () => {
      const answer = await call("GET", "/api/me/desktop-bridge");
      return answer.json?.connected && answer.json?.tunnel ? answer.json : null;
    });
    check("this desktop is connected for the signed-in person, with its network tunnel", status.desktops[0]?.name === "Ada-Mac");

    const created = await call("POST", "/api/bots", { name: "Xavier" });
    const bot = created.json.bot;
    await call("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    const turn = async (text) => {
      const before = ((await call("GET", `/api/threads/${bot.threadId}/messages`)).json.messages ?? []).filter((m) => m.role === "bot" && m.kind === "text").length;
      const sent = await call("POST", `/api/bots/${bot.id}/messages`, { text });
      if (sent.status !== 202) throw new Error(`send failed ${sent.status} ${sent.text}`);
      const reply = await until("the reply", async () => {
        const replies = ((await call("GET", `/api/threads/${bot.threadId}/messages`)).json.messages ?? []).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
        return replies.length > before ? replies.at(-1) : null;
      }, 60_000);
      await until("the bot idle", async () => !((await call("GET", "/api/bots")).json.bots ?? []).find((b) => b.id === bot.id)?.busy);
      return reply.text;
    };
    const attach = async (name, body) => (await call("POST", `/api/files?name=${encodeURIComponent(name)}`, body, "text/markdown")).json;

    // 1. desktop connected
    const readme = await attach("README.md", "# Sagax\nread me on the desktop\n");
    const reply = await turn(`read the attachment\n\n<attached-file path="${readme.path}" name="README.md" />`);
    const dump = JSON.parse(readFileSync(process.env.VERIFY_MCP_DUMP, "utf8"));
    const desktopCall = dump.calls.find((entry) => entry.server === "sagax-desktop");
    check("the bot read the attached file on this computer", reply.includes("mcp:read_file:ok") && desktopCall?.text?.includes("read me on the desktop"), desktopCall?.text?.slice(0, 80));
    check("the bot's tools were mounted on this computer, not the server environment", dump.servers.includes("sagax-desktop") && !dump.servers.includes("sagax-environment"));
    const staged = existsSync(attachmentsDir) ? (await import("node:fs")).readdirSync(attachmentsDir) : [];
    check("the attachment was copied into this desktop's attachments folder", staged.some((file) => /^[0-9a-f]{8}-README\.md$/.test(file)), staged.join(","));
    const prompt = readFileSync(process.env.VERIFY_PROMPTS, "utf8").trimEnd().split("\n").at(-1);
    check("the bot was told this desktop's path", prompt.includes(attachmentsDir.replaceAll("\\", "\\\\")) && !prompt.includes(readme.path));
    check("the engine's HTTP reached a LAN host only this desktop knows, through it", reply.includes("proxy:200:lan says hi to /hello"), reply.split("\n").find((line) => line.startsWith("proxy:")));
    const activity = bridge.activity(20);
    check("this computer logged the action and the destination host", activity.some((entry) => entry.action === "read_file") && activity.some((entry) => entry.action === "network" && entry.detail === "intranet.sagax.test:80"));

    // 2. desktop disconnected
    bridge.close();
    await until("the server to see the desktop gone", async () => (await call("GET", "/api/me/desktop-bridge")).json?.connected === false, 60_000);
    const later = await attach("later.md", "# later\n");
    const fallback = await turn(`read the attachment\n\n<attached-file path="${later.path}" name="later.md" />`);
    const after = JSON.parse(readFileSync(process.env.VERIFY_MCP_DUMP, "utf8"));
    check("with the desktop disconnected, the bot used the server environment", fallback.includes("mcp:read_file:ok") && after.servers.includes("sagax-environment") && !after.servers.includes("sagax-desktop"), `${fallback.split("\n").slice(-1)[0]} ${JSON.stringify(after.calls.map((entry) => [entry.server, entry.ok, entry.text.slice(0, 120)]))}`);
    check("and no traffic went through this computer", fallback.includes("proxy:none"));
    const lastPrompt = readFileSync(process.env.VERIFY_PROMPTS, "utf8").trimEnd().split("\n").at(-1);
    check("the bot was told the server environment path and why", /\/workspace\/attachments\/[0-9a-f]{8}-later\.md/.test(lastPrompt) && lastPrompt.includes("computer is not connected"));
  } catch (error) {
    check("no error", false, error?.stack ?? String(error));
  }
  const failed = checks.filter((ok) => !ok).length;
  app.exit(failed ? 1 : 0);
});
