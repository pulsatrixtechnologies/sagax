import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useOrgPeople } from "@/lib/perspicax-org";
import { MENTION_ALL, roomAllowsMentionAll, roomMentionPeople } from "@/lib/person-mentions";
import { viewerActorId } from "@/lib/viewer";
import { activeLocale, t } from "@/lib/i18n";
import { canTeachInBrowser } from "@/lib/bot-capabilities";
import { browserAvailable, builtInBrowserEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { TEACH_TASK_OFFERED } from "../../../shared/teach-task";
import { requestBrowserTeach } from "@/lib/teach-request";
import { myChromeCall, type MyChromeRecordingResult } from "@/lib/my-chrome";
import { mentionChoicesForQuery } from "@/lib/mentions";
import {
  composerCommandMenu,
  skillCommandInsertion,
  composerGroupCommandMenu,
  composerGroupSlashTrigger,
  composerSlashTrigger,
  engineCommandInsertion,
  groupCommandTargets,
  goalSubcommandBlock,
  replaceComposerSlashTrigger,
  GOAL_SUBCOMMANDS,
  type GoalSubcommand,
  type ComposerMenuItem,
  type ComposerSlashCommand,
  type GroupEngineCommands,
} from "@/lib/composer-commands";
import { useGroupHarnessCommands, useHarnessCommands } from "@/lib/harness-commands";
import { useSlashSkills } from "@/lib/use-slash-skills";
import { LOOP_SUBCOMMANDS, loopRoutineName, type LoopCommand } from "@/lib/composer-loop";
import { useMenuMotion } from "../MenuMotion";
import { mentionQueryAt } from "./mentionQueryAt";
import type { MentionChoice } from "./types";
import type { Action, Bot, ConfigStatus, Group, InstanceInfo } from "@/state/store";
import type { Routine } from "@/lib/routines";

export function useComposerCommands({
  text,
  caret,
  setCaret,
  editText,
  setChannelMode,
  bot,
  group,
  members,
  storeBots,
  config,
  instances,
  routines,
  ownerOrAdmin,
  remoteClient,
  threadId,
  api,
  dispatch,
  dismissedAt,
  setDismissedAt,
  dismissedSlashAt,
  setDismissedSlashAt,
  inputRef,
  mentionListRef,
  commandListRef,
}: {
  text: string;
  caret: number;
  setCaret: Dispatch<SetStateAction<number>>;
  editText: (next: string) => void;
  setChannelMode: (mode: "chat" | "goal") => void;
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  storeBots: Bot[];
  config: ConfigStatus | null | undefined;
  instances: InstanceInfo[];
  routines: Routine[];
  ownerOrAdmin: boolean | null;
  remoteClient: boolean;
  threadId: string;
  api: typeof import("@/state/store").api;
  dispatch: Dispatch<Action>;
  dismissedAt: number | null;
  setDismissedAt: Dispatch<SetStateAction<number | null>>;
  dismissedSlashAt: number | null;
  setDismissedSlashAt: Dispatch<SetStateAction<number | null>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  mentionListRef: RefObject<HTMLDivElement | null>;
  commandListRef: RefObject<HTMLDivElement | null>;
}) {
  const [highlight, setHighlight] = useState(0);
  // ── Slash commands and @mentions ─────────────────────────────────────
  // In a group "/" also opens right after a leading @mention: that bot's
  // engine commands only (shared/harness-commands.ts groupCommandTarget).
  const groupSlash = group && !group.dm ? composerGroupSlashTrigger(text, caret, members ?? []) : null;
  const slash = group && !group.dm ? groupSlash?.trigger ?? null : composerSlashTrigger(text, caret);
  const locale = activeLocale();
  // The engine's own commands (Claude Code, Codex) for a 1:1 conversation,
  // read the first time "/" is typed there (src/lib/harness-commands.ts).
  // On an organization server the list is the signed-in person's own, so the
  // cache is theirs too.
  const commandViewerId = config?.viewer?.principalId ?? null;
  const engineCommands = useHarnessCommands(api, !group ? bot?.id : undefined, threadId || undefined, Boolean(slash) && !group, commandViewerId);
  // The bot's own enabled skills, each run for one turn with `/name`
  // (shared/skill-command.ts). A 1:1 chat only: in a room the command would
  // reach several bots, each with its own skills.
  const slashSkills = useSlashSkills(!group ? bot?.id : undefined, threadId || "", Boolean(slash) && slash?.start !== dismissedSlashAt && !group);
  // In a group: the commands of the bot(s) the command would reach, per bot.
  const groupSlashOpen = Boolean(groupSlash);
  const groupSlashBotId = groupSlash?.botId;
  const groupTargets = useMemo(
    () => groupSlashOpen && group ? groupCommandTargets({ botId: groupSlashBotId }, members ?? [], group.defaultResponder) : [],
    [groupSlashOpen, groupSlashBotId, group, members],
  );
  const groupEngineCommands = useGroupHarnessCommands(api, groupTargets.map((target) => target.bot.id), group && !group.dm ? group.id : undefined, threadId || undefined, groupSlashOpen, commandViewerId);
  const supportsAgents = (candidate?: Bot) =>
    Boolean(
      candidate &&
        instances.find(
          (instance) => instance.instanceId === candidate.modelSelection.instanceId,
        )?.capabilities?.agentsMcp,
    );
  // /learn: also the + menu's "Teach a task". All three ways to teach a task
  // follow one switch (shared/teach-task.ts, #4209): off, none is offered.
  const learnAvailable = TEACH_TASK_OFFERED && skillAuthoringEnabled(config) &&
    (group ? (members ?? []).some(supportsAgents) : supportsAgents(bot));
  // ...which can also be shown in the bot's browser (a recording) when this
  // person can open that browser (the Browser panel's own conditions).
  const browserTeach = Boolean(TEACH_TASK_OFFERED && bot && !group && bot.browser !== false && canTeachInBrowser(config, bot, ownerOrAdmin)
    && (builtInBrowserEnabled(config) || browserAvailable(config)) && config?.browserEngine?.kind === "engine");
  const [teachChooser, setTeachChooser] = useState(false);
  // ...or shown in the person's own Chrome (My Chrome's recorder), where this
  // server offers My Chrome to this person (its status answers them only).
  const [myChromeOffered, setMyChromeOffered] = useState(false);
  const [myChromeRecord, setMyChromeRecord] = useState(false);
  const [myChromeTaught, setMyChromeTaught] = useState<MyChromeRecordingResult | null>(null);
  const myChromeBotId = TEACH_TASK_OFFERED && bot && !group && !remoteClient ? bot.id : "";
  useEffect(() => {
    if (!myChromeBotId) { setMyChromeOffered(false); return; }
    let live = true;
    myChromeCall("status").then((status) => { if (live) setMyChromeOffered(status.offered); }, () => { if (live) setMyChromeOffered(false); });
    return () => { live = false; };
  }, [myChromeBotId]);
  const showInBrowser = () => {
    if (!bot) return;
    requestBrowserTeach(bot.id);
    dispatch({ type: "toggleComputer", open: true });
  };
  // The room's latest goal run, its card in the transcript: what /goal
  // status, resume and stop act on.
  const latestGoalRun = useMemo(() => {
    if (!group || group.dm) return null;
    for (let index = group.messages.length - 1; index >= 0; index -= 1) {
      const message = group.messages[index]!;
      if (message.kind === "goal.run" && message.goalRun) return { messageId: message.id, run: message.goalRun };
    }
    return null;
  }, [group]);
  const goalStatus = latestGoalRun?.run.status;
  const commandCandidates = useMemo((): ComposerMenuItem[] => {
    if (!slash || slash.start === dismissedSlashAt) return [];
    // Built-in commands only work at the start of a message; skills can be named anywhere.
    const builtIns = slash.start === 0;
    const available: ComposerSlashCommand[] = [];
    if (builtIns && ((group && !group.dm) || !group)) {
      available.push({
        id: "goal",
        label: "/goal",
        description: t(group ? "composer.command.goalDesc" : "composer.command.soloGoalDesc"),
        argumentHint: t("composer.command.goalHint"),
      });
      // A team's subcommands. In a 1:1, /goal status and /goal stop are sent as text.
      if (group) for (const sub of GOAL_SUBCOMMANDS) {
        const block = goalSubcommandBlock(sub, goalStatus);
        available.push({
          id: `goal-${sub}`,
          label: `/goal ${sub}`,
          description: t(`composer.goal.sub.${sub}`),
          ...(block ? { unavailableReason: t(`composer.goal.block.${block}`) } : {}),
        });
      }
    }
    if (builtIns && learnAvailable) {
      available.push({
        id: "learn",
        label: "/learn",
        description: t("composer.command.learnDesc"),
      });
    }
    // Setup mode needs the agents tools (propose_profile and friends) and a
    // single bot: a room cannot set itself up.
    if (builtIns && !group && supportsAgents(bot)) available.push({
      id: "setup",
      label: "/setup",
      description: t("composer.command.setupDesc"),
    });
    // #2618: a report to the team, asked for in this chat (the server runs it).
    if (builtIns && !group && bot) available.push({
      id: "feedback",
      label: "/feedback",
      description: t("composer.command.feedbackDesc"),
      argumentHint: t("composer.command.feedbackHint"),
    });
    if (builtIns && (bot || (group && !group.dm))) {
      available.push({
        id: "loop",
        label: "/loop",
        description: t("composer.command.loopDesc"),
        argumentHint: t("composer.command.loopHint"),
      });
      for (const sub of LOOP_SUBCOMMANDS) {
        available.push({
          id: `loop-${sub}`,
          label: `/loop ${sub}`,
          description: t(`composer.loop.sub.${sub}`),
        });
      }
    }
    // Mid-message: only skills (and, in rooms, nothing from the built-in list).
    return group
      ? composerGroupCommandMenu(groupSlashBotId ? [] : available, builtIns ? groupTargets.map((target): GroupEngineCommands => ({
        bot: { id: target.bot.id, name: target.bot.name },
        commands: groupEngineCommands.lists.find((list) => list.botId === target.bot.id)?.answer.commands ?? [],
        mention: target.mention,
      })) : [], slash.query)
      : composerCommandMenu(available, builtIns ? (engineCommands.answer?.commands ?? []) : [], slash.query, slashSkills);
  }, [slash, dismissedSlashAt, group, members, bot, config, instances, locale, engineCommands.answer, groupTargets, groupEngineCommands.lists, groupSlashBotId, learnAvailable, goalStatus, slashSkills]);
  const commandPickerOpen = commandCandidates.length > 0;

  // Tag another bot; the agent reaches it via ask_bot. In a room, tag a
  // person too: they get a notification (server/rooms/room-mentions.ts), and
  // @all tags all of them when the room allows it.
  const mention = mentionQueryAt(text, caret);
  const orgPeople = useOrgPeople();
  const roomPeople = useMemo(
    () => (group ? roomMentionPeople(group, orgPeople, viewerActorId(config)) : []),
    [group, orgPeople, config],
  );
  const mentionAll = group ? roomAllowsMentionAll(group) && roomPeople.length > 0 : false;
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          ...(!group.dm ? [{ id: "__everyone__", name: "everyone" }] : []),
          ...(mentionAll ? [{ id: "__all__", name: MENTION_ALL, all: true as const }] : []),
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
          ...roomPeople.map((person) => ({ id: `person:${person.id}`, name: person.name, person })),
        ]
      : storeBots
          .filter((member) => member.id !== bot?.id && !member.hidden)
          .map((member) => ({ id: member.id, name: member.name, bot: member }));
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, storeBots, bot?.id, group, members, roomPeople, mentionAll]);
  // @everyone reaches the room's visible bots. Hidden members stay out of
  // the count so the line matches who the server will actually answer.
  const mentionEveryoneCount = (members ?? []).filter((member) => !member.hidden).length;
  const mentionPickerOpen = candidates.length > 0;
  const commandMotion = useMenuMotion(commandPickerOpen);
  const mentionMotion = useMenuMotion(mentionPickerOpen);

  useEffect(
    () => setHighlight(0),
    [mention?.start, mention?.query, slash?.start, slash?.query],
  );

  // the engine's commands load after the menu opens, so the list can shrink
  // under the highlighted row
  useEffect(() => {
    if (!commandPickerOpen) return;
    setHighlight((current) => Math.min(current, commandCandidates.length - 1));
  }, [commandCandidates.length, commandPickerOpen]);

  useEffect(() => {
    if (!commandPickerOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, commandPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    mentionListRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, mentionPickerOpen]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    editText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  /** /goal status, resume, stop: picked in the "/" menu or typed and sent.
   * Status shows the run's card, resume starts its goal again (there is no
   * pause path yet), stop interrupts the room as the Stop button does. */
  const runGoalSubcommand = (sub: GoalSubcommand): boolean => {
    if (!group || goalSubcommandBlock(sub, goalStatus) || !latestGoalRun) return false;
    if (sub === "status") {
      dispatch({ type: "focusMessage", threadId: group.threadId, messageId: latestGoalRun.messageId });
      editText("");
      setChannelMode("chat");
      return true;
    }
    if (sub === "stop") {
      dispatch({ type: "interruptGroup", groupId: group.id, threadId });
      editText("");
      setChannelMode("chat");
      return true;
    }
    if (sub === "resume") {
      const goal = latestGoalRun.run.goal;
      editText(goal);
      setChannelMode("goal");
      setCaret(goal.length);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(goal.length, goal.length);
      });
      return true;
    }
    return false;
  };

  /** /loop writes a routine for this chat. It never becomes a message the bot
   * has to interpret. Status opens the routine list. Stop turns one off. */
  const runLoopCommand = (command: LoopCommand) => {
    const loopBot = bot ?? (group && !group.dm ? (members ?? []).find((member) => !member.hidden) : undefined);
    if (command.kind === "incomplete") {
      dispatch({ type: "error", message: t("composer.loop.needCadence") });
      return;
    }
    if (!loopBot) {
      dispatch({ type: "error", message: t("composer.loop.needBot") });
      return;
    }
    if (command.kind === "status") {
      dispatch({ type: "showRoutines", section: "schedule", view: "list", botId: loopBot.id });
      editText("");
      return;
    }
    if (command.kind === "stop") {
      const mine = routines.filter((routine) => routine.botId === loopBot.id && routine.schedule.type === "interval" && routine.enabled !== false);
      const named = command.name.toLowerCase();
      const hits = named
        ? mine.filter((routine) => routine.name.toLowerCase().includes(named) || routine.prompt.toLowerCase().includes(named))
        : mine.filter((routine) => routine.name.startsWith("Loop "));
      if (hits.length === 0) {
        dispatch({ type: "error", message: t("composer.loop.none") });
        return;
      }
      for (const routine of hits) dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: false } });
      dispatch({ type: "error", message: t("composer.loop.stopped") });
      editText("");
      return;
    }
    dispatch({
      type: "createRoutine",
      input: {
        name: loopRoutineName(command.everyMinutes, command.prompt),
        prompt: command.prompt,
        botId: loopBot.id,
        ...(group ? { groupId: group.id } : {}),
        schedule: { type: "interval", everyMinutes: command.everyMinutes, anchorAt: Date.now() },
        postResults: true,
        continuity: true,
      },
    });
    if (command.raised) dispatch({ type: "error", message: t("composer.loop.raised") });
    else if (command.capped) dispatch({ type: "error", message: t("composer.loop.capped") });
    editText("");
  };

  const pickCommand = (item: ComposerMenuItem | undefined) => {
    if (!slash || !item) return;
    // What the chat cannot run stays listed, with its reason, but inserts nothing.
    if (item.kind === "engine" && item.unavailable) return;
    if (item.kind === "sagax" && item.command.unavailableReason) return;
    if (item.kind === "sagax" && item.command.id.startsWith("goal-")) {
      setDismissedSlashAt(slash.start);
      runGoalSubcommand(item.command.id.slice("goal-".length) as GoalSubcommand);
      return;
    }
    if (item.kind === "sagax" && item.command.id.startsWith("loop-")) {
      setDismissedSlashAt(slash.start);
      runLoopCommand(item.command.id === "loop-stop" ? { kind: "stop", name: "" } : { kind: "status" });
      return;
    }
    const command = item.kind === "sagax" ? item.command : null;
    const replacement = item.kind === "engine"
      ? engineCommandInsertion(item)
      : item.kind === "skill" ? skillCommandInsertion(item, text.slice(slash.end))
      : command?.id === "learn" ? "/learn " : command?.id === "setup" ? "/setup " : command?.id === "feedback" ? "/feedback " : command?.id === "loop" ? "/loop " : "";
    const next = replaceComposerSlashTrigger(text, slash, replacement);
    editText(next.text);
    setCaret(next.caret);
    setDismissedSlashAt(slash.start);
    setChannelMode(command?.id === "goal" ? "goal" : "chat");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return {
    highlight, setHighlight,
    groupSlash, slash, locale, commandViewerId, engineCommands, slashSkills,
    groupSlashOpen, groupSlashBotId, groupTargets, groupEngineCommands,
    supportsAgents, learnAvailable, browserTeach,
    teachChooser, setTeachChooser,
    myChromeOffered, myChromeRecord, setMyChromeRecord,
    myChromeTaught, setMyChromeTaught, myChromeBotId,
    showInBrowser, latestGoalRun, goalStatus,
    commandCandidates, commandPickerOpen,
    mention, orgPeople, roomPeople, mentionAll, candidates,
    mentionEveryoneCount, mentionPickerOpen,
    commandMotion, mentionMotion,
    pickMention, runGoalSubcommand, runLoopCommand, pickCommand,
  };
}
