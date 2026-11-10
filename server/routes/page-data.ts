// The server side of a page's capability bridge (#3413,
// shared/page-capabilities.ts). The wrapper calls these with the reader's
// own session; the page itself never reaches them (no network in its frame).
//
//   GET  /api/pages/:id/capabilities?version=n      { version, capabilities, reads: [{ name, label }] }
//   GET  /api/pages/:id/data/:source?fresh=1&version=n   PageDataAnswer
//   GET  /api/pages/:id/viewer?version=n             PageViewerInfo
//   POST /api/pages/:id/data-approvals/:approvalId   PageDataApprovalAnswer -> { ok, answer }
//   GET    /api/pages/:id/link-approvals?origin=<origin>  PageLinkApprovalState
//   POST   /api/pages/:id/link-approvals  { origin, answer: "always" } -> { ok: true }
//   DELETE /api/pages/:id/link-approvals?origin=<origin>  -> { ok: true }  forget it
// Link approvals ("Always allow this site"): per reader, page and exact
// origin (scheme, host, port; normalizePageLinkOrigin); anything else, the
// former `host` included, answers 400 origin_required;
// on disk (server/pages/page-link-approvals.ts); the person only, never a
// bot's act session.
//
// `version`: the published version for every reader; the page's own person
// may name any version (the app's preview, the publish card). `lang=fr|en`
// (else Accept-Language): the language of the error texts; `code` is stable.
//
// Every call is checked here: the reader is signed in (a reader who is not
// gets no personal capability: 401 sign_in, before anything is read); the
// reader may read this page (else the same 404 as a missing page); the
// version declares the capability; the organization's Deny and Ask first
// rules for the action `page_data`, in the reader's context (no other gate:
// everything here stays in the reader's own environment). Ask first opens a
// card the server records (server/pages/page-data-approvals.ts); only the
// reader's own session answers it, never a bot's `act` copy, and no request
// flag stands for it. A source is read with the reader's `auth`, never the
// page owner's. The answer lists only the exits the source names. A page
// that reads personal data keeps its shared state read only while shared
// (PublishedPages.stateReadOnlyForData).
import type { IncomingMessage } from "node:http";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  PAGE_CAP_LIMITS,
  pageCapGranted,
  type PageCapabilities,
  type PageCapError,
  type PageDataAnswer,
  type PageDataAskFirst,
  type PageDataSource,
  type PageLinkApprovalState,
  type PageViewerInfo,
  normalizePageLinkOrigin,
} from "../../shared/page-capabilities.ts";
import type { PagesPolicy } from "../../shared/published-pages.ts";
import type { PageDataApprovals } from "../pages/page-data-approvals.ts";
import type { PageLinkApprovals } from "../pages/page-link-approvals.ts";
import { PageSourceError, type PageDataWatch, type PageSources } from "../pages/page-sources.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import { pageAnnotator, pageMayEdit, type PageViewer } from "./published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PageDataRouteDeps {
  pages: {
    get(id: string): PageRecord | null | undefined;
    capabilities(id: string, n?: number): PageCapabilities | null;
    policy(): PagesPolicy;
    readerHandle(pageId: string, by: string): string;
  };
  /** The signed-in reader this caller is, or null. */
  reader(auth: RequestAuth): PageViewer;
  /** A bot's `act` copy of the person's session (isBotActSession). */
  botAct(auth: RequestAuth): boolean;
  teamsOf?(principalId: string): readonly string[];
  ownerActive?(page: PageRecord): boolean;
  names?(ids: readonly string[]): Record<string, string>;
  sources: PageSources;
  /** The organization's Deny and Ask first rules for the action `page_data`
   * on this source, in the reader's context (never the page owner's bot). */
  orgRule?(input: { source: string; auth: RequestAuth }): "deny" | "ask" | "none";
  approvals: PageDataApprovals;
  /** "Always allow this site" answers of the link card. */
  links?: PageLinkApprovals;
  watch?: PageDataWatch;
  now?(): number;
}

const ROUTE = /^\/api\/pages\/([\w-]+)\/(capabilities|viewer|data\/([\w-]+))$/;
const APPROVAL_ROUTE = /^\/api\/pages\/([\w-]+)\/data-approvals\/([\w-]+)$/;
const LINK_ROUTE = /^\/api\/pages\/([\w-]+)\/link-approvals$/;

type Lang = "fr" | "en";

const TEXTS: Record<PageCapError, Record<Lang, string>> = {
  sign_in: { en: "Sign in to use this page's data.", fr: "Connecte-toi pour utiliser les données de cette page." },
  not_declared: { en: "This page does not declare this capability.", fr: "Cette page ne déclare pas cette capacité." },
  denied: { en: "Your organization refuses this read.", fr: "Ton organisation refuse cette lecture." },
  ask_first: { en: "Your organization asks you first before this page reads your data.", fr: "Ton organisation te demande d'abord ta permission avant que cette page lise tes données." },
  rate_limited: { en: "This page reads too often. Try again in a minute.", fr: "Cette page lit trop souvent. Réessaie dans une minute." },
  too_large: { en: "This data is too large for a page.", fr: "Ces données sont trop grandes pour une page." },
  unavailable: { en: "This data could not be read now.", fr: "Ces données n'ont pas pu être lues pour l'instant." },
  not_found: { en: "This page does not exist.", fr: "Cette page n'existe pas." },
  bad_request: { en: "This request is not valid.", fr: "Cette demande n'est pas valide." },
  shared_write_after_data: { en: "This page reads personal data: its shared state is read only while it is shared.", fr: "Cette page lit des données personnelles : son état partagé est en lecture seule tant qu'elle est partagée." },
};

function langOf(url: URL, req: IncomingMessage): Lang {
  const asked = url.searchParams.get("lang");
  if (asked === "fr" || asked === "en") return asked;
  const header = req.headers?.["accept-language"];
  return typeof header === "string" && /^\s*fr\b/i.test(header) ? "fr" : "en";
}

export function createPageDataRoutes(deps: PageDataRouteDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  const reads = new Map<string, number[]>();
  const allowRead = (key: string): boolean => {
    const at = now();
    const recent = (reads.get(key) ?? []).filter((time) => at - time < 60_000);
    if (recent.length >= PAGE_CAP_LIMITS.dataReadsPerMinute) {
      reads.set(key, recent);
      return false;
    }
    recent.push(at);
    if (reads.size > 10_000) reads.clear();
    reads.set(key, recent);
    return true;
  };

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const approval = method === "POST" ? APPROVAL_ROUTE.exec(path) : null;
    const match = method === "GET" ? ROUTE.exec(path) : null;
    const link = deps.links && (method === "GET" || method === "POST" || method === "DELETE") ? LINK_ROUTE.exec(path) : null;
    if (!approval && !match && !link) return PASS;
    res.setHeader?.("cache-control", "no-store");
    const lang = langOf(url, req);
    const refuse = (status: number, code: PageCapError, extra: Record<string, unknown> = {}) => json(res, status, { error: TEXTS[code][lang], code, ...extra });
    const viewer = deps.reader(auth);
    // a reader who is not signed in: no personal capability, and nothing
    // that says whether the page or its owner has data
    if (!viewer || (!viewer.principalId && !viewer.computerOwner)) return refuse(401, "sign_in");
    const page = deps.pages.get((approval ?? match ?? link)![1]!);
    const who = page ? pageAnnotator(page, viewer, { policy: deps.pages.policy(), now: now(), ...(deps.teamsOf ? { teamsOf: deps.teamsOf } : {}), ownerActive: deps.ownerActive?.(page) ?? true }) : null;
    if (!page || !who) return refuse(404, "not_found");

    if (link) {
      // the reader's own answer: never a bot's act copy, to read, write or forget
      if (deps.botAct(auth)) return json(res, 403, { error: lang === "fr" ? "Seule la personne répond à cette carte, jamais un bot." : "Only the person answers this card, never a bot.", code: "person_only" });
      const links = deps.links!;
      const originRequired = () => json(res, 400, { error: lang === "fr" ? "Envoie l'origine du site (https://exemple.com), pas son hôte." : "Send the site's origin (https://example.com), not its host.", code: "origin_required" });
      if (method === "POST") {
        const body = await readBody(req) as Record<string, unknown> | null;
        const origin = normalizePageLinkOrigin(body?.origin);
        if (!origin) return originRequired();
        if (body?.answer !== "always") return refuse(400, "bad_request");
        if (!links.allow(who.by, page.id, origin)) return json(res, 409, { error: lang === "fr" ? "Trop de sites sont déjà permis sur ce serveur." : "Too many sites are already allowed on this server.", code: "too_many" });
        return json(res, 200, { ok: true });
      }
      const origin = normalizePageLinkOrigin(url.searchParams.get("origin"));
      if (!origin) return originRequired();
      if (method === "DELETE") {
        links.forget(who.by, page.id, origin);
        return json(res, 200, { ok: true });
      }
      const state: PageLinkApprovalState = { allowed: links.allowed(who.by, page.id, origin) };
      return json(res, 200, state);
    }

    if (approval) {
      // the reader's own answer to the card: never a bot's act copy
      if (deps.botAct(auth)) return json(res, 403, { error: lang === "fr" ? "Seule la personne répond à cette carte, jamais un bot." : "Only the person answers this card, never a bot.", code: "person_only" });
      const body = await readBody(req) as Record<string, unknown> | null;
      const answer = body?.answer;
      if (answer !== "once" && answer !== "always" && answer !== "deny") return refuse(400, "bad_request");
      const result = deps.approvals.answer(approval[2]!, who.by, { allow: answer !== "deny", always: answer === "always" });
      if (!result.ok || result.ask.pageId !== page.id) return refuse(404, "not_found");
      return json(res, 200, { ok: true, answer });
    }

    // the published version; the page's own person may name any version
    const askedRaw = url.searchParams.get("version");
    const asked = askedRaw && /^\d{1,6}$/.test(askedRaw) ? Number(askedRaw) : undefined;
    const version = who.owner
      ? (asked !== undefined && page.versions.some((entry) => entry.n === asked) ? asked : page.currentVersion ?? page.versions.at(-1)?.n)
      : page.currentVersion ?? undefined;
    if (!who.owner && asked !== undefined && asked !== version) return refuse(404, "not_found");
    const caps = version === undefined ? null : deps.pages.capabilities(page.id, version);

    if (match![2] === "capabilities") {
      return json(res, 200, {
        version: version ?? null,
        capabilities: caps ?? { data: [], viewer: false, open: false },
        reads: (caps?.data ?? []).map((name) => ({ name, label: deps.sources.label(name) ?? name })),
      });
    }

    if (match![2] === "viewer") {
      if (!pageCapGranted(caps, "viewer.get")) return refuse(403, "not_declared");
      const info: PageViewerInfo = {
        name: deps.names?.([who.by])[who.by] ?? "",
        handle: deps.pages.readerHandle(page.id, who.by),
        role: who.owner ? "owner" : pageMayEdit(page, viewer) ? "editor" : "signed_in",
        lang,
      };
      return json(res, 200, info);
    }

    const name = match![3]!;
    const source = deps.sources.get(name);
    if (!pageCapGranted(caps, "data.read", name) || !source || version === undefined) return refuse(403, "not_declared");
    const rule = deps.orgRule?.({ source: name, auth }) ?? "none";
    if (rule === "deny") return refuse(403, "denied");
    const ask = { person: who.by, pageId: page.id, version, source: name };
    if (rule === "ask" && !deps.approvals.allowed(ask)) {
      const body: PageDataAskFirst = { error: TEXTS.ask_first[lang], code: "ask_first", approvalId: deps.approvals.open(ask), source: name as PageDataSource, version };
      return json(res, 409, body);
    }
    if (!allowRead(`${page.id}\u0000${who.by.toLowerCase()}`)) return refuse(429, "rate_limited");
    let read: Awaited<ReturnType<typeof source.read>>;
    try {
      read = await source.read(auth, { params: {}, fresh: url.searchParams.get("fresh") === "1" });
    } catch (error) {
      if (error instanceof PageSourceError) return refuse(error.status, error.code);
      return refuse(503, "unavailable");
    }
    const text = JSON.stringify(read.value ?? null);
    if (Buffer.byteLength(text) > PAGE_CAP_LIMITS.answerBytes) return refuse(413, "too_large");
    deps.watch?.record(page.id, who.by, name as PageDataSource, read.topics);
    // only the exits the source named, and only https ones
    const links = (read.links ?? []).filter((link) => /^https:\/\/[^\s@]+$/.test(link));
    const answer: PageDataAnswer = { name: name as PageDataSource, value: read.value ?? null, at: now(), links, refs: read.refs ?? [] };
    return json(res, 200, answer);
  };
}
