// Visible roles (2026-11-05): what the thread shows for each role fact the
// Perspicax relay reports (perspicax-mcp.ts onRole).
//
// - every Perspicax tool step carries its role (`tool.role`), put on the
//   step's own row (or kept until the row exists);
// - at each transition (the role differs from the thread's previous step),
//   an inline "Agit comme" card in the approval card family, unless the
//   bot owner's "Toujours ainsi" rule answered it;
// - a lapsed role, a refused write, a refused read with no fallback: one
//   banner row with the missing permission;
// - every refusal is logged for the bot's "Permissions manquantes" and the
//   routine coverage preview; every transition for the Roles graph.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import type { PerspicaxRoleEvent } from "./perspicax-mcp.ts";
import type { RoleJournal } from "./role-journal.ts";
import type { CwPermission, ToolRole } from "../../shared/perspicax-roles.ts";
import type { MissingPermission } from "../../shared/role-graph.ts";

type Catalog = Record<string, string>;
const catalogs: Record<"en" | "fr", Catalog> = { en: en as Catalog, fr: fr as Catalog };

/** A server-side sentence in the reader's language ({name} placeholders). */
export function roleText(language: string, key: string, values: Record<string, string> = {}): string {
  const catalog = language === "fr" ? catalogs.fr : catalogs.en;
  const template = catalog[key] ?? catalogs.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

export function permissionLine(permission: CwPermission | undefined, language = "en"): string {
  if (!permission) return "";
  const area = permission.module ? `${permission.module} › ${permission.func}` : permission.func;
  const op = roleText(language, `roles.op.${permission.operation === "Inquire" ? "inquire" : permission.operation.toLowerCase()}`);
  return `${area}${permission.path ? ` (${permission.path})` : ""} · ${op}`;
}

type Row = { id: string; kind?: string; role?: string; tool?: { name: string; role?: ToolRole } & Record<string, unknown> };

export interface RoleEventsDeps {
  journal: RoleJournal;
  messagesFor(threadId: string): readonly Row[];
  patchTool(threadId: string, messageId: string, tool: NonNullable<Row["tool"]>): void;
  appendRow(threadId: string, row: { kind: "activity"; tool: Record<string, unknown> } | { kind: "options"; card: Record<string, unknown> }): void;
  personName(principalId: string): string;
  botName(botId: string): string;
  ownerOf(botId: string): string | undefined;
  language(principalId: string): string;
}

export function createRoleEvents(deps: RoleEventsDeps) {
  const { journal } = deps;

  function attach(threadId: string, tool: string, role: ToolRole): void {
    const row = journal.rowFor(deps.messagesFor(threadId), tool);
    if (row?.tool) {
      deps.patchTool(threadId, row.id, { ...row.tool, role });
      return;
    }
    journal.remember(threadId, tool, role);
  }

  return {
    /** PerspicaxMcp onRole. */
    onRole(event: PerspicaxRoleEvent): void {
      if (event.held?.length) journal.noteRoles(event.principalId, event.held);
      if (event.permission && (event.kind !== "step" || event.role.reason === "fallback" || event.role.reason === "rule")) {
        const role = event.refusedRole ?? { slug: event.role.slug, name: event.role.name };
        journal.logRefusal({
          principalId: event.principalId, botId: event.botId, threadId: event.threadId, role, tool: event.tool,
          kind: event.kind === "write_refused" ? "write" : "read", permission: event.permission,
          ...(event.target ? { target: event.target } : {}),
        });
      }
      if (event.kind === "lapsed" || event.kind === "write_refused" || event.kind === "read_refused") {
        attach(event.threadId, event.tool, event.role);
        // 2026-11-05: no role notice in the chat; the journal keeps it
        return;
      }
      const previous = journal.advance(event.threadId, { slug: event.role.slug, name: event.role.name });
      const person = event.role.slug ? "" : deps.personName(event.principalId);
      const role: ToolRole = { ...event.role, ...(previous && !event.role.previous ? { previous } : {}), ...(person ? { person } : {}) };
      attach(event.threadId, event.tool, role);
      if (previous) {
        journal.logTransition({
          principalId: event.principalId, botId: event.botId, threadId: event.threadId,
          from: previous, to: { slug: event.role.slug, name: event.role.name }, reason: event.role.reason,
          ...(event.role.refusedTool ? { refusedTool: event.role.refusedTool } : {}),
        });
        // 2026-11-05: no "Agit comme" card in the chat; the journal keeps the transition
      }
    },

    /** item.started: the role a step's relay call already reported. */
    takePending(threadId: string, rowName: string): ToolRole | undefined {
      return journal.takePending(threadId, rowName);
    },
  };
}

/** The "Écrire au nom de …" approval summary (askMeWrite). */
export function meWriteSummary(language: string, input: { person: string; role: string; tool: string; permission: CwPermission }): string {
  return roleText(language, "roles.meWrite.summary", { person: input.person, role: input.role, tool: input.tool, permission: permissionLine(input.permission, language) });
}

/** "Envoyer à l'admin" (Roles tab): the message an organization admin reads,
 * in the admin's language. Times in Eastern time (America/New_York). */
export function missingRoleMessage(language: string, input: { person: string; bot: string; missing: MissingPermission }): string {
  const { missing } = input;
  const me = roleText(language, "roles.me");
  const when = new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(missing.lastAt));
  const fix = missing.member
    ? roleText(language, "roles.missing.fixMember", { member: missing.member })
    : roleText(language, "roles.missing.fixRole", { role: missing.role.name || me });
  return roleText(language, "roles.missing.adminMessage", {
    person: input.person || roleText(language, "roles.missing.someone"),
    bot: input.bot,
    role: missing.role.name || me,
    permission: permissionLine(missing.permission, language),
    fix,
    count: String(missing.count),
    when,
    tools: missing.tools.join(", "),
  });
}
