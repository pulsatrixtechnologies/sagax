// Public share links for bot templates (server/template-links.ts,
// server/routes/template-links.ts): the signature, revocation, what never
// travels (starter notes, connections), the card, and import from a link.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { parsePackageDocument, type PackageDocument } from "../shared/package-format.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createTemplateLinkRoutes, handleTemplateLinkPublic, templateLinkToken } from "./routes/template-links.ts";
import { cardLanguage, publicTemplateDocument, TemplateLinks, templateCardHtml } from "./template-links.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function links(): { links: TemplateLinks; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-template-links-"));
  dirs.push(dir);
  return { links: new TemplateLinks(dir), dir };
}

function template(): PackageDocument {
  return parsePackageDocument({
    format: "openmaus.package", version: 2,
    package: {
      id: "support-agent", release: "1.0.0", name: "Support agent", tagline: "A preset.", summary: "Shared.",
      category: "Community", author: { name: "Mira <script>" }, license: "Unspecified", outcomes: ["x"], setupMinutes: 2,
      requirements: { apps: [], capabilities: [] }, agents: [],
      presets: [{
        key: "new-bot-defaults", name: "Support agent", description: "Answers <b>tickets</b>",
        bot: { name: "Sky", soul: "Be kind." }, skills: ["follow-up"],
        seed: { memory: { "memory/tone.md": "Private client notes.\n" } },
      }],
      skills: { version: 1, entries: [{ name: "follow-up", description: "Follow up steps.", instructions: "---\nname: follow-up\ndescription: Follow up steps.\n---\n\n# Follow up\n\nDo it well.\n" }] },
    },
  }, { trust: "file" });
}

function request(path: string, method = "GET", headers: Record<string, string> = {}): { req: IncomingMessage; res: ServerResponse; done: Promise<{ status: number; headers: Record<string, unknown>; body: string }> } {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = headers;
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let resolve!: (value: { status: number; headers: Record<string, unknown>; body: string }) => void;
  const done = new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((r) => { resolve = r; });
  res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof res.write;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string));
    resolve({ status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks).toString("utf8") });
    return res;
  }) as typeof res.end;
  return { req, res, done };
}

describe("template link signature and revocation", () => {
  it("signs each link with a key kept at 0600, and refuses a tampered or made-up token", () => {
    const { links: store, dir } = links();
    const record = store.create(template());
    const token = store.token(record.id);
    expect(store.verify(token)).toBe(record.id);
    expect(store.open(token)?.name).toBe("Support agent");
    const [id, mac] = token.split(".");
    const flipped = `${id}.${mac!.slice(0, -1)}${mac!.endsWith("A") ? "B" : "A"}`;
    expect(store.verify(flipped)).toBeNull();
    expect(store.open(`${"A".repeat(22)}.${mac}`)).toBeNull();
    expect(store.open("nope")).toBeNull();
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "template-links.key")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "template-links.json")).mode & 0o777).toBe(0o600);
    }
    // another server's key does not open this server's links
    expect(links().links.open(token)).toBeNull();
  });

  it("revoking turns the link off for good: the same token answers 404 like a made-up one", async () => {
    const { links: store } = links();
    const record = store.create(template());
    const path = store.path(record.id);
    const before = request(path);
    expect(handleTemplateLinkPublic(store, before.req, before.res, path, "GET")).toBe(true);
    expect((await before.done).status).toBe(200);
    expect(store.revoke(record.id)).toBe(true);
    expect(store.revoke(record.id)).toBe(false);
    const after = request(path);
    handleTemplateLinkPublic(store, after.req, after.res, path, "GET");
    const answer = await after.done;
    expect(answer.status).toBe(404);
    expect(answer.body).toContain("turned off");
    expect(store.list()).toEqual([]);
  });
});

describe("what a public template holds", () => {
  it("never carries starter notes or connections, and keeps the instructions and skills", () => {
    const shown = publicTemplateDocument(template());
    const text = JSON.stringify(shown);
    expect(text).not.toContain("Private client notes");
    expect(shown.package.presets?.[0]).not.toHaveProperty("seed");
    expect(shown.package).not.toHaveProperty("connections");
    expect(shown.package.presets?.[0]?.bot.soul).toBe("Be kind.");
    expect(shown.package.presets?.[0]?.skills).toEqual(["follow-up"]);
  });

  it("stores only the public form", () => {
    const { links: store } = links();
    const record = store.create(template());
    expect(JSON.stringify(store.get(record.id))).not.toContain("Private client notes");
  });

  it("serves a read-only card without script, escaped, in French or English", async () => {
    const html = templateCardHtml(publicTemplateDocument(template()), "fr");
    expect(html).toContain("Modèle de bot Sagax");
    expect(html).toContain("Answers &lt;b&gt;tickets&lt;/b&gt;");
    expect(html).toContain("Mira &lt;script&gt;");
    expect(html).not.toMatch(/<script/i);
    expect(cardLanguage("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(cardLanguage("en-US")).toBe("en");
    const { links: store } = links();
    const record = store.create(template());
    const path = store.path(record.id);
    const card = request(path, "GET", { "accept-language": "en-CA" });
    handleTemplateLinkPublic(store, card.req, card.res, path, "GET");
    const answer = await card.done;
    expect(answer.headers["content-type"]).toContain("text/html");
    expect(String(answer.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(answer.headers["referrer-policy"]).toBe("no-referrer");
    expect(answer.body).toContain("Use this template");
    const data = request(`${path}.json`);
    handleTemplateLinkPublic(store, data.req, data.res, `${path}.json`, "GET");
    const payload = JSON.parse((await data.done).body) as { document: PackageDocument };
    expect(payload.document.package.name).toBe("Support agent");
    expect(JSON.stringify(payload)).not.toContain("Private client notes");
  });

  it("leaves other paths alone", () => {
    const { links: store } = links();
    const other = request("/api/bots");
    expect(handleTemplateLinkPublic(store, other.req, other.res, "/api/bots", "GET")).toBe(false);
  });
});

describe("template link routes", () => {
  const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] } as unknown as RequestAuth;
  function routes(store: TemplateLinks, fetchRemote?: (url: URL) => Promise<unknown>) {
    return createTemplateLinkRoutes({
      links: store,
      buildTemplate: () => template(),
      creator: () => undefined,
      origin: () => "https://sagax.example.com",
      reachable: (origin) => !origin.includes("127.0.0.1"),
      ...(fetchRemote ? { fetchRemote } : {}),
    });
  }
  async function call(handler: ReturnType<typeof routes>, method: string, path: string, body?: unknown) {
    const { req, res, done } = request(path, method, { "content-type": "application/json" });
    if (body !== undefined) {
      process.nextTick(() => { req.push(JSON.stringify(body)); req.push(null); });
    } else {
      process.nextTick(() => req.push(null));
    }
    await handler({ req, res, url: new URL(`http://x${path}`), path, method, auth: owner, json, readBody });
    const answer = await done;
    return { status: answer.status, body: answer.body ? JSON.parse(answer.body) : null };
  }

  it("creates, lists and revokes a link, and imports it back from its address", async () => {
    const { links: store } = links();
    const handler = routes(store);
    const created = await call(handler, "POST", "/api/template-links", { name: "Support agent" });
    expect(created.status).toBe(201);
    expect(created.body.link.url).toMatch(/^https:\/\/sagax\.example\.com\/share\/template\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{32}$/);
    expect(created.body.link.reachable).toBe(true);
    const listed = await call(handler, "GET", "/api/template-links");
    expect(listed.body.links).toHaveLength(1);
    const imported = await call(handler, "POST", "/api/template-links/import", { url: created.body.link.url });
    expect(imported.status).toBe(200);
    expect(imported.body.document.package.presets[0].name).toBe("Support agent");
    expect(JSON.stringify(imported.body)).not.toContain("Private client notes");
    const revoked = await call(handler, "DELETE", `/api/template-links/${created.body.link.id}`);
    expect(revoked.status).toBe(200);
    expect((await call(handler, "DELETE", `/api/template-links/${created.body.link.id}`)).status).toBe(404);
  });

  it("updates the template under the same link and shows its details, never the starter notes", async () => {
    const { links: store } = links();
    let description = "Answers tickets";
    const handler = createTemplateLinkRoutes({
      links: store,
      buildTemplate: (body) => {
        const document = template();
        document.package.presets![0]!.description = body.description ?? description;
        return document;
      },
      creator: () => undefined,
      origin: () => "https://sagax.example.com",
      reachable: () => true,
    });
    const created = await call(handler, "POST", "/api/template-links", {});
    const id = created.body.link.id as string;
    description = "Answers tickets and calls";
    const updated = await call(handler, "PUT", `/api/template-links/${id}`, {});
    expect(updated.status).toBe(200);
    expect(updated.body.link.url).toBe(created.body.link.url);
    expect(updated.body.link.updatedAt).toEqual(expect.any(Number));
    expect(updated.body.template).toMatchObject({ title: "Support agent", description: "Answers tickets and calls", skills: ["follow-up"] });
    const token = (created.body.link.path as string).split("/").at(-1)!;
    expect(store.open(token)?.document.package.presets?.[0]?.description).toBe("Answers tickets and calls");
    const details = await call(handler, "GET", `/api/template-links/${id}`);
    expect(details.body.template.description).toBe("Answers tickets and calls");
    expect(JSON.stringify(details.body)).not.toContain("Private client notes");
    expect(JSON.stringify(details.body)).not.toContain("Be kind.");
    expect((await call(handler, "PUT", `/api/template-links/${id}`, { bogus: 1 })).status).toBe(400);
    await call(handler, "DELETE", `/api/template-links/${id}`);
    expect((await call(handler, "PUT", `/api/template-links/${id}`, {})).status).toBe(404);
    expect((await call(handler, "GET", `/api/template-links/${id}`)).status).toBe(404);
  });

  it("imports another server's link through its JSON, stripped again, and refuses what is not a link", async () => {
    const { links: store } = links();
    const asked: string[] = [];
    const handler = routes(store, async (url) => {
      asked.push(url.href);
      return { document: template() };
    });
    const remote = `https://other.example.org/share/template/${"a".repeat(22)}.${"b".repeat(32)}`;
    const imported = await call(handler, "POST", "/api/template-links/import", { url: remote });
    expect(imported.status).toBe(200);
    expect(asked).toEqual([remote]);
    expect(JSON.stringify(imported.body)).not.toContain("Private client notes");
    expect((await call(handler, "POST", "/api/template-links/import", { url: "https://example.org/whatever" })).status).toBe(400);
    expect(templateLinkToken("ftp://x/share/template/abc")).toBeNull();
  });
});
