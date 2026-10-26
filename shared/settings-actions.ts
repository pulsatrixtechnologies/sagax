// The settings a bot can read and change for the person speaking to it
// (sagax_settings, JC 2026-10-19: "Tout doit être modifiable via les bots").
//
// One entry per setting of the app: where it is on screen, the route the
// screen calls and how its value is read back. A change is the same route
// the screen calls, replayed with the person's own session by the act engine
// (server/bot-act.ts), so the person's rights and every route check apply
// as they do by hand. shared/settings-actions-policy.ts decides whether it
// runs now or waits on a card; server/settings-actions.ts ties both.
//
// docs/settings-actions.md is the human inventory of this table (with the
// Perspicax console part, which lives in Perspicax): keep them together.
// shared/settings-actions.test.ts fails when an entry has no doc row.

import type { SettingClass } from "./settings-actions-policy.ts";

/** `self`: the change targets the bot that is speaking. */
export type SettingClassContext = { organization: boolean; self?: boolean };

export const SETTING_FAMILIES = [
  "bot", "thread", "routine", "group", "section", "rules", "account", "appearance",
  "notifications", "models", "connections", "credentials", "server", "organization", "computer",
] as const;
export type SettingFamily = (typeof SETTING_FAMILIES)[number];

/** What a setting belongs to: the id `target` names (bot, thread, routine,
 * group, a team name for a section, a rule id), the speaker (self), or
 * nothing. */
export type SettingTarget = "bot" | "thread" | "routine" | "group" | "section" | "rule" | "credential" | "self" | "none";

/** `enum:a|b|c`, `string` (short), `text` (long), `boolean`, `number`,
 * `object`, `array`, `string?` (a string or null), `any`. */
export type SettingValue = string;

export type SettingRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

/** The ids a change resolved: the bot of a thread or routine included. */
export type SettingIds = { target?: string; botId?: string };

export type SettingRead = {
  path: string;
  query?: Record<string, string>;
  /** The list in the answer the item sits in (`bots`, `routines`, ...), or
   * none when the answer is the item. */
  list?: string;
  /** The item's id field in that list. */
  match?: string;
  /** The value inside the item (dot path); none: the whole item. */
  field?: string;
};

export interface SettingSpec {
  key: string;
  family: SettingFamily;
  target: SettingTarget;
  label: string;
  /** Where a person finds it, English (docs/settings-actions.md has French). */
  where: string;
  value: SettingValue;
  read?: (ids: SettingIds) => SettingRead;
  /** The route the screen calls, or the screen command for a preference
   * kept on the person's device. A string is a refusal to relay. */
  write: (ids: SettingIds, value: unknown) => SettingRoute | { ui: string; input: Record<string, unknown> } | string;
  /** What makes the change more than a simple application. Default: own. */
  classes?: (value: unknown, ctx: SettingClassContext) => SettingClass[];
  /** The approval level a change sets, for "up to the bot's own level". */
  approvalTo?: (value: unknown) => string | undefined;
}

const always = (...classes: SettingClass[]) => () => classes;
/** A server setting: the person's own on a personal server; the
 * organization's (other people) on an organization server. */
const serverWide = (_value: unknown, ctx: SettingClassContext): SettingClass[] => ctx.organization ? ["org"] : ["own"];
/** What widens the reach of the speaking bot itself (its tools, apps,
 * teammates): the person's Allow, so content read during the turn cannot
 * widen the bot that read it. Another bot of the owner's: simple. */
const selfReach = (_value: unknown, ctx: SettingClassContext): SettingClass[] => ctx.self ? ["rule-change"] : ["own"];
const SECRETISH = /key|token|secret|password|url/i;
/** A field named like a credential or an address the server connects to. */
function carriesSecret(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 6) return false;
  return Object.entries(value as Record<string, unknown>).some(([name, child]) => SECRETISH.test(name) || carriesSecret(child, depth + 1));
}
const secretWhenKeyed = (value: unknown, ctx: SettingClassContext): SettingClass[] => carriesSecret(value) ? (ctx.organization ? ["secret", "org"] : ["secret"]) : serverWide(value, ctx);

/** One path segment: a plain id as it is (a grant's `user:pr_…` keeps its
 * colon), anything else encoded, which act's path check then refuses. */
const enc = (value: string): string => /^[\w.:@+-]+$/.test(value) ? value : encodeURIComponent(value);

function nest(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".");
  let out: unknown = value;
  for (const part of parts.reverse()) out = { [part]: out };
  return out as Record<string, unknown>;
}

const SPECS: SettingSpec[] = [];
const add = (spec: SettingSpec) => SPECS.push(spec);

// ── bot (PATCH /api/bots/:id, bot editor) ─────────────────────────────
const botRead = (field?: string) => (): SettingRead => ({ path: "/api/bots", query: { messages: "0" }, list: "bots", match: "id", ...(field ? { field } : {}) });
function botField(key: string, field: string, value: SettingValue, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family: "bot", target: "bot", label, where, value,
    read: botRead(field),
    write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.target!)}`, body: { [field]: v } }),
    ...(classes ? { classes } : {}),
  });
}
botField("bot.name", "name", "string", "Name", "Bot editor > Identity");
botField("bot.title", "title", "string", "Title", "Bot editor > Identity");
botField("bot.description", "description", "text", "Description", "Bot editor > Identity");
botField("bot.persona", "soul", "text", "Persona and instructions", "Bot editor > Persona");
botField("bot.avatar", "avatarUrl", "string?", "Avatar picture", "Bot editor > Identity > Avatar");
botField("bot.color", "color", "string", "Color", "Bot editor > Look");
botField("bot.skin", "mascotSkin", "string", "Mascot skin", "Bot editor > Look");
botField("bot.mascot", "mascotLook", "object", "Mascot look", "Bot editor > Look");
botField("bot.mascotBody", "mascotBody", "string", "Mascot body", "Bot editor > Look");
botField("bot.mascotExpression", "mascotExpression", "string", "Mascot expression", "Bot editor > Look");
botField("bot.voice", "voice", "string?", "Voice", "Bot editor > Voice");
botField("bot.speakReplies", "speakReplies", "boolean", "Speak replies", "Bot editor > Voice");
botField("bot.voiceNotes", "voiceNotes", "boolean", "Voice notes", "Bot editor > Voice");
botField("bot.emailDrafts", "emailDrafts", "boolean", "Email drafts", "Bot editor > Permissions > Email drafts");
botField("bot.notifications", "notifications", "any", "Notifications", "Bot editor > Voice > Notifications");
botField("bot.model", "modelSelection", "object", "Model and effort ({instanceId, model, effort})", "Bot editor > Model");
add({
  key: "bot.effort", family: "bot", target: "bot", value: "string", label: "Reasoning effort (low, medium, high, ...; keeps the model)", where: "Bot editor > Model > Effort",
  read: botRead("modelSelection.effort"),
  // the handler merges it into the bot's current model (server/settings-actions.ts)
  write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.target!)}`, body: { modelSelection: { effort: v } } }),
});
botField("bot.fallback", "fallback", "array", "Fallback models", "Bot editor > Model > Fallback");
// widening the bots a bot reaches carries the screen's own acknowledgement
function botReach(key: string, field: string, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family: "bot", target: "bot", label, where, value: "array",
    ...(classes ? { classes } : {}),
    read: botRead(field),
    write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.target!)}`, body: { [field]: v, acknowledgePeerScope: true } }),
  });
}
botReach("bot.managedSections", "managedSections", "Teams the Primary Bot manages (e.g. Built-in)", "Bot editor > Permissions > Managed teams");
botField("bot.approvePeerComms", "approvePeerComms", "boolean", "Ask before talking to other bots", "Bot editor > Permissions", (v, ctx) => v === false ? selfReach(v, ctx) : ["own"]);
botField("bot.outbound", "outbound", "object", "Send on your behalf ({policy: ask|allow, dailyCap})", "Bot editor > Permissions",
  (value) => (value as { policy?: unknown } | null)?.policy === "allow" ? ["rule-change"] : ["own"]);
botReach("bot.peers", "peers", "Teammates it may reach", "Bot editor > Team", selfReach);
botField("bot.visibility", "visibility", "any", "Who sees the bot (everyone, admins, {people})", "Bot editor > Visibility",
  (v, ctx) => v === "admins" || !ctx.organization ? ["own"] : ["others"]);
botField("bot.section", "section", "string?", "Team (sidebar section)", "Sidebar, drag the bot; New bot > Team");
botField("bot.pinned", "pinned", "boolean", "Pinned in the sidebar", "Sidebar > bot menu > Pin");
botField("bot.hidden", "hidden", "boolean", "Archived (hidden)", "Bot editor > ... > Archive");
botField("bot.memoryEnabled", "memoryEnabled", "boolean", "Memory on", "Bot editor > Memory");
botField("bot.memoryUpkeep", "memoryUpkeep", "any", "Memory upkeep", "Bot editor > Memory");
// widening who gets this bot's team-memory cards (back to "shared") reaches
// other people: a card at every level; narrowing to "private" runs as simple
botField("bot.teamMemorySharing", "teamMemorySharing", "enum:shared|private", "Team memory sharing (shared, private)", "Bot editor > Memory > Team memory",
  (v) => v === "private" ? ["own"] : ["others"]);
botField("bot.browser", "browser", "boolean", "Browser", "Bot editor > Access > Browser");
botField("bot.browserProfile", "browserProfile", "string?", "Browser profile", "Bot editor > Access > Browser");
botField("bot.computer", "computer", "enum:auto|off", "Works on (Auto or Off)", "Bot editor > Workspace");
botField("bot.cloudBackend", "cloudBackend", "enum:box|vps", "Cloud computer kind", "Bot editor > Access");
botField("bot.cwd", "cwd", "string?", "Working folder", "Bot editor > Access > Folder");
botField("bot.mcpServers", "mcpServers", "array", "MCP servers it may use (null: all)", "Bot editor > Access > Tools", selfReach);
botField("bot.toolScope", "toolScope", "any", "Tool selection", "Bot editor > Access > Tool selection", selfReach);
botField("bot.parkDirectMessages", "parkDirectMessages", "boolean", "Park direct messages while busy", "Bot editor > Behaviour");
botField("bot.alwaysAllow", "alwaysAllow", "array", "Always allowed tools", "Bot editor > Access > Always allowed", always("rule-change"));
// 2026-10-21 (parité 1C): people and bots it writes to without a card
// (shared/allowed-recipients.ts): bot:<id>, email:<address>, phone:+<digits>
botField("bot.allowedRecipients", "allowedRecipients", "array", "Allowed recipients (no card: bot:<id>, email:<address>, phone:+<digits>)", "Bot editor > Permissions > Allowed recipients", always("rule-change"));
add({
  key: "bot.approvalMode", family: "bot", target: "bot", value: "enum:ask|edits|auto|full",
  label: "Approval level (ask, edits, auto = Approve for me, full)", where: "Bot editor > Permissions > Approval level",
  read: botRead("approvalMode"),
  write: (ids, v) => v === "full"
    ? { method: "PATCH", path: `/api/bots/${enc(ids.target!)}`, body: { approvalMode: "full", confirmFullAccess: true } }
    : { method: "PATCH", path: `/api/bots/${enc(ids.target!)}`, body: { approvalMode: v } },
  classes: always("rule-change"),
  approvalTo: (v) => String(v),
});
add({
  key: "bot.permissionMode", family: "bot", target: "bot", value: "enum:approval|auto|bypass",
  label: "Owner permission mode", where: "Bot editor > Permissions > Owner permissions",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/permission-mode`, field: "mode" }),
  write: (ids, v) => ({ method: "PUT", path: `/api/bots/${enc(ids.target!)}/permission-mode`, body: v === "bypass" ? { mode: v, confirmBypass: true } : { mode: v } }),
  classes: always("rule-change"),
  approvalTo: (v) => (v === "approval" ? "ask" : v === "bypass" ? "full" : String(v)),
});
add({
  key: "bot.primary", family: "bot", target: "bot", value: "boolean", label: "Primary Bot", where: "Bot editor > Permissions > Primary Bot",
  read: botRead("chiefOfStaff"),
  write: (ids, v) => ({ method: v === true ? "POST" : "DELETE", path: `/api/bots/${enc(ids.target!)}/primary` }),
});
add({
  key: "bot.runtime", family: "bot", target: "bot", value: "object",
  label: "Parallel work and recovery ({maxConcurrentThreads, maxParallelPerPerson, busySend, automaticRecovery})", where: "Bot editor > Behaviour > Parallel tasks",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/runtime-settings` }),
  write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.target!)}/runtime-settings`, body: v }),
});
add({
  key: "bot.memory", family: "bot", target: "bot", value: "text", label: "Memory text", where: "Bot editor > Memory",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/memory` }),
  write: (ids, v) => ({ method: "PUT", path: `/api/bots/${enc(ids.target!)}/memory`, body: { text: v } }),
});
add({
  key: "bot.perspicaxProfiles", family: "bot", target: "bot", value: "array", label: "Perspicax tools (profiles)", where: "Bot editor > Perspicax", classes: selfReach,
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/perspicax` }),
  write: (ids, v) => ({ method: "PUT", path: `/api/bots/${enc(ids.target!)}/perspicax`, body: { profiles: v } }),
});
add({
  key: "bot.skill", family: "bot", target: "bot", value: "object", label: "A skill on or off ({name, enabled})", where: "Bot editor > Skills",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/skills` }),
  write: (ids, v) => {
    const skill = v as { name?: unknown; enabled?: unknown } | null;
    if (!skill || typeof skill.name !== "string" || typeof skill.enabled !== "boolean") return "value is {name, enabled}.";
    return { method: "PATCH", path: `/api/bots/${enc(ids.target!)}/skills/${enc(skill.name)}`, body: { enabled: skill.enabled } };
  },
});
add({
  key: "bot.share", family: "bot", target: "bot", value: "object", label: "Share with a person or team ({target: user:<id>|team:<name>, level}, level null removes)", where: "Bot editor > Visibility > Sharing",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/grants` }),
  write: (ids, v) => {
    const grant = v as { target?: unknown; level?: unknown } | null;
    if (!grant || typeof grant.target !== "string") return "value is {target, level}.";
    return grant.level === null
      ? { method: "DELETE", path: `/api/bots/${enc(ids.target!)}/grants/${enc(grant.target)}` }
      : { method: "PUT", path: `/api/bots/${enc(ids.target!)}/grants`, body: { target: grant.target, level: grant.level } };
  },
  classes: always("others"),
});
add({
  key: "bot.toolGrant", family: "bot", target: "bot", value: "object", label: "Tool access grant ({scope: area:read|write|admin, expiresAt})", where: "Bot editor > Tool access",
  write: (ids, v) => ({ method: "POST", path: `/api/bots/${enc(ids.target!)}/tool-grants`, body: v }),
  classes: always("rule-change"),
});
add({
  key: "bot.delete", family: "bot", target: "bot", value: "boolean", label: "Delete the bot (true)", where: "Bot editor > ... > Delete",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/bots/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete"),
});

// ── bot templates behind a public link (routes/template-links.ts) ──────
// "Make a public template of yourself": the bot first sets the New bot
// defaults (server.newBotDefaults) from its own persona when asked, then
// shares or updates the template. A public link reaches other people: card.
const templateLinkId = (value: unknown): string | null => {
  const id = typeof value === "string" ? value : value && typeof value === "object" ? (value as { id?: unknown }).id : undefined;
  return typeof id === "string" && /^[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
};
const templateBody = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const field of ["name", "description"] as const) {
      const text = (value as Record<string, unknown>)[field];
      if (typeof text === "string" && text.trim()) out[field] = text.trim();
    }
  }
  return out;
};
add({
  key: "template.share", family: "bot", target: "none", value: "object", label: "Share the New bot defaults as a public template link ({name?, description?}); get lists your links", where: "New bot > Share preset > Share the link",
  read: () => ({ path: "/api/template-links", field: "links" }),
  write: (_ids, v) => ({ method: "POST", path: "/api/template-links", body: templateBody(v) }),
  classes: always("others"),
});
add({
  key: "template.update", family: "bot", target: "none", value: "object", label: "Update a shared template under the same link ({id, name?, description?})", where: "New bot > Share preset > Share the link > Update the template",
  write: (_ids, v) => {
    const id = templateLinkId(v);
    return id ? { method: "PUT", path: `/api/template-links/${id}`, body: templateBody(v) } : "value is {id, name?, description?} with the id of one of your links (get template.share).";
  },
  classes: always("others"),
});
add({
  key: "template.remove", family: "bot", target: "none", value: "string", label: "Delete a shared template and turn its link off (its id)", where: "New bot > Share preset > Share the link > Turn off",
  write: (_ids, v) => {
    const id = templateLinkId(v);
    return id ? { method: "DELETE", path: `/api/template-links/${id}` } : "value is the id of one of your links (get template.share).";
  },
  classes: always("delete"),
});

// ── thread (PATCH /api/bots/:id/tasks/:threadId) ──────────────────────
function threadField(key: string, field: string, value: SettingValue, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family: "thread", target: "thread", label, where, value,
    read: (ids) => ({ path: "/api/bots", query: { messages: "0" }, list: "bots", match: "id", field: `tasks[threadId=${ids.target}].${field}` }),
    write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.botId!)}/tasks/${enc(ids.target!)}`, body: { [field]: v } }),
    ...(classes ? { classes } : {}),
  });
}
threadField("thread.title", "title", "string", "Title", "Thread menu > Rename");
threadField("thread.pinned", "pinned", "boolean", "Pinned", "Thread list > Pin");
threadField("thread.archived", "archivedAt", "number?", "Archived (a time, null to restore)", "Thread list > Archive");
threadField("thread.snoozedUntil", "snoozedUntil", "number?", "Snoozed until", "Thread list > Snooze");
threadField("thread.model", "modelSelection", "object", "Model and effort of this conversation", "Composer > model picker");
threadField("thread.project", "projectId", "string?", "Project", "Thread menu > Move to project");
threadField("thread.confidential", "confidential", "boolean", "Confidential (one way)", "Thread menu > Confidential");
add({
  key: "thread.approvalMode", family: "thread", target: "thread", value: "enum:ask|edits|auto|full",
  label: "Approval level of this conversation", where: "Composer > approval level",
  read: (ids) => ({ path: "/api/bots", query: { messages: "0" }, list: "bots", match: "id", field: `tasks[threadId=${ids.target}].approvalMode` }),
  write: (ids, v) => ({ method: "PATCH", path: `/api/bots/${enc(ids.botId!)}/tasks/${enc(ids.target!)}`, body: v === "full" ? { approvalMode: v, confirmFullAccess: true } : { approvalMode: v } }),
  classes: always("rule-change"),
  approvalTo: (v) => String(v),
});
add({
  key: "thread.delete", family: "thread", target: "thread", value: "boolean", label: "Delete the conversation (true)", where: "Thread menu > Delete",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/bots/${enc(ids.botId!)}/tasks/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete"),
});

// ── routine (PATCH /api/routines/:id, Automations) ────────────────────
function routineField(key: string, field: string, value: SettingValue, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family: "routine", target: "routine", label, where, value,
    read: () => ({ path: "/api/routines", list: "routines", match: "id", field }),
    write: (ids, v) => ({ method: "PATCH", path: `/api/routines/${enc(ids.target!)}`, body: { [field]: v } }),
    ...(classes ? { classes } : {}),
  });
}
routineField("routine.name", "name", "string", "Name", "Automations > routine");
routineField("routine.prompt", "prompt", "text", "Instructions", "Automations > routine");
routineField("routine.schedule", "schedule", "object", "Schedule ({type: once|daily|cron|interval, ...})", "Automations > routine > Schedule");
routineField("routine.enabled", "enabled", "boolean", "On or off", "Bot panel > Details > Routines; Automations");
routineField("routine.thread", "resultsThreadId", "string?", "Conversation its results go to (null: the bot's main one)", "Automations > routine > Results");
routineField("routine.engine", "runOn", "enum:maus|cloud", "Where it runs", "Automations > routine > Runs on");
routineField("routine.bot", "botId", "string", "Bot that runs it", "Automations > routine > Bot");
routineField("routine.room", "groupId", "string?", "Room of a room routine", "Automations > routine > Target");
routineField("routine.timeoutMinutes", "timeoutMinutes", "number?", "Time limit", "Automations > routine > Advanced");
routineField("routine.overlap", "overlap", "enum:skip|queue", "When a run is still going", "Automations > routine > Advanced");
routineField("routine.onlyWhenPresent", "onlyWhenPresent", "boolean", "Only when present", "Automations > routine > Advanced");
routineField("routine.runAs", "runAs", "string", "Runs as (a person)", "Automations > routine > Runs as", always("others"));
add({
  key: "routine.create", family: "routine", target: "none", value: "object",
  label: "New routine ({name, prompt, botId, schedule, ...})", where: "Automations > New routine",
  write: (_ids, v) => ({ method: "POST", path: "/api/routines", body: v }),
  classes: (v) => (v as { runAs?: unknown } | null)?.runAs !== undefined ? ["others"] : ["own"],
});
add({
  key: "routine.run", family: "routine", target: "routine", value: "boolean", label: "Run now (true)", where: "Automations > routine > Run now",
  write: (ids, v) => v === true ? { method: "POST", path: `/api/routines/${enc(ids.target!)}/run` } : "value is true.",
});
add({
  key: "routine.delete", family: "routine", target: "routine", value: "boolean", label: "Delete the routine (true)", where: "Bot panel > Details > Routines > Delete",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/routines/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete"),
});

// ── group (rooms and people conversations, PATCH /api/groups/:id) ─────
function groupField(key: string, field: string, value: SettingValue, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family: "group", target: "group", label, where, value,
    read: () => ({ path: "/api/groups", list: "groups", match: "id", field }),
    write: (ids, v) => ({ method: "PATCH", path: `/api/groups/${enc(ids.target!)}`, body: { [field]: v } }),
    ...(classes ? { classes } : {}),
  });
}
groupField("group.name", "name", "string", "Name", "Group panel");
groupField("group.bulletin", "bulletin", "text", "Bulletin", "Group panel > Bulletin");
groupField("group.bots", "memberIds", "array", "Bots in the group", "Group panel > Members");
groupField("group.people", "humanIds", "array", "People in the group", "Group panel > People", always("others"));
groupField("group.section", "section", "string?", "Team (sidebar section)", "Sidebar, drag the group");
groupField("group.pinned", "pinned", "boolean", "Pinned", "Sidebar > group menu > Pin");
groupField("group.turnTimeout", "turnTimeoutMinutes", "number?", "Turn limit", "Group panel > Turn limit");
groupField("group.defaultResponder", "defaultResponder", "string?", "Default responder", "Group panel");
groupField("group.mentionAll", "mentionAll", "boolean", "@all reaches every bot", "Group panel");
groupField("group.cwd", "cwd", "string?", "Working folder", "Group panel > Folder");
add({
  key: "group.memory", family: "group", target: "group", value: "object", label: "Group memory ({text?, enabled?})", where: "Group panel > Memory",
  read: (ids) => ({ path: `/api/groups/${enc(ids.target!)}/memory` }),
  write: (ids, v) => ({ method: "PUT", path: `/api/groups/${enc(ids.target!)}/memory`, body: v }),
});
add({
  key: "group.create", family: "group", target: "none", value: "object", label: "New group ({memberIds, name, section})", where: "Sidebar > New group",
  write: (_ids, v) => ({ method: "POST", path: "/api/groups", body: v }),
  classes: (v) => Array.isArray((v as { humanIds?: unknown } | null)?.humanIds) && ((v as { humanIds: unknown[] }).humanIds.length > 0) ? ["others"] : ["own"],
});
add({
  key: "group.delete", family: "group", target: "group", value: "boolean", label: "Delete the group (true)", where: "Group panel > Delete",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/groups/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete"),
});

// ── section (sidebar teams; target is the team's name) ────────────────
add({
  key: "section.create", family: "section", target: "none", value: "object", label: "New team ({name, botIds})", where: "Sidebar > New team",
  write: (_ids, v) => ({ method: "POST", path: "/api/sidebar-sections", body: v }), classes: serverWide,
});
add({
  key: "section.name", family: "section", target: "section", value: "string", label: "Rename a team", where: "Sidebar > team menu > Rename",
  write: (ids, v) => ({ method: "PATCH", path: "/api/sidebar-sections", query: { section: ids.target! }, body: { name: v } }), classes: serverWide,
});
add({
  key: "section.bots", family: "section", target: "section", value: "object", label: "Bots in a team ({addBotIds, removeBotIds})", where: "Sidebar > team",
  write: (ids, v) => ({ method: "PUT", path: "/api/sidebar-sections", query: { section: ids.target! }, body: v }), classes: serverWide,
});
add({
  key: "section.delete", family: "section", target: "section", value: "boolean", label: "Delete a team (true)", where: "Sidebar > team menu > Delete",
  write: (ids, v) => v === true ? { method: "DELETE", path: "/api/sidebar-sections", query: { section: ids.target! } } : "value is true.",
  classes: always("delete"),
});

// ── rules (the person's approval rules) ───────────────────────────────
add({
  key: "rules.custom", family: "rules", target: "none", value: "object",
  label: "Add a rule in your words ({when, behavior: allow|ask|deny, botId?, riskScope?})", where: "Bot editor > Permissions > Custom rules",
  read: () => ({ path: "/api/custom-rules" }),
  write: (_ids, v) => ({ method: "POST", path: "/api/custom-rules", body: v }),
  // only a deny or ask rule spelled out is a simple change: a sentence
  // ("toujours permettre ...") or a rule from a card may read as allow
  classes: (v) => {
    const rule = v as Record<string, unknown> | null;
    const tightens = rule && (rule.behavior === "ask" || rule.behavior === "deny") && Object.keys(rule).every((name) => ["when", "behavior", "botId"].includes(name));
    return tightens ? ["own"] : ["rule-change"];
  },
});
add({
  key: "rules.customUpdate", family: "rules", target: "rule", value: "object", label: "Change a custom rule ({when?, behavior?, enabled?, riskScope?})", where: "Bot editor > Permissions > Custom rules",
  write: (ids, v) => ({ method: "PATCH", path: `/api/custom-rules/${enc(ids.target!)}`, body: v }),
  classes: always("rule-change"),
});
add({
  key: "rules.customDelete", family: "rules", target: "rule", value: "boolean", label: "Delete a custom rule (true)", where: "Bot editor > Permissions > Custom rules",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/custom-rules/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete", "rule-change"),
});
add({
  key: "rules.owner", family: "rules", target: "rule", value: "object", label: "Change an owner rule ({behavior, botId?})", where: "Bot editor > Permissions > Owner permissions",
  read: () => ({ path: "/api/approval-rules" }),
  write: (ids, v) => ({ method: "PATCH", path: `/api/approval-rules/${enc(ids.target!)}`, body: v }),
  classes: always("rule-change"),
});
add({
  key: "rules.ownerDelete", family: "rules", target: "rule", value: "boolean", label: "Delete an owner rule (true)", where: "Settings > Approvals > My rules",
  write: (ids, v) => v === true ? { method: "DELETE", path: `/api/approval-rules/${enc(ids.target!)}` } : "value is true.",
  classes: always("delete", "rule-change"),
});
add({
  key: "rules.commandAllow", family: "rules", target: "bot", value: "object", label: "Allow an exact command ({command, cwd, providerInstanceId})", where: "Bot editor > Access > Saved commands",
  write: (ids, v) => ({ method: "POST", path: `/api/bots/${enc(ids.target!)}/command-allowlist`, body: v }),
  classes: always("rule-change"),
});

// ── account (the person) ───────────────────────────────────────────────
add({
  key: "account.label", family: "account", target: "self", value: "string", label: "How people see your name", where: "Settings > General > Account",
  write: (ids, v) => ({ method: "PUT", path: `/api/people/${enc(ids.target!)}/label`, body: { label: v } }),
});
add({
  key: "account.avatar", family: "account", target: "none", value: "string?", label: "Your photo (a data URL, null removes)", where: "Settings > General > Account",
  write: (_ids, v) => v === null ? { method: "DELETE", path: "/api/me/avatar" } : { method: "PUT", path: "/api/me/avatar", body: { avatarUrl: v } },
});
add({
  key: "account.aboutMe", family: "account", target: "none", value: "text", label: "About me", where: "Settings > General > About me",
  // the server's profile: on an organization server it is the operator's
  classes: serverWide,
  read: () => ({ path: "/api/config", field: "profile.aboutMe" }),
  write: (_ids, v) => ({ method: "PUT", path: "/api/config", body: { profile: { aboutMe: v } } }),
});
add({
  key: "account.botOverride", family: "account", target: "bot", value: "object", label: "Your own model and notifications for a shared bot", where: "Shared bot > Model / Notifications",
  write: (ids, v) => ({ method: "PUT", path: `/api/me/bot-overrides/${enc(ids.target!)}`, body: v }),
});
add({
  key: "account.timeZone", family: "account", target: "none", value: "string", label: "Your time zone (an IANA zone such as America/Toronto; turns automatic detection off)", where: "Settings > General > Appearance > Time zone",
  read: () => ({ path: "/api/settings/bot", field: "settings.timeZone" }),
  write: (_ids, v) => ({ method: "PUT", path: "/api/settings/bot", body: { timeZone: v, timeZoneAuto: false } }),
});
add({
  key: "account.timeZoneAuto", family: "account", target: "none", value: "boolean", label: "Detect your time zone automatically (the app then follows this computer's zone)", where: "Settings > General > Appearance > Time zone",
  read: () => ({ path: "/api/settings/bot", field: "settings.timeZoneAuto" }),
  write: (_ids, v) => ({ method: "PUT", path: "/api/settings/bot", body: { timeZoneAuto: v } }),
});

// ── preferences kept on the person's device (and per person on an
// organization server): the screen command writes them in the app ─────
function pref(key: string, family: SettingFamily, storage: string, value: SettingValue, label: string, where: string, classes?: SettingSpec["classes"]): void {
  add({
    key, family, target: "none", label, where, value,
    ...(classes ? { classes } : {}),
    write: (_ids, v) => ({ ui: "setPreference", input: { key: storage, value: typeof v === "string" ? v : JSON.stringify(v) } }),
  });
}
pref("appearance.skin", "appearance", "omb-skin", "string", "Skin", "Settings > Appearance > Skin");
pref("appearance.mode", "appearance", "omb-skin-mode", "enum:light|dark|auto", "Light, dark or auto", "Settings > Appearance > Skin");
pref("appearance.font", "appearance", "omb-font", "string", "Font", "Settings > Appearance");
pref("appearance.language", "appearance", "omb-language", "string", "Language (fr, en; empty follows the system)", "Settings > General > Appearance");
pref("appearance.interfaceMode", "appearance", "sagax.interfaceMode.v1", "enum:simple|advanced", "Simple or Advanced", "Settings > Appearance");
pref("appearance.showThreads", "appearance", "omb-show-threads", "boolean", "Show threads", "Settings > Appearance");
pref("appearance.showSuggestions", "appearance", "sagax.showSuggestions.v1", "boolean", "Show the Suggestions card in the bot panel", "Settings > Appearance");
pref("appearance.showAllHistory", "appearance", "sagax.showAllHistory.v1", "boolean", "Show the All history row in the bot panel", "Settings > Appearance");
pref("appearance.threadsLocation", "appearance", "omb-threads-location", "string", "Threads location", "Settings > Appearance");
pref("appearance.backgroundEffect", "appearance", "sagax-background-effect", "string", "Background effect", "Settings > Appearance > Background");
pref("appearance.glyphRipple", "appearance", "sagax-glyph-ripple", "boolean", "Glyph ripple", "Settings > Appearance > Background");
pref("appearance.retro98", "appearance", "omb.retro98.on", "boolean", "Hibou 98", "Settings > Appearance");
pref("appearance.reduceMotion", "appearance", "sagax.a11y.motion.v1", "enum:system|reduce", "Reduce motion (follow the system, or always)", "Settings > Appearance > Accessibility");
pref("appearance.highContrast", "appearance", "sagax.a11y.contrast.v1", "enum:system|high", "Contrast (standard, or high)", "Settings > Appearance > Accessibility");
pref("appearance.hdMascots", "appearance", "sagax.hdMascots.v1", "enum:on|off", "HD mascots (painted art for the characters that have it, or the classic look)", "Settings > Appearance > Mascots");
pref("appearance.textSize", "appearance", "sagax.a11y.textSize.v1", "enum:default|large|xlarge", "Text size (default, large, extra large)", "Settings > Appearance > Accessibility");
pref("appearance.hardwareAcceleration", "appearance", "sagax.hardwareAcceleration.v1", "boolean", "Use hardware acceleration (desktop app; needs a restart)", "Settings > Appearance > Desktop");
pref("appearance.spellcheck", "appearance", "sagax.spellcheck.v1", "boolean", "Check spelling while typing (desktop app)", "Settings > Appearance > Desktop");
pref("appearance.botHotkeys", "appearance", "sagax.botHotkeys.v1", "boolean", "Global shortcuts that open a bot (macOS menu bar list)", "Settings > Appearance > Desktop");
pref("appearance.botHotkeyChord", "appearance", "sagax.botHotkeyModifier.v1", "enum:cmd-shift|cmd-alt|ctrl-alt", "Chord of the bots' global shortcuts (Cmd+Shift, Cmd+Option, Ctrl+Option, then the slot number)", "Settings > Appearance > Desktop");
pref("appearance.sendKey", "appearance", "omb-send-key", "enum:enter|mod-enter", "Send key", "Settings > Appearance");
pref("appearance.runCard", "appearance", "omb-show-run-card", "boolean", "This run card", "Settings > Appearance");
pref("appearance.sidebarLogo", "appearance", "sagax-show-sidebar-logo", "boolean", "Sidebar logo", "Settings > Appearance");
pref("appearance.routinesBadge", "appearance", "sagax-show-routines-badge", "boolean", "Routines badge", "Settings > Appearance");
pref("appearance.sidebarDensity", "appearance", "openmausbot.sidebarDensity", "string", "Sidebar density", "Settings > Appearance");
pref("appearance.freshTopicAfter", "appearance", "sagax.freshTopicAfter.v1", "string", "Fresh topic after", "Settings > Appearance");
pref("appearance.floatingBots", "appearance", "omb.floatingBots.prefs.v1", "object", "Desktop mascot", "Settings > Appearance > Floating bots");
pref("appearance.busySend", "appearance", "sagax.busySend.v1", "string", "Sending to a busy bot", "Settings > Appearance");
pref("notifications.sounds", "notifications", "omb-notification-sounds", "boolean", "Notification sounds", "Settings > Notifications");
pref("notifications.soundChoice", "notifications", "sagax.notificationSound.v1", "enum:system|tick|double-tick|chime-a|chime-b|blip", "Notification sound (the system's, Tick, Double tick, Chime A, Chime B, Blip)", "Settings > Notifications");
pref("notifications.persistent", "notifications", "omb-notification-persistent", "boolean", "Persistent notifications", "Settings > Notifications");
pref("notifications.dockBadge", "notifications", "omb-dock-badge", "boolean", "Dock badge", "Settings > Notifications");
pref("notifications.approvalChime", "notifications", "omb-approval-chime", "boolean", "Approval chime", "Settings > Notifications");
pref("notifications.nudgeSound", "notifications", "omb-nudge-sound", "boolean", "Nudge sound", "Settings > Notifications > Nudges");
pref("notifications.nudgeShake", "notifications", "omb-nudge-shake", "boolean", "Nudge shake", "Settings > Notifications > Nudges");
pref("notifications.readReceipts", "notifications", "sagax.readReceipts.v1", "boolean", "Read receipts", "Settings > Notifications > Privacy");
pref("notifications.presence", "notifications", "sagax.presenceVisible.v1", "boolean", "Show when online", "Settings > Notifications > Privacy");
pref("notifications.analyticsOptOut", "notifications", "omb-analytics-opt-out", "boolean", "Analytics opt-out", "Settings > Privacy");
pref("models.voiceMode", "models", "omb.voiceMode.v1", "object", "Voice mode (voice, speed, language)", "Settings > Models and voice > Voice mode");
// where bots run for the person (their own computer, routines, network): a
// widening of where work goes, the person's Allow
pref("computer.botWorkplace", "computer", "sagax.botWorkplace.v1", "object", "Where bots work for you", "Settings > Computer > Bot workplace", always("rule-change"));
// the person's other computers (organization server; server/desktop-bridge.ts):
// named by the computer's name or id, never offline-only for a rename
add({
  key: "computer.rename", family: "computer", target: "none", value: "object", label: "Rename one of your other computers ({computer: its name, name: the new name})", where: "Settings > Computer > Other computers",
  write: (_ids, v) => {
    const { computer, name } = (v ?? {}) as { computer?: unknown; name?: unknown };
    return { method: "POST", path: "/api/me/desktop-bridge/computers/rename", body: { computer, name } };
  },
});
add({
  key: "computer.remove", family: "computer", target: "none", value: "string", label: "Remove one of your other computers from the list (its name; refused while it is online)", where: "Settings > Computer > Other computers",
  write: (_ids, v) => ({ method: "POST", path: "/api/me/desktop-bridge/computers/remove", body: { computer: v } }),
  classes: always("delete"),
});
add({
  key: "computer.messages", family: "computer", target: "none", value: "boolean",
  label: "Use Messages on this Mac (read and send iMessage or SMS; solo desktop only)",
  where: "Settings > Computer > Messages",
  read: () => ({ path: "/api/messages", field: "useMessages" }),
  write: (_ids, v) => ({ method: "PUT", path: "/api/messages", body: { useMessages: v === true } }),
  classes: always("rule-change"),
});
add({
  key: "bot.lifecycleHooks", family: "bot", target: "bot", value: "boolean",
  label: "Lifecycle hooks on the bot computer (never on the server)",
  where: "Bot editor > Permissions > Lifecycle hooks",
  read: (ids) => ({ path: `/api/bots/${enc(ids.target!)}/lifecycle-hooks`, field: "enabled" }),
  write: (ids, v) => ({ method: "PUT", path: `/api/bots/${enc(ids.target!)}/lifecycle-hooks`, body: { enabled: v === true } }),
  classes: always("rule-change"),
});

const PROVIDER_KEYS: ReadonlySet<string> = new Set(["anthropic", "openai", "openrouter", "xai", "mistral", "cerebras", "groq", "elevenlabs", "fishAudio"]);

// ── server configuration (PATCH /api/config) ──────────────────────────
function config(key: string, family: SettingFamily, path: string, value: SettingValue, label: string, where: string, classes: SettingSpec["classes"] = serverWide): void {
  add({
    key, family, target: "none", label, where, value,
    read: () => ({ path: "/api/config", field: path }),
    write: (_ids, v) => ({ method: "PATCH", path: "/api/config", body: nest(path, v) }),
    classes,
  });
}
config("server.newBotDefaults", "server", "newBotDefaults", "object", "New bot defaults", "Settings > General > System > New bots",
  // a default that sets a level, grants or tools for every new bot widens
  (v, ctx) => /"(approvalMode|alwaysAllow|routines|toolScope|mcpServers|fullAccess)"/.test(JSON.stringify(v ?? null)) ? ["rule-change"] : serverWide(v, ctx));
config("server.threads", "server", "threads", "object", "Conversation cleanup", "Settings > General > Advanced > Threads");
config("server.showToolCalls", "server", "features.showToolCalls", "boolean", "Show tool calls", "Settings > Appearance");
config("server.feature", "server", "features", "object", "Experimental features ({skillAuthoring, browser, connectedApps, decisionModel, dataWindow, meetingNotetaker})", "Settings > Experimental");
config("server.routinesInConversation", "server", "features.routinesInConversation", "boolean", "Routines in conversation", "Settings > Organization > Bots");
config("server.roomTurnTimeout", "server", "rooms.turnTimeoutMinutes", "number", "Room turn limit", "Settings > Organization > Rooms");
config("server.mcpCallTimeout", "server", "mcp.callTimeoutMinutes", "number", "MCP call time limit", "Settings > Organization");
config("server.localVm", "computer", "localVm", "object", "Local VM ({mode, maxInstances, idleTimeoutMinutes})", "Settings > Computer");
config("models.voiceProvider", "models", "tts.provider", "string", "Voice engine", "Settings > Models and voice > Voice");
config("models.fishModel", "models", "tts.fishModel", "string", "Fish Audio model", "Settings > Models and voice > Voice");
config("models.imageGen", "models", "imageGen", "object", "Image generation", "Settings > Models and voice > Images", secretWhenKeyed);
config("models.decider", "models", "decider", "object", "Decision model", "Settings > Models and voice > Decision model", secretWhenKeyed);
config("models.everyClaudeBot", "models", "anthropic.everyClaudeBot", "boolean", "Anthropic key for every Claude bot", "Settings > Models and voice > Keys");
add({
  key: "models.providerKey", family: "credentials", target: "none", value: "object", label: "A provider key ({<provider>: {key}})", where: "Settings > Models and voice > Keys",
  // known providers, each holding its key only: nothing else rides along
  write: (_ids, v) => {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return "value is {<provider>: {key}}.";
    for (const [provider, block] of entries) {
      if (!PROVIDER_KEYS.has(provider)) return `${provider} is not a provider key (${[...PROVIDER_KEYS].join(", ")}).`;
      const fields = block && typeof block === "object" && !Array.isArray(block) ? Object.keys(block) : [];
      if (fields.length !== 1 || fields[0] !== "key" || typeof (block as { key?: unknown }).key !== "string") return `${provider} takes {key} only.`;
    }
    return { method: "PATCH", path: "/api/config", body: v };
  },
  classes: (_v, ctx) => ctx.organization ? ["secret", "org"] : ["secret"],
});
add({
  key: "models.liveCalls", family: "models", target: "none", value: "object", label: "Live call settings", where: "Settings > Models and voice > Live calls",
  read: () => ({ path: "/api/live/settings" }),
  write: (_ids, v) => ({ method: "PATCH", path: "/api/live/settings", body: v }), classes: secretWhenKeyed,
});

// ── organization (organization server: PATCH /api/org/settings) ───────
function org(key: string, field: string, value: SettingValue, label: string, where: string): void {
  add({
    key, family: "organization", target: "none", label, where, value,
    read: () => ({ path: "/api/org/settings", field }),
    write: (_ids, v) => ({ method: "PATCH", path: "/api/org/settings", body: { [field]: v } }),
    classes: always("org"),
  });
}
org("org.allowFullAccess", "allowFullAccess", "boolean", "Allow Full access", "Settings > Organization > Bots");
org("org.memberAutoApproval", "memberAutoApproval", "boolean", "Members' bots may use Auto", "Settings > Organization > Bots");
org("org.memberEnvironmentAutonomy", "memberEnvironmentAutonomy", "any", "Members' environments", "Settings > Organization > Computers");
org("org.confidentialByDefault", "confidentialThreadsByDefault", "boolean", "New conversations confidential", "Settings > Organization > Privacy");
org("org.allowVaultExport", "allowVaultExport", "boolean", "Allow vault export", "Settings > Organization > Credentials");
org("org.interimAttachDays", "interimAttachDays", "number", "People from before: days", "Settings > Organization > People");
org("org.pluginMarketplaces", "pluginMarketplaces", "any", "Plugin marketplaces", "Connect apps > Sources");
// published pages (lot R8): the admins' switch for public links, a card at every level
add({
  key: "org.pagesLinkSharing", family: "organization", target: "none", value: "boolean", label: "Public links for published pages", where: "Settings > Pages > Organization pages",
  read: () => ({ path: "/api/admin/pages/policy", field: "linkSharing" }),
  write: (_ids, v) => typeof v === "boolean" ? { method: "PUT", path: "/api/admin/pages/policy", body: { linkSharing: v } } : "value is true or false.",
  classes: always("org"),
});
add({
  key: "org.pagesReaderComments", family: "organization", target: "none", value: "boolean", label: "Reader comments on published pages", where: "Settings > Pages > Organization pages",
  read: () => ({ path: "/api/admin/pages/policy", field: "readerComments" }),
  write: (_ids, v) => typeof v === "boolean" ? { method: "PUT", path: "/api/admin/pages/policy", body: { readerComments: v } } : "value is true or false.",
  classes: always("org"),
});

// ── connections (the person's own) ─────────────────────────────────────
add({
  key: "connections.mcpServer", family: "connections", target: "none", value: "object", label: "Add your MCP server ({name, url|command, auth, ...})", where: "Connect apps > Manage",
  read: () => ({ path: "/api/me/mcp/servers" }),
  write: (_ids, v) => ({ method: "POST", path: "/api/me/mcp/servers", body: v }), classes: always("secret"),
});
add({
  key: "connections.mcpServerEnabled", family: "connections", target: "none", value: "object", label: "Your MCP server on or off ({name, enabled})", where: "Connect apps > Manage",
  write: (_ids, v) => {
    const s = v as { name?: unknown; enabled?: unknown } | null;
    if (!s || typeof s.name !== "string" || typeof s.enabled !== "boolean") return "value is {name, enabled}.";
    return { method: "PATCH", path: `/api/me/mcp/servers/${enc(s.name)}`, body: { enabled: s.enabled } };
  },
});
add({
  key: "connections.mcpServerRemove", family: "connections", target: "none", value: "string", label: "Remove your MCP server (its name)", where: "Connect apps > Manage",
  write: (_ids, v) => typeof v === "string" && v ? { method: "DELETE", path: `/api/me/mcp/servers/${enc(v)}` } : "value is the server's name.",
  classes: always("delete"),
});
add({
  key: "connections.githubDisconnect", family: "connections", target: "none", value: "boolean", label: "Disconnect GitHub (true)", where: "Connect apps > Manage > GitHub",
  write: (_ids, v) => v === true ? { method: "DELETE", path: "/api/me/github" } : "value is true.", classes: always("delete", "secret"),
});
add({
  key: "connections.cloudAgentKey", family: "credentials", target: "none", value: "object", label: "Cloud coding agent key ({provider: cursor|claude|codex, token}, token null removes)", where: "Settings > Models and voice > Cloud coding agents",
  write: (_ids, v) => {
    const k = v as { provider?: unknown; token?: unknown } | null;
    if (!k || typeof k.provider !== "string") return "value is {provider, token}.";
    return k.token === null
      ? { method: "DELETE", path: `/api/me/cloud-agent-providers/${enc(k.provider)}` }
      : { method: "PUT", path: `/api/me/cloud-agent-providers/${enc(k.provider)}`, body: { token: k.token } };
  },
  classes: always("secret"),
});

// ── credentials (the person's vault; export and import stay theirs) ───
add({
  key: "credentials.item", family: "credentials", target: "credential", value: "object",
  label: "A vault item ({name, username, password, apiKey, notes, domains}); no target creates one", where: "Settings > Credentials",
  write: (ids, v) => ids.target
    ? { method: "PATCH", path: `/api/me/credentials/${enc(ids.target)}`, body: v }
    : { method: "POST", path: "/api/me/credentials", body: v },
  classes: always("secret"),
});
add({
  key: "credentials.botAccess", family: "credentials", target: "credential", value: "object", label: "Let a bot use an item ({botId, allow: true|false})", where: "Settings > Credentials > item",
  write: (ids, v) => {
    const g = v as { botId?: unknown; allow?: unknown } | null;
    if (!ids.target) return "target is the vault item's id.";
    if (!g || typeof g.botId !== "string" || typeof g.allow !== "boolean") return "value is {botId, allow}.";
    return g.allow
      ? { method: "POST", path: `/api/me/credentials/${enc(ids.target!)}/grants`, body: { botId: g.botId, mode: "always" } }
      : { method: "DELETE", path: `/api/me/credentials/${enc(ids.target!)}/grants/${enc(g.botId)}` };
  },
  classes: always("secret"),
});
add({
  key: "credentials.delete", family: "credentials", target: "credential", value: "boolean", label: "Delete a vault item (true)", where: "Settings > Credentials",
  write: (ids, v) => !ids.target ? "target is the vault item's id." : v === true ? { method: "DELETE", path: `/api/me/credentials/${enc(ids.target)}` } : "value is true.",
  classes: always("delete", "secret"),
});

export const SETTINGS: readonly SettingSpec[] = SPECS;
const BY_KEY = new Map(SPECS.map((spec) => [spec.key, spec]));

export function settingSpec(key: unknown): SettingSpec | undefined {
  return typeof key === "string" ? BY_KEY.get(key) : undefined;
}

/** Whether a value has the kind a setting takes. The route checks the rest. */
export function valueFits(kind: SettingValue, value: unknown): boolean {
  if (kind === "any") return value !== undefined;
  if (kind.endsWith("?") && value === null) return true;
  const base = kind.replace(/\?$/, "");
  if (base.startsWith("enum:")) return typeof value === "string" && base.slice(5).split("|").includes(value);
  if (base === "string") return typeof value === "string" && value.length <= 2_000;
  if (base === "text") return typeof value === "string" && value.length <= 100_000;
  if (base === "boolean") return typeof value === "boolean";
  if (base === "number") return typeof value === "number" && Number.isFinite(value);
  if (base === "array") return Array.isArray(value) || value === null;
  if (base === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return false;
}

/** The value at a dot path; `list[field=value]` picks one item of a list. */
export function pickValue(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    const match = /^(\w+)\[(\w+)=([^\]]*)\]$/.exec(part);
    if (match) {
      const list = (current as Record<string, unknown>)[match[1]!];
      current = Array.isArray(list) ? list.find((item) => item && typeof item === "object" && String((item as Record<string, unknown>)[match[2]!]) === match[3]) : undefined;
      continue;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** The storage keys a bot may set on the person's device (setPreference). */
export const DEVICE_PREFERENCE_KEYS: ReadonlySet<string> = new Set(
  SPECS.map((spec) => spec.write({}, "x")).flatMap((route) => (typeof route === "object" && "ui" in route && route.ui === "setPreference" ? [String(route.input.key)] : [])),
);
