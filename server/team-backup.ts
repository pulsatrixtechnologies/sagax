import { newId, type ModelSelection } from "./contracts.ts";
import { botMascotBody } from "../shared/mascot-bodies.ts";
import { botMascotSkin } from "../shared/mascot-skins.ts";
import { takeImportName } from "../shared/import-name.ts";
import { MAX_TEAM_BACKUP_BYTES, parseTeamBackup, type BackupTask, type TeamBackup } from "../shared/team-backup.ts";
import type { BotVisibility } from "../shared/wire.ts";
import type { BotRecord, GroupRecord, Message, Store, TaskRecord } from "./store.ts";
import type { Routine, RoutineManager } from "./routines.ts";
import { redactSecretsInText } from "./redact.ts";
import {
  listMemoryLogs, listMemoryTopics, readMemoryFile, readMemoryLog, readMemoryTopic,
  writeMemoryFile, writeMemoryLog, writeMemoryTopic,
} from "./workspace.ts";

/** A bot's memory as it travels: MEMORY.md, every topic file, every daily
 * log — scrubbed on the way out, because a file the bot's own file tools
 * wrote never passed the server's scrub. Absent when the bot has none, so
 * a backup of a bot that never remembered anything is unchanged. */
function memoryFor(botId: string, scrub: (text: string) => string = redactSecretsInText): TeamBackup["bots"][number]["memory"] {
  const file = scrub(readMemoryFile(botId).text);
  const topics = listMemoryTopics(botId).flatMap((topic) => {
    const text = readMemoryTopic(botId, topic.name);
    return text === null ? [] : [{ name: topic.name, text: scrub(text) }];
  });
  const logs = listMemoryLogs(botId).flatMap((name) => {
    const text = readMemoryLog(botId, name);
    return text === null ? [] : [{ name, text: scrub(text) }];
  });
  if (!file && !topics.length && !logs.length) return undefined;
  return { file, topics, logs };
}

/** Restore a bot's memory into its fresh workspace: the same writers the
 * tool and the editor use, so modes (0700 folders, 0600 files), the scrub
 * and the search index all come for free. Runs before any transcript is
 * restored, inside the import's rollback — deleteBot removes the workspace. */
function restoreMemory(botId: string, memory: NonNullable<TeamBackup["bots"][number]["memory"]>): void {
  if (memory.file) writeMemoryFile(botId, memory.file);
  for (const topic of memory.topics) writeMemoryTopic(botId, topic.name, topic.text);
  for (const log of memory.logs) writeMemoryLog(botId, log.name, log.text);
}

/** Preserve readable history without importing executable cards, live queue
 * entries, approval requests, local paths or provider session handles. */
function messageText(message: Message): string {
  const parts = [message.text ?? ""];
  if (message.card) parts.push(message.card.title, message.card.subtitle, ...message.card.options, message.card.answered ?? "");
  if (message.tool) parts.push(`[${message.tool.name}${message.tool.ok === false ? ": failed" : ""}]`);
  if (message.kind === "connector") parts.push("[Connection card — reconnect in Settings]");
  if (message.kind === "secret") parts.push("[Secret request — not restored]");
  if (message.kind === "signin") parts.push("[Sign-in request — not restored]");
  if (message.routineRun) parts.push(`[Routine: ${message.routineRun.routineName} — ${message.routineRun.status}]`, message.routineRun.summary ?? "", message.routineRun.error ?? "");
  if (message.goalRun) parts.push(`[Room goal: ${message.goalRun.status}]`, message.goalRun.goal, message.goalRun.detail ?? "");
  if (message.kind === "screen" || message.attachments?.length) parts.push("[Image or attachment — file not included in this backup]");
  return parts.filter(Boolean).join("\n");
}

/** What a backup of a subset carries (slice 8 organization copy). Without
 * options: every bot, room and routine, message text as written. */
export interface TeamBackupOptions {
  /** Only these bots (and the rooms in `groupIds`). */
  botIds?: ReadonlySet<string>;
  groupIds?: ReadonlySet<string>;
  /** Run over message text, instructions, description, playbook
   * instructions, routine prompts, room bulletins, task and room titles
   * and memory (memory is always scrubbed). */
  scrub?: (text: string) => string;
  /** False: the bot travels with one empty "Conversation". */
  threads?: (botId: string) => boolean;
  /** False: the bot travels without its memory. */
  memory?: (botId: string) => boolean;
}

export function createTeamBackup(store: Store, routines: Routine[], name: string, options: TeamBackupOptions = {}): TeamBackup {
  const chosenBots = options.botIds ? store.bots.filter((bot) => options.botIds!.has(bot.id)) : store.bots;
  // A conversation between two people (server/people-dms.ts) is theirs
  // alone: no backup or package ever carries it.
  const chosenGroups = (options.groupIds ? store.groups.filter((group) => options.groupIds!.has(group.id)) : store.groups).filter((group) => !group.peopleDm);
  const botIds = new Set(chosenBots.map((bot) => bot.id));
  const text = options.scrub ?? ((value: string) => value);
  // Free text a person typed (a routine prompt, a room bulletin, a title)
  // can hold a pasted key just like a message: scrubbed when asked.
  const typed = <T extends string | undefined>(value: T): T =>
    (options.scrub && typeof value === "string" ? text(value) : value) as T;
  const warnings: string[] = [];
  const history = (record: BotRecord | GroupRecord): BackupTask[] => {
    if (options.threads && store.bot(record.id) && !options.threads(record.id)) {
      return [{ key: record.threadId, title: "Conversation", createdAt: record.createdAt, activeLeafId: null, messages: [] }];
    }
    const all = record.tasks?.length ? record.tasks : [{ threadId: record.threadId, title: "Conversation", createdAt: record.createdAt }];
    // A confidential thread (server/confidential-threads.ts) never leaves in
    // a backup or a package: not its messages, title nor id.
    const tasks = all.filter((task) => !("confidential" in task && task.confidential === true));
    if (!tasks.length) return [{ key: `conversation-${record.id}`, title: "Conversation", createdAt: record.createdAt, activeLeafId: null, messages: [] }];
    return tasks.map((task) => ({
      key: task.threadId, title: typed(task.title), createdAt: task.createdAt,
      // Whether the first message already named this task travels with it:
      // without the marker a restore could re-arm one generated title on a
      // row that had already used it.
      titleFromFirstMessage: "titleFromFirstMessage" in task && task.titleFromFirstMessage || undefined,
      // Who opened the thread travels; the handoff id does not — the
      // delegation ledger is process-local and never part of a backup.
      openedBy: "openedBy" in task && task.openedBy
        ? { botId: task.openedBy.botId, name: task.openedBy.name, at: task.openedBy.at,
            // What kind of conversation it is travels: a restored pair
            // conversation is still the standing line between those two
            // bots, so the import does not read as one more loose row.
            ...(task.openedBy.kind ? { kind: task.openedBy.kind } : {}) }
        : undefined,
      closedBy: "closedBy" in task && task.closedBy
        ? { botId: task.closedBy.botId, name: task.closedBy.name, at: task.closedBy.at }
        : undefined,
      pinned: task.pinned === true ? true : undefined,
      turnTimeoutMinutes: "turnTimeoutMinutes" in task && typeof task.turnTimeoutMinutes === "number"
        ? task.turnTimeoutMinutes
        : undefined,
      activeLeafId: store.activeLeaf(task.threadId),
      messages: store.messagesFor(task.threadId).map((message) => ({
        id: message.id, role: message.role, text: text(messageText(message)), at: message.at,
        parentId: message.parentId ?? null, replyToId: message.replyToId,
        from: message.from, peerPost: message.peerPost,
      })),
    }));
  };
  const groups = chosenGroups.map((group) => {
    const memberIds = group.memberIds.filter((id) => botIds.has(id));
    if (memberIds.length !== group.memberIds.length) warnings.push(`Room “${typed(group.name)}” contains deleted bots. Its conversation is included with the remaining members.`);
    return {
      key: group.id, name: typed(group.name), section: group.section, dm: Boolean(group.dm) && memberIds.length === 2,
      bulletin: typed(group.bulletin), memberIds,
      defaultResponder: group.defaultResponder.kind === "member" && !memberIds.includes(group.defaultResponder.botId)
        ? { kind: "mentions" as const }
        : group.defaultResponder.kind === "auto" && group.defaultResponder.fallbackBotId && !memberIds.includes(group.defaultResponder.fallbackBotId)
          ? { kind: "auto" as const } : group.defaultResponder,
      activeTask: group.threadId,
      tasks: history(group).map((task, index) =>
        group.dm && index === 0 && typeof group.turnTimeoutMinutes === "number"
          ? { ...task, turnTimeoutMinutes: group.turnTimeoutMinutes }
          : task,
      ),
    };
  });
  const validRoutines = routines.filter((routine) => {
    const room = groups.find((group) => group.key === routine.groupId);
    const valid = botIds.has(routine.botId) && (routine.target !== "room-goal" || (room && !room.dm && room.memberIds.includes(routine.botId)));
    if (!valid) warnings.push(`Routine “${routine.name}” is not included because its bot, room or coordinator was deleted.`);
    return valid;
  });
  const document = parseTeamBackup({
    format: "openmaus.backup", version: 1, name, exportedAt: Date.now(),
    warnings,
    bots: chosenBots.map((bot) => ({
      key: bot.id, name: bot.name, title: bot.title, description: options.scrub ? text(bot.description) : bot.description,
      soul: bot.soul !== undefined && options.scrub ? text(bot.soul) : bot.soul,
      section: bot.section, color: bot.color,
      mascotExpression: bot.mascotExpression ?? undefined, mascotBody: bot.mascotBody ?? undefined,
      mascotSkin: bot.mascotSkin && bot.mascotSkin !== "none" ? bot.mascotSkin : undefined,
      chiefOfStaff: Boolean(bot.chiefOfStaff), hidden: Boolean(bot.hidden),
      playbooks: options.scrub ? (bot.playbooks ?? []).map((playbook) => ({ ...playbook, instructions: text(playbook.instructions) })) : bot.playbooks ?? [],
      // Grants are workspace-private authority: they travel in this backup
      // so the team's shape is not lost, but the import below still lands
      // every bot grant-less — restoring them is a deliberate later choice.
      ...(bot.connectorTools ? { connectorTools: structuredClone(bot.connectorTools) } : {}),
      ...(bot.toolScope !== undefined ? { toolScope: structuredClone(bot.toolScope) } : {}),
      memory: options.memory && !options.memory(bot.id) ? undefined : memoryFor(bot.id, options.scrub),
      ...(() => {
        const tasks = history(bot);
        return { activeTask: tasks.some((task) => task.key === bot.threadId) ? bot.threadId : tasks[0]!.key, tasks };
      })(),
    })),
    groups,
    routines: validRoutines.map((routine) => ({
      name: routine.name, prompt: typed(routine.prompt), target: routine.target, botId: routine.botId,
      groupId: routine.groupId, runOn: routine.runOn, schedule: routine.schedule,
      durationMinutes: routine.durationMinutes, timeoutMinutes: routine.timeoutMinutes,
    })),
  });
  // Never download a file our own importer cannot read; never truncate history.
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_TEAM_BACKUP_BYTES) {
    throw new Error("This backup exceeds the 50 MB portable-backup limit. Nothing was exported or changed.");
  }
  return document;
}

/** Import is always additive, including sections and Primary Bots. Rollback owns
 * only the fresh records below and cannot touch any pre-existing bot/chat. */
/** The section-channel records an organization import keeps in step
 * (server/section-channels.ts); absent in solo mode. */
export interface ImportSectionChannels {
  byName(name: string): unknown;
  ensure(name: string, ownerPrincipalId: string): unknown;
  removeByName(name: string): void;
  recordPlacement(name: string, botId: string, ownerPrincipalId: string): void;
  recordRoomPlacement(name: string, roomId: string): void;
}

export interface TeamBackupImportOptions {
  visibility?: BotVisibility;
  /** Organization server (slice 8): every bot is this person's. */
  ownerUserId?: string;
  /** A room's people, by its backup key. */
  groupHumanIds?: (sourceKey: string) => string[] | undefined;
  /** Who a routine runs as, by its index in the backup. */
  routineRunAs?: (index: number) => string | undefined;
  /** Every section the import creates becomes a private section-channel
   * of `ownerUserId`, holding its bots and rooms; undone on rollback. */
  sectionChannels?: ImportSectionChannels;
}

export function importTeamBackup(store: Store, routines: RoutineManager, input: unknown, selection: ModelSelection, options: TeamBackupImportOptions = {}) {
  const backup = parseTeamBackup(input);
  const channels = options.ownerUserId ? options.sectionChannels : undefined;
  const createdChannels: string[] = [];
  const channelFor = (name: string) => {
    if (!channels || createdChannels.includes(name)) return;
    if (channels.byName(name)) return;
    channels.ensure(name, options.ownerUserId!);
    createdChannels.push(name);
  };
  const bots: BotRecord[] = [];
  const groups: GroupRecord[] = [];
  const createdRoutines: Routine[] = [];
  const existingBotIds = new Set(store.bots.map((bot) => bot.id));
  const existingGroupIds = new Set(store.groups.map((group) => group.id));
  const botIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const takenNames = new Set(store.bots.map((bot) => bot.name.trim().toLowerCase()));
  const takenGroups = new Set(store.groups.map((group) => group.name.trim().toLowerCase()));
  const takenSections = new Set([
    ...store.sections.map((section) => section.toLowerCase()),
    ...[...store.bots, ...store.groups].map((record) => record.section?.trim().toLowerCase() ?? ""),
  ]);
  const sections = new Map<string, string>();
  const sectionFor = (section?: string) => {
    const key = section?.trim() ?? "";
    if (!sections.has(key)) sections.set(key, takeImportName(section?.trim() || "Imported bots", takenSections, 60));
    return sections.get(key)!;
  };
  const restore = (task: BackupTask, threadId: string) => {
    const ids = new Map(task.messages.map((message) => [message.id, newId()]));
    const messages: Message[] = task.messages.map((message) => ({
      id: ids.get(message.id)!, kind: "text", role: message.role, text: message.text, at: message.at,
      parentId: message.parentId ? ids.get(message.parentId)! : null,
      replyToId: message.replyToId ? ids.get(message.replyToId) : undefined,
      // Removed historical senders retain their name in the text, never a
      // link to an unrelated local bot with a colliding file key.
      ...(message.from && botIds.has(message.from.botId)
        ? { from: { ...message.from, botId: botIds.get(message.from.botId)! } }
        : message.from ? { text: `${message.from.name}:\n${message.text}` } : {}),
      peerPost: message.peerPost,
    }));
    store.importTranscript(threadId, messages, task.activeLeafId ? ids.get(task.activeLeafId)! : null);
  };
  try {
    // Allocate all bot IDs before remapping any conversation participants.
    for (const source of backup.bots) {
      const bot = store.createBot({
        name: takeImportName(source.name, takenNames), title: source.title, description: source.description, soul: source.soul,
        color: source.color, mascotExpression: source.mascotExpression,
        mascotBody: botMascotBody(source.mascotBody),
        mascotSkin: botMascotSkin(source.mascotSkin),
        modelSelection: selection, section: sectionFor(source.section),
        // who may see the imported team is the importing admin's choice
        ...(options.visibility ? { visibility: options.visibility } : {}),
        ...(options.ownerUserId ? { ownerUserId: options.ownerUserId } : {}),
      }, { seedMessages: false });
      bots.push(bot);
      botIds.set(source.key, bot.id);
      store.patchBot(bot.id, { composio: false, computer: "off", browser: false, approvalMode: "ask", autoApprove: false,
        connectorTools: {}, toolScope: source.toolScope, hidden: source.hidden, playbooks: source.playbooks });
      if (source.memory) restoreMemory(bot.id, source.memory);
      if (channels && bot.section) {
        channelFor(bot.section);
        channels.recordPlacement(bot.section, bot.id, options.ownerUserId!);
      }
    }
    // Former Chiefs of Staff (one per section) arrive under the one-per-
    // person Primary Bot rule (store.adoptImportedLeaders).
    store.adoptImportedLeaders(backup.bots.filter((source) => source.chiefOfStaff).map((source) => botIds.get(source.key)!));
    for (const source of backup.bots) {
      const bot = store.bot(botIds.get(source.key)!)!;
      const tasks = source.tasks.map((task, i): TaskRecord => {
        const record: TaskRecord = {
          // Each imported thread follows the imported bot's model.
          threadId: i === 0 ? bot.threadId : newId(), title: task.title, createdAt: task.createdAt, resumeCursors: {},
          activity: "idle" as const, busy: false, unread: false,
          ...(task.titleFromFirstMessage ? { titleFromFirstMessage: true } : {}),
        };
        // Same rule as a message's `from`: the opener is remapped to its
        // imported twin, and an opener outside this backup leaves no record
        // rather than a bot id that resolves to a stranger.
        const opener = task.openedBy && botIds.get(task.openedBy.botId);
        if (task.openedBy && opener) record.openedBy = { botId: opener, name: task.openedBy.name, at: task.openedBy.at, ...(task.openedBy.kind ? { kind: task.openedBy.kind } : {}) };
        // A closed thread stays closed after import — the pile the person
        // tidied does not come back as a pile — with the closer remapped
        // the same way, or absent when it was a stranger.
        const closer = task.closedBy && botIds.get(task.closedBy.botId);
        if (task.closedBy && closer) record.closedBy = { botId: closer, name: task.closedBy.name, at: task.closedBy.at };
        if (task.pinned === true) record.pinned = true;
        // confidential is permanent: an import never makes one ordinary
        if (task.confidential === true) record.confidential = true;
        const newest = task.messages.reduce((max, message) => Math.max(max, message.at), task.createdAt);
        record.updatedAt = newest;
        return record;
      });
      // Own the task IDs before writing their transcripts, so rollback also
      // removes partially imported history if persistence fails midway.
      store.patchBot(bot.id, { tasks, threadId: tasks[source.tasks.findIndex((task) => task.key === source.activeTask)].threadId });
      source.tasks.forEach((task, i) => restore(task, tasks[i].threadId));
    }
    for (const source of backup.groups) {
      const group = store.createGroup(takeImportName(source.name, takenGroups), source.memberIds.map((id) => botIds.get(id)!), source.dm, sectionFor(source.section));
      groups.push(group);
      groupIds.set(source.key, group.id);
      const humans = options.groupHumanIds?.(source.key);
      if (humans) store.patchGroup(group.id, { humanIds: humans });
      if (channels && group.section) {
        channelFor(group.section);
        channels.recordRoomPlacement(group.section, group.id);
      }
      const responder = source.defaultResponder;
      store.patchGroup(group.id, {
        bulletin: source.bulletin,
        setupCompletedAt: Date.now(),
        ...(source.dm && source.tasks[0]?.turnTimeoutMinutes != null
          ? { turnTimeoutMinutes: source.tasks[0].turnTimeoutMinutes }
          : {}),
        defaultResponder:
        responder.kind === "member" ? { kind: "member", botId: botIds.get(responder.botId)! }
          : responder.kind === "auto" ? { kind: "auto", ...(responder.fallbackBotId ? { fallbackBotId: botIds.get(responder.fallbackBotId)! } : {}) }
            : responder });
      // Use the existing task APIs for rooms; direct-message rooms have one.
      const threads = source.tasks.map((task, i) => {
        if (i === 0) {
          if (!source.dm) store.renameGroupTask(group.id, group.threadId, task.title);
          return group.threadId;
        }
        return store.createGroupTask(group.id, task.title, false)!.threadId;
      });
      source.tasks.forEach((task, i) => restore(task, threads[i]));
      if (!source.dm) {
        group.tasks = source.tasks.map((task, i) => ({
          threadId: threads[i], title: task.title, createdAt: task.createdAt,
          updatedAt: task.messages.reduce((max, message) => Math.max(max, message.at), task.createdAt),
          ...(task.pinned === true ? { pinned: true as const } : {}),
          ...(task.titleFromFirstMessage ? { titleFromFirstMessage: true } : {}),
          ...(task.turnTimeoutMinutes != null ? { turnTimeoutMinutes: task.turnTimeoutMinutes } : {}),
        }));
        store.switchGroupTask(group.id, threads[source.tasks.findIndex((task) => task.key === source.activeTask)]);
      }
    }
    for (const [index, source] of backup.routines.entries()) {
      const runAs = options.routineRunAs?.(index);
      createdRoutines.push(routines.create({ ...source, botId: botIds.get(source.botId)!,
        groupId: source.target === "room-goal" ? groupIds.get(source.groupId!) : undefined, enabled: false },
      undefined, runAs ? { actorPrincipalId: runAs } : undefined));
    }
    return { name: backup.name, bots, groups, routines: createdRoutines };
  } catch (error) {
    for (const routine of createdRoutines) routines.remove(routine.id);
    // createBot/createGroup can throw during persistence before returning.
    // This synchronous import cannot interleave another writer, so include
    // every fresh ID, even a record that never reached the result arrays.
    for (const group of store.groups) if (!existingGroupIds.has(group.id)) store.deleteGroup(group.id);
    for (const bot of store.bots) if (!existingBotIds.has(bot.id)) store.deleteBot(bot.id);
    for (const section of sections.values()) {
      if (store.sections.includes(section)) store.changeEmptySection(section, null);
    }
    for (const name of createdChannels) channels!.removeByName(name);
    throw error;
  }
}
