// Published pages (server/pages/published-pages.ts, shared/published-pages.ts).
//
// Before the auth gate (handlePublishedPagePublic, server/index.ts):
//   GET /pages/view/<token>    the reader's entry: a Sagax wrapper with its
//     bar (2026-10-28: the title, the permanent notice "published by <bot>
//     for <person>, not a Sagax screen, never enter a password", and the
//     actions the reader has a right to) and the page in an iframe sandboxed
//     to scripts only (Markdown: nothing). Its CSP runs only this server's
//     own built bar script (script-src 'self', none without a built UI),
//     reaches only this origin, frames only this page's frame path
//     (`frame-src` with the path, so the page cannot navigate its frame
//     anywhere else) and cannot itself be framed. Who may read it is checked here:
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
//   PATCH  /api/pages/:id                   { title?, editors? } any time; { access?, expiresAt? } while published
//   POST   /api/pages/:id/revoke            stop serving now; the link is gone
//   DELETE /api/pages/:id
// Lot R8 (the reference design parity: edit, comments, annotation, Presentation):
//   GET    /api/pages/:id/versions/:n/source?offset=&limit=   { version: { n, kind,
//          title, bytes, sha256 }, content, offset, nextOffset } the person's
//          editor; offset and limit (UTF-8 bytes) read one slice (#3488)
//   GET    /api/pages/:id/versions/:n/export?theme=light|dark   { filename, html }
//          a self-contained file of that version (Export, #2717)
//   POST   /api/pages/:id/versions          { kind, content, title? } the person's
//          own edit: a new proposed version, published only by Publish
//   GET    /api/pages/:id/comments          { comments }
//   POST   /api/pages/:id/comments          { text, version?, anchor? }
//   DELETE /api/pages/:id/comments/:cid
//   GET    /pages/preview/<id>/<n>?annotate=1  the preview in annotation mode:
//          its frame (?a=1) runs ANNOTATE_SOURCE, which only posts to the app
//   GET    /api/pages/policy                { linkSharing } any person
//   GET    /api/pages/design-systems        { systems } built-in and the person's own (#2717)
//   DELETE /api/pages/design-systems/:id    forget one of the person's own
//   GET    /api/pages/look                  { look } the person's own look
//   PUT    /api/pages/look                  { light?, dark?, skin?, botAccent? }
//          (2026-10-29) the person's app: the tokens of their skin, light and
//          dark; their reading links' bar and frames are drawn in them
//   PUT    /api/admin/pages/policy          { linkSharing } organization admins (audited)
//   POST   /api/pages/:id/invite            { people, teams } (2026-10-28, Share >
//          Add people or groups): who else reads it while it is shared with
//          "People you invite"; the person's own choice, no admin
// Annotations (2026-10-28, shared/page-threads.ts): anyone signed in who may
// read the published page (its person always), from the reader's bar. No
// admin; another reader's page reads exactly like a missing one:
//   GET    /api/pages/:id/threads           { threads, names, owner }
//   POST   /api/pages/:id/threads           { anchor, text }
//   POST   /api/pages/:id/threads/:tid/replies   { text }
//   POST   /api/pages/:id/threads/:tid/resolve   { resolved }
//   POST   /api/pages/:id/threads/:tid/accept    the page's person: a suggested
//          edit becomes a new version (published if the page is)
//   POST   /api/pages/:id/threads/:tid/decline   the page's person
//   DELETE /api/pages/:id/threads/:tid      its author or the page's person
//   DELETE /api/pages/:id/threads/:tid/replies/:rid   the same
// Shared state (#1544, shared/page-state.ts): the page's script sets values
// through window.sagax.page; its wrapper reads and writes them here. Who
// writes a key is what the page declares (its sagax-state block), within its
// sharing (2026-10-29); the default is anyone signed in who may read it:
//   GET    /pages/state/<token>             (before the gate) anyone who may read
//          the page: { entries: { key: { value, name, at, who } }, access, me }
//   PUT    /pages/state/<token>             (before the gate) { key, value } a
//          reader not signed in, on a page shared with anyone who has the link,
//          only the keys it declares "anyone"; tighter limits, written as
//          Anonyme with a hash of the browser's own random id
//   PUT    /api/pages/:id/state             { key, value } anyone signed in who
//          may annotate it, as the key's level allows (value null clears it)
//   DELETE /api/pages/:id/state             the page's person clears it all
//   PUT    /api/pages/:id/state/lock        { key, locked } the page's person
//          makes one key read-only, or writable again
//   GET    /api/pages/:id/live             (2026-10-28) an event stream: who has
//          the page open (presence) and "threads changed" (server/pages/page-live.ts)
import { applyDesignSystem, findDesignSystem } from "../../src/lib/design-systems.ts";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { PAGE_SOURCE_READ_BYTES, pageSourceRange, type PageError, type PageRecord, type PageVersionRecord, type PublishedPages } from "../pages/published-pages.ts";
import { commentAnswerDocument, escapeHtml, pageDocument, parseReaderAssets, splitSlides, wrapperDocument, type ReaderAssets } from "../pages/published-pages-render.ts";
import type { ReaderBoot } from "../../shared/page-reader.ts";
import type { PageLive } from "../pages/page-live.ts";
import { pageCapabilitiesAny } from "../../shared/page-capabilities.ts";
import { anonymousBy, anonymousName, READER_ID, READER_ID_HEADER, STATE_LIMITS, STATE_PREFIX, stateLevelFor, stateMayWrite, stateRoleFor, validStateKey, type PageStateEntry, type PageStateView, type StateAccess, type StateRole } from "../../shared/page-state.ts";
import { applySuggestion, parsePageQuote, parseSuggestion, parseThreadText, suggestable, type PageThread, type PageThreadsAnswer } from "../../shared/page-threads.ts";
import { geistFace } from "../geist-face.ts";
import { decodeSkinTokens, encodeSkinTokens } from "../../src/lib/page-theme.ts";
import { lookContentTokens } from "../../src/lib/page-look.ts";
import { readerBotColor } from "../../shared/page-reader.ts";
import { MASCOT_COLOR_HEX, type MascotColorName } from "../../shared/mascot-colors.ts";
import type { WidgetThemeTokens } from "../../src/lib/widget-kit.ts";
import { requestSource, type RequestAuth } from "../auth/request-auth.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { pageAudienceOf, pageMayEnter, parsePageAudience } from "../../shared/page-audience.ts";
import {
  PAGE_ACCESS,
  PAGE_COMMENT_PREFIX,
  PAGE_FRAME_PREFIX,
  PAGE_KINDS,
  PAGE_LIMITS,
  PAGE_PREVIEW_FRAME_PREFIX,
  PAGE_PREVIEW_PREFIX,
  PAGE_SCROLL_MAX,
  PAGE_VIEW_PREFIX,
  pageCsp,
  pageHasEditor,
  pageInvites,
  parsePageAnchor,
  parsePageEditors,
  parsePageInvites,
  parsePageTitle,
  validExpiry,
  type PageAccess,
  type PageKind,
  type PagesPolicy,
  type PageTheme,
} from "../../shared/published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { reportBackgroundError } from "../background-error.ts";

/** Who is reading: null for nobody signed in. `principalId` is the person
 * on an organization server; `computerOwner` is the owner of a one-person
 * server (its other paired sessions are not). */
export type PageViewer = { principalId?: string; computerOwner: boolean } | null;

/** Whether this reader may read this page. While the organization's switch
 * for public links is off, a page shared by link reads as "org". A page
 * shared with "People you invite" (`private`) reads for its person, its
 * editors (#1704), and the people and teams they invited (`teamsOf`: the
 * reader's teams). Pure. */
export function pageReadable(page: Pick<PageRecord, "access" | "ownerId" | "invites" | "editors"> & { botShared?: boolean; botId?: string }, viewer: PageViewer, policy?: PagesPolicy, teamsOf?: (principalId: string) => readonly string[], mayUseBot?: (principalId: string, botId: string) => boolean): boolean {
  if (page.access === "link" && policy?.linkSharing !== false) return true;
  if (!viewer) return false;
  if (page.access === "org" || page.access === "link") return true;
  if (page.ownerId === undefined) return viewer.computerOwner;
  if ((viewer.principalId ?? "").toLowerCase() === page.ownerId.toLowerCase()) return true;
  const principalId = viewer.principalId;
  if (pageHasEditor(page.editors, principalId)) return true;
  // #3128: a page shared in its bot's Library reads for whoever uses the bot
  if (page.botShared === true && principalId && page.botId && mayUseBot?.(principalId, page.botId)) return true;
  return Boolean(principalId) && pageInvites(page.invites, principalId, principalId && teamsOf ? teamsOf(principalId) : []);
}

/** Whether this reader is the page's own person (the preview). Pure. */
export function pageOwnedBy(page: Pick<PageRecord, "ownerId">, viewer: PageViewer): boolean {
  return pageReadable({ access: "private", ownerId: page.ownerId }, viewer);
}

/** Whether this reader may change the page (#1704): its person, or someone
 * on its editors list. Pure. */
export function pageMayEdit(page: Pick<PageRecord, "ownerId" | "editors">, viewer: PageViewer): boolean {
  if (pageOwnedBy(page, viewer)) return true;
  return pageHasEditor(page.editors, viewer?.principalId);
}

const readableBy = (options: PublicPageOptions, page: PageRecord, viewer: PageViewer) =>
  pageReadable(page, viewer, options.pages!.policy(), options.teamsOf ? (id) => options.teamsOf!(id) : undefined, options.mayUseBot);

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
  /** The teams a person is in (team ids), for pages shared with a team. */
  teamsOf?(principalId: string): readonly string[];
  /** The built tags of the reader's bar (readerAssetsFrom), or null: the bar
   * then shows the title and the notice without its actions. */
  readerAssets?(): ReaderAssets | null;
  /** A signed-in reader's name, as the bar shows it. */
  personName?(principalId: string): string;
  /** #3128: whether a person may use a bot (its shared pages read for them). */
  mayUseBot?(principalId: string, botId: string): boolean;
  /** Where a reader who is not signed in signs in and comes back to this
   * reading link (an organization server's web sign-in), or nothing. */
  signInPath?(viewPath: string): string | undefined;
  /** The bot that published the page, as the bar draws its mascot
   * (2026-10-29): its color and its character; null when it is gone. */
  bot?(page: PageRecord): { color: string; look?: unknown } | null;
  /** A reader not signed in changed the page's shared state: every open
   * bar reads it again (PageLive.stateChanged). */
  stateChanged?(pageId: string): void;
}

/** A bot color as #rrggbb, for the bar's dot and the bot accent. Pure. */
export function botColorHex(color: string | null | undefined): string | null {
  const known = readerBotColor(color);
  if (!known) return null;
  return known.startsWith("#") ? known : MASCOT_COLOR_HEX[known as MascotColorName] ?? null;
}

/** What a reading link is drawn in: its person's look (PUT /api/pages/look)
 * and its bot, as checked values. */
function readerLook(options: PublicPageOptions, page: PageRecord, botName: string) {
  const look = options.pages?.look(page.ownerId) ?? null;
  const bot = options.bot?.(page) ?? null;
  const color = readerBotColor(bot?.color);
  const character = bot?.look && typeof bot.look === "object" && !Array.isArray(bot.look) ? bot.look as Record<string, unknown> : undefined;
  return {
    look,
    botHex: botColorHex(color),
    bot: color ? { name: botName, color, ...(character ? { look: character } : {}) } : undefined,
  };
}

const assetCache = new Map<string, { mtimeMs: number; assets: ReaderAssets | null }>();

/** The reader's bar as this server's built UI has it (SAGAX_STATIC_DIR's
 * page-reader.html), read again only when that file changes; null when there
 * is none (a server run from source, without a built UI). */
export function readerAssetsFrom(staticDir: string | null): ReaderAssets | null {
  if (!staticDir) return null;
  const file = join(staticDir, "page-reader.html");
  try {
    const { mtimeMs } = statSync(file);
    const cached = assetCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.assets;
    const assets = parseReaderAssets(readFileSync(file, "utf8"));
    assetCache.set(file, { mtimeMs, assets });
    return assets;
  } catch {
    return null;
  }
}

/** What the reader's bar is told: the page's id and Share only for the
 * page's own person; nothing about the page for a reader who is not signed
 * in beyond what the wrapper shows anyway. Pure. */
export function readerBoot(input: { page: PageRecord; version: PageVersionRecord; viewer: PageViewer; lang: "fr" | "en"; personName: string; meName?: string; annotate?: boolean; bot?: ReaderBoot["bot"] }): ReaderBoot {
  const owner = pageOwnedBy(input.page, input.viewer);
  const annotate = input.annotate === true;
  const me = input.viewer?.principalId
    ? { id: input.viewer.principalId, name: owner ? input.personName : input.meName ?? "" }
    : owner ? { id: "owner", name: input.personName } : undefined;
  return {
    v: 1,
    lang: input.lang,
    title: input.page.title ?? input.version.title,
    kind: input.version.kind,
    version: input.version.n,
    ...(owner || annotate ? { pageId: input.page.id } : {}),
    ...(me ? { me } : {}),
    owner: { name: input.personName },
    can: { share: owner, annotate },
    ...(input.bot ? { bot: input.bot } : {}),
  };
}

const NOT_FOUND_STYLE = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#1f2328}"
  + "main{max-width:30rem;margin:16px;padding:24px 28px;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)}p{margin:0 0 12px}"
  + "a{display:inline-block;margin-top:4px;padding:9px 16px;border-radius:999px;background:#1f2328;color:#fff;text-decoration:none;font-weight:600}"
  + "@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}main{background:#161b22;box-shadow:none}a{background:#e6edf3;color:#0d1117}}</style>";

const NOT_FOUND_HTML = (language: "fr" | "en", signIn?: string) => (language === "fr"
  ? "<!doctype html><meta charset=\"utf-8\"><title>Page introuvable</title>" + NOT_FOUND_STYLE + "<main><p>Cette page n'existe pas, n'est plus publiée ou tu n'y as pas accès. Si elle t'a été partagée, connecte-toi à Sagax dans ce navigateur, puis rouvre le lien.</p>"
  : "<!doctype html><meta charset=\"utf-8\"><title>Page not found</title>" + NOT_FOUND_STYLE + "<main><p>This page does not exist, is no longer published, or you cannot see it. If it was shared with you, sign in to Sagax in this browser, then open the link again.</p>")
  // a reader who is not signed in (#1486): sign in, then back to this link
  + (signIn ? `<p><a href="${escapeHtml(signIn)}">${language === "fr" ? "Se connecter et revenir à cette page" : "Sign in and come back to this page"}</a></p>` : "")
  + "</main>";

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

function notFound(req: IncomingMessage, res: ServerResponse, method: string, signIn?: string): true {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox", "x-frame-options": "DENY" });
  res.end(method === "HEAD" ? undefined : NOT_FOUND_HTML(language(req), signIn));
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
  input: { page: PageRecord; version: PageVersionRecord; framePath: string; ticket: string; preview: boolean; annotate?: boolean; commentPath?: string; look?: PreviewLook }): true {
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
  // A reading link's bar runs this server's own built script, in the wrapper
  // only (its CSP below). The open-link listener (#1799) is a nonce'd inline
  // script on every wrapper so a page frame can open the system browser.
  const assets = input.preview ? null : options.readerAssets?.() ?? null;
  const openNonce = randomBytes(16).toString("base64url");
  const scriptSrc = assets ? `script-src 'self' 'nonce-${openNonce}'` : `script-src 'nonce-${openNonce}'`;
  const csp = [
    "default-src 'none'",
    scriptSrc,
    assets ? "style-src 'self' 'unsafe-inline'" : "style-src 'unsafe-inline'",
    assets ? "img-src 'self' data: blob: https:" : "img-src 'none'",
    ...(assets ? ["font-src 'self' data:", "connect-src 'self'"] : []),
    `frame-src ${frameSource}`,
    `child-src ${frameSource}`,
    "base-uri 'none'",
    `form-action ${formAction}`,
    input.preview ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ].join("; ");
  if (!input.preview) res.setHeader("cross-origin-opener-policy", "same-origin");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "x-frame-options": input.preview ? "SAMEORIGIN" : "DENY" });
  const names = options.names(input.page);
  const lang = language(req);
  const viewer = input.preview ? null : options.viewer(req);
  const meName = viewer?.principalId ? options.personName?.(viewer.principalId) : undefined;
  // a reading link is drawn in its person's look, with its bot's mascot
  const drawn = input.preview ? null : readerLook(options, input.page, names.botName);
  res.end(method === "HEAD" ? undefined : wrapperDocument({
    title: input.page.title ?? input.version.title,
    kind: input.version.kind,
    botName: names.botName,
    personName: names.personName,
    frameUrl: `${separate ? separate.pagesOrigin.origin : ""}${input.framePath}?t=${encodeURIComponent(input.ticket)}${input.annotate ? "&a=1" : ""}`
      + (input.preview && input.look?.keep !== undefined ? `&k=${input.look.keep}` : "")
      + (input.preview && input.look?.theme ? `&c=${input.look.theme}` : "")
      + (input.preview && input.look?.theme && input.look.skin ? `&s=${encodeSkinTokens(input.look.skin)}` : ""),
    lang,
    openNonce,
    preview: input.preview,
    // #3413: the preview of a version that declares capabilities relays them to the app's broker
    ...(input.preview && pageCapabilitiesAny(options.pages?.capabilities(input.page.id, input.version.n)) ? { capsRelay: true } : {}),
    ...(!input.preview && input.version.kind === "presentation" ? { slides: splitSlides(options.pages?.content(input.page.id, input.version.n) ?? "").length } : {}),
    ...(input.preview ? {} : { reader: { boot: readerBoot({ page: input.page, version: input.version, viewer, lang, personName: names.personName, ...(meName ? { meName } : {}),
      ...(drawn?.bot ? { bot: drawn.bot } : {}),
      annotate: pageAnnotator(input.page, viewer, { policy: options.pages!.policy(), now: Date.now(), ...(options.teamsOf ? { teamsOf: (id: string) => options.teamsOf!(id) } : {}) }) !== null }), assets,
      look: drawn?.look ?? null, botHex: drawn?.botHex ?? null } }),
    annotate: input.annotate === true,
    ...(input.preview && input.look?.bare ? { bare: true } : {}),
    ...(input.preview && input.look?.theme ? { theme: input.look.theme } : {}),
    ...(input.preview && input.look?.keep !== undefined ? { keep: true } : {}),
    ...(input.commentPath ? { comments: { action: input.commentPath, approved: (input.page.readerNotes ?? []).filter((entry) => entry.status === "approved") } } : {}),
  }));
  return true;
}

function serveWrapper(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const token = tokenAfter(path, PAGE_VIEW_PREFIX);
  const opened = token && options.pages ? options.pages.open(token) : null;
  const viewer = options.viewer(req);
  // nobody signed in: the same 404 for every reason, with a way to sign in
  // and come back to this very link (#1486); never a hint the page exists
  if (!opened || !ownerActive(options, opened.page) || !readableBy(options, opened.page, viewer)) return notFound(req, res, method, viewer ? undefined : options.signInPath?.(path));
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
  return sendWrapper(options, req, res, method, { ...target, framePath: `${PAGE_PREVIEW_FRAME_PREFIX}${rest}`, ticket: options.pages!.frameTicket(subject, viewerKey(viewer)), preview: true, annotate, look: previewLook(req) });
}

/** How the app draws its own preview (2026-10-28), from the wrapper's query:
 * `bare=1` no banner (inside the app, which names the page itself),
 * `theme=light|dark` the app's theme, `skin=<tokens>` the person's skin
 * tokens with it (src/lib/page-theme.ts encodeSkinTokens: known names and
 * safe values only), `y=<n>` keep the place (the frame runs the small script
 * that scrolls there and reports the place back). The page's person only: a
 * reading link never takes them. */
export interface PreviewLook { bare?: boolean; theme?: PageTheme; skin?: WidgetThemeTokens; keep?: number }
export function previewLook(req: IncomingMessage): PreviewLook {
  const theme = query(req, "theme");
  const skin = theme === "light" || theme === "dark" ? decodeSkinTokens(query(req, "skin")) : undefined;
  const y = query(req, "y");
  const keep = /^\d{1,8}$/.test(y) ? Number(y) : undefined;
  return {
    ...(query(req, "bare") === "1" ? { bare: true } : {}),
    ...(theme === "light" || theme === "dark" ? { theme } : {}),
    ...(skin ? { skin } : {}),
    ...(keep !== undefined && keep <= PAGE_SCROLL_MAX ? { keep } : {}),
  };
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

/** A reader's comment (2026-10-21): only on a published page its reader
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
  if (!opened || !ownerActive(options, opened.page) || !readableBy(options, opened.page, viewer) || !readerCommentsOpen(options, opened.page)) {
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
      return reply(429, false, lang === "fr" ? "Trop de commentaires depuis cette adresse. Réessaie plus tard." : "Too many comments from this address. Try again later.");
    }
    const redact = options.redact ?? redactSecretsInText;
    const added = pages.addReaderComment(opened.page.id, { name: redact(name), text: redact(text), version: opened.version.n });
    return added.ok ? reply(200, true) : reply(409, false);
  }).catch(reportBackgroundError);
  return true;
}

/** What a reader gets of a page's state: values, the name of who set each
 * and when, and a handle of this page only (`handleOf`), never a principal
 * id. Pure. */
export function stateView(state: Record<string, PageStateEntry>, nameOf: (by: string) => string, handleOf?: (by: string) => string): Record<string, PageStateView> {
  return Object.fromEntries(Object.entries(state).map(([key, entry]) => [key, { value: entry.value, name: nameOf(entry.by), at: entry.at, ...(handleOf ? { who: handleOf(entry.by) } : {}) }]));
}

/** Whether a page is open to readers who are not signed in: shared with
 * anyone who has the link, and the organization allows public links. Pure. */
export function publicLinkPage(page: Pick<PageRecord, "access">, policy: PagesPolicy): boolean {
  return page.access === "link" && policy.linkSharing !== false;
}

/** The whole state answer: values, who may write what, and the reader's
 * own handle (`me`, when known). */
function stateAnswer(pages: PublishedPages, page: PageRecord, input: { role: StateRole; me?: string; nameOf(by: string): string }): { entries: Record<string, PageStateView>; access: StateAccess; me?: string } {
  return {
    entries: stateView(pages.state(page.id), input.nameOf, (by) => pages.readerHandle(page.id, by)),
    access: { role: input.role, rules: pages.stateRules(page.id), locked: pages.stateLocks(page.id), publicLink: publicLinkPage(page, pages.policy()) },
    ...(input.me ? { me: input.me } : {}),
  };
}

/** A browser's own random id, when its wrapper sent a valid one. */
function readerIdOf(req: IncomingMessage): string | null {
  const raw = req.headers[READER_ID_HEADER];
  return typeof raw === "string" && READER_ID.test(raw) ? raw : null;
}

const STATE_HEADERS = { "content-type": "application/json", "cache-control": "no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" };

/** The page's shared state for whoever may read it (#1544): the same checks
 * and the same 404 as the wrapper; with who may write what (2026-10-29). */
function serveState(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): true {
  const token = tokenAfter(path, STATE_PREFIX);
  const opened = token && options.pages ? options.pages.open(token) : null;
  const viewer = options.viewer(req);
  if (!opened || !ownerActive(options, opened.page) || !readableBy(options, opened.page, viewer)) {
    res.writeHead(404, STATE_HEADERS);
    res.end(method === "HEAD" ? undefined : JSON.stringify({ error: "This page does not exist.", code: "not_found" }));
    return true;
  }
  const pages = options.pages!;
  const page = opened.page;
  const owned = pageOwnedBy(page, viewer);
  const mayEdit = pageMayEdit(page, viewer);
  const annotator = owned ? null : pageAnnotator(page, viewer, { policy: pages.policy(), now: Date.now(), ...(options.teamsOf ? { teamsOf: (id: string) => options.teamsOf!(id) } : {}) });
  const role: StateRole = stateRoleFor({ owned, mayEdit, signedIn: Boolean(annotator) || (mayEdit && !owned) });
  const readerId = role === "anon" ? readerIdOf(req) : null;
  const by = owned
    ? viewer?.principalId ?? "owner"
    : mayEdit && viewer?.principalId
      ? viewer.principalId
      : annotator ? annotator.by : readerId ? pages.anonymousWriter(readerId) : null;
  res.writeHead(200, STATE_HEADERS);
  res.end(method === "HEAD" ? undefined : JSON.stringify(stateAnswer(pages, page, { role, ...(by ? { me: pages.readerHandle(page.id, by) } : {}), nameOf: stateNamer(options, page, language(req)) })));
  return true;
}

/** The name readers see for who set a value: the page's person, a person
 * of the organization, or Anonyme. */
function stateNamer(options: PublicPageOptions, page: PageRecord, lang: "fr" | "en"): (by: string) => string {
  const owner = options.names(page).personName;
  return (by) => anonymousBy(by)
    ? anonymousName(lang)
    : by === "owner" || (page.ownerId && by.toLowerCase() === page.ownerId.toLowerCase()) ? owner : options.personName?.(by) ?? "";
}

const STATE_BODY_MAX = STATE_LIMITS.valueBytes + 1024;

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const type = String(req.headers["content-type"] ?? "");
    if (!/^application\/json\b/i.test(type)) {
      req.resume();
      return resolve(null);
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > STATE_BODY_MAX) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** Whether a request came from this host's own pages: a browser that names
 * another site, or an Origin of another host, never writes here. */
function fromThisHost(req: IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host.toLowerCase() === (hostOf(req) ?? "");
  } catch {
    return false;
  }
}

/** A write by a reader who is not signed in (2026-10-29): only on a page
 * shared with anyone who has the link (else the same 404 as a missing page),
 * only a key the page declares "anyone" and its person did not make
 * read-only, from this host, with the browser's own random id (stored as a
 * hash: Anonyme in the history), within the tighter limits for readers not
 * signed in. The reader's session, if any, is not used here. */
function serveStateWrite(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string): true {
  const lang = language(req);
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, STATE_HEADERS);
    res.end(JSON.stringify(body));
  };
  const token = tokenAfter(path, STATE_PREFIX);
  const opened = token && options.pages ? options.pages.open(token) : null;
  if (!opened || !ownerActive(options, opened.page) || !publicLinkPage(opened.page, options.pages!.policy())) {
    req.resume();
    reply(404, { error: "This page does not exist.", code: "not_found" });
    return true;
  }
  if (!fromThisHost(req)) {
    req.resume();
    reply(403, { error: "Not from this page.", code: "cross_site" });
    return true;
  }
  const readerId = readerIdOf(req);
  void readJson(req).then((body) => {
    const pages = options.pages!;
    const page = opened.page;
    if (!readerId) return reply(400, { error: "Missing the browser's reader id.", code: "no_reader" });
    if (!body || !validStateKey(body.key) || !("value" in body)) return reply(400, { error: "Send { key, value } (value null clears the key).", code: "bad_body" });
    const level = stateLevelFor(pages.stateRules(page.id), body.key);
    const locked = pages.stateLocks(page.id).includes(body.key);
    if (!stateMayWrite("anon", level, { publicLink: true, locked })) {
      return reply(403, locked
        ? { error: lang === "fr" ? "Cette valeur est en lecture seule." : "This value is read-only.", code: "locked" }
        : { error: lang === "fr" ? "Connecte-toi pour modifier cette page." : "Sign in to change this page.", code: "sign_in" });
    }
    const by = pages.anonymousWriter(readerId);
    const result = pages.setState(page.id, { key: body.key, value: body.value, by, anon: { source: requestSource(req) } });
    if (!result.ok) return reply(result.code === "too_many_writes" ? 429 : result.status, { error: result.error, code: result.code });
    options.stateChanged?.(page.id);
    return reply(200, stateAnswer(pages, page, { role: "anon", me: pages.readerHandle(page.id, by), nameOf: stateNamer(options, page, lang) }));
  }).catch(reportBackgroundError);
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
  const allowed = preview ? pageOwnedBy(target.page, reader) : readableBy(options, target.page, reader);
  const content = allowed ? pages.content(target.page.id, target.version.n) : null;
  if (content === null) return notFound(req, res, method);
  const ancestors = options.separate ? options.separate.appOrigin.origin : "'self'";
  // the app's own scripts (annotation, keeping the place) and its theme: the
  // preview only (its person), never a reading link
  const annotating = preview && query(req, "a") === "1";
  const keepRaw = preview ? query(req, "k") : "";
  const keepScroll = /^\d{1,8}$/.test(keepRaw) && Number(keepRaw) <= PAGE_SCROLL_MAX ? Number(keepRaw) : undefined;
  const themeRaw = preview ? query(req, "c") : "";
  const theme: PageTheme | undefined = themeRaw === "light" || themeRaw === "dark" ? themeRaw : undefined;
  const skin = theme ? decodeSkinTokens(query(req, "s")) : undefined;
  // a reading link's frame reports its size to the wrapper (Download PDF)
  const reportSize = !preview;
  // and is drawn in its person's look, light and dark by the reader's system
  const schemes = preview ? undefined : (() => {
    const drawn = readerLook(options, target.page, "");
    return drawn.look ? lookContentTokens(drawn.look, drawn.botHex) : undefined;
  })();
  // Every frame gets a nonce so Markdown/presentation can run our open-link
  // bridge (#1799); annotation and place-keeping reuse the same nonce.
  const nonce = randomBytes(16).toString("base64url");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(target.version.kind, { frameAncestors: ancestors, annotateNonce: nonce }) });
  res.end(method === "HEAD" ? undefined : pageDocument({ kind: target.version.kind, title: target.page.title ?? target.version.title, content, lang: language(req) }, {
    ...(annotating ? { annotateNonce: nonce } : {}),
    nonce,
    ...(keepScroll !== undefined ? { keepScroll } : {}),
    ...(reportSize ? { reportSize: true } : {}),
    // #4099: the app's preview tells the app where the person's selection is
    ...(preview ? { selection: true } : {}),
    // #3413: the capabilities this version declares (null: today's frame)
    capabilities: pages.capabilities(target.page.id, target.version.n),
    ...(theme ? { theme } : {}),
    ...(skin ? { skin } : {}),
    ...(schemes ? { schemes } : {}),
    font: geistFace(),
  }));
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

/** Whether an address belongs to the published pages (/pages and below):
 * it is answered by handlePublishedPagePublic, a page or a 404, and never by
 * the UI's SPA fallback. Pure. */
export function isPagesPath(path: string): boolean {
  return path === "/pages" || path.startsWith("/pages/");
}

/** Answer a published page's wrapper, preview or frame on the app's origin;
 * false when the request is not one. */
export function handlePublishedPagePublic(options: PublicPageOptions, req: IncomingMessage, res: ServerResponse, path: string, method: string): boolean {
  if (!isPagesPath(path)) return false;
  const view = path.startsWith(PAGE_VIEW_PREFIX);
  const previewWrapper = path.startsWith(PAGE_PREVIEW_PREFIX);
  const frame = isFramePath(path);
  const comment = path.startsWith(PAGE_COMMENT_PREFIX);
  const state = path.startsWith(STATE_PREFIX);
  common(res);
  if (state) {
    if (method === "PUT") return serveStateWrite(options, req, res, path);
    return method === "GET" || method === "HEAD" ? serveState(options, req, res, path, method) : refuseMethod(res);
  }
  // Any other address under /pages is no page: an explicit 404, never the
  // app's SPA page (which a page's card would then draw as its preview).
  if (!view && !previewWrapper && !frame && !comment) return notFound(req, res, method);
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
  /** Annotations: the signed-in reader this caller is (a person of the
   * organization, or a one-person server's owner), or null. */
  reader?(auth: RequestAuth): PageViewer;
  /** The teams a person is in, for pages shared with a team. */
  teamsOf?(principalId: string): readonly string[];
  /** #3128: whether a person may use a bot (its shared pages read for them). */
  mayUseBot?(principalId: string, botId: string): boolean;
  /** #3128: whether the caller may remove a page someone shared (its creator, the bot's owner). */
  mayRemoveShared?(auth: RequestAuth, page: PageRecord): boolean;
  /** A person's name, for "Shared by". */
  personName?(principalId: string): string;
  /** Names for the people and bots in a page's threads (by id). */
  names?(ids: readonly string[]): Record<string, string>;
  /** False when the page's person was disabled or deleted. */
  ownerActive?(page: PageRecord): boolean;
  /** Who has a page open, and its annotations as they change. */
  live?: PageLive;
  /** Someone other than the page's person commented or replied: tell its
   * person (a notification). */
  onComment?(input: { page: PageRecord; by: string; text: string; reply: boolean }): void;
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
  // #3128: a page someone shared in the Library of a bot this person uses
  const sharedWith = (auth: RequestAuth, page: PageRecord) => {
    const owner = deps.owner(auth);
    return Boolean(owner) && page.botShared === true && page.status === "published" && !mine(auth, page) && Boolean(deps.mayUseBot?.(owner!, page.botId));
  };
  const sharedFields = (auth: RequestAuth, page: PageRecord) => ({
    sharedBy: (page.ownerId && deps.personName?.(page.ownerId)) || "?",
    canRemove: Boolean(deps.mayRemoveShared?.(auth, page)),
  });
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
      const owner = deps.owner(auth);
      const shared = owner && deps.mayUseBot ? deps.pages.sharedFor(owner, (botId) => deps.mayUseBot!(owner, botId)) : [];
      return json(res, 200, {
        pages: [
          ...deps.pages.list(owner).map((page) => wire(page, req)),
          ...shared.map((page) => ({ ...wire(page, req), ...sharedFields(auth, page) })),
        ],
      });
    }
    if (path === "/api/pages/policy") return method === "GET" ? json(res, 200, deps.pages.policy()) : PASS;
    // the person's look (2026-10-29): their app sends it, a reading link of
    // their pages is drawn in it (src/lib/page-look.ts); their own, no admin
    if (path === "/api/pages/look") {
      if (method === "GET") return json(res, 200, { look: deps.pages.look(deps.owner(auth)) });
      if (method !== "PUT") return PASS;
      const look = deps.pages.setLook(deps.owner(auth), await readBody(req));
      return look ? json(res, 200, { look }) : json(res, 400, { error: "Send { light?, dark?, skin?, botAccent? } with the app's tokens.", code: "bad_body" });
    }
    // design systems (#2717): the built-in ones and the person's own (taken
    // from their code by a bot); their own, no admin
    if (path === "/api/pages/design-systems" && method === "GET") {
      return json(res, 200, { systems: deps.pages.designSystems(deps.owner(auth)).map((system) => ({ ...system, own: system.id.startsWith("own-") })) });
    }
    const designSystemMatch = method === "DELETE" ? /^\/api\/pages\/design-systems\/(own-[a-z0-9-]+)$/.exec(path) : null;
    if (designSystemMatch) {
      return deps.pages.deleteDesignSystem(deps.owner(auth), designSystemMatch[1]!) ? json(res, 200, { ok: true }) : json(res, 404, { error: "No design system of yours has that id.", code: "not_found" });
    }
    // one route per line with its method, so the tool policy sees each one
    const extra: Extra | null =
      (method === "GET" && /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/source$/.exec(path) && { route: "source", match: /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/source$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/export$/.exec(path) && { route: "export", match: /^\/api\/pages\/([\w-]+)\/versions\/(\d+)\/export$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/versions$/.exec(path) && { route: "edit", match: /^\/api\/pages\/([\w-]+)\/versions$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/comments$/.exec(path) && { route: "comments", match: /^\/api\/pages\/([\w-]+)\/comments$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/comments$/.exec(path) && { route: "comment", match: /^\/api\/pages\/([\w-]+)\/comments$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/comments\/([\w-]+)$/.exec(path) && { route: "uncomment", match: /^\/api\/pages\/([\w-]+)\/comments\/([\w-]+)$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/reader-comments$/.exec(path) && { route: "readerComments", match: /^\/api\/pages\/([\w-]+)\/reader-comments$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)\/approve$/.exec(path) && { route: "readerApprove", match: /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)\/approve$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)$/.exec(path) && { route: "readerRemove", match: /^\/api\/pages\/([\w-]+)\/reader-comments\/([\w-]+)$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/share$/.exec(path) && { route: "share", match: /^\/api\/pages\/([\w-]+)\/share$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/place$/.exec(path) && { route: "place", match: /^\/api\/pages\/([\w-]+)\/place$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/invite$/.exec(path) && { route: "invite", match: /^\/api\/pages\/([\w-]+)\/invite$/.exec(path)! })
      || null;
    if (extra) return pageExtras(deps, { req, res, method, auth, json, readBody }, extra);
    // annotations: one route per line with its method, like the ones above
    const thread: ThreadRoute | null =
      (method === "GET" && /^\/api\/pages\/([\w-]+)\/threads$/.exec(path) && { route: "list", match: /^\/api\/pages\/([\w-]+)\/threads$/.exec(path)! })
      || (method === "GET" && /^\/api\/pages\/([\w-]+)\/live$/.exec(path) && { route: "live", match: /^\/api\/pages\/([\w-]+)\/live$/.exec(path)! })
      || (method === "PUT" && /^\/api\/pages\/([\w-]+)\/state$/.exec(path) && { route: "state", match: /^\/api\/pages\/([\w-]+)\/state$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/state$/.exec(path) && { route: "stateClear", match: /^\/api\/pages\/([\w-]+)\/state$/.exec(path)! })
      || (method === "PUT" && /^\/api\/pages\/([\w-]+)\/state\/lock$/.exec(path) && { route: "stateLock", match: /^\/api\/pages\/([\w-]+)\/state\/lock$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/threads$/.exec(path) && { route: "add", match: /^\/api\/pages\/([\w-]+)\/threads$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/replies$/.exec(path) && { route: "reply", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/replies$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/resolve$/.exec(path) && { route: "resolve", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/resolve$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/accept$/.exec(path) && { route: "accept", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/accept$/.exec(path)! })
      || (method === "POST" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/decline$/.exec(path) && { route: "decline", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/decline$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)$/.exec(path) && { route: "remove", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)$/.exec(path)! })
      || (method === "DELETE" && /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/replies\/([\w-]+)$/.exec(path) && { route: "removeReply", match: /^\/api\/pages\/([\w-]+)\/threads\/([\w-]+)\/replies\/([\w-]+)$/.exec(path)! })
      || null;
    if (thread) return pageThreads(deps, { req, res, method, auth, json, readBody }, thread);
    const match = /^\/api\/pages\/([\w-]+)(?:\/(publish|decline|revoke)|\/versions\/(\d+))?$/.exec(path);
    if (!match) return PASS;
    const page = deps.pages.get(match[1]!);
    // Another person's page reads exactly like a missing one.
    const shared = Boolean(page) && !mine(auth, page!) && sharedWith(auth, page!);
    if (!page || (!mine(auth, page) && !shared)) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
    // #3128: a member of the share reads it; its creator and the bot's owner
    // remove it; nothing else of another person's page is theirs to change
    if (shared) {
      if (method === "GET" && !match[2] && match[3] === undefined) return json(res, 200, { page: { ...wire(page, req), ...sharedFields(auth, page) } });
      if (method === "DELETE" && !match[2] && match[3] === undefined && deps.mayRemoveShared?.(auth, page)) {
        deps.pages.remove(page.id);
        return json(res, 200, { ok: true });
      }
      return json(res, 403, { error: "This page is shared by someone else: you can read it and ask its bot to refresh it.", code: "shared_page" });
    }
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
      if (!body || typeof body !== "object") return json(res, 400, { error: "Send { title?, access?, expiresAt?, readerComments?, pinned?, keepUpdated?, botShared?, editors? }.", code: "bad_body" });
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
      let pinned: boolean | undefined;
      if ("pinned" in body) {
        if (typeof body.pinned !== "boolean") return json(res, 400, { error: "pinned: true or false.", code: "bad_pinned" });
        pinned = body.pinned;
      }
      let keepUpdated: boolean | undefined;
      if ("keepUpdated" in body) {
        if (typeof body.keepUpdated !== "boolean") return json(res, 400, { error: "keepUpdated: true or false.", code: "bad_keep" });
        keepUpdated = body.keepUpdated;
      }
      let botShared: boolean | undefined;
      if ("botShared" in body) {
        if (typeof body.botShared !== "boolean") return json(res, 400, { error: "botShared: true or false.", code: "bad_bot_shared" });
        botShared = body.botShared;
      }
      let editors: string[] | undefined;
      if ("editors" in body) {
        const parsed = parsePageEditors(body.editors, page.ownerId ?? by);
        if (!parsed) return json(res, 400, { error: `editors: up to ${PAGE_LIMITS.editors} principal ids, not the page's person.`, code: "bad_editors" });
        editors = parsed;
      }
      if ((access !== undefined || expiresAt !== undefined) && page.status !== "published") return json(res, 409, { error: "Publish this page first.", code: "not_published" });
      if (access === "link" && page.access !== "link" && !deps.pages.policy().linkSharing) return json(res, 403, LINK_SHARING_OFF);
      if (readerComments === true && !deps.pages.policy().readerComments) return json(res, 403, READER_COMMENTS_OFF);
      let result: PageRecord | PageError = page;
      if (title !== undefined) result = deps.pages.rename(page.id, title, by);
      if (!failed(result) && (access !== undefined || expiresAt !== undefined)) {
        result = deps.pages.update(page.id, { ...(access !== undefined ? { access: access as PageAccess } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}), ...(by ? { by } : {}) });
      }
      if (!failed(result) && readerComments !== undefined) result = deps.pages.setReaderComments(page.id, readerComments, by);
      if (!failed(result) && pinned !== undefined) result = deps.pages.setPinned(page.id, pinned, by);
      if (!failed(result) && keepUpdated !== undefined) result = deps.pages.setKeepUpdated(page.id, keepUpdated, by);
      if (!failed(result) && botShared !== undefined) result = deps.pages.setBotShared(page.id, botShared, by);
      if (!failed(result) && editors !== undefined) result = deps.pages.setEditors(page.id, editors, by);
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
/** The file name of an exported version: the title as a slug, and its number. */
export function exportFilename(title: string, version: number): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "page"}-v${version}.html`;
}

type Extra = { route: "source" | "export" | "edit" | "comments" | "comment" | "uncomment" | "readerComments" | "readerApprove" | "readerRemove" | "share" | "place" | "invite"; match: RegExpExecArray };

/** Lot R8: the person's editor (source and own edit), their comments, and
 * the moderation of readers' comments. The same rules as the routes above: a
 * person only, their own pages only, another person's page reads exactly
 * like a missing one. Listed editors (#1704) may read the source and save a
 * new version; share, invite and moderation stay with the page's person. */
async function pageExtras(deps: PublishedPageRouteDeps, ctx: ExtrasContext, extra: Extra) {
  const { req, res, auth, json, readBody } = ctx;
  const { route, match } = extra;
  const page = deps.pages.get(match[1]!);
  const owner = deps.owner(auth);
  // reader() is the signed-in person; on a one-person server there is no
  // principal id and the computer owner manages every page
  const viewer = deps.reader?.(auth) ?? (owner !== undefined
    ? { principalId: owner, computerOwner: false }
    : { computerOwner: true as const });
  const owned = Boolean(page && pageOwnedBy(page, viewer));
  const mayEdit = Boolean(page && pageMayEdit(page, viewer));
  const editorOnly = mayEdit && !owned && (route === "edit" || route === "source" || route === "export");
  if (!page || (!owned && !editorOnly)) {
    return json(res, 404, { error: "This page does not exist.", code: "not_found" });
  }
  const by = viewer.principalId ?? owner;
  const clean = (text: string) => (deps.redact ? deps.redact(text) : text);
  const outcome = (result: PageRecord | PageError) => failed(result) ? json(res, result.status, { error: result.error, code: result.code }) : json(res, 200, { ok: true });
  if (route === "share") {
    const body = await readBody(req) as Record<string, unknown> | null;
    const parsed = parsePageAudience(body);
    if (!parsed.ok) return json(res, 400, { error: parsed.error, code: "bad_audience" });
    const result = deps.pages.share(page.id, parsed.value, by);
    if (failed(result)) return json(res, result.status, { error: result.error, code: result.code });
    const origin = deps.origin(req);
    return json(res, 200, { page: deps.pages.summary(result, origin, deps.reachable(origin)) });
  }
  if (route === "invite") {
    // Share > Add people or groups: the person's own page, their own choice;
    // no admin. Who reads it still follows its access (pageReadable).
    const body = await readBody(req) as Record<string, unknown> | null;
    const invites = parsePageInvites(body, page.ownerId);
    if (!invites) return json(res, 400, { error: "Send { people: [principal ids], teams: [team ids] }.", code: "bad_invites" });
    const result = deps.pages.setInvites(page.id, invites, by);
    if (failed(result)) return json(res, result.status, { error: result.error, code: result.code });
    const origin = deps.origin(req);
    return json(res, 200, { page: deps.pages.summary(result, origin, deps.reachable(origin)) });
  }
  if (route === "place") {
    const body = await readBody(req) as Record<string, unknown> | null;
    const into = body?.into;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if ((into !== "room" && into !== "group") || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      return json(res, 400, { error: "Send { into: room or group, id }.", code: "bad_place" });
    }
    const audience = pageAudienceOf(page.audience);
    if (!pageMayEnter(audience, { kind: into, id })) {
      const code = audience.kind === "person" ? "page_audience_person" : "page_audience_mismatch";
      const error = audience.kind === "person"
        ? "This page stays with its person. Choose a room or a group when you share it."
        : "This page is shared with a different room or group.";
      return json(res, 403, { error, code });
    }
    return json(res, 200, { ok: true, audience });
  }
  if (route === "source") {
    // #3488: size and SHA-256 always; ?offset=&limit= (UTF-8 bytes) reads
    // one slice, nextOffset the next one (null at the end)
    const query = new URL(req.url ?? "/", "http://local").searchParams;
    const range = pageSourceRange(query.get("offset"), query.get("limit"));
    if (!range) return json(res, 400, { error: `offset: a byte offset of 0 or more; limit: 1 to ${PAGE_SOURCE_READ_BYTES.max} bytes.`, code: "bad_range" });
    const read = deps.pages.source(page.id, Number(match[2]), range === "whole" ? undefined : range);
    if (!read) return json(res, 404, { error: "This version does not exist.", code: "no_version" });
    return json(res, 200, read);
  }
  if (route === "export") {
    // a self-contained file of one version (#2717): the same document a
    // reader gets, with its theme, Geist and, for a design, its canvas and
    // design system, so it opens and prints (one screen per sheet) anywhere
    const version = page.versions.find((entry) => entry.n === Number(match[2]));
    const content = version ? deps.pages.content(page.id, version.n) : null;
    if (!version || content === null) return json(res, 404, { error: "This version does not exist.", code: "no_version" });
    const asked = new URL(req.url ?? "/", "http://local").searchParams.get("theme");
    const theme: PageTheme = asked === "dark" ? "dark" : "light";
    const title = page.title ?? version.title;
    const html = pageDocument({ kind: version.kind, title, content }, { meta: true, theme, font: geistFace() });
    return json(res, 200, { filename: exportFilename(title, version.n), html });
  }
  if (route === "edit") {
    const body = await readBody(req) as Record<string, unknown> | null;
    const kind = body?.kind;
    if (!PAGE_KINDS.includes(kind as PageKind)) return json(res, 400, { error: "kind: html, markdown, presentation or design.", code: "bad_kind" });
    if (typeof body!.content !== "string" || !body!.content.trim()) return json(res, 400, { error: "content: the page's full text is required.", code: "bad_content" });
    let content: string = body!.content;
    // a design drawn again with the design system the person picked (#2717)
    if (kind === "design" && typeof body!.designSystem === "string") {
      const system = findDesignSystem(deps.pages.designSystems(page.ownerId), body!.designSystem);
      if (!system) return json(res, 400, { error: "designSystem: unknown design system.", code: "bad_design_system" });
      content = applyDesignSystem(content, system);
    }
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

type ThreadRoute = { route: "list" | "live" | "state" | "stateClear" | "stateLock" | "add" | "reply" | "resolve" | "accept" | "decline" | "remove" | "removeReply"; match: RegExpExecArray };

/** Who may annotate this page: its own person always; anyone else signed in
 * only while it is published, not expired, and readable by them. Null for
 * everyone else (their answer is the same 404 as a missing page). Pure. */
export function pageAnnotator(page: PageRecord, viewer: PageViewer, input: { policy: PagesPolicy; now: number; teamsOf?: (principalId: string) => readonly string[]; ownerActive?: boolean }): { by: string; owner: boolean } | null {
  if (!viewer || input.ownerActive === false) return null;
  if (pageOwnedBy(page, viewer)) return { by: viewer.principalId ?? "owner", owner: true };
  if (!viewer.principalId) return null;
  const live = page.status === "published" && page.currentVersion !== null && (page.expiresAt === null || page.expiresAt > input.now);
  return live && pageReadable(page, viewer, input.policy, input.teamsOf) ? { by: viewer.principalId, owner: false } : null;
}

/** Annotations, from the reader's bar: the same checks for every route, the
 * text cut and stripped of secret-shaped words, a thread or reply deleted
 * only by its author or the page's person. */
async function pageThreads(deps: PublishedPageRouteDeps, ctx: ExtrasContext, thread: ThreadRoute) {
  const { req, res, auth, json, readBody } = ctx;
  const { route, match } = thread;
  const page = deps.pages.get(match[1]!);
  const now = deps.now?.() ?? Date.now();
  const who = page ? pageAnnotator(page, deps.reader?.(auth) ?? null, { policy: deps.pages.policy(), now, ...(deps.teamsOf ? { teamsOf: deps.teamsOf } : {}), ownerActive: deps.ownerActive?.(page) ?? true }) : null;
  if (!page || !who) return json(res, 404, { error: "This page does not exist.", code: "not_found" });
  const clean = (text: string) => (deps.redact ? deps.redact(text) : text);
  const answer = (): PageThreadsAnswer => {
    const threads = deps.pages.threads(page.id);
    const ids = [...new Set(threads.flatMap((entry: PageThread) => [entry.by, ...entry.replies.map((reply) => reply.by), ...(entry.resolved ? [entry.resolved.by] : [])]))];
    return {
      threads: threads.map((entry) => ({ ...entry, mine: entry.by.toLowerCase() === who.by.toLowerCase() })),
      names: deps.names?.(ids) ?? {},
      owner: who.owner,
    };
  };
  if (route === "list") return json(res, 200, answer());
  if (route === "live") {
    if (!deps.live) return json(res, 404, { error: "No live updates on this server.", code: "no_live" });
    const name = deps.names?.([who.by])[who.by] ?? "";
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", connection: "keep-alive" });
    res.write(": open\n\n");
    const leave = deps.live.join(page.id, { id: who.by, name }, res);
    if (!leave) {
      res.end();
      return;
    }
    req.on("close", leave);
    res.on("close", leave);
    return;
  }
  if (route === "state" || route === "stateClear" || route === "stateLock") {
    // the page's shared state (#1544): a reader who may annotate writes the
    // keys the page lets them write (2026-10-29); its person always clears
    // it or makes a key read-only. Editors (#1704) write editors-level keys.
    const viewer = deps.reader?.(auth) ?? null;
    const role: StateRole = stateRoleFor({
      owned: who.owner,
      mayEdit: pageMayEdit(page, viewer),
      signedIn: true,
    });
    const lang = language(req);
    const nameOf = (by: string) => anonymousBy(by) ? anonymousName(lang) : names[by] ?? "";
    let names: Record<string, string> = {};
    const reply = () => {
      const ids = [...new Set(Object.values(deps.pages.state(page.id)).map((entry) => entry.by).filter((by) => !anonymousBy(by)))];
      names = deps.names?.(ids) ?? {};
      return json(res, 200, stateAnswer(deps.pages, deps.pages.get(page.id) ?? page, { role, me: deps.pages.readerHandle(page.id, who.by), nameOf }));
    };
    if (route !== "state" && !who.owner) return json(res, 403, { error: "Only the page's person does this.", code: "owner_only" });
    if (route === "stateClear") {
      const cleared = deps.pages.clearState(page.id);
      if (!cleared.ok) return json(res, cleared.status, { error: cleared.error, code: cleared.code });
      deps.live?.stateChanged(page.id);
      return reply();
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    if (route === "stateLock") {
      if (!body || !validStateKey(body.key) || typeof body.locked !== "boolean") return json(res, 400, { error: "Send { key, locked }.", code: "bad_body" });
      const result = deps.pages.lockState(page.id, body.key, body.locked);
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      deps.live?.stateChanged(page.id);
      return reply();
    }
    if (!body || !validStateKey(body.key) || !("value" in body)) return json(res, 400, { error: "Send { key, value } (value null clears the key).", code: "bad_body" });
    const level = stateLevelFor(deps.pages.stateRules(page.id), body.key);
    const locked = deps.pages.stateLocks(page.id).includes(body.key);
    if (!stateMayWrite(role, level, { publicLink: publicLinkPage(page, deps.pages.policy()), locked })) {
      return json(res, 403, locked
        ? { error: lang === "fr" ? "Cette valeur est en lecture seule." : "This value is read-only.", code: "locked" }
        : { error: lang === "fr" ? "Seule la personne de la page modifie cette valeur." : "Only the page's person changes this value.", code: "not_allowed" });
    }
    const result = deps.pages.setState(page.id, { key: body.key, value: body.value, by: who.by });
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    deps.live?.stateChanged(page.id);
    return reply();
  }
  // after a change: every open bar reads the threads again
  const changed = () => deps.live?.changed(page.id);
  const threadId = match[2];
  if (route === "remove" || route === "removeReply") {
    const target = deps.pages.threads(page.id).find((entry) => entry.id === threadId);
    const author = route === "remove" ? target?.by : target?.replies.find((reply) => reply.id === match[3])?.by;
    if (!target || author === undefined) return json(res, 404, { error: route === "remove" ? "This annotation does not exist." : "This reply does not exist.", code: route === "remove" ? "no_thread" : "no_reply" });
    if (!who.owner && author.toLowerCase() !== who.by.toLowerCase()) return json(res, 403, { error: "Only its author or the page's person deletes it.", code: "not_author" });
    const result = deps.pages.removeThreadPart(page.id, threadId!, route === "removeReply" ? match[3] : undefined);
    if (failed(result)) return json(res, result.status, { error: result.error, code: result.code });
    changed();
    return json(res, 200, answer());
  }
  if (route === "accept" || route === "decline") {
    req.resume();
    // the page's person decides; nobody else changes the page
    if (!who.owner) return json(res, 403, { error: "Only the page's person accepts or declines a suggestion.", code: "owner_only" });
    const target = deps.pages.threads(page.id).find((entry) => entry.id === threadId);
    if (!target?.suggestion) return json(res, 404, { error: "This suggestion does not exist.", code: "no_suggestion" });
    if (target.suggestion.state !== "open") return json(res, 409, { error: "This suggestion was already decided.", code: "decided" });
    if (route === "decline") {
      const result = deps.pages.decideSuggestion(page.id, threadId!, { by: who.by, state: "declined" });
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      changed();
      return json(res, 200, answer());
    }
    const latest = page.versions.at(-1);
    const source = latest ? deps.pages.content(page.id, latest.n) : null;
    if (!latest || source === null || !suggestable(latest.kind)) return json(res, 409, { error: "This page's source takes no suggestion.", code: "not_suggestable" });
    const applied = applySuggestion(source, target.anchor, target.suggestion.text);
    if (!applied.ok) {
      return json(res, 409, applied.reason === "ambiguous"
        ? { error: "These words appear more than once in the page: edit the page instead.", code: "suggestion_ambiguous" }
        : { error: "These words are no longer in the page as written: edit the page instead.", code: "suggestion_not_found" });
    }
    const edited = deps.pages.edit(page.id, { kind: latest.kind, content: applied.content, ...(who.owner && page.ownerId ? { by: page.ownerId } : {}) });
    if (!edited.ok) return json(res, edited.status, { error: edited.error, code: edited.code });
    // a page its person shares stays shared, now with the accepted words
    const fresh = deps.pages.get(page.id)!;
    if (fresh.status === "published" && fresh.currentVersion !== edited.version.n) {
      const published = deps.pages.publish(page.id, { version: edited.version.n, access: fresh.access, expiresAt: fresh.expiresAt, ...(page.ownerId ? { by: page.ownerId } : {}) });
      if (failed(published)) return json(res, published.status, { error: published.error, code: published.code });
    }
    const result = deps.pages.decideSuggestion(page.id, threadId!, { by: who.by, state: "accepted", version: edited.version.n });
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    changed();
    return json(res, 200, { ...answer(), version: edited.version.n });
  }
  const body = await readBody(req) as Record<string, unknown> | null;
  if (route === "resolve") {
    if (typeof body?.resolved !== "boolean") return json(res, 400, { error: "Send { resolved: true or false }.", code: "bad_body" });
    const result = deps.pages.resolveThread(page.id, threadId!, { by: who.by, resolved: body.resolved });
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    changed();
    return json(res, 200, answer());
  }
  const typed = parseThreadText(body?.text);
  // a suggestion may come without a comment
  const suggesting = route === "add" && body?.suggestion !== undefined;
  const text = typed ?? (suggesting && (typeof body?.text !== "string" || !body.text.trim()) ? "" : null);
  if (text === null) return json(res, 400, { error: "text: 1 to 2000 characters.", code: "bad_text" });
  if (route === "reply") {
    if (!text) return json(res, 400, { error: "text: 1 to 2000 characters.", code: "bad_text" });
    const result = deps.pages.reply(page.id, threadId!, { by: who.by, text: clean(text) });
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    changed();
    if (!who.owner) deps.onComment?.({ page, by: who.by, text: result.reply.text, reply: true });
    return json(res, 201, answer());
  }
  // route === "add": on the version readers get (its person: the latest)
  const anchor = parsePageQuote(body?.anchor);
  if (!anchor) return json(res, 400, { error: "anchor: { kind, quote, prefix, suffix, path, tag }.", code: "bad_anchor" });
  const version = page.currentVersion ?? page.versions.at(-1)?.n ?? 1;
  let suggestion: string | undefined;
  if (suggesting) {
    const kind = page.versions.find((entry) => entry.n === version)?.kind ?? "";
    if (!suggestable(kind) || anchor.kind !== "text") return json(res, 400, { error: "Suggestions are for the text of a Markdown page or presentation.", code: "not_suggestable" });
    const parsed = parseSuggestion(body!.suggestion, anchor.quote);
    if (parsed === null) return json(res, 400, { error: "suggestion: the new words, at most 8000 characters, other than the quoted ones.", code: "bad_suggestion" });
    suggestion = clean(parsed);
  } else if (!text) {
    return json(res, 400, { error: "text: 1 to 2000 characters.", code: "bad_text" });
  }
  const result = deps.pages.addThread(page.id, { by: who.by, anchor, text: clean(text), version, ...(suggestion !== undefined ? { suggestion } : {}) });
  if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
  changed();
  if (!who.owner) deps.onComment?.({ page, by: who.by, text: result.thread.text || `→ ${result.thread.suggestion?.text ?? ""}`, reply: false });
  return json(res, 201, answer());
}
