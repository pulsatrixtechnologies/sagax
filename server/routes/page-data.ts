// The server side of a page's capability bridge (#3413,
// shared/page-capabilities.ts). The wrapper calls these with the reader's
// own session; the page itself never reaches them (no network in its frame).
//
//   GET /api/pages/:id/capabilities         { capabilities, reads: [{ name, label }] }
//   GET /api/pages/:id/data/:source?fresh=1  PageDataAnswer (approved=1 after an Ask first card)
//   GET /api/pages/:id/viewer?lang=fr|en     PageViewerInfo
//
// Every call is checked here: the reader is signed in (a reader who is not
// gets no personal capability: 401 sign_in, before anything is read); the
// reader may read this page (else the same 404 as a missing page); the
// version declares the capability; the organization's Deny and Ask first
// rules allow it (no other gate: everything here stays in the reader's own
// environment). A source is read with the reader's `auth`, never the page
// owner's. A reader who received data is marked (PageDataTaint) so their
// writes to the page's shared state are refused unless the page is private
// to its person; the answer lists the addresses and open references it holds,
// the only ones the wrapper opens without a question.
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  PAGE_CAP_LIMITS,
  pageAnswerExits,
  pageCapGranted,
  type PageCapabilities,
  type PageCapError,
  type PageDataAnswer,
  type PageDataSource,
  type PageViewerInfo,
} from "../../shared/page-capabilities.ts";
import type { PagesPolicy } from "../../shared/published-pages.ts";
import { PageSourceError, type PageDataTaint, type PageDataWatch, type PageSources } from "../pages/page-sources.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import { pageAnnotator, pageMayEdit, type PageViewer } from "./published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PageDataRouteDeps {
  pages: {
    get(id: string): PageRecord | undefined;
    capabilities(id: string, n?: number): PageCapabilities | null;
    policy(): PagesPolicy;
    readerHandle(pageId: string, by: string): string;
  };
  /** The signed-in reader this caller is, or null. */
  reader(auth: RequestAuth): PageViewer;
  teamsOf?(principalId: string): readonly string[];
  ownerActive?(page: PageRecord): boolean;
  names?(ids: readonly string[]): Record<string, string>;
  sources: PageSources;
  /** The organization's Deny and Ask first rules for this call, as they
   * would apply to the reader's own bot doing the same read. */
  orgRule?(input: { page: PageRecord; source: string; auth: RequestAuth }): "deny" | "ask" | "none";
  taint: PageDataTaint;
  watch?: PageDataWatch;
  now?(): number;
}

const ROUTE = /^\/api\/pages\/([\w-]+)\/(capabilities|viewer|data\/([\w-]+))$/;

function refusal(code: PageCapError, message: string): { error: string; code: PageCapError } {
  return { error: message, code };
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

  return async ({ res, url, path, method, auth, json }) => {
    if (method !== "GET") return PASS;
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    res.setHeader?.("cache-control", "no-store");
    const viewer = deps.reader(auth);
    // a reader who is not signed in: no personal capability, and nothing
    // that says whether the page or its owner has data
    if (!viewer || (!viewer.principalId && !viewer.computerOwner)) return json(res, 401, refusal("sign_in", "Sign in to use this page's data."));
    const page = deps.pages.get(match[1]!);
    const who = page ? pageAnnotator(page, viewer, { policy: deps.pages.policy(), now: now(), ...(deps.teamsOf ? { teamsOf: deps.teamsOf } : {}), ownerActive: deps.ownerActive?.(page) ?? true }) : null;
    if (!page || !who) return json(res, 404, refusal("not_found", "This page does not exist."));
    // the published version; its own person also previews the newest one
    const version = page.currentVersion ?? (who.owner ? page.versions.at(-1)?.n : undefined);
    const caps = version === undefined ? null : deps.pages.capabilities(page.id, version);

    if (match[2] === "capabilities") {
      return json(res, 200, {
        capabilities: caps ?? { data: [], viewer: false, open: false },
        reads: (caps?.data ?? []).map((name) => ({ name, label: deps.sources.label(name) ?? name })),
      });
    }

    if (match[2] === "viewer") {
      if (!pageCapGranted(caps, "viewer.get")) return json(res, 403, refusal("not_declared", "This page does not declare viewer."));
      const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
      const info: PageViewerInfo = {
        name: deps.names?.([who.by])[who.by] ?? "",
        handle: deps.pages.readerHandle(page.id, who.by),
        role: who.owner ? "owner" : pageMayEdit(page, viewer) ? "editor" : "signed_in",
        lang,
      };
      return json(res, 200, info);
    }

    const name = match[3]!;
    const source = deps.sources.get(name);
    if (!pageCapGranted(caps, "data.read", name) || !source) return json(res, 403, refusal("not_declared", `This page does not declare the data source ${name}.`));
    const rule = deps.orgRule?.({ page, source: name, auth }) ?? "none";
    if (rule === "deny") return json(res, 403, refusal("denied", "Your organization refuses this read."));
    if (rule === "ask" && url.searchParams.get("approved") !== "1") return json(res, 409, refusal("ask_first", "Your organization asks you first before this page reads your data."));
    if (!allowRead(`${page.id}\u0000${who.by.toLowerCase()}`)) return json(res, 429, refusal("rate_limited", "This page reads too often. Try again in a minute."));
    let read: Awaited<ReturnType<typeof source.read>>;
    try {
      read = await source.read(auth, { params: {}, fresh: url.searchParams.get("fresh") === "1" });
    } catch (error) {
      if (error instanceof PageSourceError) return json(res, error.status, refusal(error.code, error.message));
      return json(res, 503, refusal("unavailable", "This data could not be read now."));
    }
    const text = JSON.stringify(read.value ?? null);
    if (Buffer.byteLength(text) > PAGE_CAP_LIMITS.answerBytes) return json(res, 413, refusal("too_large", "This data is too large for a page."));
    // personal data reached this reader on this page
    deps.taint.mark(page.id, who.by);
    deps.watch?.record(page.id, who.by, name as PageDataSource, read.topics);
    const answer: PageDataAnswer = { name: name as PageDataSource, value: read.value ?? null, at: now(), ...pageAnswerExits(read.value) };
    return json(res, 200, answer);
  };
}
