import {
  engineCommandLabel,
  leadingMention,
  type GroupCommandMember,
  type GroupCommandResponder,
  type HarnessCommand,
  type HarnessCommandGroup,
  type HarnessCommandUnavailable,
} from "../../shared/harness-commands";
import type { GroupGoalRunStatus } from "../../shared/group-goal-run";
import { offersSkillCommand } from "../../shared/skill-command";
import { LOOP_SUBCOMMANDS, type LoopSubcommand } from "./composer-loop";

/** What /goal does besides starting one: typed after it (`/goal stop`). */
export const GOAL_SUBCOMMANDS = ["status", "pause", "resume", "stop"] as const;
export type GoalSubcommand = (typeof GOAL_SUBCOMMANDS)[number];

export type ComposerSlashCommandId = "goal" | `goal-${GoalSubcommand}` | "loop" | `loop-${LoopSubcommand}` | "learn" | "setup" | "feedback";

/** Sagax's own commands sit under two headings: the room's goal (/goal and
 * its subcommands, Objective) and the rest (Sagax). */
export type ComposerSagaxGroup = "goal" | "sagax";

export interface ComposerSlashCommand {
  id: ComposerSlashCommandId;
  /** `/goal`, `/goal status`, `/learn`… */
  label: string;
  description: string;
  /** What follows it, shown after the label (`<objective>`). */
  argumentHint?: string;
  /** Listed, dimmed, with this reason: nothing to act on, or not offered yet. */
  unavailableReason?: string;
}

/** The heading a Sagax command is listed under. */
export function sagaxCommandGroup(id: ComposerSlashCommandId): ComposerSagaxGroup {
  return id === "goal" || id.startsWith("goal-") ? "goal" : "sagax";
}

/** The typed `/goal status` (or pause, resume, stop), alone in the draft. */
export function goalSubcommandFromComposer(text: string): GoalSubcommand | null {
  const match = /^\/goal\s+(\w+)\s*$/i.exec(text);
  const word = match?.[1]?.toLowerCase();
  return word && (GOAL_SUBCOMMANDS as readonly string[]).includes(word) ? (word as GoalSubcommand) : null;
}

/** A bot's enabled skill as the skills listing names it (src/lib/use-slash-skills.ts). */
export interface SlashSkill {
  name: string;
  description: string;
}

export interface ComposerSlashTrigger {
  query: string;
  start: number;
  end: number;
}

/** Slash menu trigger at the caret: built-in commands only at the start of a
 * draft; skills can be named after a space later in the message. */
export function composerSlashTrigger(text: string, caretInput: number): ComposerSlashTrigger | null {
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  const prefix = text.slice(0, caret);
  // `/goal ` then the start of one of its subcommands keeps the menu open on
  // them; any other word is the goal itself and closes it. Built-ins stay at
  // the start of the draft only.
  const sub = /^\/goal[ \t]+(\w*)$/i.exec(prefix);
  const word = sub?.[1]?.toLowerCase();
  if (word !== undefined && GOAL_SUBCOMMANDS.some((name) => name.startsWith(word))) {
    return { query: `goal ${word}`, start: 0, end: caret };
  }
  const loop = /^\/loop[ \t]+(\w*)$/i.exec(prefix);
  const loopWord = loop?.[1]?.toLowerCase();
  if (loopWord !== undefined && LOOP_SUBCOMMANDS.some((name) => name.startsWith(loopWord))) {
    return { query: `loop ${loopWord}`, start: 0, end: caret };
  }
  // A slash after a space (or at the start) can open skills mid-message; a path
  // or link such as "a/b" or "https://x/" must not.
  const match = /(?:^|\s)\/([\w.:-]*)$/.exec(prefix);
  if (!match) return null;
  const query = match[1] ?? "";
  return { query, start: caret - query.length - 1, end: caret };
}

/** Why a goal subcommand cannot run now, given the room's latest goal run;
 * null when it can. There is no pause path yet (shared/group-goal-run.ts):
 * stop, then resume, starts it again. */
export type GoalSubcommandBlock = "noGoal" | "notRunning" | "alreadyRunning" | "completed" | "pauseUnsupported";

export function goalSubcommandBlock(sub: GoalSubcommand, status: GroupGoalRunStatus | undefined): GoalSubcommandBlock | null {
  if (sub === "pause") return "pauseUnsupported";
  if (!status) return "noGoal";
  if (sub === "status") return null;
  if (sub === "stop") return status === "working" ? null : "notRunning";
  if (status === "working") return "alreadyRunning";
  return status === "completed" ? "completed" : null;
}

/** A typed `/goal …` is equivalent to selecting Goal mode from the menu.
 * null means this is an ordinary chat message; an empty string means the
 * command is present but still needs a goal description or attachment. */
export function goalTextFromComposer(text: string): string | null {
  if (goalSubcommandFromComposer(text)) return null;
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trimStart() : null;
}

/** Replace the active slash token and return the caret position immediately
 * after the inserted text. */
export function replaceComposerSlashTrigger(
  text: string,
  trigger: ComposerSlashTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + replacement.length };
}

/** One row of the "/" menu: a Sagax command, one of the bot's enabled skills
 * (run for one turn by sending `/name`, shared/skill-command.ts), or one of
 * the engine's own (shared/harness-commands.ts), grouped Objective, Sagax,
 * Skills, Engine, Plugins, MCP. */
export type ComposerMenuItem =
  | { kind: "sagax"; key: string; group: ComposerSagaxGroup; label: string; description: string; command: ComposerSlashCommand }
  | { kind: "skill"; key: string; group: "skills"; label: string; description: string; skill: SlashSkill }
  | {
    kind: "engine";
    key: string;
    group: HarnessCommandGroup;
    label: string;
    description: string;
    argumentHint?: string;
    unavailable?: HarnessCommandUnavailable;
    command: HarnessCommand;
    /** In a group: the bot whose engine lists it (the menu groups by bot). */
    bot?: { id: string; name: string };
    /** In a group that names no single bot: the mention picking it adds. */
    mentionPrefix?: string;
  };

export const COMPOSER_MENU_GROUPS = ["goal", "sagax", "skills", "engine", "plugins", "mcp"] as const;
export type ComposerMenuGroup = (typeof COMPOSER_MENU_GROUPS)[number];
const MENU_LIMIT = 80;

function matchRank(query: string, names: readonly string[], description: string): number | null {
  if (!query) return 0;
  if (names.some((name) => name.startsWith(query))) return 0;
  // a plugin command by its short name (`using-px-flow` for `pulsatrix-flow:using-px-flow`)
  if (names.some((name) => name.split(":").pop()?.startsWith(query))) return 1;
  // One typed letter ("/p") is the start of a name: a name that merely
  // contains it, or a description that does, is not what was asked for.
  if (query.length >= 2 && names.some((name) => name.includes(query))) return 2;
  // Words of a description only as a fallback, after every name match, and
  // only from the start of a word of at least three letters typed. `goal s`
  // is a subcommand being typed.
  if (query.length >= 3 && !query.includes(" ") && descriptionWords(description).some((word) => word.startsWith(query))) return 3;
  return null;
}

function descriptionWords(description: string): string[] {
  return description.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The bot's enabled skills a `/name` can reach, as menu rows, by name. */
export function skillMenuItems(skills: readonly SlashSkill[]): Array<Extract<ComposerMenuItem, { kind: "skill" }>> {
  const seen = new Set<string>();
  return skills
    .filter((skill) => offersSkillCommand(skill.name) && !seen.has(skill.name) && Boolean(seen.add(skill.name)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ kind: "skill", key: `skill:${skill.name}`, group: "skills", label: `/${skill.name}`, description: skill.description, skill }));
}

/** The "/" menu for a query: Sagax's commands first (the goal's, then the
 * others), then the bot's skills, then the engine's by
 * group; within a group the closest names first, what the chat cannot run
 * last. An engine command a Sagax one shadows is offered as /engine:<name>;
 * one a skill shadows is left out, since `/name` runs the skill (the server
 * expands it before the engine sees the turn). */
export function composerCommandMenu(
  sagax: readonly ComposerSlashCommand[],
  engine: readonly HarnessCommand[],
  queryInput: string,
  skills: readonly SlashSkill[] = [],
): ComposerMenuItem[] {
  const query = queryInput.toLowerCase();
  const ranked: Array<{ item: ComposerMenuItem; rank: number; order: number }> = [];
  sagax.forEach((command, order) => {
    const rank = matchRank(query, [command.label.slice(1).toLowerCase(), command.id], command.description);
    if (rank !== null) ranked.push({ item: { kind: "sagax", key: `sagax:${command.id}`, group: sagaxCommandGroup(command.id), label: command.label, description: command.description, command }, rank, order });
  });
  const skillRows = skillMenuItems(skills);
  const skillNames = new Set(skillRows.map((item) => item.skill.name));
  skillRows.forEach((item, order) => {
    const rank = matchRank(query, [item.skill.name], item.description);
    if (rank !== null) ranked.push({ item, rank, order });
  });
  engine.forEach((command, order) => {
    if (skillNames.has(engineCommandLabel(command).slice(1))) return;
    const label = engineCommandLabel(command);
    const names = [label.slice(1).toLowerCase(), command.name.toLowerCase(), ...(command.aliases ?? []).map((alias) => alias.toLowerCase())];
    const rank = matchRank(query, names, command.description);
    if (rank === null) return;
    ranked.push({
      item: {
        kind: "engine",
        key: `engine:${command.name}`,
        group: command.group,
        label,
        description: command.description,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        ...(command.unavailable ? { unavailable: command.unavailable } : {}),
        command,
      },
      rank: rank + (command.unavailable ? 10 : 0),
      order,
    });
  });
  const groupIndex = (group: ComposerMenuGroup) => COMPOSER_MENU_GROUPS.indexOf(group);
  ranked.sort((a, b) => groupIndex(a.item.group) - groupIndex(b.item.group) || a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, MENU_LIMIT).map((entry) => entry.item);
}

/** What picking an engine command puts in the draft: its label and a space
 * for its arguments, after the bot's mention when the group needs one. */
export function engineCommandInsertion(item: Extract<ComposerMenuItem, { kind: "engine" }>): string {
  return `${item.mentionPrefix ?? ""}${item.label} `;
}

// ── groups ───────────────────────────────────────────────────────────────

/** The "/" being typed in a group: at the very start, or right after a
 * leading `@Bot ` (that bot's engine commands only). */
export interface ComposerGroupSlash {
  trigger: ComposerSlashTrigger;
  /** The bot the draft starts by mentioning. */
  botId?: string;
}

export function composerGroupSlashTrigger(
  text: string,
  caretInput: number,
  members: readonly GroupCommandMember[],
): ComposerGroupSlash | null {
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  // A leading @Bot /command names that bot's engine commands. Check it before
  // the plain mid-message skill trigger, which would otherwise swallow the slash.
  const mention = leadingMention(text, members);
  if (mention && mention.rest <= caret && /\s/u.test(text[mention.rest - 1] ?? "")) {
    const match = /^\/([\w.:-]*)$/.exec(text.slice(mention.rest, caret));
    if (match) return { trigger: { query: match[1] ?? "", start: mention.rest, end: caret }, botId: mention.member.id };
  }
  const plain = composerSlashTrigger(text, caretInput);
  // Room built-ins and engine commands stay at the absolute start. Mid-message
  // skill picks are a 1:1 concern (composerSlashTrigger); rooms do not open them.
  if (plain && plain.start === 0) return { trigger: plain };
  return null;
}

/** Whose engine commands a group's "/" menu lists: the mentioned bot, else
 * the lead when it answers alone, else every active member, each picked
 * command then starting with that bot's mention so it reaches it only. */
export function groupCommandTargets<T extends GroupCommandMember>(
  slash: Pick<ComposerGroupSlash, "botId">,
  members: readonly T[],
  defaultResponder: GroupCommandResponder,
): Array<{ bot: T; mention: boolean }> {
  const available = members.filter((member) => !member.hidden);
  if (slash.botId) {
    const bot = available.find((member) => member.id === slash.botId);
    return bot ? [{ bot, mention: false }] : [];
  }
  if (defaultResponder.kind === "member") {
    const lead = available.find((member) => member.id === defaultResponder.botId);
    if (lead) return [{ bot: lead, mention: false }];
  }
  return available.map((bot) => ({ bot, mention: true }));
}

export interface GroupEngineCommands {
  bot: { id: string; name: string };
  commands: readonly HarnessCommand[];
  /** Picking one adds `@Name ` in front. */
  mention: boolean;
}

/** The fewest rows a bot keeps in a group's "/" menu, however many bots. */
const GROUP_MENU_MIN_PER_BOT = 8;

/** How many of its engine commands each bot shows in a group's "/" menu:
 * the menu's room shared evenly, so a bot listing many commands never
 * crowds out the bots after it. */
export function groupMenuLimitPerBot(bots: number): number {
  if (bots <= 0) return 0;
  return Math.max(GROUP_MENU_MIN_PER_BOT, Math.floor(MENU_LIMIT / bots));
}

/** A group's "/" menu: Sagax's commands, then each bot's engine commands
 * under that bot's name, ranked as in a 1:1 and capped per bot. */
export function composerGroupCommandMenu(
  sagax: readonly ComposerSlashCommand[],
  sets: readonly GroupEngineCommands[],
  query: string,
): ComposerMenuItem[] {
  const items: ComposerMenuItem[] = composerCommandMenu(sagax, [], query);
  const perBot = groupMenuLimitPerBot(sets.length);
  for (const set of sets) {
    let shown = 0;
    for (const item of composerCommandMenu([], set.commands, query)) {
      if (shown >= perBot) break;
      if (item.kind !== "engine") continue;
      items.push({
        ...item,
        key: `bot:${set.bot.id}:${item.key}`,
        bot: set.bot,
        ...(set.mention ? { mentionPrefix: `@${set.bot.name} ` } : {}),
      });
      shown += 1;
    }
  }
  return items;
}

/** What picking a skill row puts in the draft: `/name` and a trailing space only
 * when the text after the token does not already start with whitespace. */
export function skillCommandInsertion(
  item: Extract<ComposerMenuItem, { kind: "skill" }>,
  textAfterTrigger = "",
): string {
  const spaceAfter = /^\s/.test(textAfterTrigger) ? "" : " ";
  return `${item.label}${spaceAfter}`;
}

/** The heading a menu row starts under: its bot in a group, else its group. */
export function composerMenuSection(item: ComposerMenuItem): string {
  return item.kind === "engine" && item.bot ? `bot:${item.bot.id}` : item.group;
}
