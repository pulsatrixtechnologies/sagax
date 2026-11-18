// Tools a provider refused for one person's access (#4720). A connector that
// knows who asks can refuse one call for that person durably: X answers
// 403 client-forbidden, billing-scope-missing, when the connection may not
// bill the person's own developer account; an OAuth server answers
// insufficient_scope; GitHub "Resource not accessible by integration".
// Calling again changes nothing until the person's access changes, so a bot
// that is told nothing retries it on every turn and every routine run.
//
// One memory for every connector and every engine, fed by the runtime bus
// (server/host/tool-refusal-guard.ts): a key (person, connector, tool) holds
// the provider's own reason, and only a refusal really received for that
// person creates one. It is forgotten when the same tool answers, when the
// person signs the connector in again, or after REFUSAL_TTL_MS, so access
// the provider adds later is taken up without a change here. Persisted: a
// routine runs again after a restart.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { classifyError } from "../drivers/retry.ts";
import { decodeGrokGatewayName, grokConnectorIdForName, parseGrokGatewayToolId } from "../../shared/grok-cloud-connectors.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { stepToolId, toolIdParts } from "../../shared/searched-tool-call.ts";
import { toolFailureText } from "../../shared/tool-failure-text.ts";

/** A refusal is forgotten after this long without a new one. */
export const REFUSAL_TTL_MS = 24 * 60 * 60_000;
/** Per person: one person's refusals never push out another's. */
const ENTRIES_PER_PERSON_MAX = 100;
const DETAIL_MAX = 240;
const REASON_MAX = 60;

export interface ToolRefusal {
  /** the provider's own short reason (`billing-scope-missing`), else "permission" */
  reason: string;
  requiredScope?: string;
  /** the provider's sentence, secrets masked, cut short */
  detail: string;
  at: number;
}

export interface RefusedTool extends ToolRefusal {
  connector: string;
  tool: string;
}

/** The connector and the tool a step ran, as a person names them: a Grok
 * gateway call (`cursor/user-X-get_5fusers_5fme___6`) reads as its own
 * connector and decoded tool (`X`, `get_users_me`); any other MCP call as
 * its server and tool. Null for a built-in tool. */
export function refusalTarget(step: { title?: unknown; tool?: unknown }): { connector: string; tool: string } | null {
  const id = stepToolId(step);
  const parts = id ? toolIdParts(id) : null;
  if (!parts) return null;
  const gateway = parseGrokGatewayToolId(`${parts.server}__${parts.tool}`);
  if (gateway && gateway.server && gateway.tool) return { connector: gateway.server, tool: gateway.tool };
  return { connector: parts.server, tool: decodeGrokGatewayName(parts.tool) };
}

/** A JSON body after an engine's own words (`Failed to call x: {...}`): its words. */
function embeddedWords(raw: string): string | undefined {
  const at = raw.indexOf("{");
  if (at <= 0) return undefined;
  try {
    return toolFailureText(JSON.parse(raw.slice(at)));
  } catch {
    return undefined;
  }
}

const FIELD = (name: string) => new RegExp(`"${name}"\\s*:\\s*"([^"\\n]{1,${REASON_MAX}})"`, "i");

/** A failed call's output read as a durable permission refusal, or null:
 * the words come from toolFailureText, the verdict from classifyError. */
export function permissionRefusalOf(output: unknown, at: number): ToolRefusal | null {
  const raw = typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output);
  const words = embeddedWords(raw) ?? toolFailureText(output) ?? "";
  if (classifyError({ text: `${raw}\n${words}` }).reason !== "permission") return null;
  const reason = FIELD("reason").exec(raw)?.[1]?.trim()
    ?? /\binsufficient[-_ ]scopes?\b/i.exec(raw)?.[0]?.toLowerCase().replace(/[- ]/g, "_")
    ?? FIELD("type").exec(raw)?.[1]?.split("/").pop()?.trim()
    ?? "permission";
  const requiredScope = FIELD("required_scope").exec(raw)?.[1]?.trim() ?? FIELD("scope").exec(raw)?.[1]?.trim();
  const flat = redactSecretsInText(words || raw).replace(/\s+/g, " ").trim();
  const detail = flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 1).trimEnd()}…` : flat;
  return { reason, ...(requiredScope ? { requiredScope } : {}), detail, at };
}

/** What is known of a connector beyond its refusals: a way around and the
 * cause in plain words. Said only beside a refusal really remembered for
 * the person, never as a refusal by itself. Keyed by connector id
 * (shared/grok-cloud-connectors.ts grokConnectorIdForName). */
export interface ConnectorRefusalKnowledge {
  /** the refusals it explains (`billing-scope-missing`) */
  reasons: readonly string[];
  /** a way around with tools that answer, in a few words */
  instead?: string;
  /** the cause, for the person, in one sentence */
  cause: string;
}

export const CONNECTOR_REFUSAL_KNOWLEDGE: Readonly<Record<string, ConnectorRefusalKnowledge>> = {
  // measured 2026-11-18 on the grok.com X connection: search_users and
  // get_users_posts answer where the user lookups are refused
  x: {
    reasons: ["billing-scope-missing"],
    instead: "search_users with the handle, then get_users_posts with its id",
    cause: "X bills this to your own X developer account, and this X connection may not bill it",
  },
};

export function connectorKnowledge(connector: string, reason: string): ConnectorRefusalKnowledge | undefined {
  const id = grokConnectorIdForName(connector) ?? connector.toLowerCase();
  const known = CONNECTOR_REFUSAL_KNOWLEDGE[id];
  return known?.reasons.includes(reason) ? known : undefined;
}

const refusalSchema = z.object({
  person: z.string().min(1),
  connector: z.string().min(1),
  tool: z.string().min(1),
  reason: z.string().min(1),
  requiredScope: z.string().optional(),
  detail: z.string(),
  at: z.number().finite(),
});
const fileSchema = z.object({
  version: z.literal(1),
  refusals: z.array(refusalSchema).default([]),
  /** person and connector the person was told about, with when */
  told: z.array(z.object({ person: z.string().min(1), connector: z.string().min(1), at: z.number().finite() })).default([]),
});

export interface ToolRefusalMemory {
  /** A refusal received for this person: `first` when the tool was not remembered, `tell` when the person was never told about this connector. */
  record(person: string, connector: string, tool: string, refusal: ToolRefusal): { first: boolean; tell: boolean };
  /** The tool answered: it is not refused any more. */
  answered(person: string, connector: string, tool: string): void;
  /** The person signed this connector in again. */
  forgetConnector(person: string, connector: string): void;
  get(person: string, connector: string, tool: string): ToolRefusal | undefined;
  list(person: string): RefusedTool[];
}

const norm = (value: string) => value.trim().toLowerCase();
const key = (person: string, connector: string, tool: string) => `${norm(person)}\0${norm(connector)}\0${norm(tool)}`;
const toldKey = (person: string, connector: string) => `${norm(person)}\0${norm(connector)}`;

export function createToolRefusalMemory(deps: { dataDir?: string; now?: () => number; ttlMs?: number; log?: (line: string) => void }): ToolRefusalMemory {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? REFUSAL_TTL_MS;
  const dir = deps.dataDir ? join(deps.dataDir, "tool-refusals") : undefined;
  const file = dir ? join(dir, "refusals.json") : undefined;
  let loaded: { refusals: Map<string, RefusedTool & { person: string }>; told: Map<string, number> } | null = null;

  const state = () => {
    if (loaded) return loaded;
    loaded = { refusals: new Map(), told: new Map() };
    if (!file || !existsSync(file)) return loaded;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const row of parsed.refusals) loaded.refusals.set(key(row.person, row.connector, row.tool), { ...row });
      for (const row of parsed.told) loaded.told.set(toldKey(row.person, row.connector), row.at);
    } catch (error) {
      deps.log?.(`[tool-refusals] ${file} is unreadable, starting empty: ${error instanceof Error ? error.message : String(error)}`);
    }
    return loaded;
  };

  const save = () => {
    if (!file || !dir) return;
    const { refusals, told } = state();
    const rows = [...refusals.values()];
    const toldRows = [...told].map(([k, at]) => {
      const [person, connector] = k.split("\0") as [string, string];
      return { person, connector, at };
    });
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(file, `${JSON.stringify({ version: 1, refusals: rows, told: toldRows }, null, 2)}\n`, { mode: 0o600, durable: false });
    } catch (error) {
      deps.log?.(`[tool-refusals] could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** Drop what expired: a refusal, and having told the person (told
   * again only after the TTL or a new sign-in, never per bot or per run). */
  const prune = (): boolean => {
    const { refusals, told } = state();
    const cutoff = now() - ttl;
    let changed = false;
    for (const [k, row] of refusals) if (row.at <= cutoff) { refusals.delete(k); changed = true; }
    for (const [k, at] of told) if (at <= cutoff) { told.delete(k); changed = true; }
    return changed;
  };

  const fresh = (row: RefusedTool | undefined) => (row && row.at > now() - ttl ? row : undefined);

  return {
    record(person, connector, tool, refusal) {
      if (!person.trim() || !connector.trim() || !tool.trim()) return { first: false, tell: false };
      prune();
      const { refusals, told } = state();
      const k = key(person, connector, tool);
      const first = !refusals.has(k);
      refusals.delete(k);
      refusals.set(k, { person: norm(person), connector, tool, ...refusal });
      // oldest first (insertion order): only this person's own entries go
      const mine = [...refusals].filter(([, row]) => row.person === norm(person));
      for (const [old] of mine.slice(0, Math.max(0, mine.length - ENTRIES_PER_PERSON_MAX))) refusals.delete(old);
      const t = toldKey(person, connector);
      const tell = !told.has(t);
      if (tell) told.set(t, refusal.at);
      save();
      return { first, tell };
    },
    answered(person, connector, tool) {
      const { refusals } = state();
      if (!refusals.delete(key(person, connector, tool))) return;
      prune();
      save();
    },
    forgetConnector(person, connector) {
      const { refusals, told } = state();
      let changed = told.delete(toldKey(person, connector));
      for (const [k, row] of refusals) {
        if (norm(row.person) === norm(person) && norm(row.connector) === norm(connector)) { refusals.delete(k); changed = true; }
      }
      if (changed) save();
    },
    get(person, connector, tool) {
      const row = fresh(state().refusals.get(key(person, connector, tool)));
      return row ? { reason: row.reason, ...(row.requiredScope ? { requiredScope: row.requiredScope } : {}), detail: row.detail, at: row.at } : undefined;
    },
    list(person) {
      if (prune()) save();
      return [...state().refusals.values()]
        .filter((row) => norm(row.person) === norm(person))
        .map(({ connector, tool, reason, requiredScope, detail, at }) => ({ connector, tool, reason, ...(requiredScope ? { requiredScope } : {}), detail, at }))
        .sort((a, b) => a.connector.localeCompare(b.connector) || a.tool.localeCompare(b.tool));
    },
  };
}

const LINE_TOOLS_MAX = 8;

/** One line per connector for the model (server/turns/turn-reach.ts): the
 * tools refused for this person, why, never retried, and the way around
 * when the connector's knowledge has one. */
export function refusalLines(refused: readonly RefusedTool[]): string[] {
  const byConnector = new Map<string, RefusedTool[]>();
  for (const row of refused) byConnector.set(row.connector, [...(byConnector.get(row.connector) ?? []), row]);
  return [...byConnector].map(([connector, rows]) => {
    const reason = rows[0]!.reason;
    const instead = connectorKnowledge(connector, reason)?.instead;
    const tools = rows.map((row) => row.tool).slice(0, LINE_TOOLS_MAX).join(", ");
    return `${connector} refused for this person (${reason}), never call or retry: ${tools}.${instead ? ` Instead: ${instead}` : ""}`;
  });
}

/** The one sentence the person reads, with the provider's own reason. */
export function refusalSentence(connector: string, tool: string, refusal: ToolRefusal): string {
  const known = connectorKnowledge(connector, refusal.reason);
  const scope = refusal.requiredScope ? `, it needs ${refusal.requiredScope}` : "";
  return `${connector} refused ${tool} for your access (${refusal.reason}${scope}). ${known ? `${known.cause}.` : "Calling it again will not help until that access changes."}`;
}

/** Why a tool is refused, for the bot's note (server/host/loop-guard.ts). */
export function refusalReason(connector: string, refusal: ToolRefusal): string {
  const known = connectorKnowledge(connector, refusal.reason);
  const scope = refusal.requiredScope ? `, needs ${refusal.requiredScope}` : "";
  return `${connector} answered ${refusal.reason}${scope}.${known?.instead ? ` Instead: ${known.instead}.` : ""} ${refusal.detail}`;
}
