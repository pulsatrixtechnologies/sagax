// The signed-in sites routes through the route table: they name one profile
// or bot, pass the server's reasons through, and sign out of one listed site
// or of all. The work itself is faked; server/browser-sites.test.ts covers it.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { BrowserSitesTarget } from "../browser-sites.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import { createBrowserSiteRoutes, type BrowserSitesRef } from "./browser-sites.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(refusal?: Parameters<typeof createBrowserSiteRoutes>[0]["refusal"]) {
  const asked: BrowserSitesRef[] = [];
  const signedOut: Array<{ session: string; site: string | null }> = [];
  const routes = [createBrowserSiteRoutes({
    target: (which) => {
      asked.push(which);
      if ("bot" in which && which.bot === "guest-bot") return { status: 409, error: "A temporary browser saves no sign-ins." };
      return { binaryPath: "/engine", session: "bot-pepper", env: {}, encryptionKey: "k" } satisfies BrowserSitesTarget;
    },
    list: async () => ({ running: false, sites: [{ site: "example.com", cookies: 2, storage: 1 }] }),
    signOut: async (target, site) => { signedOut.push({ session: target.session, site }); return { running: true, sites: [] }; },
    refusal,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, type = "application/json") => fetch(`${base}/api/browser-sites/sign-out`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
  return { base, asked, signedOut, post };
}

describe("signed-in sites routes", () => {
  // #4471: a person's own bot's browser; the handler's refusal keeps another
  // person's bot and a shared profile out (server/index.ts)
  it("are a person's own routes", () => {
    expect(requiredScope("GET", "/api/browser-sites")).toBe("client");
    expect(requiredScope("POST", "/api/browser-sites/sign-out")).toBe("client");
  });

  it("refuse another person's bot and a shared profile before reaching the browser", async () => {
    const { base, asked, post, signedOut } = await serve((_auth, which) => "profile" in which
      ? { status: 403, error: "A shared browser profile holds the sign-ins of several bots: only an administrator manages it.", code: "shared_browser_profile" }
      : which.bot === "someone-elses" ? { status: 404, error: "no such bot" } : null);
    const shared = await fetch(`${base}/api/browser-sites?profile=profile-work`);
    expect(shared.status).toBe(403);
    expect(await shared.json()).toMatchObject({ code: "shared_browser_profile" });
    expect((await fetch(`${base}/api/browser-sites?bot=someone-elses`)).status).toBe(404);
    const out = await post({ bot: "someone-elses" });
    expect(out.status).toBe(404);
    expect(await out.json()).toEqual({ error: "no such bot" });
    expect(asked).toEqual([]);
    expect(signedOut).toEqual([]);
  });

  it("list one profile's or one bot's sites", async () => {
    const { base, asked } = await serve();
    const response = await fetch(`${base}/api/browser-sites?profile=profile-work`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ running: false, sites: [{ site: "example.com", cookies: 2, storage: 1 }] });
    expect((await fetch(`${base}/api/browser-sites?bot=pepper`)).status).toBe(200);
    expect(asked).toEqual([{ profile: "profile-work" }, { bot: "pepper" }]);
  });

  it("need exactly one profile or bot, and pass the server's reason through", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/api/browser-sites`)).status).toBe(400);
    expect((await fetch(`${base}/api/browser-sites?profile=a&bot=b`)).status).toBe(400);
    const guest = await fetch(`${base}/api/browser-sites?bot=guest-bot`);
    expect(guest.status).toBe(409);
    expect(await guest.json()).toEqual({ error: "A temporary browser saves no sign-ins." });
  });

  it("sign out of one site, or of all when no site is named", async () => {
    const { post, signedOut } = await serve();
    expect((await post({ profile: "profile-work", site: "example.com" })).status).toBe(200);
    expect((await post({ bot: "pepper" })).status).toBe(200);
    expect(signedOut).toEqual([{ session: "bot-pepper", site: "example.com" }, { session: "bot-pepper", site: null }]);
  });

  it("refuse a form post, a bad site and a missing target", async () => {
    const { post, signedOut } = await serve();
    expect((await post({ profile: "profile-work" }, "text/plain")).status).toBe(415);
    expect((await post({ profile: "profile-work", site: "../../etc" })).status).toBe(400);
    expect((await post({ profile: "profile-work", site: 7 })).status).toBe(400);
    expect((await post({ site: "example.com" })).status).toBe(400);
    expect(signedOut).toEqual([]);
  });
});
