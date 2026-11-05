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
import type { RoleNotice, RoleTransitionCard } from "../../shared/wire.ts";
import type { CwPermission, ToolRole } from "../../shared/perspicax-roles.ts";
import { matchingRoleRule } from "../../shared/perspicax-roles.ts";

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

  function notice(event: PerspicaxRoleEvent, kind: RoleNotice["kind"]): void {
    const language = deps.language(event.principalId);
    const role = event.refusedRole ?? { slug: event.role.slug, name: event.role.name };
    const person = deps.personName(event.principalId);
    const roleLabel = role.name || roleText(language, "roles.me");
    const key = kind === "lapsed" ? "roles.notice.lapsed" : kind === "write_refused" ? "roles.notice.writeRefused" : "roles.notice.readRefused";
    const text = roleText(language, key, { role: roleLabel, permission: permissionLine(event.permission, language), bot: deps.botName(event.botId), person });
    const roleNotice: RoleNotice = {
      kind, role, tool: event.tool,
      ...(event.permission ? { permission: event.permission } : {}),
      ...(person ? { person } : {}),
      ...(event.target ? { target: event.target } : {}),
    };
    deps.appendRow(event.threadId, { kind: "activity", tool: { name: text, ok: false, roleNotice } });
  }

  function transitionCard(event: PerspicaxRoleEvent, from: { slug: string; name: string }): void {
    const to = { slug: event.role.slug, name: event.role.name };
    const owner = deps.ownerOf(event.botId);
    const path = event.permission?.path ?? "";
    // the owner's saved rule answers this transition: the chip says why
    if (event.role.reason === "rule") return;
    if (owner && owner === event.principalId && event.role.reason === "switch"
      && matchingRoleRule(journal.rulesFor(event.botId, owner).filter((rule) => rule.to.slug === to.slug), owner, from.slug, "")) return;
    const language = deps.language(event.principalId);
    const person = deps.personName(event.principalId);
    const bot = deps.botName(event.botId);
    const me = roleText(language, "roles.me");
    const fromName = from.name || me;
    const toName = to.name || me;
    const subtitle = event.role.reason === "fallback"
      ? roleText(language, "roles.transition.fallback", { bot, from: fromName, to: toName, tool: event.role.refusedTool ?? event.tool, person })
      : roleText(language, "roles.transition.switch", { bot, from: fromName, to: toName, person });
    const card: RoleTransitionCard = {
      botId: event.botId, botName: bot, person, from, to, reason: event.role.reason,
      ...(event.role.refusedTool ? { refusedTool: event.role.refusedTool } : {}),
      ...(path ? { path } : {}),
      canAlways: Boolean(owner && owner === event.principalId),
    };
    deps.appendRow(event.threadId, {
      kind: "options",
      card: {
        title: roleText(language, "roles.transition.title", { role: toName }),
        subtitle,
        options: [
          roleText(language, "roles.transition.continue"),
          roleText(language, "roles.transition.stay", { role: fromName }),
          ...(card.canAlways ? [roleText(language, "roles.transition.always")] : []),
        ],
        roleTransition: card,
      },
    });
  }

  return {
    /** PerspicaxMcp onRole. */
    onRole(event: PerspicaxRoleEvent): void {
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
        // a read refused under "Moi" itself is an ordinary tool error
        if (event.kind !== "read_refused" || event.refusedRole?.slug) notice(event, event.kind);
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
        transitionCard(event, previous);
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
