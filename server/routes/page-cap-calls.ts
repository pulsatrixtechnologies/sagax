// The calls of a page's capability bridge that keep or act on something
// (#3413 lots 3 to 7, shared/page-capabilities.ts). server/routes/page-data.ts
// has already checked the reader (signed in, may read the page) and chosen the
// version; each call here is checked again against that version's
// declaration, the reader's role on the page and the isolation rules:
//
//   GET    /api/pages/:id/store/:collection?q=<PageStoreQuery JSON>  { docs: PageStoreDoc[] }
//   GET    /api/pages/:id/store/:collection/:doc                     PageStoreDoc
//   POST   /api/pages/:id/store/:collection        { value }        PageStoreDoc (a new id)
//   PUT    /api/pages/:id/store/:collection/:doc   { value }        PageStoreDoc
//   DELETE /api/pages/:id/store/:collection/:doc                     { ok: true }
//   POST   /api/pages/:id/model   PageModelQuestion   PageModelAnswer (lot 4)
//
// model.ask runs on the reader's own engine and account, never the page
// owner's; the organization's Deny and Ask first apply to it (action
// `page_model`), Ask first through the same card as a data read; at most
// modelQuestionsPerMinute per reader and page.
//
// Isolation: a `reader` collection is read and written per reader, never
// another's; a write to what other readers read (a `shared` collection) is
// refused while the page reads personal data and is shared with anyone but
// its person (PublishedPages.stateReadOnlyForData), the rule of the shared
// state. Writes count in the page person's own share.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RequestAuth } from "../auth/request-auth.ts";
import { PAGE_CAP_LIMITS, pageModelJson, parsePageModelQuestion, parsePageStoreQuery, type PageCapabilities, type PageCapError, type PageDataAskFirst, type PageModelAnswer, type PageModelQuestion, type PageStoreDoc } from "../../shared/page-capabilities.ts";
import { stateMayWrite, type StateRole } from "../../shared/page-state.ts";
import { PAGE_LIMITS } from "../../shared/published-pages.ts";
import type { PageDataApprovals } from "../pages/page-data-approvals.ts";
import type { PageStore, StoredDoc } from "../pages/page-store.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import type { PageViewer } from "./published-pages.ts";
import type { RouteContext } from "./table.ts";

/** The routes of this module, one per line with its method. */
export const PAGE_STORE_ROUTE = /^\/api\/pages\/([\w-]+)\/store\/([a-z][a-z0-9_-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/;
export const PAGE_MODEL_ROUTE = /^\/api\/pages\/([\w-]+)\/model$/;

/** The organization's Deny and Ask first for one call a page makes, in the
 * reader's context (an organization rule applies to every person). */
export type PageActRule = (input: { tool: string; mcpTool: string; summary: string; input: string; readOnly: boolean; auth: RequestAuth }) => "deny" | "ask" | "none";

/** What a model is asked for a page: the page's system words and the
 * schema its answer follows, before the question. Pure. */
export function pageModelPrompt(question: PageModelQuestion): string {
  const head = [
    question.system?.trim(),
    question.schema ? `Answer with JSON only, no other text, that follows this JSON Schema:\n${JSON.stringify(question.schema)}` : undefined,
  ].filter(Boolean).join("\n\n");
  return head ? `${head}\n\n${question.prompt}` : question.prompt;
}

export interface PageCapCallDeps {
  pages: {
    readerHandle(pageId: string, by: string): string;
    /** The page reads personal data and is shared: shared writes refused. */
    stateReadOnlyForData?(id: string): boolean;
    /** Every byte the page's person keeps (versions, store, files). */
    ownerBytes?(ownerId: string | undefined): number;
  };
  names?(ids: readonly string[]): Record<string, string>;
  /** Lot 3: the pages' store. */
  store?: PageStore;
  /** A collection changed: the open bars of who reads it (everyone, or that
   * reader alone for a `reader` collection) tell their page. */
  live?: { store(pageId: string, name: string, personId?: string): void };
  /** Ask first answers (server/pages/page-data-approvals.ts). */
  approvals?: PageDataApprovals;
  actRule?: PageActRule;
  /** Lot 4: one tool-free answer on the reader's own engine and account. */
  model?: { ask(input: { auth: RequestAuth; viewer: NonNullable<PageViewer>; text: string; lang: "fr" | "en" }): Promise<string> };
  now?(): number;
}

export interface PageCapCallContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
  auth: RequestAuth;
  json: RouteContext["json"];
  readBody: RouteContext["readBody"];
  refuse(status: number, code: PageCapError, extra?: Record<string, unknown>): void;
  page: PageRecord;
  viewer: NonNullable<PageViewer>;
  /** The reader as the page's records keep them, and whether it is its person. */
  who: { by: string; owner: boolean };
  role: StateRole;
  caps: PageCapabilities | null;
  version: number | undefined;
  lang: "fr" | "en";
}

/** The reader's room left in the page person's share, in bytes. */
function roomOf(deps: PageCapCallDeps, page: PageRecord): number | undefined {
  return deps.pages.ownerBytes ? Math.max(0, PAGE_LIMITS.bytesPerOwner - deps.pages.ownerBytes(page.ownerId)) : undefined;
}

function storeDoc(deps: PageCapCallDeps, ctx: PageCapCallContext, doc: StoredDoc): PageStoreDoc {
  return {
    id: doc.id,
    value: doc.value,
    by: deps.pages.readerHandle(ctx.page.id, doc.by),
    name: deps.names?.([doc.by])[doc.by] ?? "",
    at: doc.at,
    mine: doc.by.toLowerCase() === ctx.who.by.toLowerCase(),
  };
}

/** The handler of these calls, with its own per reader rate counts. */
export function createPageCapCalls(deps: PageCapCallDeps): { handle(ctx: PageCapCallContext): Promise<void> } {
  const now = () => deps.now?.() ?? Date.now();
  const asked = new Map<string, number[]>();
  const allowQuestion = (key: string): boolean => {
    const at = now();
    const recent = (asked.get(key) ?? []).filter((time) => at - time < 60_000);
    if (recent.length >= PAGE_CAP_LIMITS.modelQuestionsPerMinute) {
      asked.set(key, recent);
      return false;
    }
    recent.push(at);
    if (asked.size > 10_000) asked.clear();
    asked.set(key, recent);
    return true;
  };

  const modelCall = async (ctx: PageCapCallContext): Promise<void> => {
    if (ctx.caps?.model !== true || ctx.version === undefined) return ctx.refuse(403, "not_declared");
    const question = parsePageModelQuestion(await ctx.readBody(ctx.req));
    if (question === "too_large") return ctx.refuse(413, "too_large", { error: ctx.lang === "fr" ? "Cette question est trop longue pour une page." : "This question is too long for a page." });
    if (!question) return ctx.refuse(400, "bad_request");
    const rule = deps.actRule?.({ tool: "page_model", mcpTool: "page_model", summary: "A page asks a model a question for the person reading it", input: JSON.stringify({ prompt: question.prompt.slice(0, 500) }), readOnly: true, auth: ctx.auth }) ?? "none";
    if (rule === "deny") return ctx.refuse(403, "denied", { reason: "org_rule", error: ctx.lang === "fr" ? "Ton organisation refuse cette question." : "Your organization refuses this question." });
    const ask = { person: ctx.who.by, pageId: ctx.page.id, version: ctx.version, source: "model" };
    if (rule === "ask" && deps.approvals && !deps.approvals.allowed(ask)) {
      const body: Omit<PageDataAskFirst, "source"> & { source: string } = { error: ctx.lang === "fr" ? "Ton organisation te demande d'abord ta permission avant que cette page pose une question à un modèle avec ton compte." : "Your organization asks you first before this page asks a model a question with your account.", code: "ask_first", approvalId: deps.approvals.open(ask), source: "model", version: ctx.version };
      return ctx.json(ctx.res, 409, body);
    }
    if (!allowQuestion(`${ctx.page.id}\u0000${ctx.who.by.toLowerCase()}`)) return ctx.refuse(429, "rate_limited", { error: ctx.lang === "fr" ? "Cette page pose trop de questions. Réessaie dans une minute." : "This page asks too many questions. Try again in a minute." });
    if (!deps.model) return ctx.refuse(503, "unavailable");
    let text: string;
    try {
      text = await deps.model.ask({ auth: ctx.auth, viewer: ctx.viewer, text: pageModelPrompt(question), lang: ctx.lang });
    } catch {
      return ctx.refuse(503, "unavailable", { error: ctx.lang === "fr" ? "Aucun modèle de ton compte n'a pu répondre pour l'instant." : "No model of your account could answer now." });
    }
    const value = question.schema ? pageModelJson(text) : undefined;
    const answer: PageModelAnswer = { text, ...(value !== undefined ? { value } : {}) };
    return ctx.json(ctx.res, 200, answer);
  };

  return {
    async handle(ctx) {
      if (PAGE_MODEL_ROUTE.test(ctx.path)) return modelCall(ctx);
      return pageStoreCall(deps, ctx);
    },
  };
}

/** Lot 3: the store. */
async function pageStoreCall(deps: PageCapCallDeps, ctx: PageCapCallContext): Promise<void> {
  const match = PAGE_STORE_ROUTE.exec(ctx.path)!;
  const name = match[2]!;
  const id = match[3];
  const rule = ctx.caps?.store && Object.prototype.hasOwnProperty.call(ctx.caps.store, name) ? ctx.caps.store[name]! : null;
  if (!rule || !deps.store) return ctx.refuse(403, "not_declared");
  const store = deps.store;
  const reader = { scope: rule.scope, reader: ctx.who.by };
  if (ctx.method === "GET") {
    if (id) {
      const doc = store.get(ctx.page.id, name, id, reader);
      return doc ? ctx.json(ctx.res, 200, storeDoc(deps, ctx, doc)) : ctx.refuse(404, "not_found", { error: ctx.lang === "fr" ? "Ce document n'existe pas." : "This document does not exist." });
    }
    const raw = ctx.url.searchParams.get("q");
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      return ctx.refuse(400, "bad_request");
    }
    const query = parsePageStoreQuery(parsed);
    if (!query) return ctx.refuse(400, "bad_request");
    return ctx.json(ctx.res, 200, { docs: store.list(ctx.page.id, name, { ...reader, query }).map((doc) => storeDoc(deps, ctx, doc)) });
  }
  // a write: the declared level for this reader's role
  if (!stateMayWrite(ctx.role === "anon" ? "signed_in" : ctx.role, rule.write, { publicLink: false, locked: false })) return ctx.refuse(403, "not_allowed");
  // what other readers read: never after personal data on a shared page
  if (rule.scope === "shared" && deps.pages.stateReadOnlyForData?.(ctx.page.id) === true) return ctx.refuse(409, "shared_write_after_data");
  const told = () => deps.live?.store(ctx.page.id, name, rule.scope === "reader" ? ctx.who.by : undefined);
  if (ctx.method === "DELETE") {
    if (!id) return ctx.refuse(400, "bad_request");
    if (!store.delete(ctx.page.id, name, id, reader)) return ctx.refuse(404, "not_found", { error: ctx.lang === "fr" ? "Ce document n'existe pas." : "This document does not exist." });
    told();
    return ctx.json(ctx.res, 200, { ok: true });
  }
  if ((ctx.method === "PUT" && !id) || (ctx.method === "POST" && id)) return ctx.refuse(400, "bad_request");
  const body = await ctx.readBody(ctx.req) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || !("value" in body)) return ctx.refuse(400, "bad_request");
  const room = roomOf(deps, ctx.page);
  const result = store.put(ctx.page.id, name, { scope: rule.scope, by: ctx.who.by, ...(id ? { id } : {}), value: body.value, ...(room !== undefined ? { room } : {}) });
  if (!result.ok) return ctx.refuse(result.status, result.code, result.code === "too_large" ? { error: ctx.lang === "fr" ? "Le stockage de cette page est plein, ou ce document est trop grand." : "This page's store is full, or this document is too large." } : {});
  told();
  return ctx.json(ctx.res, 200, storeDoc(deps, ctx, result.doc));
}
