// Public share links for bot templates (server/template-links.ts).
//
// Before the auth gate (handleTemplateLinkPublic, server/index.ts): the
// signed token in the path is the authorization, for one read-only template.
//   GET /share/template/<token>        the card (HTML, no script, strict CSP)
//   GET /share/template/<token>.json   { format, document } for import
// A bad signature, a revoked link and a made-up one all answer the same 404.
//
// Behind the gate (admin scope, like Share preset's file):
//   POST   /api/template-links          { name?, description?, picture? }
//          freezes the person's New bot defaults as a template (no starter
//          notes) and answers { link: { id, name, createdAt, path, url, reachable } }
//   GET    /api/template-links          { links: [...] } the person's own links
//   GET    /api/template-links/:id      { link, template: { title, description, skills, release } }
//   PUT    /api/template-links/:id      { name?, description?, picture? } freezes
//          the defaults again under the same link (Update the template)
//   DELETE /api/template-links/:id      turn the link off (404 once gone)
//   POST   /api/template-links/import   { url } -> { document } a template
//          from a link of this server or another one (public addresses only),
//          for the ordinary import preview (src/lib/team-import.ts).
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { checkMediaDestination, MediaProxyBlockedError } from "../media-proxy-guard.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  cardLanguage,
  publicTemplateDocument,
  TEMPLATE_LINK_PREFIX,
  templateCardHtml,
  templateDetails,
  type TemplateLinkRecord,
  type TemplateLinks,
} from "../template-links.ts";
import { PACKAGE_MAX_BYTES, parsePackageDocument, type PackageDocument } from "../../shared/package-format.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CARD_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Answer a public template link; false when the request is not one. */
export function handleTemplateLinkPublic(
  links: TemplateLinks | null,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
): boolean {
  if (!path.startsWith(TEMPLATE_LINK_PREFIX) || (method !== "GET" && method !== "HEAD")) return false;
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(TEMPLATE_LINK_PREFIX.length));
  } catch {
    rest = "";
  }
  const wantsJson = rest.endsWith(".json");
  const token = wantsJson ? rest.slice(0, -".json".length) : rest;
  const record = links?.open(token) ?? null;
  if (!record) {
    res.writeHead(404, { "content-type": "application/json", "content-security-policy": "default-src 'none'" });
    res.end(method === "HEAD" ? undefined : JSON.stringify({ error: "This template link does not exist or was turned off." }));
    return true;
  }
  if (wantsJson) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-security-policy": "default-src 'none'", "access-control-allow-origin": "*" });
    res.end(method === "HEAD" ? undefined : JSON.stringify({ format: "sagax.template-link", version: 1, document: record.document }));
    return true;
  }
  const language = cardLanguage(typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : undefined);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CARD_CSP, "x-frame-options": "DENY" });
  res.end(method === "HEAD" ? undefined : templateCardHtml(record.document, language));
  return true;
}

/** The token a pasted link names, when it is a template link at all. Pure. */
export function templateLinkToken(raw: string): { url: URL; token: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const at = url.pathname.indexOf(TEMPLATE_LINK_PREFIX);
  if (at === -1) return null;
  const token = url.pathname.slice(at + TEMPLATE_LINK_PREFIX.length).replace(/\.json$/, "");
  return /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{32}$/.test(token) ? { url, token } : null;
}

export interface TemplateLinkRouteDeps {
  links: TemplateLinks;
  /** The template from the person's New bot defaults, never with starter notes. */
  buildTemplate(body: { name?: string; description?: string; picture?: string }): PackageDocument;
  /** The person's principal id (organization server); undefined for the owner. */
  creator(auth: RequestAuth): string | undefined;
  /** Where links point: the server's public address, else the request's. */
  origin(req: IncomingMessage): string;
  /** Whether that address can be reached from outside this computer. */
  reachable(origin: string): boolean;
  /** Fetch a template from another server (tests replace it). */
  fetchRemote?(url: URL): Promise<unknown>;
}

const createBody = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(300).optional(),
  picture: z.string().max(200_000).optional(),
}).strict();

const importBody = z.object({ url: z.string().min(1).max(2_000) }).strict();

/** GET a template link's JSON from another server: public addresses only,
 * no redirect, 10 s, at most the package limit. */
export async function fetchRemoteTemplate(url: URL): Promise<unknown> {
  const target = new URL(url.href);
  target.pathname = `${target.pathname.replace(/\.json$/, "")}.json`;
  target.search = "";
  target.hash = "";
  await checkMediaDestination(target);
  const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (response.status === 404) throw Object.assign(new Error("This template link does not exist or was turned off."), { status: 404 });
  if (!response.ok) throw new Error(`The other server answered ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > PACKAGE_MAX_BYTES + 64 * 1024) throw new Error("This template is too large.");
  return JSON.parse(text);
}

export function createTemplateLinkRoutes(deps: TemplateLinkRouteDeps): RouteHandler {
  const wire = (record: Pick<TemplateLinkRecord, "id" | "name" | "createdAt" | "updatedAt">, req: IncomingMessage) => {
    const origin = deps.origin(req).replace(/\/+$/, "");
    const path = deps.links.path(record.id);
    return {
      id: record.id, name: record.name, createdAt: record.createdAt,
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      path, url: `${origin}${path}`, reachable: deps.reachable(origin),
    };
  };
  const mine = (auth: RequestAuth, record: TemplateLinkRecord) => {
    const creator = deps.creator(auth);
    return creator === undefined || record.createdBy?.toLowerCase() === creator.toLowerCase();
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/template-links" && method === "GET") {
      return json(res, 200, { links: deps.links.list(deps.creator(auth)).map((link) => wire(link, req)) });
    }
    if (path === "/api/template-links" && method === "POST") {
      const parsed = createBody.safeParse(await readBody(req, 512 * 1024));
      if (!parsed.success) return json(res, 400, { error: "send { name?, description?, picture? }" });
      try {
        const record = deps.links.create(deps.buildTemplate(parsed.data), { createdBy: deps.creator(auth) });
        return json(res, 201, { link: wire(record, req) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "The template could not be shared." });
      }
    }
    if (path === "/api/template-links/import" && method === "POST") {
      const parsed = importBody.safeParse(await readBody(req));
      const link = parsed.success ? templateLinkToken(parsed.data.url) : null;
      if (!link) return json(res, 400, { error: "Paste a template link (…/share/template/…)." });
      const local = deps.links.open(link.token);
      if (local) return json(res, 200, { document: local.document });
      try {
        const answer = await (deps.fetchRemote ?? fetchRemoteTemplate)(link.url) as { document?: unknown };
        const document = publicTemplateDocument(parsePackageDocument(answer?.document, { trust: "file" }));
        return json(res, 200, { document });
      } catch (error) {
        if (error instanceof MediaProxyBlockedError) return json(res, 400, { error: "This link points to a private address." });
        const status = (error as { status?: number }).status === 404 ? 404 : 400;
        return json(res, status, { error: error instanceof Error ? error.message : "The template could not be loaded." });
      }
    }
    const one = path.match(/^\/api\/template-links\/([A-Za-z0-9_-]{22})$/);
    if (one && (method === "GET" || method === "PUT" || method === "DELETE")) {
      const record = deps.links.get(one[1]!);
      if (!record || !mine(auth, record)) return json(res, 404, { error: "This link does not exist." });
      if (method === "GET") return json(res, 200, { link: wire(record, req), template: templateDetails(record.document) });
      if (method === "PUT") {
        const parsed = createBody.safeParse(await readBody(req, 512 * 1024));
        if (!parsed.success) return json(res, 400, { error: "send { name?, description?, picture? }" });
        try {
          const updated = deps.links.update(record.id, deps.buildTemplate(parsed.data));
          if (!updated) return json(res, 404, { error: "This link does not exist." });
          return json(res, 200, { link: wire(updated, req), template: templateDetails(updated.document) });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "The template could not be updated." });
        }
      }
      deps.links.revoke(record.id);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
