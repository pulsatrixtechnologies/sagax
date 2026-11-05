// Team writes for the Team map and its team panel (#2045). The sidebar's
// groups are the one source of the teams:
//
// - on an organization server, the person's own sections
//   (personal-sections.ts): what they create, rename, fill or delete there is
//   theirs, nobody else sees it and no admin right is needed. Their own bots
//   also follow on the server (bot.section), so team instructions and team
//   memory keep reaching them; that echo is best effort and never blocks;
// - on a solo server, the server's sections (/api/sidebar-sections).
//
// Sub-teams (section-tree.ts) follow every rename and delete in both modes.
import { api, type Bot } from "@/state/store";
import {
  assignToPersonalSection,
  createPersonalSection,
  deletePersonalSection,
  editPersonalSections,
  itemKey,
  readPersonalSections,
  renamePersonalSection,
  EMPTY_PERSONAL_SECTIONS,
  type PersonalSections,
  type SectionEditError,
  type SectionEditResult,
} from "./personal-sections";
import { editSectionParents, removeFromSectionTree, renameInSectionTree, setSectionParent, type SectionParentError } from "./section-tree";
import { t } from "./i18n";

export interface TeamWriteContext {
  orgMode: boolean;
  dispatch: (action: any) => void;
  /** The viewer's principal, lower case (viewerActorId). */
  viewerId: string;
  bots: readonly Bot[];
  /** The teams the server lists for this person. */
  serverSections: readonly string[];
}

type ServerAnswer = { sections?: string[]; bots?: Bot[] };

function applied(context: TeamWriteContext, answer: ServerAnswer): void {
  if (answer.sections) context.dispatch({ type: "sections", sections: answer.sections });
  for (const bot of answer.bots ?? []) context.dispatch({ type: "botPatched", bot });
}

function ownBotIds(context: TeamWriteContext, ids: readonly string[]): string[] {
  const own = new Set(context.bots.filter((bot) => (bot.ownerUserId ?? "").trim().toLowerCase() === context.viewerId).map((bot) => bot.id));
  return ids.filter((id) => own.has(id));
}

/** The server echo of an organization edit: never blocks, never shows. */
function echo(context: TeamWriteContext, path: string, init: RequestInit): void {
  void api(path, init).then((answer: ServerAnswer) => applied(context, answer), () => undefined);
}

function sectionEditMessage(code: SectionEditError): string {
  if (code === "reserved") return t("sidebar.section.reserved");
  if (code === "exists") return t("sidebar.section.exists");
  if (code === "full") return t("sidebar.section.full");
  return t("sidebar.section.namePlaceholder");
}

function personalEdit(edit: (prefs: PersonalSections) => SectionEditResult): string | null {
  const code = editPersonalSections(edit);
  return code ? sectionEditMessage(code) : null;
}

export function sectionParentMessage(code: SectionParentError): string {
  if (code === "cycle" || code === "self") return t("team.parentCycle");
  if (code === "depth") return t("team.parentDepth");
  if (code === "full") return t("sidebar.section.full");
  return t("team.parentMissing");
}

/** Every team name the person has, for the parent picker and its checks. */
export function teamNames(context: Pick<TeamWriteContext, "orgMode" | "serverSections">): Set<string> {
  if (!context.orgMode) return new Set(context.serverSections);
  return new Set((readPersonalSections() ?? EMPTY_PERSONAL_SECTIONS).sections.map((section) => section.name));
}

/** Puts a team under another one, or detaches it (parent ""). */
export function setTeamParent(context: TeamWriteContext, child: string, parent: string): string | null {
  const names = teamNames(context);
  const code = editSectionParents((tree) => setSectionParent(tree, child, parent, names));
  return code ? sectionParentMessage(code) : null;
}

/** Creates a team with these bots, under `parent` when given. Throws the
 * server's refusal on a solo server; returns an error text otherwise. */
export async function createTeam(context: TeamWriteContext, name: string, botIds: readonly string[], parent = ""): Promise<string | null> {
  const team = name.trim();
  if (context.orgMode) {
    const failed = personalEdit((prefs) => {
      const made = createPersonalSection(prefs, team);
      if (!made.ok) return made;
      let next = made.prefs;
      for (const id of botIds) {
        const moved = assignToPersonalSection(next, itemKey("bot", id), team);
        if (!moved.ok) return moved;
        next = moved.prefs;
      }
      return { ok: true, prefs: next };
    });
    if (failed) return failed;
    const mine = ownBotIds(context, botIds);
    if (mine.length) echo(context, "/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: team, botIds: mine }) });
  } else {
    applied(context, await api("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: team, botIds: [...botIds] }) }));
  }
  return parent ? setTeamParent(context, team, parent) : null;
}

export async function renameTeam(context: TeamWriteContext, from: string, to: string): Promise<string | null> {
  const next = to.trim();
  if (context.orgMode) {
    const failed = personalEdit((prefs) => renamePersonalSection(prefs, from, next));
    if (failed) return failed;
    if (context.serverSections.includes(from)) echo(context, `/api/sidebar-sections?section=${encodeURIComponent(from)}`, { method: "PATCH", body: JSON.stringify({ name: next }) });
  } else {
    applied(context, await api(`/api/sidebar-sections?section=${encodeURIComponent(from)}`, { method: "PATCH", body: JSON.stringify({ name: next }) }));
  }
  editSectionParents((tree) => renameInSectionTree(tree, from, next));
  return null;
}

export async function deleteTeam(context: TeamWriteContext, name: string): Promise<void> {
  if (context.orgMode) {
    editPersonalSections((prefs) => ({ ok: true, prefs: deletePersonalSection(prefs, name) }));
    if (context.serverSections.includes(name)) echo(context, `/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" });
  } else {
    applied(context, await api(`/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" }));
  }
  editSectionParents((tree) => removeFromSectionTree(tree, name));
}

/** Adds and removes bots of a team (removed ones go back to Unassigned). */
export async function setTeamBots(context: TeamWriteContext, section: string, addBotIds: readonly string[], removeBotIds: readonly string[]): Promise<string | null> {
  if (context.orgMode) {
    const failed = personalEdit((prefs) => {
      let next = prefs;
      for (const [ids, target] of [[addBotIds, section], [removeBotIds, ""]] as const) {
        for (const id of ids) {
          const moved = assignToPersonalSection(next, itemKey("bot", id), target);
          if (!moved.ok) return moved;
          next = moved.prefs;
        }
      }
      return { ok: true, prefs: next };
    });
    if (failed) return failed;
    const add = ownBotIds(context, addBotIds);
    const remove = ownBotIds(context, removeBotIds);
    if (add.length || remove.length) {
      if (context.serverSections.includes(section)) echo(context, `/api/sidebar-sections?section=${encodeURIComponent(section)}`, { method: "PUT", body: JSON.stringify({ addBotIds: add, removeBotIds: remove }) });
      else if (add.length) echo(context, "/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: section, botIds: add }) });
    }
    return null;
  }
  applied(context, await api(`/api/sidebar-sections?section=${encodeURIComponent(section)}`, { method: "PUT", body: JSON.stringify({ addBotIds, removeBotIds }) }));
  return null;
}

/** Moves one bot to a team ("" = Unassigned). */
export async function moveBotToTeam(context: TeamWriteContext, botId: string, destination: string): Promise<string | null> {
  if (context.orgMode) {
    const failed = personalEdit((prefs) => assignToPersonalSection(prefs, itemKey("bot", botId), destination));
    if (failed) return failed;
    if (ownBotIds(context, [botId]).length) echo(context, "/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: destination, botIds: [botId] }) });
    return null;
  }
  applied(context, await api("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: destination, botIds: [botId] }) }));
  return null;
}
