// A real self-hosted server, asked the way a browser on its own machine asks: refused until it signs in once, while
// the CLI keeps working and a development server keeps trusting its local browser. Port of OpenMausBot #2930.
import { createServer, request } from "node:http";
import { describe, expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { BROWSER_SIGN_IN } from "./request-auth.ts";
import { findChrome, launchPipeChrome } from "./testing/chrome-pipe.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const chrome = findChrome();

/** Headers set exactly as given: Chrome's Sec-Fetch-* and Origin, which a page cannot change. */
function raw(url: string, path: string, headers: Record<string, string>, method = "GET", body?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const target = new URL(path, url);
    const call = request({ hostname: target.hostname, port: target.port, path: target.pathname, method, headers: { host: target.host, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    call.on("upgrade", (res, socket) => { socket.destroy(); resolve({ status: res.statusCode ?? 0, headers: res.headers, body: "" }); });
    call.on("error", reject);
    call.end(body);
  });
}

const fromPage = (origin: string) => ({ origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" });
const otherPage = { origin: "http://localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" };
const navigation = { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" };

describe("a browser on a self-hosted server's own machine", () => {
  it("is refused until it signs in once with a pairing code, while the CLI keeps working", async () => {
    const fixture = await launchVerificationServer({ SAGAX_DEV_TRUST_LOCAL_BROWSER: "0" });
    const url = fixture.info.url;
    try {
      for (const headers of [fromPage(url), otherPage, navigation]) {
        for (const [method, path] of [["GET", "/api/bots"], ["GET", "/api/config"], ["GET", "/api/auth/session"], ["PATCH", "/api/config"]]) {
          const refused = await raw(url, path!, { ...headers, "content-type": "application/json" }, method, method === "PATCH" ? "{}" : undefined);
          expect(refused.status, `${method} ${path}`).toBe(401);
          expect(JSON.parse(refused.body).error).toBe(BROWSER_SIGN_IN);
        }
      }
      const socket = await raw(url, "/api/desktop-viewer/local/shared/websockify", {
        origin: url, upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      });
      expect(socket.status).toBe(401);
      // Public routes still answer a stranger: the sign-in page needs them.
      expect(await raw(url, "/api/health", fromPage(url)).then((answer) => JSON.parse(answer.body))).toEqual({ app: "openmausbot", product: "sagax" });

      // The CLI is Node's fetch, which sends Sec-Fetch-Mode alone.
      const cli = await fetch(`${url}/api/bots`);
      expect(cli.status).toBe(200);
      const opened = await fetch(`${url}/api/auth/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const { code } = await opened.json() as { code: string };

      const paired = await raw(url, "/api/auth/pair", { ...fromPage(url), "content-type": "application/json" }, "POST", JSON.stringify({ code, label: "This browser", cookie: true }));
      expect(paired.status).toBe(200);
      const cookie = String(paired.headers["set-cookie"]).split(";", 1)[0]!;
      const signedIn = await raw(url, "/api/bots", { ...fromPage(url), cookie });
      expect(signedIn.status).toBe(200);
      expect(JSON.parse(signedIn.body).bots).toHaveLength(1);
      // The cookie is for this page only: another page on this machine still gets nothing.
      expect((await raw(url, "/api/bots", { ...otherPage, cookie })).status).toBe(403);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("is trusted as before by a development server, which asked for it", async () => {
    const fixture = await launchVerificationServer();
    try {
      expect((await raw(fixture.info.url, "/api/bots", fromPage(fixture.info.url))).status).toBe(200);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it.skipIf(!chrome)("a real web page on this computer cannot drive the server: no read, no change, no event stream", async () => {
    const fixture = await launchVerificationServer({ SAGAX_DEV_TRUST_LOCAL_BROWSER: "0" });
    const url = fixture.info.url;
    // Any local site: a page the person opened, or one a bot's dev server serves.
    const site = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>hostile</title>"); });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", () => resolve()));
    const home = `http://127.0.0.1:${(site.address() as { port: number }).port}/`;
    const browser = await launchPipeChrome(chrome!, []);
    try {
      const before = await (await fetch(`${url}/api/bots`)).json() as { bots: unknown[] };
      const page = await browser.page();
      expect((await page.navigate(home)).errorText).toBeUndefined();
      await page.loaded(home);
      const outcome = await page.evaluate<Record<string, string>>(`(async () => {
        const server = ${JSON.stringify(url)};
        const settle = (promise, ms = 4000) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))]);
        return {
          // A simple request needs no preflight: before the port it created a bot as the owner.
          create: await settle(fetch(server + "/api/bots", { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ name: "Planted" }) }).then(() => "sent", () => "failed")),
          config: await settle(fetch(server + "/api/config", { method: "PATCH", mode: "no-cors", headers: { "content-type": "text/plain" }, body: "{}" }).then(() => "sent", () => "failed")),
          read: await settle(fetch(server + "/api/config").then((r) => r.text(), () => "blocked")),
          events: await settle(new Promise((resolve) => { const socket = new WebSocket(server.replace(/^http/, "ws") + "/api/events"); socket.onopen = () => resolve("open"); socket.onerror = () => resolve("refused"); })),
        };
      })()`, hostTimeout(60_000));
      expect(outcome.read).toBe("blocked");
      expect(outcome.events).toBe("refused");
      const after = await (await fetch(`${url}/api/bots`)).json() as { bots: unknown[] };
      expect(after.bots).toHaveLength(before.bots.length);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => site.close(() => resolve()));
      await fixture.close();
    }
  }, 120_000);
});
