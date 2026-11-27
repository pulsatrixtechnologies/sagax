// Connector calls from a chat app (message kind "app", show_html). R6.
// The frame has no network. The host posts here with the viewer's session.
// The call is runPageConnectorCall: the same findConnectorCall, verdict,
// approvals and journal as a published page. Nothing here is a second rule.
//
//   POST /api/bots/:botId/apps/:messageId/connector
//        { threadId, connector, tool, arguments?, click }
//   POST /api/bots/:botId/apps/:messageId/approvals/:approvalId
//        { threadId, answer: "once" | "always" | "deny" }
//
// The message must be an app in that bot's thread, and the viewer must be
// allowed to read the thread. Capabilities are read from the stored HTML,
// never from the request. A room is refused. A change needs click: true.
import type { IncomingMessage } from "node:http";

import type { AppPayload } from "../../shared/app.ts";
import { pageCapabilitiesOf, type PageCapError } from "../../shared/page-capabilities.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { runPageConnectorCall, type PageCapCallDeps } from "./page-cap-calls.ts";
import type { PageViewer } from "./published-pages.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CONNECTOR_ROUTE = /^\/api\/bots\/([\w-]+)\/apps\/([\w-]+)\/connector$/;
const APPROVAL_ROUTE = /^\/api\/bots\/([\w-]+)\/apps\/([\w-]+)\/approvals\/([\w-]+)$/;
const ID = /^[\w-]{1,80}$/;

type Lang = "fr" | "en";

const TEXTS: Record<PageCapError, Record<Lang, string>> = {
  sign_in: { en: "Sign in to use this app.", fr: "Connecte-toi pour utiliser cette app." },
  not_declared: { en: "This app does not declare this capability.", fr: "Cette app ne déclare pas cette capacité." },
  denied: { en: "Your organization refuses this call.", fr: "Ton organisation refuse cet appel." },
  ask_first: { en: "Your organization asks you first.", fr: "Ton organisation te demande d'abord." },
  rate_limited: { en: "This app calls too often. Try again in a minute.", fr: "Cette app appelle trop souvent. Réessaie dans une minute." },
  too_large: { en: "This answer is too large.", fr: "Cette réponse est trop grande." },
  unavailable: { en: "This connector could not be called now.", fr: "Ce connecteur n'a pas pu être appelé pour l'instant." },
  not_found: { en: "This app does not exist.", fr: "Cette app n'existe pas." },
  bad_request: { en: "This request is not valid.", fr: "Cette demande n'est pas valide." },
  shared_write_after_data: { en: "This app cannot change shared data.", fr: "Cette app ne peut pas modifier des données partagées." },
  not_allowed: { en: "Live apps are not available in rooms.", fr: "Les apps en direct ne sont pas disponibles dans les salons." },
};

export interface AppConnectorMessage {
  id: string;
  kind?: string;
  app?: AppPayload;
  from?: { botId?: string };
}

export interface AppConnectorRouteDeps {
  bot(id: string): { id: string; threadId: string; tasks?: readonly { threadId: string }[] } | null;
  /** True when the thread is a room. Live apps are refused there. */
  room(threadId: string): boolean;
  messages(threadId: string): readonly AppConnectorMessage[];
  /** The viewer may read this bot's thread. */
  mayRead(auth: RequestAuth, botId: string, threadId: string): boolean;
  reader(auth: RequestAuth): PageViewer;
  /** A bot's act copy of the person's session. It never answers a card. */
  botAct(auth: RequestAuth): boolean;
  approvals: PageDataApprovals;
  connectors?: PageCapCallDeps["connectors"];
}

/** The approvals key for one chat app. Stable across revisions. */
export function appConnectorScope(botId: string, messageId: string): string {
  return `app:${botId}:${messageId}`;
}

function langOf(url: URL, req: IncomingMessage): Lang {
  const asked = url.searchParams.get("lang");
  if (asked === "fr" || asked === "en") return asked;
  const header = req.headers?.["accept-language"];
  return typeof header === "string" && /^\s*fr\b/i.test(header) ? "fr" : "en";
}

function personOf(viewer: NonNullable<PageViewer>): string {
  const id = viewer.principalId?.trim();
  return id ? id : "owner";
}

interface FoundApp {
  botId: string;
  messageId: string;
  html: string;
  version: number;
}

export function createAppConnectorRoutes(deps: AppConnectorRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const connector = method === "POST" ? CONNECTOR_ROUTE.exec(path) : null;
    const approval = method === "POST" ? APPROVAL_ROUTE.exec(path) : null;
    const match = connector ?? approval;
    if (!match) return PASS;
    res.setHeader?.("cache-control", "no-store");
    const lang = langOf(url, req);
    const refuse = (status: number, code: PageCapError, extra: Record<string, unknown> = {}) => json(res, status, { error: TEXTS[code][lang], code, ...extra });
    const viewer = deps.reader(auth);
    if (!viewer || (!viewer.principalId && !viewer.computerOwner)) return refuse(401, "sign_in");
    const botId = match[1]!;
    const messageId = match[2]!;
    const body = await readBody(req) as Record<string, unknown> | null;
    const threadId = body?.threadId;
    if (typeof threadId !== "string" || !ID.test(threadId)) return refuse(400, "bad_request");
    const bot = deps.bot(botId);
    const owns = Boolean(bot && (bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId)));
    if (!bot || !owns || !deps.mayRead(auth, botId, threadId)) return refuse(404, "not_found");
    if (deps.room(threadId)) return refuse(409, "not_allowed");
    const message = deps.messages(threadId).find((entry) => entry.id === messageId);
    const html = message?.kind === "app" ? message.app?.html : undefined;
    if (!message || typeof html !== "string" || (message.from?.botId && message.from.botId !== bot.id)) return refuse(404, "not_found");
    const found: FoundApp = { botId, messageId, html, version: (message.app?.rev ?? 0) + 1 };
    const person = personOf(viewer);
    const scopeId = appConnectorScope(found.botId, found.messageId);

    if (approval) {
      if (deps.botAct(auth)) return json(res, 403, { error: lang === "fr" ? "Seule la personne répond à cette carte, jamais un bot." : "Only the person answers this card, never a bot.", code: "person_only" });
      const answer = body?.answer;
      if (answer !== "once" && answer !== "always" && answer !== "deny") return refuse(400, "bad_request");
      const result = deps.approvals.answer(approval[3]!, person, { allow: answer !== "deny", always: answer === "always" });
      if (!result.ok || result.ask.pageId !== scopeId) return refuse(404, "not_found");
      return json(res, 200, { ok: true, answer });
    }

    const caps = pageCapabilitiesOf(found.html);
    const outcome = await runPageConnectorCall(deps, {
      caps,
      version: found.version,
      scopeId,
      person,
      viewer,
      lang,
    }, body);
    if (outcome.kind === "ok") return json(res, 200, outcome.body);
    if (outcome.kind === "ask") return json(res, 409, outcome.body);
    return refuse(outcome.status, outcome.code, outcome.extra);
  };
}
