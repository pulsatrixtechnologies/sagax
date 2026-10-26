// The bots' email addresses read from a fake Perspicax over real HTTP
// (contract B of 2026-10-21, server/bot-mail-addresses.ts): one batched call
// for the server's bots with the link token, a 5 minute cache, and
// `available: false` on a 404, an error, an answer that is not the
// contract's, inbound mail off, or no link.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BOT_MAIL_ADDRESSES_PATH, BOT_MAIL_CACHE_MS, BotMailAddresses, type BotMailBot } from "./bot-mail-addresses.ts";
import { PerspicaxDirectory } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN = `pxat1.${"m".repeat(43)}`;

type Handler = (req: IncomingMessage, body: any, res: ServerResponse) => void;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const answer = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const enabledAnswer = (body: any) => ({
  enabled: true,
  domain: "bots.example.org",
  addresses: body.bots.map((bot: { id: string; name: string }) => ({
    bot_id: bot.id,
    address: `${bot.name.toLowerCase()}@bots.example.org`,
    enabled: bot.id !== "bot_off",
  })),
});

async function fakePerspicax(handler: Handler, bots: BotMailBot[] = [
  { id: "bot_abc", name: "Cryptic", ownerSub: "u_123" },
  { id: "bot_off", name: "Ember", ownerSub: "u_123" },
  { id: "bot_local", name: "Local", ownerSub: null },
]) {
  const seen: Array<{ path: string; authorization: string; body: any }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ path: req.url ?? "", authorization: String(req.headers.authorization ?? ""), body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const dir = mkdtempSync(join(tmpdir(), "px-botmail-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const linkFile = join(dir, "pulsabot.json");
  writeFileSync(linkFile, JSON.stringify({ version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: SERVER_ID, origin: ORIGIN, link_token: TOKEN }));
  chmodSync(linkFile, 0o600);
  const directory = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    linkFile,
    expect: { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" },
    principals: new PrincipalRegistry({ path: join(dir, "principals.json") }),
    onPersonOut: () => {},
    onRoleNarrowed: () => {},
    version: "0.1.101",
    log: () => {},
  });
  let clock = 1_000_000;
  const log: string[] = [];
  const roster = [...bots];
  const addresses = new BotMailAddresses({ link: () => directory, bots: () => roster, now: () => clock, log: (line) => log.push(line) });
  return { seen, addresses, log, roster, tick: (ms: number) => { clock += ms; } };
}

describe("BotMailAddresses (contract B)", () => {
  it("asks once for every bot with an owner, with the link token, and caches the answer 5 minutes", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)));
    expect(await px.addresses.forBot("bot_abc")).toEqual({ available: true, address: "cryptic@bots.example.org", enabled: true });
    expect(px.seen).toHaveLength(1);
    expect(px.seen[0]).toMatchObject({ path: BOT_MAIL_ADDRESSES_PATH, authorization: `Bearer ${TOKEN}` });
    // v2 (F8): the list is every bot with a Perspicax owner: complete
    expect(px.seen[0]!.body).toEqual({ complete: true, bots: [
      { id: "bot_abc", name: "Cryptic", owner_sub: "u_123" },
      { id: "bot_off", name: "Ember", owner_sub: "u_123" },
    ] });
    // the other bot comes from the same answer
    expect(await px.addresses.forBot("bot_off")).toEqual({ available: true, address: "ember@bots.example.org", enabled: false });
    expect(px.seen).toHaveLength(1);
    px.tick(BOT_MAIL_CACHE_MS - 1);
    await px.addresses.forBot("bot_abc");
    expect(px.seen).toHaveLength(1);
    px.tick(2);
    await px.addresses.forBot("bot_abc");
    expect(px.seen).toHaveLength(2);
    // the last bot gone: an empty, complete list
    px.roster.splice(0, px.roster.length);
    await px.addresses.resync();
    expect(px.seen[2]!.body).toEqual({ complete: true, bots: [] });
  });

  it("a bot with no Perspicax owner has no address and is never sent", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)));
    expect(await px.addresses.forBot("bot_local")).toEqual({ available: false, address: null, enabled: false });
    expect(px.seen.every((call) => !JSON.stringify(call.body).includes("bot_local"))).toBe(true);
  });

  it("asks again at once for a bot the cached answer did not cover (a new bot)", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)));
    await px.addresses.forBot("bot_abc");
    px.roster.push({ id: "bot_new", name: "Nova", ownerSub: "u_9" });
    expect(await px.addresses.forBot("bot_new")).toEqual({ available: true, address: "nova@bots.example.org", enabled: true });
    expect(px.seen).toHaveLength(2);
  });

  it("concurrent reads share one call", async () => {
    const px = await fakePerspicax((_req, body, res) => setTimeout(() => answer(res, 200, enabledAnswer(body)), 20));
    const got = await Promise.all([px.addresses.forBot("bot_abc"), px.addresses.forBot("bot_off"), px.addresses.forBot("bot_abc")]);
    expect(got.map((entry) => entry.available)).toEqual([true, true, true]);
    expect(px.seen).toHaveLength(1);
  });

  it("inbound mail off: nothing is available", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, {
      enabled: false, domain: null, addresses: body.bots.map((bot: { id: string }) => ({ bot_id: bot.id, address: null, enabled: false })),
    }));
    expect(await px.addresses.forBot("bot_abc")).toEqual({ available: false, address: null, enabled: false });
  });

  it.each([
    ["an older Perspicax (404)", (res: ServerResponse) => answer(res, 404, { error: "not_found" })],
    ["a 500", (res: ServerResponse) => answer(res, 500, { error: "boom" })],
    ["a refused link (401)", (res: ServerResponse) => answer(res, 401, { error: "unauthorized" })],
    ["an answer that is not the contract's", (res: ServerResponse) => answer(res, 200, { enabled: true, addresses: "nope" })],
    ["an address that is not one", (res: ServerResponse) => answer(res, 200, { enabled: true, domain: "x", addresses: [{ bot_id: "bot_abc", address: "not an address", enabled: true }] })],
  ])("%s: available false, cached, and the log never holds the token", async (_label, reply) => {
    const px = await fakePerspicax((_req, _body, res) => reply(res));
    expect(await px.addresses.forBot("bot_abc")).toEqual({ available: false, address: null, enabled: false });
    const calls = px.seen.length; // a 401 re-reads the link file and tries once more
    expect(await px.addresses.forBot("bot_abc")).toEqual({ available: false, address: null, enabled: false });
    expect(px.seen).toHaveLength(calls);
    expect(px.log.join("\n")).not.toContain(TOKEN);
  });

  it("no link: available false, no call", async () => {
    const addresses = new BotMailAddresses({ link: () => null, bots: () => [{ id: "bot_abc", name: "Cryptic", ownerSub: "u_1" }] });
    expect(await addresses.forBot("bot_abc")).toEqual({ available: false, address: null, enabled: false });
  });

  it("sends at most 500 bots, the asked one always among them", async () => {
    const many: BotMailBot[] = Array.from({ length: 600 }, (_, i) => ({ id: `bot_${i}`, name: `B${i}`, ownerSub: "u_1" }));
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)), many);
    expect((await px.addresses.forBot("bot_599")).available).toBe(true);
    expect(px.seen[0]!.body.bots).toHaveLength(500);
    expect(px.seen[0]!.body.bots[0].id).toBe("bot_599");
    // a partial list never says complete: Perspicax would drop the others
    expect(px.seen[0]!.body).not.toHaveProperty("complete");
  });
});

describe("BotMailAddresses: re-sync and the owner's new address (v2)", () => {
  it("resync() forgets the cache and sends the full list again at once (ownership transfer, delete)", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)));
    await px.addresses.forBot("bot_abc");
    px.roster.splice(1, 1); // bot_off deleted
    await px.addresses.resync();
    expect(px.seen).toHaveLength(2);
    expect(px.seen[1]!.body).toEqual({ complete: true, bots: [{ id: "bot_abc", name: "Cryptic", owner_sub: "u_123" }] });
    await px.addresses.forBot("bot_abc");
    expect(px.seen).toHaveLength(2);
  });

  it("changes the local part for the owner, then forgets the cache", async () => {
    const px = await fakePerspicax((req, body, res) => {
      if (req.url?.endsWith("/local-part")) return answer(res, 200, { bot_id: "bot_abc", address: `${body.local_part}@bots.example.org`, enabled: true });
      answer(res, 200, enabledAnswer(body));
    });
    await px.addresses.forBot("bot_abc");
    const changed = await px.addresses.setLocalPart("bot_abc", "u_123", "factures");
    expect(changed).toEqual({ ok: true, mail: { available: true, address: "factures@bots.example.org", enabled: true } });
    const call = px.seen.find((seen) => seen.path.endsWith("/local-part"))!;
    expect(call).toMatchObject({ path: `${BOT_MAIL_ADDRESSES_PATH}/bot_abc/local-part`, authorization: `Bearer ${TOKEN}`, body: { owner_sub: "u_123", local_part: "factures" } });
    const before = px.seen.length;
    await px.addresses.forBot("bot_abc");
    expect(px.seen.length).toBe(before + 1);
  });

  it.each([
    [400, { error: "invalid" }, "invalid"],
    [403, { error: "not_owner" }, "not_owner"],
    [404, { error: "no_bot" }, "no_bot"],
    [409, { error: "taken" }, "taken"],
    // second review: Perspicax's per bot and per owner limit
    [429, { error: "rate_limited" }, "rate_limited"],
    [429, { error: "other" }, "unavailable"],
    [404, { error: "not_found" }, "unavailable"],
    [500, { error: "boom" }, "unavailable"],
  ])("maps Perspicax's %s %j to %s", async (status, body, error) => {
    const px = await fakePerspicax((_req, _body, res) => answer(res, status, body));
    expect(await px.addresses.setLocalPart("bot_abc", "u_123", "factures")).toEqual({ ok: false, error });
  });

  it("never calls Perspicax for a malformed local part", async () => {
    const px = await fakePerspicax((_req, body, res) => answer(res, 200, enabledAnswer(body)));
    for (const bad of ["", "-x", "x-", "Majuscule", "a b", "é", "a".repeat(41), "a/b"]) {
      expect(await px.addresses.setLocalPart("bot_abc", "u_123", bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(px.seen).toHaveLength(0);
  });
});
