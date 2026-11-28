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
//   GET    /api/pages/:id/files                     { files: PageFileInfo[] } (lot 5)
//   POST   /api/pages/:id/files   { name, mime, data }   PageFileInfo
//   GET    /api/pages/:id/files/:fileId              PageFileData
//   DELETE /api/pages/:id/files/:fileId              { ok: true }
//
//   POST   /api/pages/:id/proposals  PageProposal  { version } (lot 6)
//   POST   /api/pages/:id/connector  { connector, tool, arguments?, click }  PageConnectorAnswer (lot 7)
//
// connector.call runs with the reader's own connections, never the page
// owner's (findConnectorCall on the reader's own accounts, the one reading
// call_connector has). A read runs at once; a change runs only from the
// reader's click and through the reader's own approval path: the
// organization's Deny refuses it, its Ask first and any level but Full
// access ask the reader on the card (Allow once is one call). Every call
// goes to the reader's action journal.
//
// A version the page proposes is the edit of the reader who clicked, for
// the page's person and its editors only (anyone else: not_allowed); it is a
// write others read, refused after personal data on a shared page.
//
// A file a reader adds is read by that reader and by who manages the page
// (its person, its editors), never by another reader. Adding one is a
// write others read: refused after personal data on a shared page.
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
import { PAGE_CAP_FILE_MIMES, PAGE_CAP_LIMITS, pageCapFileName, pageModelJson, parsePageModelQuestion, parsePageStoreQuery, type PageCapabilities, type PageCapError, type PageDataAskFirst, type PageModelAnswer, type PageActAskFirst, type PageConnectorAnswer, type PageFileData, type PageFileInfo, type PageModelQuestion, type PageStoreDoc } from "../../shared/page-capabilities.ts";
import { stateMayWrite, type StateRole } from "../../shared/page-state.ts";
import { PAGE_LIMITS, parsePageTitle, type PageKind } from "../../shared/published-pages.ts";
import type { PageActVerdict } from "../pages/page-act-verdict.ts";
import type { PageDataApprovals } from "../pages/page-data-approvals.ts";
import type { ConnectorHub } from "../connectors/hub.ts";
import type { ConnectorAccount } from "../connectors/types.ts";
import type { PageFiles, StoredFile } from "../pages/page-files.ts";
import { findConnectorCall } from "./internal-connectors.ts";
import type { PageStore, StoredDoc } from "../pages/page-store.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import type { PageViewer } from "./published-pages.ts";
import type { RouteContext } from "./table.ts";

/** The routes of this module, one per line with its method. */
export const PAGE_STORE_ROUTE = /^\/api\/pages\/([\w-]+)\/store\/([a-z][a-z0-9_-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/;
export const PAGE_MODEL_ROUTE = /^\/api\/pages\/([\w-]+)\/model$/;
export const PAGE_CONNECTOR_ROUTE = /^\/api\/pages\/([\w-]+)\/connector$/;
export const PAGE_PROPOSE_ROUTE = /^\/api\/pages\/([\w-]+)\/proposals$/;
export const PAGE_FILES_ROUTE = /^\/api\/pages\/([\w-]+)\/files(?:\/([A-Za-z0-9_-]{16,40}))?$/;

/** The bytes of an added file: one standard base64 string, decoded at once
 * (a whole upload, so the shared helper's per character check is not run
 * on it). Null when it is not base64. */
function base64Bytes(data: unknown): Buffer | null {
  if (typeof data !== "string" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, "base64");
  return bytes.toString("base64") === data ? bytes : null;
}

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
  /** The organization's Deny and Ask first for one call the page makes (a
   * data read, a model question), in the reader's context. */
  orgRule?: PageActRule;
  /** Lot 6: a new proposed version, as the person's own edit
   * (PublishedPages.edit); `redact` masks secret-shaped text, as there. */
  propose?(pageId: string, input: { kind: PageKind; content: string; title?: string; by: string }): { ok: true; version: { n: number } } | { ok: false; status: number; error: string; code: string };
  redact?(text: string): string;
  /** Lot 7: the reader's own connectors. */
  connectors?: {
    /** The reader's connector principal; "" for nobody. */
    principal(viewer: NonNullable<PageViewer>): string;
    accounts(principalId: string): readonly ConnectorAccount[];
    hub(): ConnectorHub;
    /** The bot's approval path for this call, in the reader's context
     * (server/pages/page-act-verdict.ts): their own rules and the
     * organization's, and their one Full access decision. */
    verdict(viewer: NonNullable<PageViewer>, call: { tool: string; mcpTool: string; summary: string; input: string; readOnly: boolean }): PageActVerdict;
    /** Every call, in the reader's action journal. */
    journal?(input: { viewer: NonNullable<PageViewer>; pageId: string; mcpTool: string; summary: string; decision: "auto-approved" | "user-approved" | "auto-denied"; source: "connector-read" | "full-access" | "user" | "custom-rule" | "custom-rule-deny" }): void;
  };
  /** Lot 5: the files readers add. */
  files?: PageFiles;
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
    const rule = deps.orgRule?.({ tool: "page_model", mcpTool: "page_model", summary: "A page asks a model a question for the person reading it", input: JSON.stringify({ prompt: question.prompt.slice(0, 500) }), readOnly: true, auth: ctx.auth }) ?? "none";
    if (rule === "deny") return ctx.refuse(403, "denied", { reason: "org_rule", error: ctx.lang === "fr" ? "Ton organisation refuse cette question." : "Your organization refuses this question." });
    const ask = { person: ctx.who.by, pageId: ctx.page.id, version: ctx.version, source: "model" };
    if (rule === "ask" && deps.approvals && !deps.approvals.allowed(ask)) {
      const body: Omit<PageDataAskFirst, "source"> & { source: string } = { error: ctx.lang === "fr" ? "Ton organisation te demande d'abord ta permission avant que cette page pose une question à un modèle avec ton compte." : "Your organization asks you first before this page asks a model a question with your account.", code: "ask_first", approvalId: deps.approvals.open(ask), source: "model", version: ctx.version, always: deps.approvals.alwaysOffered() };
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

  const fileInfo = (ctx: PageCapCallContext, file: StoredFile): PageFileInfo => ({
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    by: deps.pages.readerHandle(ctx.page.id, file.by),
    writer: deps.names?.([file.by])[file.by] ?? "",
    at: file.at,
    mine: file.by.toLowerCase() === ctx.who.by.toLowerCase(),
  });

  const filesCall = async (ctx: PageCapCallContext): Promise<void> => {
    if (!(ctx.caps?.files ?? []).includes("add") || !deps.files) return ctx.refuse(403, "not_declared");
    const files = deps.files;
    const id = PAGE_FILES_ROUTE.exec(ctx.path)![2];
    // the reader's own files; who manages the page reads them all
    const reader = { reader: ctx.who.by, all: ctx.role === "owner" || ctx.role === "editor" };
    const missing = () => ctx.refuse(404, "not_found", { error: ctx.lang === "fr" ? "Ce fichier n'existe pas." : "This file does not exist." });
    if (ctx.method === "GET" && !id) return ctx.json(ctx.res, 200, { files: files.list(ctx.page.id, reader).map((file) => fileInfo(ctx, file)) });
    if (ctx.method === "GET") {
      const found = files.get(ctx.page.id, id!, reader);
      if (!found) return missing();
      const answer: PageFileData = { ...fileInfo(ctx, found.file), data: Buffer.from(found.bytes).toString("base64") };
      return ctx.json(ctx.res, 200, answer);
    }
    if (ctx.method === "DELETE") return id && files.remove(ctx.page.id, id, reader) ? ctx.json(ctx.res, 200, { ok: true }) : missing();
    if (id) return ctx.refuse(400, "bad_request");
    // what the page's person and editors read: never after personal data on a shared page
    if (deps.pages.stateReadOnlyForData?.(ctx.page.id) === true) return ctx.refuse(409, "shared_write_after_data");
    let body: Record<string, unknown> | null;
    try {
      body = await ctx.readBody(ctx.req, Math.ceil(PAGE_CAP_LIMITS.fileBytes / 3) * 4 + 64 * 1024) as Record<string, unknown> | null;
    } catch {
      return ctx.refuse(413, "too_large", { error: ctx.lang === "fr" ? "Ce fichier est trop grand." : "This file is too large." });
    }
    const mime = body?.mime;
    if (typeof mime !== "string" || !(PAGE_CAP_FILE_MIMES as readonly string[]).includes(mime)) return ctx.refuse(400, "bad_request", { error: ctx.lang === "fr" ? "Ce type de fichier n'est pas permis." : "This file type is not allowed." });
    const name = pageCapFileName(body?.name);
    if (!name) return ctx.refuse(400, "bad_request", { error: ctx.lang === "fr" ? "Ce nom de fichier n'est pas permis." : "This file name is not allowed." });
    const bytes = base64Bytes(body?.data);
    if (!bytes) return ctx.refuse(400, "bad_request");
    const room = roomOf(deps, ctx.page);
    const added = files.add(ctx.page.id, { name, mime, bytes, by: ctx.who.by, ...(room !== undefined ? { room } : {}) });
    if (!added.ok) return ctx.refuse(added.status, added.code, { error: ctx.lang === "fr" ? "Ce fichier est trop grand, ou les fichiers de cette page sont pleins." : "This file is too large, or this page's files are full." });
    return ctx.json(ctx.res, 200, fileInfo(ctx, added.file));
  };

  const proposeCall = async (ctx: PageCapCallContext): Promise<void> => {
    if (ctx.caps?.propose !== true || !deps.propose) return ctx.refuse(403, "not_declared");
    // the page's person and its editors, as for their own edit
    if (ctx.role !== "owner" && ctx.role !== "editor") return ctx.refuse(403, "not_allowed", { error: ctx.lang === "fr" ? "Seuls la personne de cette page et ses éditeurs proposent une version." : "Only this page's person and its editors propose a version." });
    if (deps.pages.stateReadOnlyForData?.(ctx.page.id) === true) return ctx.refuse(409, "shared_write_after_data");
    const body = await ctx.readBody(ctx.req) as Record<string, unknown> | null;
    const content = body?.content;
    if (typeof content !== "string" || !content.trim()) return ctx.refuse(400, "bad_request");
    if (Buffer.byteLength(content) > PAGE_LIMITS.contentBytes) return ctx.refuse(413, "too_large", { error: ctx.lang === "fr" ? "Cette version est trop grande pour une page." : "This version is too large for a page." });
    let title: string | undefined;
    if (body!.title !== undefined && body!.title !== null) {
      const parsed = parsePageTitle(body!.title);
      if (parsed === null) return ctx.refuse(400, "bad_request");
      title = parsed;
    }
    const clean = (text: string) => (deps.redact ? deps.redact(text) : text);
    // the kind of the version the page runs in (a page that proposes is HTML)
    const kind = ctx.page.versions.find((entry) => entry.n === ctx.version)?.kind ?? "html";
    const result = deps.propose(ctx.page.id, { kind, content: clean(content), ...(title ? { title: clean(title) } : {}), by: ctx.who.by });
    if (!result.ok) return ctx.refuse(result.status === 413 || result.code === "too_large" || result.code === "owner_full" || result.code === "server_full" ? 413 : 409, result.code === "not_found" ? "not_found" : "too_large", { error: result.error });
    return ctx.json(ctx.res, 200, { version: result.version.n });
  };

  const connectorCall = async (ctx: PageCapCallContext): Promise<void> => {
    const outcome = await runPageConnectorCall(deps, {
      caps: ctx.caps,
      version: ctx.version,
      scopeId: ctx.page.id,
      person: ctx.who.by,
      viewer: ctx.viewer,
      lang: ctx.lang,
    }, await ctx.readBody(ctx.req) as Record<string, unknown> | null);
    if (outcome.kind === "ok") return ctx.json(ctx.res, 200, outcome.body);
    if (outcome.kind === "ask") return ctx.json(ctx.res, 409, outcome.body);
    return ctx.refuse(outcome.status, outcome.code, outcome.extra);
  };

  return {
    async handle(ctx) {
      if (PAGE_CONNECTOR_ROUTE.test(ctx.path)) return connectorCall(ctx);
      if (PAGE_PROPOSE_ROUTE.test(ctx.path)) return proposeCall(ctx);
      if (PAGE_MODEL_ROUTE.test(ctx.path)) return modelCall(ctx);
      if (PAGE_FILES_ROUTE.test(ctx.path)) return filesCall(ctx);
      return pageStoreCall(deps, ctx);
    },
  };
}

/** What one connector.call decided. The published-page route and a chat
 * app's route both return this. The rules live here, once. */
export type PageConnectorCallOutcome =
  | { kind: "ok"; body: PageConnectorAnswer }
  | { kind: "ask"; body: PageActAskFirst }
  | { kind: "refuse"; status: number; code: PageCapError; extra?: Record<string, unknown> };

/** One connector.call (#3413 lot 7): the reader's own connection, the same
 * verdict as their bot, a click for a change, the same journal. `scopeId`
 * is the page id, or a chat app's stable id. The caller already checked
 * who the reader is. */
export async function runPageConnectorCall(
  deps: Pick<PageCapCallDeps, "connectors" | "approvals">,
  env: {
    caps: PageCapabilities | null;
    version: number | undefined;
    scopeId: string;
    person: string;
    viewer: NonNullable<PageViewer>;
    lang: "fr" | "en";
  },
  body: Record<string, unknown> | null,
): Promise<PageConnectorCallOutcome> {
  const fr = env.lang === "fr";
  const connector = body?.connector;
  const tool = body?.tool;
  const args = body?.arguments ?? {};
  if (typeof connector !== "string" || typeof tool !== "string") return { kind: "refuse", status: 400, code: "bad_request" };
  if (!env.caps?.connectors || !Object.prototype.hasOwnProperty.call(env.caps.connectors, connector) || !env.caps.connectors[connector]!.includes(tool) || !deps.connectors || env.version === undefined) return { kind: "refuse", status: 403, code: "not_declared" };
  if (!args || typeof args !== "object" || Array.isArray(args)) return { kind: "refuse", status: 400, code: "bad_request" };
  const version = env.version;
  const hub = deps.connectors.hub();
  const principalId = deps.connectors.principal(env.viewer);
  if (!principalId) return { kind: "refuse", status: 503, code: "unavailable" };
  // the reader's own accounts, never the page owner's and never another person's
  const target = findConnectorCall(hub, deps.connectors.accounts(principalId), connector, tool);
  if (!target.ok) {
    const said = target.reason === "no_connector" ? (fr ? `Tu n'as pas de connecteur ${connector}.` : `You have no connector named ${connector}.`)
      : target.reason === "no_tool" ? (fr ? `${connector} n'a pas d'outil ${tool}.` : `${connector} has no tool named ${tool}.`)
        : target.reason === "needs_sign_in" ? (fr ? `${connector} attend que tu te connectes de nouveau.` : `${connector} is waiting for you to sign in again.`)
          : (fr ? `${connector} ne peut pas encore être appelé d'une page.` : `${connector} cannot be called from a page yet.`);
    return { kind: "refuse", status: target.reason === "no_connector" || target.reason === "no_tool" ? 404 : 503, code: target.reason === "no_connector" || target.reason === "no_tool" ? "not_found" : "unavailable", extra: { error: said } };
  }
  const { account, entry, toolId, mcpTool, outbound } = target;
  const summary = `${entry.name}: ${toolId} (${account.label})`;
  const journal = (decision: "auto-approved" | "user-approved" | "auto-denied", source: "connector-read" | "full-access" | "user" | "custom-rule" | "custom-rule-deny") => {
    try {
      deps.connectors?.journal?.({ viewer: env.viewer, pageId: env.scopeId, mcpTool, summary, decision, source });
    } catch { /* the journal never fails the call */ }
  };
  const verdict = deps.connectors.verdict(env.viewer, { tool: "call_connector", mcpTool, summary, input: JSON.stringify(args), readOnly: !outbound });
  if (verdict.rule === "deny") {
    journal("auto-denied", "custom-rule-deny");
    const org = verdict.by === "org";
    return { kind: "refuse", status: 403, code: "denied", extra: { reason: org ? "org_rule" : "person_rule", error: org ? (fr ? "Ton organisation refuse cet appel." : "Your organization refuses this call.") : (fr ? "Ta propre règle refuse cet appel." : "Your own rule refuses this call.") } };
  }
  // a change starts from the reader's own click in the page
  if (outbound && body?.click !== true) return { kind: "refuse", status: 400, code: "bad_request", extra: { error: fr ? "Un changement part d'un clic dans la page." : "A change starts from a click in the page." } };
  // as for their bot: a rule's Ask first, else a change below Full access
  // (or held at Full) asks; an Allow rule of theirs lets it run
  const card = verdict.rule === "ask" || (outbound && verdict.rule !== "allow" && !verdict.acts);
  if (card) {
    const ask = { person: env.person, pageId: env.scopeId, version, source: `connector:${mcpTool}` };
    if (!deps.approvals || !deps.approvals.use(ask)) {
      if (!deps.approvals) return { kind: "refuse", status: 503, code: "unavailable" };
      const answer: PageActAskFirst = { error: fr ? `Cette page veut utiliser ${entry.name} avec ton compte : ${toolId}.` : `This page wants to use ${entry.name} with your account: ${toolId}.`, code: "ask_first", approvalId: deps.approvals.open(ask), source: ask.source, label: summary, version, by: verdict.rule === "ask" && verdict.by ? verdict.by : "page", always: deps.approvals.alwaysOffered() };
      return { kind: "ask", body: answer };
    }
  }
  journal(card ? "user-approved" : "auto-approved", card ? "user" : verdict.rule === "allow" ? "custom-rule" : outbound ? "full-access" : "connector-read");
  const result = await hub.call({ principalId, account, connector: entry, tool: toolId, arguments: args as Record<string, unknown>, engine: "page" });
  if (result.needsSignIn) return { kind: "refuse", status: 503, code: "unavailable", extra: { error: fr ? `${entry.name} attend que tu te connectes de nouveau.` : `${entry.name} is waiting for you to sign in again.` } };
  if (result.isError) return { kind: "refuse", status: 502, code: "unavailable", extra: { error: result.text.slice(0, 2_000) } };
  // the call ran (a change is made): an answer too large is cut, never refused
  return { kind: "ok", body: fitAnswer({ connector: entry.name, account: account.label, tool: toolId, text: result.text }) };
}

/** A connector's answer within PAGE_CAP_LIMITS.answerBytes: its text cut
 * (marked `cut`) when the whole answer is larger. Pure. */
function fitAnswer(answer: PageConnectorAnswer): PageConnectorAnswer {
  const size = (value: PageConnectorAnswer) => Buffer.byteLength(JSON.stringify(value));
  if (size(answer) <= PAGE_CAP_LIMITS.answerBytes) return answer;
  let text = answer.text;
  let cut: PageConnectorAnswer = { ...answer, text: "", cut: true };
  while (text.length > 0) {
    cut = { ...answer, text, cut: true };
    const over = size(cut) - PAGE_CAP_LIMITS.answerBytes;
    if (over <= 0) break;
    text = text.slice(0, Math.max(0, text.length - Math.max(1, over)));
    // never half of a surrogate pair
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  }
  return text.length > 0 ? cut : { ...answer, text: "", cut: true };
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
