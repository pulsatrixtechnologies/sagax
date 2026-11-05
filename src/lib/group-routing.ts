import type { Bot, ConfigStatus, Group, GroupDefaultResponder } from "@/state/store";
import { isMentionBoundary, isMentionNameContinuation } from "../../shared/mention-boundary";
import { isViewersPrimaryBot } from "./primary-bot";
import { t } from "./i18n";

/** Whether an Auto room asks the decision model right now: the master switch
 * (off while no key is saved) and the room job both on. */
export function jevRoomRoutingOn(config: ConfigStatus | null | undefined): boolean {
  return Boolean(config?.decider?.enabled && config.decider.jobs.roomRouting);
}

/** Be defensive around rooms loaded while an older server is still running,
 * and around a lead removed by another client before the group patch arrives. */
export function effectiveDefaultResponder(
  group: Pick<Group, "defaultResponder">,
  members: Array<{ id: string }>,
): GroupDefaultResponder {
  const value = group.defaultResponder;
  if (value?.kind === "everyone" || value?.kind === "mentions") return value;
  if (value?.kind === "member" && members.some((member) => member.id === value.botId)) return value;
  // Auto keeps its fallback only while that bot is still in the room.
  if (value?.kind === "auto") {
    return value.fallbackBotId && members.some((member) => member.id === value.fallbackBotId) ? value : { kind: "auto" };
  }
  return members[0] ? { kind: "member", botId: members[0].id } : { kind: "mentions" };
}

/** The member who answers a plain message: the lead, or an Auto room's
 * fallback (its chosen fallback, else the first member). */
export function defaultResponderName(group: Group, members: Bot[]): string | null {
  const value = effectiveDefaultResponder(group, members);
  if (value.kind === "auto") return (members.find((member) => member.id === value.fallbackBotId) ?? members[0])?.name ?? null;
  if (value.kind !== "member") return null;
  return members.find((member) => member.id === value.botId)?.name ?? null;
}

/** `jevOn`: whether the decision model is on for rooms. An Auto room with it
 * off answers exactly like lead mode, so it reads like lead mode. */
export function groupResponseHint(group: Group, members: Bot[], { jevOn = true }: { jevOn?: boolean } = {}): string {
  if (group.dm) return t("room.hint.dm");
  const value = effectiveDefaultResponder(group, members);
  if (value.kind === "everyone") return t("room.hint.everyone");
  if (value.kind === "mentions") return t("room.hint.mentions");
  if (value.kind === "auto" && jevOn) return t("room.hint.auto");
  const name = defaultResponderName(group, members) ?? t("room.hint.leadFallback");
  return t("room.hint.lead", { name });
}

export function groupComposerHint(group: Group, members: Bot[], { jevOn = true }: { jevOn?: boolean } = {}): string {
  if (group.dm) return t("composer.hint.dm");
  const value = effectiveDefaultResponder(group, members);
  if (value.kind === "everyone") return t("composer.hint.everyone");
  if (value.kind === "mentions") return t("composer.hint.mentions");
  if (value.kind === "auto" && jevOn) return t("composer.hint.auto");
  return t("composer.hint.responder", {
    name: defaultResponderName(group, members) ?? t("composer.hint.lead"),
  });
}

/** Same routing sendGroup uses: explicit @mentions win, otherwise the
 * room's default responder. Keep this aligned with server/store.ts
 * `roomResponders` / `mentionedBots`. */
/** Whether a room's open task is working, which locks its composer. Its
 * tasks run side by side, so the task's own work counts; the room's flag,
 * which counts every task (a background goal's too), stands in only when no
 * task list came (a bot-to-bot channel's one conversation). */
export function openTaskWorking(group: Pick<Group, "threadId" | "working" | "tasks">): boolean {
  const task = group.tasks?.find((candidate) => candidate.threadId === group.threadId);
  return task ? Boolean(task.working) : Boolean(group.working);
}

/** Whether every bot that will answer can open an image. A person-to-person
 * chat has no bot to answer: the image goes to the other person, so it is
 * always allowed there (#1067). */
export function roomTakesImages<T>(
  group: Pick<Group, "peopleDm">,
  responders: readonly T[],
  supportsImages: (responder: T) => boolean,
): boolean {
  if (group.peopleDm) return true;
  return responders.length > 0 && responders.every(supportsImages);
}

export function roomRespondersForComposer<T extends { id: string; name: string; hidden?: boolean }>(
  text: string,
  members: T[],
  group: Pick<Group, "defaultResponder">,
): T[] {
  const available = members.filter((member) => !member.hidden);
  const everyone = "everyone";
  let everyoneAt = -1;
  while ((everyoneAt = text.indexOf("@", everyoneAt + 1)) !== -1) {
    if (
      isMentionBoundary(text, everyoneAt)
      && text.slice(everyoneAt + 1, everyoneAt + 1 + everyone.length).toLowerCase() === everyone
      && !isMentionNameContinuation(text.slice(everyoneAt + 1 + everyone.length))
    ) {
      return available;
    }
  }
  const mentioned = mentionedMembers(text, available);
  if (mentioned.length) return mentioned;
  const fallback = effectiveDefaultResponder(group, available);
  if (fallback.kind === "everyone") return available;
  // Any member may be picked, so image support is judged for all of them.
  if (fallback.kind === "auto") return available;
  if (fallback.kind === "member") {
    const lead = available.find((member) => member.id === fallback.botId);
    return lead ? [lead] : [];
  }
  return [];
}

/** Goal mode always starts with one coordinator: an explicit mention, the
 * configured lead, an in-room Chief, or the first active member. Keep this
 * aligned with the server's selectGroupGoalCoordinator path.
 * #2045: when viewerId is set, the fallback Chief is the viewer's own
 * Primary Bot only. */
export function goalCoordinatorForComposer<
  T extends { id: string; name: string; hidden?: boolean; chiefOfStaff?: boolean; ownerUserId?: string },
>(
  text: string,
  members: T[],
  group: Pick<Group, "defaultResponder">,
  viewerId?: string,
): T | null {
  const available = members.filter((member) => !member.hidden);
  const explicitlyMentioned = roomRespondersForComposer(
    text,
    available,
    { defaultResponder: { kind: "mentions" } },
  )[0];
  if (explicitlyMentioned) return explicitlyMentioned;
  const configuredResponder = group.defaultResponder;
  const lead = configuredResponder?.kind === "member" ? configuredResponder.botId
    : configuredResponder?.kind === "auto" ? configuredResponder.fallbackBotId : undefined;
  if (lead) {
    const configured = available.find((member) => member.id === lead);
    if (configured) return configured;
  }
  const primary = viewerId === undefined
    ? available.find((member) => member.chiefOfStaff)
    : available.find((member) => isViewersPrimaryBot(member, viewerId));
  return primary ?? available[0] ?? null;
}

/** #2045: the room lead for a viewer: preferred id, configured lead, then
 * the viewer's own Primary Bot, then the first member. */
export function preferredRoomLead<
  T extends { id: string; hidden?: boolean; chiefOfStaff?: boolean; ownerUserId?: string },
>(
  group: Pick<Group, "defaultResponder" | "memberIds"> | undefined,
  bots: readonly T[],
  options: { preferredId?: string; viewerId?: string } = {},
): T | undefined {
  const members = (group?.memberIds ?? []).flatMap((id) => {
    const bot = bots.find((candidate) => candidate.id === id);
    return bot && !bot.hidden ? [bot] : [];
  });
  const explicitLeadId = group?.defaultResponder.kind === "member" ? group.defaultResponder.botId : undefined;
  return members.find((bot) => bot.id === options.preferredId)
    ?? members.find((bot) => bot.id === explicitLeadId)
    ?? (options.viewerId === undefined
      ? members.find((bot) => bot.chiefOfStaff)
      : members.find((bot) => isViewersPrimaryBot(bot, options.viewerId!)))
    ?? members[0];
}

function mentionedMembers<T extends { name: string; hidden?: boolean }>(text: string, peers: T[]): T[] {
  const candidates = peers
    .filter((p) => !p.hidden && p.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const found: T[] = [];
  let at = -1;
  while ((at = text.indexOf("@", at + 1)) !== -1) {
    if (!isMentionBoundary(text, at)) continue;
    const hit = candidates.find((p) => {
      const name = p.name.toLowerCase();
      if (text.slice(at + 1, at + 1 + p.name.length).toLowerCase() !== name) return false;
      return !isMentionNameContinuation(text.slice(at + 1 + p.name.length));
    });
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}
