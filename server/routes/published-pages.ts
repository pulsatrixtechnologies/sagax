// Published pages (server/published-pages.ts, shared/published-pages.ts).
//
// Before the auth gate (handlePublishedPagePublic, server/index.ts):
//   GET /pages/view/<token>    the reader's entry: a Sagax wrapper with a
//     permanent banner ("not a Sagax screen, never enter a password") and the
//     page in an iframe sandboxed to scripts only (Markdown: nothing). Its
//     CSP runs no script, frames only this page's frame path (`frame-src`
//     with the path, so the page cannot navigate its frame anywhere else)
//     and cannot itself be framed. Who may read it is checked here:
//     "link" anyone holding the link; "org" a signed-in person of this
//     server; "private" only the page's person (on a one-person server, the
//     computer's owner). A bad signature, a revoked link, an expired page
//     and a reader who may not see it all answer the same 404.
//   GET /pages/frame/<token>?t=<ticket>   the page itself, only with the
//     wrapper's five-minute ticket, only as an iframe when the browser says
//     (Sec-Fetch-Dest), under `sandbox` without allow-same-origin (opaque
//     origin), no network, `frame-ancestors` the wrapper's origin, no-store,
//     no Set-Cookie. With SAGAX_PAGES_ORIGIN the frames are served only on
//     that origin, which serves nothing else (handlePagesOriginRequest).
//
// Behind the gate, a person's own pages only (never another's, never a
// bot's shell, never a paired device that is not the computer's owner on a
// one-person server):
//   GET    /api/pages                       { pages: [...] }
//   GET    /api/pages/:id                   { page }
//   GET    /api/pages/:id/versions/:n       { version: { n, kind, title, state, previewPath } }
//          previewPath: /pages/preview/<id>/<n>, the wrapper the app frames
//   GET    /pages/preview/<id>/<n>          (before the gate) the page's person
//          only: the same wrapper (banner) framing /pages/preview-frame/...
//   GET    /api/admin/pages                 organization admins: every page
//   POST   /api/admin/pages/:id/revoke      organization admins (audited)
//   POST   /api/pages/:id/publish           { version, access, expiresAt|null }
//          the person's approval: the only way a version is published
//   POST   /api/pages/:id/decline           { version }
//   PATCH  /api/pages/:id                   { title? } any time; { access?, expiresAt? } while published
//   POST   /api/pages/:id/revoke            stop serving now; the link is gone
//   DELETE /api/pages/:id
// Lot R8 (Grok Bot parity: edit, comments, annotation, Presentation):
//   GET    /api/pages/:id/versions/:n/source   { version, content } the person's editor
//   POST   /api/pages/:id/versions          { kind, content, title? } the person's
//          own edit: a new proposed version, published only by Publish
//   GET    /api/pages/:id/comments          { comments }
//   POST   /api/pages/:id/comments          { text, version?, anchor? }
//   DELETE /api/pages/:id/comments/:cid
//   GET    /pages/preview/<id>/<n>?annotate=1  the preview in annotation mode:
//          its frame (?a=1) runs ANNOTATE_SOURCE, which only posts to the app
//   GET    /api/pages/policy                { linkSharing } any person
//   PUT    /api/admin/pages/policy          { linkSharing } organization admins (audited)
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { PageError, PageRecord, PageVersionRecord, PublishedPages } from "../published-pages.ts";
import { commentAnswerDocument, pageDocument, wrapperDocument } from "../published-pages-render.ts";
import { requestSource, type RequestAuth } from "../request-auth.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import {
  PAGE_ACCESS,
  PAGE_COMMENT_PREFIX,
  PAGE_FRAME_PREFIX,
  PAGE_KINDS,
  PAGE_LIMITS,
  PAGE_PREVIEW_FRAME_PREFIX,
  PAGE_PREVIEW_PREFIX,
  PAGE_VIEW_PREFIX,
  pageCsp,
  parsePageAnchor,
  parsePageTitle,
  validExpiry,
  type PageAccess,
  type PageKind,
  type PagesPolicy,
} from "../../shared/published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Who is reading: null for nobody signed in. `principalId` is the person
 * on an organization server; `computerOwner` is the owner of a one-person
 * server (its other paired sessions are not). */
export type PageViewer = { principalId?: string; computerOwner: boolean } | null;

/** Whether this reader may read this page. While the organization's switch
 * for public links is off, a page shared by link reads as "org". Pure. */
export function pageReadable(page: Pick<PageRecord, "access" | "ownerId">, viewer: PageViewer, policy?: PagesPolicy): boolean {
  if (page.access === "link" && policy?.linkSharing !== false) return true;
  if (!viewer) return false;
  if (page.access === "org" || page.access === "link") return true;
  if (page.ownerId === undefined) return viewer.computerOwner;
  return (viewer.principalId ?? "").toLowerCase() === page.ownerId.toLowerCase();
}

/** Whether this reader is the page's own person (the preview). Pure. */
export function pageOwnedBy(page: Pick<PageRecord, "ownerId">, viewer: PageViewer): boolean {
  return pageReadable({ access: "private", ownerId: page.ownerId }, viewer);
}

/** A viewer as a frame ticket carries it, and back. Pure. */
export function viewerKey(viewer: PageViewer): string {
  if (!viewer) return "anon";
  if (viewer.principalId) return `p:${viewer.principalId.toLowerCase()}`;
  return viewer.computerOwner ? "owner" : "member";
}
export function viewerFromKey(key: string): PageViewer {
  if (key === "owner") return { computerOwner: true };
  if (key === "member") return { computerOwner: false };
  if (key.startsWith("p:") && key.length > 2) return { principalId: key.slice(2), computerOwner: false };
  return null;
}

export interface PublicPageOptions {
  pages: PublishedPages | null;
  viewer(req: IncomingMessage): PageViewer;
  /** The banner's names: the bot, and the person it published for. */
  names(page: PageRecord): { botName: string; personName: string };
  /** False when the page's person was disabled or deleted: nothing of theirs
   * is served. Absent: always active. */
  ownerActive?(page: PageRecord): boolean;
  /** Whether a viewer a ticket carries is still a person allowed in (not
   * disabled), for frames on the separate origin, which see no cookie. */
  viewerActive?(viewer: PageViewer): boolean;
  /** The host of SAGAX_PAGES_ORIGIN when it is set, used or not: that host
   * never serves the app. */
  pagesHost?: string | null;
  /** This app's public origin when it is known (organization public origin
   * or custom domain): the wrapper's frame-src names it, with its scheme,
   * whenever the request came in on that host. */
  appOrigin?: URL | null;
  /** SAGAX_PAGES_ORIGIN and this app's own origin (the frames' only
   * ancestor), when both are known: frames are then served there only. */
  separate?: { pagesOrigin: URL; appOrigin: URL } | null;
  /** Secret-shaped text out of a reader's comment (default: redactSecretsInText). */
  redact?(text: string): string;
}

const NOT_FOUND_HTML = (language: "fr" | "en") => language === "fr"
  ? "<!doctype html><meta charset=\"utf-8\"><title>Page introuvable</title><p>Cette page n'existe pas, n'est plus publiée ou vous n'y avez pas accès. Si elle vous a été partagée, connectez-vous à Sagax dans ce navigateur, puis rouvrez le lien.</p>"
  : "<!doctype html><meta charset=\"utf-8\"><title>Page not found</title><p>This page does not exist, is no longer published, or you cannot see it. If it was shared with you, sign in to Sagax in this browser, then open the link again.</p>";

function language(req: IncomingMessage): "fr" | "en" {
  const header = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
  return /^\s*fr\b/i.test(header) ? "fr" : "en";
}

function hostOf(req: IncomingMessage): string | null {
  const host = typeof req.headers.host === "string" ? req.headers.host.trim().toLowerCase() : "";
  return /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(host) ? host : null;
}

function common(res: ServerResponse): void {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()");
}

function notFound(req: IncomingMessage, res: ServerResponse, method: string): true {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox", "x-frame-options": "DENY" });
  res.end(method === "HEAD" ? undefined : NOT_FOUND_HTML(language(req)));
  return true;
}

function tokenAfter(path: string, prefix: string): string {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return "";
  }
}

function query(req: IncomingMessage, name: string): string {
  try {
    return new URL(req.url ?? "/", "http://x").searchParams.get(name) ?? "";
  } catch {
    return "";
  }
}

const ownerActive = (options: PublicPageOptions, page: PageRecord) => options.ownerActive?.(page) ?? true;

/** A preview address: `<pageId>/<n>`. */
function previewTarget(options: PublicPageOptions, rest: string): { page: PageRecord; version: PageVersionRecord } | null {
  const match = /^([A-Za-z0-9_-]{8,40})\/(\d{1,4})$/.exec(rest);
  if (!match || !options.pages) return null;
  const page = options.pages.get(match[1]!);
  const version = page?.versions.find((entry) => entry.n === Number(match[2]));
  return page && version ? { page, version } : null;
}

/** The wrapper: banner, then the page in its sandboxed frame. `preview` is
 * the app's own preview of a version (its person only; framed by the app). */
function sendWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, method: string,
  input: { page: PageRecord; version: PageVersionRecord; framePath: string; ticket: string; preview: boolean; annotate?: boolean; commentPath?: string }): true {
  const separate = options.separate ?? null;
  const host = hostOf(req);
  // A host-source with a path: the frame may load this page's frame path and
  // nothing else, so the page cannot navigate its frame to another site.
  const known = options.appOrigin && host === options.appOrigin.host.toLowerCase() ? options.appOrigin.origin : null;
  const frameSource = separate
    ? `${separate.pagesOrigin.origin}${input.framePath}`
    : known ? `${known}${input.framePath}` : host ? `${host}${input.framePath}` : "'self'";
  // reader comments: a plain form that may post to this page's comment path only
  const formAction = input.commentPath ? (known ? `${known}${input.commentPath}` : host ? `${host}${input.commentPath}` : "'self'") : "'none'";
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    `frame-src ${frameSource}`,
    `child-src ${frameSource}`,
    "base-uri 'none'",
    `form-action ${formAction}`,
    input.preview ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ].join("; ");
  if (!input.preview) res.setHeader("cross-origin-opener-policy", "same-origin");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "x-frame-options": input.preview ? "SAMEORIGIN" : "DENY" });
  const names = options.names(input.page);
  res.end(method === "HEAD" ? undefined : wrapperDocument({
    title: input.page.title ?? input.version.title,
    kind: input.version.kind,
    botName: names.botName,
    personName: names.personName,
    frameUrl: `${separate ? separate.pagesOrigin.origin : ""}${input.framePath}?t=${encodeURIComponent(input.ticket)}${input.annotate ? "&a=1" : ""}`,
    lang: language(req),
    preview: input.preview,
    annotate: input.annotate === true,
    ...(input.commentPath ? { comments: { action: input.commentPath, approved: (input.page.readerNotes ?? []).filter((entry) => entry.status === "approved") } } : {}),
  }));
  return true;
}

function serveWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const token = tokenAfter(path, PAGE_VIEW_PREFIX);
  const opened = token && options.pages ? options.pages.open(token) : null;
  const viewer = options.viewer(req);
  if (!opened || !ownerActive(options, opened.page) || !pageReadable(opened.page, viewer, options.pages!.policy())) return notFound(req, res, method);
  const subject = `link:${opened.page.linkId!}`;
  const commentPath = readerCommentsOpen(options, opened.page) ? `${PAGE_COMMENT_PREFIX}${token}` : undefined;
  return sendWrapper(options, req, res, method, { ...opened, framePath: `${PAGE_FRAME_PREFIX}${token}`, ticket: options.pages!.frameTicket(subject, viewerKey(viewer)), preview: false, ...(commentPath ? { commentPath } : {}) });
}

function servePreviewWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const rest = tokenAfter(path, PAGE_PREVIEW_PREFIX);
  const target = previewTarget(options, rest);
  const viewer = options.viewer(req);
  if (!target || !ownerActive(options, target.page) || !pageOwnedBy(target.page, viewer)) return notFound(req, res, method);
  const subject = `preview:${target.page.id}:${target.version.n}`;
  // annotation mode: the page's person only, on their preview, never a reader's link
  const annotate = query(req, "annotate") === "1";
  return sendWrapper(options, req, res, method, { ...target, framePath: `${PAGE_PREVIEW_FRAME_PREFIX}${rest}`, ticket: options.pages!.frameTicket(subject, viewerKey(viewer)), preview: true, annotate });
}

/** Whether a published page takes and shows reader comments: its person
 * turned them on and the organization allows them. */
function readerCommentsOpen(options: PublicPageOptions, page: PageRecord): boolean {
  return page.readerComments === true && options.pages!.policy().readerComments;
}

const READER_BODY_MAX = 16 * 1024;

function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    const type = String(req.headers["content-type"] ?? "");
    if (!/^application\/x-www-form-urlencoded\b/i.test(type)) return resolve(null);
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > READER_BODY_MAX) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", () => resolve(null));
  });
}

/** A reader's comment (JC 2026-10-21): only on a published page its reader
 * may read, with reader comments on and allowed; from this host's own form
 * (an Origin, when sent, must be this host; Sec-Fetch-Site cross-site is refused); rate-limited per address; name
 * and text checked and capped, secret-shaped text removed; a filled honeypot
 * is thanked and dropped. The comment waits for the person's approval and
 * is never shown before. The answer is a plain page with a link back. */
function serveReaderComment(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string): true {
  const lang = language(req);
  const token = tokenAfter(path, PAGE_COMMENT_PREFIX);
  const back = `${PAGE_VIEW_PREFIX}${token}`;
  const reply = (status: number, ok: boolean, message?: string) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'", "x-frame-options": "DENY" });
    res.end(commentAnswerDocument({ lang, back, ok, ...(message ? { message } : {}) }));
  };
  const opened = token && options.pages ? options.pages.open(token) : null;
  const viewer = options.viewer(req);
  if (!opened || !ownerActive(options, opened.page) || !pageReadable(opened.page, viewer, options.pages!.policy()) || !readerCommentsOpen(options, opened.page)) {
    req.resume();
    return notFound(req, res, "POST");
  }
  // a browser that names another site as the source never posts here
  if (req.headers["sec-fetch-site"] === "cross-site") {
    req.resume();
    reply(403, false);
    return true;
  }
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin && origin !== "null") {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host.toLowerCase() === (hostOf(req) ?? "");
    } catch { /* a bad Origin is another site */ }
    if (!sameHost) {
      req.resume();
      reply(403, false);
      return true;
    }
  }
  void readForm(req).then((form) => {
    const pages = options.pages!;
    if (!form) return reply(400, false);
    // the honeypot: a person never sees this field
    if ((form.get("website") ?? "").trim()) return reply(200, true);
    const name = (form.get("name") ?? "").replace(/\s+/g, " ").trim();
    const text = (form.get("text") ?? "").trim();
    if (!name || name.length > PAGE_LIMITS.readerNameChars || !text || text.length > PAGE_LIMITS.readerCommentChars) return reply(400, false);
    if (!pages.allowReaderPost(requestSource(req))) {
      return reply(429, false, lang === "fr" ? "Trop de commentaires depuis cette adresse. Réessayez plus tard." : "Too many comments from this address. Try again later.");
    }
    const redact = options.redact ?? redactSecretsInText;
    const added = pages.addReaderComment(opened.page.id, { name: redact(name), text: redact(text), version: opened.version.n });
    return added.ok ? reply(200, true) : reply(409, false);
  });
  return true;
}

/** The page itself. Never the main entry; the ticket the wrapper minted for
 * this page and this reader; and the reader checked again: the live cookie
 * on the app's origin, or the ticket's reader (still active) on the
 * separate origin, which sees no cookie. */
function serveFrame(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const dest = req.headers["sec-fetch-dest"];
  if (typeof dest === "string" && dest !== "iframe") return notFound(req, res, method);
  const pages = options.pages;
  if (!pages) return notFound(req, res, method);
  const preview = path.startsWith(PAGE_PREVIEW_FRAME_PREFIX);
  let target: { page: PageRecord; version: PageVersionRecord } | null;
  let subject: string;
  if (preview) {
    target = previewTarget(options, tokenAfter(path, PAGE_PREVIEW_FRAME_PREFIX));
    subject = target ? `preview:${target.page.id}:${target.version.n}` : "";
  } else {
    target = pages.open(tokenAfter(path, PAGE_FRAME_PREFIX));
    subject = target ? `link:${target.page.linkId!}` : "";
  }
  const bound = target ? pages.verifyFrameTicket(subject, query(req, "t")) : null;
  if (!target || bound === null || !ownerActive(options, target.page)) return notFound(req, res, method);
  const reader = options.separate ? viewerFromKey(bound) : options.viewer(req);
  if (options.separate && reader && options.viewerActive && !options.viewerActive(reader)) return notFound(req, res, method);
  const allowed = preview ? pageOwnedBy(target.page, reader) : pageReadable(target.page, reader, pages.policy());
  const content = allowed ? pages.content(target.page.id, target.version.n) : null;
  if (content === null) return notFound(req, res, method);
  const ancestors = options.separate ? options.separate.appOrigin.origin : "'self'";
  // the annotation script: the preview only (its person), never a reading link
  const annotateNonce = preview && query(req, "a") === "1" ? randomBytes(16).toString("base64url") : undefined;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(target.version.kind, { frameAncestors: ancestors, ...(annotateNonce ? { annotateNonce } : {}) }) });
  res.end(method === "HEAD" ? undefined : pageDocument({ kind: target.version.kind, title: target.page.title ?? target.version.title, content, lang: language(req) }, annotateNonce ? { annotateNonce } : {}));
  return true;
}

function refuseMethod(res: ServerResponse): true {
  res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; sandbox" });
  res.end();
  return true;
}

const isFramePath = (path: string) => path.startsWith(PAGE_FRAME_PREFIX) || path.startsWith(PAGE_PREVIEW_FRAME_PREFIX);

/** On the pages origin (SAGAX_PAGES_ORIGIN), the server answers the page
 * frames and nothing else: no app, no API, no sign-in. When the app's own
 * origin is unknown the separation is off and that host answers nothing at
 * all. True when the request was for that host (it is then answered). */
export function handlePagesOriginRequest(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
  const pagesHost = (options.separate?.pagesOrigin.host ?? options.pagesHost ?? "").toLowerCase();
  if (!pagesHost || hostOf(req) !== pagesHost) return false;
  common(res);
  if (method !== "GET" && method !== "HEAD") return refuseMethod(res);
  if (!options.separate || !isFramePath(path)) return notFound(req, res, method);
  return serveFrame(options, req, res, path, method);
}

/** Answer a published page's wrapper, preview or frame on the app's origin;
 * false when the request is not one. */
export function handlePublishedPagePublic(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
  const view = path.startsWith(PAGE_VIEW_PREFIX);
  const previewWrapper = path.startsWith(PAGE_PREVIEW_PREFIX);
  const frame = isFramePath(path);
  const comment = path.startsWith(PAGE_COMMENT_PREFIX);
  if (!view && !previewWrapper && !frame && !comment) return false;
  common(res);
  if (comment) {
    if (method !== "POST") {
      res.writeHead(405, { allow: "POST", "content-type": "text/plain; charset=utf-8", "content-security-policy": "default-src 'none'; sandbox" });
      res.end();
      return true;
    }
    return serveReaderComment(options, req, res, path);
  }
  if (method !== "GET" && method !== "HEAD") return refuseMethod(res);
  if (view) return serveWrapper(options, req, res, path, method);
  if (previewWrapper) return servePreviewWrapper(options, req, res, path, method);
  // With a separate pages origin, frames live there only.
  if (options.separate) return notFound(req, res, method);
  return serveFrame(options, req, res, path, method);
}

export interface PublishedPageRouteDeps {
  pages: PublishedPages;
  /** The person's principal id on an organization server; undefined for the
   * owner of a one-person server (who manages every page). */
  owner(auth: RequestAuth): string | undefined;
  /** False for a caller that is no person: a bot's shell on a shared
   * server, or on a one-person server a paired session that is not the
   * computer's owner (computerOwner in server/index.ts). */
  isPerson(auth: RequestAuth): boolean;
  /** Where links point: the server's public address, else the request's. */
  origin(req: IncomingMessage): string;
  reachable(origin: string): boolean;
  /** An organization admin (the admin routes below). */
  isAdmin?(auth: RequestAuth): boolean;
  /** 2026-10-19: whether this caller may act on this person's page (a
   * person an admin gave people.manage never revokes an admin's). */
  mayActOn?(auth: RequestAuth, ownerPrincipalId: string): boolean;
  /** Write an admin activity row (category security) for an admin's act. */
  audit?(auth: RequestAuth, req: IncomingMessage, row: { action: string; target: { kind: string; id: string; name?: string } }): void;
  /** Secret-shaped text out of a person's edit before storage (as for a
   * bot's proposal). Absent: kept as typed. */
  redact?(text: string): string;
  now?(): number;
}

const LINK_SHARING_OFF = { error: "Your organization turned off public links for pages. Choose My organization instead.", code: "link_sharing_off" };
const READER_COMMENTS_OFF = { error: "Your organization does not allow reader comments on pages.", code: "reader_comments_off" };

function failed(result: unknown): result is PageError {
  return Boolean(result) && typeof result === "object" && (result as { ok?: unknown }).ok === false;
}

export function createPublishedPageRoutes(deps: PublishedPageRouteDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  const mine = (auth: RequestAuth, page: PageRecord) => {
    const owner = deps.owner(auth);
    return owner === undefined || (page.ownerId ?? "").toLowerCase() === owner.toLowerCase();
  };
  const wire = (page: PageRecord, req: IncomingMessage) => {
    const origin = deps.origin(req);
    return deps.pages.summary(page, origin, deps.reachable(origin));
  };
  // An admin's view of a page: never its link or path (they carry the token).
  const adminWire = (page: PageRecord, req: IncomingMessage) => {
    const { url: _url, path: _path, reachable: _reachable, ...rest } = wire(page, req);
    return { ...rest, ownerId: page.ownerId ?? null };
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // Organization admins: every page, and Revoke (audited). Never publish,
    // change access or read another person's content from here.
    if (path === "/api/admin/pages" || path.startsWith("/api/admin/pages/")) {
      res.setHeader("cache-control", "no-store");
      if (!deps.isAdmin?.(auth)) return json(res, 403, { error: "Only an organization admin manages every page.", code: "admin_only" });
      if (path === "/api/admin/pages/policy") {
        if (method === "GET") return json(res, 200, deps.pages.policy());
        if (method !== "PUT") return PASS;
        const body = await readBody(req) as Record<string, unknown> | null;
        const fields = ["linkSharing", "readerComments"] as const;
        if (!body || fields.some((field) => field in body && typeof body[field] !== "boolean") || !fields.some((field) => typeof body[field] === "boolean")) {
          return json(res, 400, { error: "Send { linkSharing?: boolean, readerComments?: boolean }.", code: "bad_body" });
        }
        const before = deps.pages.policy();
        const after = deps.pages.setPolicy(Object.fromEntries(fields.filter((field) => typeof body[field] === "boolean").map((field) => [field, body[field]])));
        for (const field of fields) {
          if (before[field] !== after[field]) deps.audit?.(auth, req, { action: "page.policy", target: { kind: "pages", id: field, name: after[field] ? "on" : "off" } });
        }
        return json(res, 200, after);
      }
      if (path === "/api/admin/pages" && method === "GET") {
        return json(res, 200, { pages: deps.pages.list(undefined).map((page) => adminWire(page, req)) });
      }
      const revoke = /^\/api\/admin\/pages\/([\w-]+)\/revoke$/.exec(path);
      if (revoke && method === "POST") {
        const page = deps.pages.get(revoke[1]!);
        if (!page) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
        if (deps.mayActOn && !deps.mayActOn(auth, page.ownerId ?? "")) return json(res, 403, { error: "Only an organization admin can revoke an admin's page.", code: "target_is_admin" });
        const result = deps.pages.revoke(page.id, deps.owner(auth) ?? "admin");
        if (failed(result)) return json(res, result.status, { error: result.error, code: result.code });
        const title = result.versions.at(-1)?.title;
        deps.audit?.(auth, req, { action: "page.revoke", target: { kind: "page", id: page.id, ...(title ? { name: title } : {}) } });
        return json(res, 200, { page: adminWire(result, req) });
      }
      return PASS;
    }
    if (path !== "/api/pages" && !path.startsWith("/api/pages/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.isPerson(auth)) return json(res, 403, { error: "Only a signed-in person manages published pages.", code: "person_only" });
    if (path === "/api/pages" && method === "GET") {
      return json(res, 200, { pages: deps.pages.list(deps.owner(auth)).map((page) => wire(page, req)) });
    }
    if (path === "/api/pages/policy") return method === "GET" ? json(res, 200, deps.pages.policy()) : PASS;
    // one route per line with its method, so the tool policy sees each one
    const extra: Extra | null =
      (method === "GET" && /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/source$/.exec(path) && { route: "source", match: /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/source$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/versions$/.exec(path) && { route: "edit", match: /^\/api\/pages\/([\w-]+)\/versions$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/comments$/.exec(path) && { route: "comments", match: /^\/api\/pages\/([\w-]+)\/comments$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/comments$/.exec(path) && { route: "comment", match: /^\/api\/pages\/([\w-]+)\/comments$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/comments\/([\w-]+)$/.exec(path) && { route: "uncomment", match: /^\/api\/pages\/([\w-]+)\/comments\/([\w-]+)$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/reader-comments$/.exec(path) && { route: "readerComments", match: /^\/api\/pages\/([\w-]+)\/reader-comments$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)\/approve$/.exec(path) && { route: "readerApprove", match: /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)\/approve$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)$/.exec(path) && { route: "readerRemove", match: /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)$/.exec(path)! })
      || null;
    if (extra) return pageExtras(deps, { req, res, method, auth, json, readBody }, extra);
    const match = /^\/api\/pages\/([\w-]+)(?:\/(publish|decline|revoke)|\/versions\/(\d+))?$/.exec(path);
    if (!match) return PASS;
    const page = deps.pages.get(match[1]!);
    // Another person's page reads exactly like a missing one.
    if (!page || !mine(auth, page)) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
    const action = match[2];
    const versionPath = match[3];
    const answer = (result: PageRecord | PageError) => failed(result)
      ? json(res, result.status, { error: result.error, code: result.code })
      : json(res, 200, { page: wire(result, req) });

    if (versionPath !== undefined && method === "GET") {
      const version = page.versions.find((entry) => entry.n === Number(versionPath));
      if (!version) return json(res, 404, { error: "This version does not exist.", code: "no_version" });
      // Never the content: the app previews a version through the same
      // wrapper and sandboxed frame readers get (no srcdoc in the app).
      return json(res, 200, { version: { n: version.n, kind: version.kind, title: version.title, state: version.state, previewPath: `${PAGE_PREVIEW_PREFIX}${page.id}/${version.n}` } });
    }
    if (!action && method === "GET") return json(res, 200, { page: wire(page, req) });
    if (!action && method === "DELETE") {
      deps.pages.remove(page.id);
      return json(res, 200, { ok: true });
    }
    const by = deps.owner(auth);
    if (!action && method === "PATCH") {
      const body = await readBody(req) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return json(res, 400, { error: "Send { title?, access?, expiresAt?, readerComments? }.", code: "bad_body" });
      // every field is checked before anything changes: a refused request
      // changes nothing, and nothing a person asked is ever dropped quietly
      let title: string | undefined;
      if ("title" in body) {
        const parsed = parsePageTitle(body.title);
        if (parsed === null) return json(res, 400, { error: `title: one line, 1 to ${PAGE_LIMITS.title} characters.`, code: "bad_title" });
        title = deps.redact ? deps.redact(parsed) : parsed;
      }
      const access = body.access;
      if (access !== undefined && !PAGE_ACCESS.includes(access as PageAccess)) return json(res, 400, { error: "access: private, org or link.", code: "bad_access" });
      let expiresAt: number | null | undefined;
      if ("expiresAt" in body) {
        const checked = validExpiry(body.expiresAt, now());
        if (!checked.ok) return json(res, 400, { error: "expiresAt: a future time within a year, or null.", code: "bad_expiry" });
        expiresAt = checked.value;
      }
      const readerComments = body.readerComments;
      if (readerComments !== undefined && typeof readerComments !== "boolean") return json(res, 400, { error: "readerComments: true or false.", code: "bad_reader_comments" });
      if ((access !== undefined || expiresAt !== undefined) && page.status !== "published") return json(res, 409, { error: "Publish this page first.", code: "not_published" });
      if (access === "link" && page.access !== "link" && !deps.pages.policy().linkSharing) return json(res, 403, LINK_SHARING_OFF);
      if (readerComments === true && !deps.pages.policy().readerComments) return json(res, 403, READER_COMMENTS_OFF);
      let result: PageRecord | PageError = page;
      if (title !== undefined) result = deps.pages.rename(page.id, title, by);
      if (!failed(result) && (access !== undefined || expiresAt !== undefined)) {
        result = deps.pages.update(page.id, { ...(access !== undefined ? { access: access as PageAccess } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}), ...(by ? { by } : {}) });
      }
      if (!failed(result) && readerComments !== undefined) result = deps.pages.setReaderComments(page.id, readerComments, by);
      return answer(result);
    }
    if (method !== "POST") return PASS;
    if (action === "revoke") return answer(deps.pages.revoke(page.id, by));
    const body = await readBody(req) as Record<string, unknown> | null;
    const version = body && typeof body === "object" ? body.version : undefined;
    if (typeof version !== "number" || !Number.isSafeInteger(version)) return json(res, 400, { error: "version: the version number to act on.", code: "bad_version" });
    if (action === "decline") return answer(deps.pages.decline(page.id, version, by));
    // publish: who may see it is the person's choice, never a default the bot set
    const access = body!.access;
    if (!PAGE_ACCESS.includes(access as PageAccess)) return json(res, 400, { error: "access: choose private, org or link.", code: "bad_access" });
    if (access === "link" && !deps.pages.policy().linkSharing) return json(res, 403, LINK_SHARING_OFF);
    const expiry = validExpiry(body!.expiresAt, now());
    if (!expiry.ok) return json(res, 400, { error: "expiresAt: a future time within a year, or null.", code: "bad_expiry" });
    return answer(deps.pages.publish(page.id, { version, access: access as PageAccess, expiresAt: expiry.value, ...(by ? { by } : {}) }));
  };
}

type ExtrasContext = Pick<Parameters<RouteHandler>[0], "req" | "res" | "method" | "auth" | "json" | "readBody">;
type Extra = { route: "source" | "edit" | "comments" | "comment" | "uncomment" | "readerComments" | "readerApprove" | "readerRemove"; match: RegExpExecArray };

/** Lot R8: the person's editor (source and own edit), their comments, and
 * the moderation of readers' comments. The same rules as the routes above: a
 * person only, their own pages only, another person's page reads exactly
 * like a missing one. Their own comments never reach a reader. */
async function pageExtras(deps: PublishedPageRouteDeps, ctx: ExtrasContext, extra: Extra) {
  const { req, res, auth, json, readBody } = ctx;
  const { route, match } = extra;
  const page = deps.pages.get(match[1]!);
  const owner = deps.owner(auth);
  if (!page || (owner !== undefined && (page.ownerId ?? "").toLowerCase() !== owner.toLowerCase())) {
    return json(res, 404, { error: "This page does not exist.", code: "not_found" });
  }
  const by = owner;
  const clean = (text: string) => (deps.redact ? deps.redact(text) : text);
  const outcome = (result: PageRecord | PageError) => failed(result) ? json(res, result.status, { error: result.error, code: result.code }) : json(res, 200, { ok: true });
  if (route === "source") {
    const version = page.versions.find((entry) => entry.n === Number(match[2]));
    const content = version ? deps.pages.content(page.id, version.n) : null;
    if (!version || content === null) return json(res, 404, { error: "This version does not exist.", code: "no_version" });
    return json(res, 200, { version: { n: version.n, kind: version.kind, title: version.title }, content });
  }
  if (route === "edit") {
    const body = await readBody(req) as Record<string, unknown> | null;
    const kind = body?.kind;
    if (!PAGE_KINDS.includes(kind as PageKind)) return json(res, 400, { error: "kind: html, markdown or presentation.", code: "bad_kind" });
    const content = body!.content;
    if (typeof content !== "string" || !content.trim()) return json(res, 400, { error: "content: the page's full text is required.", code: "bad_content" });
    if (Buffer.byteLength(content) > PAGE_LIMITS.contentBytes) return json(res, 400, { error: `content: at most ${PAGE_LIMITS.contentBytes / 1024} KB.`, code: "too_large" });
    let title: string | undefined;
    if (body!.title !== undefined) {
      const parsed = parsePageTitle(body!.title);
      if (parsed === null) return json(res, 400, { error: `title: one line, 1 to ${PAGE_LIMITS.title} characters.`, code: "bad_title" });
      title = clean(parsed);
    }
    const result = deps.pages.edit(page.id, { kind: kind as PageKind, content: clean(content), ...(title ? { title } : {}), ...(by ? { by } : {}) });
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    const origin = deps.origin(req);
    return json(res, 201, { page: deps.pages.summary(result.page, origin, deps.reachable(origin)), version: result.version.n });
  }
  if (route === "comments") return json(res, 200, { comments: deps.pages.comments(page.id) });
  if (route === "uncomment") return outcome(deps.pages.removeComment(page.id, match[2]!));
  if (route === "readerComments") return json(res, 200, { comments: deps.pages.readerComments(page.id), enabled: page.readerComments === true, allowed: deps.pages.policy().readerComments });
  if (route === "readerApprove") return outcome(deps.pages.approveReaderComment(page.id, match[2]!, by));
  if (route === "readerRemove") return outcome(deps.pages.removeReaderComment(page.id, match[2]!, by));
  // route === "comment"
  const body = await readBody(req) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > PAGE_LIMITS.commentChars) return json(res, 400, { error: `text: 1 to ${PAGE_LIMITS.commentChars} characters.`, code: "bad_text" });
  const version = body!.version;
  if (version !== undefined && (typeof version !== "number" || !Number.isSafeInteger(version))) return json(res, 400, { error: "version: a version number, or leave it out.", code: "bad_version" });
  const anchor = body!.anchor === undefined ? undefined : parsePageAnchor(body!.anchor);
  if (anchor === null) return json(res, 400, { error: "anchor: { tag, text, path }, or leave it out.", code: "bad_anchor" });
  const result = deps.pages.addComment(page.id, {
    text: clean(text),
    ...(version !== undefined ? { version: version as number } : {}),
    ...(anchor ? { anchor: { ...anchor, text: clean(anchor.text), path: clean(anchor.path) } } : {}),
    ...(by ? { by } : {}),
  });
  return result.ok ? json(res, 201, { comment: result.comment }) : json(res, result.status, { error: result.error, code: result.code });
}
