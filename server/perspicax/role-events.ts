// Visible roles (2026-11-05, corrected #2032/#2033): what the role journal
// keeps when the Perspicax relay reports a role fact (perspicax-mcp.ts onRole).
//
// The chat never shows role chips, "Agit comme" cards or role notices. The
// journal alone keeps steps, transitions, refusals and owner rules (Roles
// tab, routine coverage). The turn role itself lives only on Pulsatrix Flow
// routines ("Au nom de").
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

export interface RoleEventsDeps {
  journal: RoleJournal;
}

export function createRoleEvents(deps: RoleEventsDeps) {
  const { journal } = deps;

  return {
    /** PerspicaxMcp onRole. Journal only: nothing is posted into the chat. */
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
        // 2026-11-05: no role notice in the chat; the journal keeps it
        return;
      }
      const previous = journal.advance(event.threadId, { slug: event.role.slug, name: event.role.name });
      if (previous) {
        journal.logTransition({
          principalId: event.principalId, botId: event.botId, threadId: event.threadId,
          from: previous, to: { slug: event.role.slug, name: event.role.name }, reason: event.role.reason,
          ...(event.role.refusedTool ? { refusedTool: event.role.refusedTool } : {}),
        });
        // 2026-11-05: no "Agit comme" card in the chat; the journal keeps the transition
      }
    },

    /** item.started: pending chat role chips are gone (#2033); drain nothing. */
    takePending(_threadId: string, _rowName: string): ToolRole | undefined {
      return undefined;
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
