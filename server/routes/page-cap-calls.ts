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
//
// Isolation: a `reader` collection is read and written per reader, never
// another's; a write to what other readers read (a `shared` collection) is
// refused while the page reads personal data and is shared with anyone but
// its person (PublishedPages.stateReadOnlyForData), the rule of the shared
// state. Writes count in the page person's own share.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RequestAuth } from "../auth/request-auth.ts";
import { parsePageStoreQuery, type PageCapabilities, type PageCapError, type PageStoreDoc } from "../../shared/page-capabilities.ts";
import { stateMayWrite, type StateRole } from "../../shared/page-state.ts";
import { PAGE_LIMITS } from "../../shared/published-pages.ts";
import type { PageStore, StoredDoc } from "../pages/page-store.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import type { PageViewer } from "./published-pages.ts";
import type { RouteContext } from "./table.ts";

/** The routes of this module, one per line with its method. */
export const PAGE_STORE_ROUTE = /^\/api\/pages\/([\w-]+)\/store\/([a-z][a-z0-9_-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/;

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

/** Lot 3: the store. Null when the path is not a store route. */
export async function pageStoreCall(deps: PageCapCallDeps, ctx: PageCapCallContext): Promise<void> {
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
