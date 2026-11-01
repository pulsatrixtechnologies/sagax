// Capabilities (lot 1b): the desktop side of the one resolved list of a bot
// (GET /api/bots/:id/capabilities, shared/capabilities.ts). Bot panel >
// Capabilities, Capabilities > Installed in a bot's scope and the pages of a
// plugin, a skill or a server read it through these helpers: the words for a
// form, a scope and a state, what the bot's engine receives grouped for
// "What <bot> receives", and the "Engines" line a page shows. Pure functions
// and one hook; the screens word everything, never an id.
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readableError } from "./plain-error";
import {
  CAPABILITIES_PATH,
  engineReceipt,
  type BotCapabilities,
  type Capability,
  type CapabilityForm,
  type CapabilityReason,
  type CapabilityScope,
  type CapabilityState,
  type EngineParts,
  type EngineReceipt,
  type Receipt,
} from "../../shared/capabilities";

export type { BotCapabilities, Capability };

/** The list of one bot, read again on `reload` and whenever `revision`
 * changes (a switch elsewhere). `engine` previews another engine instance. */
export function useBotCapabilities(botId: string | null, options: { engine?: string; revision?: unknown } = {}): {
  data: BotCapabilities | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [answer, setAnswer] = useState<{ identity: string; data: BotCapabilities } | null>(null);
  const [failure, setFailure] = useState<{ identity: string; error: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const engine = options.engine;
  const identity = JSON.stringify([botId, engine ?? null]);
  const reload = useCallback(async () => {
    const mine = ++generation.current;
    if (!botId) {
      setAnswer(null);
      setFailure(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const query = engine ? `?engine=${encodeURIComponent(engine)}` : "";
      const answer = await api<BotCapabilities>(`${CAPABILITIES_PATH(botId)}${query}`);
      if (mine !== generation.current) return;
      setAnswer({ identity, data: answer });
      setFailure(null);
    } catch (cause) {
      if (mine !== generation.current) return;
      setFailure({ identity, error: readableError(cause) });
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [botId, engine, identity]);
  useEffect(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload, options.revision]);
  return {
    data: answer?.identity === identity ? answer.data : null,
    error: failure?.identity === identity ? failure.error : null,
    loading,
    reload,
  };
}

const FORM_KEY: Record<CapabilityForm, LocaleKey> = {
  plugin: "capabilities.form.plugin",
  skill: "capabilities.form.skill",
  mcp: "capabilities.form.mcp",
  connector: "capabilities.form.connector",
  role: "capabilities.form.role",
  flow: "capabilities.form.flow",
};

const SCOPE_KEY: Record<CapabilityScope, LocaleKey> = {
  bot: "capabilities.scope.bot",
  me: "capabilities.scope.me",
  organization: "capabilities.scope.organization",
  installation: "capabilities.scope.installation",
  account: "capabilities.scope.account",
};

const STATE_KEY: Record<CapabilityState, LocaleKey> = {
  on: "capabilities.state.on",
  off: "capabilities.state.off",
  to_connect: "capabilities.state.toConnect",
  imposed: "capabilities.state.imposed",
  not_held: "capabilities.state.notHeld",
  not_served: "capabilities.state.notServed",
  reserved: "capabilities.state.reserved",
  unverifiable: "capabilities.state.unverifiable",
};

const REASON_KEY: Record<CapabilityReason, LocaleKey> = {
  name_taken: "capabilities.reason.nameTaken",
  not_selected: "capabilities.reason.notSelected",
  host_command: "capabilities.reason.hostCommand",
  policy: "capabilities.reason.policy",
  needs_github: "capabilities.reason.needsGithub",
  needs_token: "capabilities.reason.needsToken",
  needs_sign_in: "capabilities.reason.needsSignIn",
  no_environment: "capabilities.reason.noEnvironment",
  private_address: "capabilities.reason.privateAddress",
  library_off: "capabilities.reason.libraryOff",
  not_assigned: "capabilities.reason.notAssigned",
  guard_off: "capabilities.reason.guardOff",
  not_member: "capabilities.reason.notMember",
  not_installed: "capabilities.reason.notInstalled",
  unknown_profile: "capabilities.reason.unknownProfile",
  disabled: "capabilities.reason.disabled",
  offered: "capabilities.reason.offered",
};

export const formWord = (form: CapabilityForm): string => t(FORM_KEY[form]);
export const scopeWord = (scope: CapabilityScope): string => t(SCOPE_KEY[scope]);
export const stateWord = (state: CapabilityState): string => t(STATE_KEY[state]);
/** Why it is off, to connect or not served, in one sentence; null when the
 * list gives no reason (or one this build does not know). */
export const reasonText = (reason: CapabilityReason | undefined): string | null => (reason && REASON_KEY[reason] ? t(REASON_KEY[reason]) : null);

/** A row's name: a Role Perspicax no longer lists has none (never its id). */
export function capabilityName(item: Pick<Capability, "name" | "form">): string {
  if (item.name.trim()) return item.name;
  return item.form === "role" ? t("capabilities.role.unknown") : t("capabilities.unnamed");
}

/** The tone of a state chip (on is said by the switch, not a chip). */
export function stateTone(state: CapabilityState): "good" | "accent" | "warn" | "muted" | null {
  switch (state) {
    case "on": return null;
    case "imposed": return "accent";
    case "to_connect":
    case "not_held":
    case "reserved": return "warn";
    default: return "muted";
  }
}

const SCOPE_ORDER: Record<CapabilityScope, number> = { organization: 0, bot: 1, me: 2, installation: 3, account: 4 };

/** The rows in the order the panel shows them: the organization's first,
 * then this bot's, the person's, everyone's, the engine account's; by name
 * within a scope. */
export function orderedCapabilities(items: readonly Capability[]): Capability[] {
  return [...items].sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || capabilityName(a).localeCompare(capabilityName(b)));
}

/** The plugin key of a bot plugin row (`plugin:bot:name@market`), for its switch. */
export function botPluginKey(item: Pick<Capability, "key" | "form" | "scope">): string | null {
  return item.form === "plugin" && item.scope === "bot" && item.key.startsWith("plugin:bot:") ? item.key.slice("plugin:bot:".length) : null;
}

/** The person's plugin is shared by all of their bots, never this bot's copy. */
export function personalPluginKey(item: Pick<Capability, "key" | "form" | "scope">): string | null {
  return item.form === "plugin" && item.scope === "me" && item.key.startsWith("plugin:me:") ? item.key.slice("plugin:me:".length) : null;
}

/** The server name of an installation MCP row (`mcp:installation:<name>`). */
export function installationServerName(item: Pick<Capability, "key" | "form" | "scope">): string | null {
  return item.form === "mcp" && item.scope === "installation" && item.key.startsWith("mcp:installation:") ? item.key.slice("mcp:installation:".length) : null;
}

/** The profile id of a Role row (`role:bot:<id>`): sent back to the route, never shown. */
export function roleProfileId(item: Pick<Capability, "key" | "form">): string | null {
  return item.form === "role" && item.key.startsWith("role:bot:") ? item.key.slice("role:bot:".length) : null;
}

/** The skill name of a skill row (`skill:<scope>:<name>`). */
export function skillName(item: Pick<Capability, "key" | "form">): string | null {
  if (item.form !== "skill") return null;
  const parts = item.key.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}

const received = (receipt: Receipt | undefined): receipt is Exclude<Receipt, "none"> => receipt !== undefined && receipt !== "none";

/** Served to this bot: on (or imposed) and received by its engine. */
export function isServed(item: Capability): boolean {
  return (item.state === "on" || item.state === "imposed") && !item.engine.nothing;
}

export interface ReceivedGroups {
  /** skills and commands, by how they arrive */
  native: string[];
  prompt: string[];
  agents: string[];
  servers: string[];
  /** a capability this engine receives nothing of, with why */
  notServed: Array<{ name: string; why: string }>;
}

/** "What <bot> receives (engine: X)": the served capabilities grouped by
 * what the engine gets, and those it does not get. */
export function receivedGroups(items: readonly Capability[]): ReceivedGroups {
  const out: ReceivedGroups = { native: [], prompt: [], agents: [], servers: [], notServed: [] };
  for (const item of orderedCapabilities(items)) {
    const name = capabilityName(item);
    if (isServed(item)) {
      const { skills, commands, agents, mcp, tools } = item.engine;
      if ([skills, commands].some((receipt) => receipt === "prompt")) out.prompt.push(name);
      else if ([skills, commands].some((receipt) => receipt === "native")) out.native.push(name);
      if (received(agents)) out.agents.push(name);
      if (received(mcp) || received(tools)) out.servers.push(name);
    } else if (item.state === "not_served" || ((item.state === "on" || item.state === "imposed") && item.engine.nothing)) {
      out.notServed.push({ name, why: notServedWhy(item) });
    }
  }
  return out;
}

function notServedWhy(item: Capability): string {
  if (item.form === "connector") return item.source.kind === "catalog" || item.source.label === "Grok" ? t("capabilities.received.grokAccountOnly") : t("capabilities.received.claudeAccountOnly");
  if (item.form === "flow") return t("capabilities.received.flowClaudeOnly");
  return t("capabilities.received.engineGetsNothing");
}

/** The skills index of the prompt cut something (#1748). */
export function indexCut(index: BotCapabilities["promptIndex"]): boolean {
  return Boolean(index && (index.incomplete || index.omitted > 0 || index.bytes > index.maxBytes || index.skills > index.maxSkills));
}

/** "4 KB" for the index cap. */
export function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))}`;
}

/** The engines a page's "Engines" line names: one of each family the
 * matrix tells apart (shared/capabilities.ts engineReceipt). */
export const ENGINE_SAMPLES: ReadonlyArray<{ kind: string; label: () => string }> = [
  { kind: "claudeAgent", label: () => "Claude" },
  { kind: "codex", label: () => "Codex" },
  { kind: "grok", label: () => "Grok" },
  { kind: "openai-compat", label: () => t("capabilities.engines.api") },
];

type Part = "skills" | "commands" | "agents" | "mcp" | "tools";
const PART_KEY: Record<Part, LocaleKey> = {
  skills: "capabilities.part.skills",
  commands: "capabilities.part.commands",
  agents: "capabilities.part.agents",
  mcp: "capabilities.part.servers",
  tools: "capabilities.part.tools",
};

/** What one engine gets of what a capability brings, in a few words:
 * "everything", "commands + server", "nothing". */
export function receiptWords(receipt: EngineReceipt): string {
  if (receipt.nothing) return t("capabilities.engines.nothing");
  const parts = (Object.keys(PART_KEY) as Part[]).filter((part) => receipt[part] !== undefined);
  const got = parts.filter((part) => received(receipt[part]));
  // a Role's tools are its server: say it once
  const shown = got.filter((part) => !(part === "tools" && got.includes("mcp")));
  if (got.length === parts.length) return t("capabilities.engines.everything");
  return shown.map((part) => t(PART_KEY[part])).join(" + ");
}

/** The "Engines" line of a page: what each engine family gets of this
 * capability ("Claude: everything · Codex: commands + server · Grok:
 * server · API: nothing"). */
export function enginesLine(form: CapabilityForm, parts: Omit<EngineParts, "customMcp">): string {
  return ENGINE_SAMPLES
    .map((engine) => `${engine.label()}${t("capabilities.engines.colon")}${receiptWords(engineReceipt(engine.kind, form, { customMcp: true, skillDiscovery: form === "skill", ...parts }))}`)
    .join(" · ");
}

/** Whether the bot's own engine would receive nothing of this capability
 * (the warning before an install). */
export function engineGetsNothing(driverKind: string, form: CapabilityForm, parts: Omit<EngineParts, "customMcp">): boolean {
  const any = parts.skills || parts.commands || parts.agents || parts.mcp || parts.account;
  return Boolean(any) && engineReceipt(driverKind, form, { customMcp: true, skillDiscovery: form === "skill", ...parts }).nothing;
}

/** Capabilities > Installed in a bot's scope: what the organization and
 * Perspicax put on this bot, read from the same list (the organization's
 * Flow, "imposed by the organization"; the Roles, "held / not held"). */
export function organizationRows(items: readonly Capability[]): Capability[] {
  return orderedCapabilities(items.filter((item) => item.form === "flow" || item.form === "role"));
}
