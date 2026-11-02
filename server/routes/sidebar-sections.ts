// Sidebar team sections (#1388 slice P1): list, rename, delete, membership.
import { z } from "zod";
import type { BotRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

const MAX_WORKSPACE_BOTS = 100;

const createSidebarSectionSchema = z.object({
  name: z.string(),
  botIds: z.array(z.string().regex(/^[\w-]+$/)).max(MAX_WORKSPACE_BOTS).default([]),
}).strict();

export interface SidebarSectionsRouteDeps {
  sections(): readonly string[];
  bot(id: string): BotRecord | undefined;
  /** Throws Error & { status: 409 } when a team computer change is unsafe. */
  assertTeamComputerChangeIdle(before: BotRecord, after: BotRecord): void;
  teamComputerForSection(section: string): unknown;
  deleteSection(section: string): string | null;
  renameSection(section: string, nextName: string): string | null;
  updateTeamMembers(
    section: string,
    addBotIds: string[],
    removeBotIds: string[],
  ): { ok: true; bots: BotRecord[] } | { ok: false; reason: string };
  setBotsSection(
    botIds: string[],
    name: string,
  ): { ok: true; bots: BotRecord[] } | { ok: false };
  wireBot(bot: BotRecord): unknown;
  onSectionRemoved?(section: string): void;
  onSectionRenamed?(from: string, to: string): void;
}

export function createSidebarSectionsRoutes(deps: SidebarSectionsRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/sidebar-sections" && method === "GET") {
      return json(res, 200, { sections: deps.sections() });
    }
    if (path === "/api/sidebar-sections" && (method === "PATCH" || method === "DELETE")) {
      const section = url.searchParams.get("section")?.trim();
      if (!section) return json(res, 400, { error: "Choose a named team" });
      if (method === "DELETE" && deps.teamComputerForSection(section)) {
        return json(res, 409, { error: "Unassign this team's computer before deleting the team" });
      }
      let nextName: string | null = null;
      if (method === "PATCH") {
        const parsed = z.object({ name: z.string().trim().min(1).max(60) }).strict().safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "Team name must be 1 to 60 characters" });
        nextName = parsed.data.name;
      }
      const error = nextName === null
        ? deps.deleteSection(section)
        : deps.renameSection(section, nextName);
      if (error) return json(res, error === "No such team" ? 404 : 409, { error });
      // Slice 4: the section's channel record follows its name.
      if (nextName === null) deps.onSectionRemoved?.(section);
      else deps.onSectionRenamed?.(section, nextName);
      return json(res, 200, { sections: deps.sections() });
    }
    if (method === "PUT" && path === "/api/sidebar-sections") {
      const section = url.searchParams.get("section")?.trim();
      if (!section || !deps.sections().includes(section)) return json(res, 404, { error: "No such team" });
      const ids = z.array(z.string().regex(/^[\w-]+$/)).max(MAX_WORKSPACE_BOTS);
      const parsed = z.object({ addBotIds: ids, removeBotIds: ids }).strict().safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Provide addBotIds and removeBotIds" });
      for (const [botIds, destination] of [[parsed.data.addBotIds, section], [parsed.data.removeBotIds, undefined]] as const) {
        for (const id of botIds) {
          const bot = deps.bot(id);
          if (bot) deps.assertTeamComputerChangeIdle(bot, { ...bot, section: destination });
        }
      }
      const result = deps.updateTeamMembers(section, parsed.data.addBotIds, parsed.data.removeBotIds);
      if (!result.ok) {
        return json(res, result.reason === "unavailable" ? 404 : 409, {
          error: result.reason === "membership-changed"
            ? "Team membership changed. Reopen the dialog and try again."
            : "One or more bots are unavailable",
        });
      }
      return json(res, 200, { sections: deps.sections(), bots: result.bots.map(deps.wireBot) });
    }
    if (method === "POST" && path === "/api/sidebar-sections") {
      const parsed = createSidebarSectionSchema.safeParse(await readBody(req));
      if (!parsed.success) {
        return json(res, 400, { error: "Provide a team name and up to 100 valid botIds" });
      }
      const name = parsed.data.name.trim();
      if (name.length > 60) {
        return json(res, 400, { error: "name must be at most 60 characters" });
      }
      const botIds = [...new Set(parsed.data.botIds)];
      if (!name && !botIds.length) return json(res, 400, { error: "Team name is required" });
      for (const botId of botIds) {
        const bot = deps.bot(botId);
        if (bot) deps.assertTeamComputerChangeIdle(bot, { ...bot, section: name || undefined });
      }
      const result = deps.setBotsSection(botIds, name);
      if (!result.ok) {
        return json(res, 404, { error: "one or more bots are unavailable" });
      }
      return json(res, 200, { section: name, sections: deps.sections(), bots: result.bots.map(deps.wireBot) });
    }
    return PASS;
  };
}
