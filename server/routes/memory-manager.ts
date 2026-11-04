// Memory manager catalog (2026-11-02): the sources the right-panel manager
// lists. Local Sagax memories always; Perspicax tiers when the installation
// is linked and the person is signed in with Pulsatrix.
//
//   GET /api/memory-manager/sources
//
// Never returns another person's bot or a Perspicax scope the caller cannot
// see. Bot rows follow the same owner/edit gate as the bot Memory section.
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MEMORY_MANAGER_SOURCES = "/api/memory-manager/sources";

export type MemoryManagerSourceKind = "bot" | "team" | "perspicax";

export interface MemoryManagerSource {
  id: string;
  kind: MemoryManagerSourceKind;
  /** Person-facing name (bot name, section label, or "Personal" / team name). */
  name: string;
  /** Grey context line under the name. */
  detail?: string;
  /** Whether the person may write in this source. */
  mayWrite: boolean;
  /** Perspicax only: trash and cross-tier move when the person manages it. */
  mayManage?: boolean;
  /** Bot source: the bot id for existing memory file routes. */
  botId?: string;
  /** Bot source: whether a current bot owns this memory. A temporary agent
   * (create_agent: never listed with the bots) leaves a folder no bot is
   * linked to, which the page lets the person delete. */
  linked?: boolean;
  /** Team source: section key for /api/team-memory. */
  section?: string;
  /** Perspicax scope hint (`me`, `org`, `team:<id>`), never a person GUID. */
  scope?: string;
}

export interface MemoryManagerSourcesDeps {
  /** Bots the caller may open in the manager. */
  bots(auth: RequestAuth): Array<{ id: string; name: string; mayWrite: boolean; temporary?: boolean }>;
  /** Whether this bot's memory routes answer the caller (the request gate's
   * visibility and channel checks, then the memory owner gate). A bot they
   * refuse is not listed: its row would only open on "no such bot". */
  botReachable(auth: RequestAuth, botId: string): boolean;
  /** Team memory sections the caller may see. */
  teamSections(auth: RequestAuth): Array<{ section: string; label: string; mayWrite: boolean; count: number }>;
  /** Whether Perspicax notes are offered for this caller. */
  perspicax(auth: RequestAuth): { available: boolean; reason?: "link" | "sign_in" | "solo" } | null;
}

export function createMemoryManagerRoutes(deps: MemoryManagerSourcesDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== MEMORY_MANAGER_SOURCES) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });

    const sources: MemoryManagerSource[] = [];
    for (const bot of deps.bots(auth)) {
      if (!deps.botReachable(auth, bot.id)) continue;
      sources.push({
        id: `bot:${bot.id}`,
        kind: "bot",
        name: bot.name,
        detail: "Bot memory",
        mayWrite: bot.mayWrite,
        botId: bot.id,
        linked: !bot.temporary,
      });
    }
    for (const section of deps.teamSections(auth)) {
      sources.push({
        id: `team:${section.section || "general"}`,
        kind: "team",
        name: section.label,
        detail: section.count === 1 ? "1 team note" : `${section.count} team notes`,
        mayWrite: section.mayWrite,
        section: section.section,
      });
    }
    const px = deps.perspicax(auth);
    if (px?.available) {
      sources.push({
        id: "perspicax",
        kind: "perspicax",
        name: "Perspicax",
        detail: "Personal, team and organization notes",
        mayWrite: true,
        mayManage: true,
        scope: "me",
      });
    }

    return json(res, 200, {
      sources,
      perspicax: px ?? { available: false, reason: "solo" as const },
    });
  };
}
