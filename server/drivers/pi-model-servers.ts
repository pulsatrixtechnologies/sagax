// #2024: the model servers a person reaches through Perspicax (their
// organization's and their own), served to pi on an organization server.
//
// Perspicax answers POST /api/v1/pulsabot/model-servers/resolve with the
// servers and their keys (server/perspicax/perspicax-link.ts). A key never
// touches the disk: each server becomes one pi provider in the person's own
// models.json (PI_CODING_AGENT_DIR) whose `apiKey` is `$SAGAX_PI_KEY_<ID>`,
// pi's own environment interpolation, and the value rides only the
// environment of that turn's pi process.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EffortLevel } from "../../shared/model-selection.ts";

/** pi's own thinking levels (models.md `samplingParamsByThinkingLevel`). */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export const MODEL_SERVER_DEFAULT_CONTEXT = 131_072;
export const MODEL_SERVER_DEFAULT_MAX_TOKENS = 16_384;
/** Every model-server provider pi sees starts with this. */
export const MODEL_SERVER_PROVIDER_PREFIX = "px-";
/** The variable a server's key reaches pi as: `SAGAX_PI_KEY_<ID>`. */
export const MODEL_SERVER_KEY_ENV_PREFIX = "SAGAX_PI_KEY_";

/** One model of a server, with the defaults of the contract applied. */
export interface ModelServerModel {
  id: string;
  label: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: Array<"text" | "image">;
  /** pi level → the value the endpoint takes; null: the level is not offered. */
  thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>;
  defaultThinkingLevel?: PiThinkingLevel;
}

/** A server as Perspicax resolves it for one person. */
export interface ModelServer {
  instanceId: string;
  name: string;
  url: string;
  protocol: "openai" | "anthropic";
  scope: "org" | "personal";
  apiKey: string;
  models: ModelServerModel[];
}

/** A server without its key: what a turn carries to the driver and what
 * the catalog draws. */
export interface PiModelServer extends Omit<ModelServer, "apiKey"> {
  /** The pi provider id (`px-org-<id>` or `px-own-<id>`). */
  provider: string;
  /** The variable its key rides in the turn's environment. */
  keyEnv: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Whether a string holds a control character (C0 or DEL). */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isModelId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/\s/.test(value) && !hasControl(value);
}
const MAX_SERVERS = 32;
const MAX_MODELS = 256;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || hasControl(trimmed)) return null;
  return trimmed;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000_000 ? value : fallback;
}

function isPiLevel(value: unknown): value is PiThinkingLevel {
  return typeof value === "string" && (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

function parseModel(raw: unknown): ModelServerModel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = isModelId(row.id) ? row.id : null;
  if (!id) return null;
  const input = Array.isArray(row.input) ? row.input.filter((kind): kind is "text" | "image" => kind === "text" || kind === "image") : [];
  const model: ModelServerModel = {
    id,
    label: text(row.label, 200) ?? id,
    contextWindow: positive(row.contextWindow, MODEL_SERVER_DEFAULT_CONTEXT),
    maxTokens: positive(row.maxTokens, MODEL_SERVER_DEFAULT_MAX_TOKENS),
    reasoning: typeof row.reasoning === "boolean" ? row.reasoning : true,
    input: input.length ? [...new Set<"text" | "image">(["text", ...input])] : ["text"],
  };
  if (row.thinkingLevelMap && typeof row.thinkingLevelMap === "object" && !Array.isArray(row.thinkingLevelMap)) {
    const map: Partial<Record<PiThinkingLevel, string | null>> = {};
    for (const [level, value] of Object.entries(row.thinkingLevelMap as Record<string, unknown>)) {
      if (!isPiLevel(level)) continue;
      if (value === null) map[level] = null;
      else if (typeof value === "string" && value.length <= 64 && !hasControl(value)) map[level] = value;
    }
    if (Object.keys(map).length) model.thinkingLevelMap = map;
  }
  if (isPiLevel(row.defaultThinkingLevel)) model.defaultThinkingLevel = row.defaultThinkingLevel;
  return model;
}

function parseServer(raw: unknown): ModelServer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const instanceId = typeof row.instanceId === "string" && ID.test(row.instanceId) ? row.instanceId : null;
  const url = text(row.url, 2048);
  const apiKey = row.apiKey;
  if (!instanceId || !url || (row.protocol !== "openai" && row.protocol !== "anthropic")) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  // A key may be empty (an endpoint without authentication), never a
  // value pi's models.json could read as a command or a variable.
  if (typeof apiKey !== "string" || apiKey.length > 4096 || /\s/.test(apiKey) || hasControl(apiKey)) return null;
  const models = Array.isArray(row.models) ? row.models.slice(0, MAX_MODELS).map(parseModel).filter((model): model is ModelServerModel => model !== null) : [];
  if (!models.length) return null;
  return {
    instanceId,
    name: text(row.name, 200) ?? instanceId,
    url: url.replace(/\/+$/, ""),
    protocol: row.protocol,
    scope: row.scope === "personal" ? "personal" : "org",
    apiKey,
    models,
  };
}

/** The `servers` of a model-servers/resolve answer, validated: a malformed
 * server is dropped, never the whole answer. */
export function parseModelServers(body: unknown): ModelServer[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const servers = (body as Record<string, unknown>).servers;
  if (!Array.isArray(servers)) return [];
  const out: ModelServer[] = [];
  const seen = new Set<string>();
  for (const raw of servers.slice(0, MAX_SERVERS)) {
    const server = parseServer(raw);
    if (!server) continue;
    const provider = modelServerProvider(server);
    if (seen.has(provider)) continue;
    seen.add(provider);
    out.push(server);
  }
  return out;
}

/** The pi provider of a server: the organization's and a person's own never
 * collide even when they share an id. */
export function modelServerProvider(server: Pick<ModelServer, "instanceId" | "scope">): string {
  return `${MODEL_SERVER_PROVIDER_PREFIX}${server.scope === "personal" ? "own" : "org"}-${server.instanceId}`;
}

/** `SAGAX_PI_KEY_<PROVIDER>`, upper case, every other character `_`. */
export function modelServerKeyEnv(server: Pick<ModelServer, "instanceId" | "scope">): string {
  return `${MODEL_SERVER_KEY_ENV_PREFIX}${modelServerProvider(server).slice(MODEL_SERVER_PROVIDER_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** Whether a pi provider id is a model server's. */
export function isModelServerProvider(provider: string): boolean {
  return /^px-(org|own)-[a-z0-9][a-z0-9-]*$/.test(provider);
}

/** Split resolved servers into what a turn carries: the keys, for the pi
 * process environment only, and the servers without them. */
export function modelServerAccess(servers: readonly ModelServer[]): { environment: Record<string, string>; servers: PiModelServer[] } {
  const environment: Record<string, string> = {};
  const meta: PiModelServer[] = [];
  for (const { apiKey, ...server } of servers) {
    const keyEnv = modelServerKeyEnv(server);
    // pi needs a key value to list a provider; an open endpoint takes any.
    environment[keyEnv] = apiKey || "none";
    meta.push({ ...server, provider: modelServerProvider(server), keyEnv });
  }
  return { environment, servers: meta };
}

/** One server as a pi models.json provider (pi docs, models.md). */
export function piProviderEntry(server: PiModelServer): Record<string, unknown> {
  return {
    baseUrl: server.url,
    api: server.protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
    apiKey: `$${server.keyEnv}`,
    compat: { supportsDeveloperRole: false },
    models: server.models.map((model) => ({
      id: model.id,
      name: model.label,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    })),
  };
}

function readModelsJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return { providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Write a person's model servers into the models.json of their pi home:
 * every model-server provider is replaced by the current list (one removed
 * in Perspicax leaves at the next turn), every other provider (a local
 * host, one the person added) is kept. A malformed file is left alone.
 * Returns whether the file now holds the list. */
export function writePiModelServers(dir: string, servers: readonly PiModelServer[]): boolean {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "models.json");
  const root = readModelsJson(path);
  if (!root) return false;
  const previous = root.providers && typeof root.providers === "object" && !Array.isArray(root.providers) ? root.providers as Record<string, unknown> : {};
  const providers: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(previous)) if (!isModelServerProvider(id)) providers[id] = entry;
  for (const server of servers) providers[server.provider] = piProviderEntry(server);
  const before = JSON.stringify(root.providers ?? {});
  if (before === JSON.stringify(providers) && existsSync(path)) return true;
  root.providers = providers;
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX modes.
  }
  return true;
}

/** A pi thinking level as the picker's effort level (none for off; minimal
 * has no picker level of its own). */
export function effortOfPiLevel(level: PiThinkingLevel): EffortLevel | null {
  if (level === "off") return "none";
  if (level === "minimal") return null;
  return level;
}

/** The effort levels the picker offers for one model: the levels its map
 * gives a value, in pi's order; [] for a model without reasoning; absent
 * (the driver's own levels) when nothing says. */
export function modelServerEffort(model: ModelServerModel): { effortLevels?: EffortLevel[]; defaultEffort?: EffortLevel } {
  if (!model.reasoning) return { effortLevels: [] };
  const out: { effortLevels?: EffortLevel[]; defaultEffort?: EffortLevel } = {};
  if (model.thinkingLevelMap) {
    const levels: EffortLevel[] = [];
    for (const level of PI_THINKING_LEVELS) {
      if (model.thinkingLevelMap[level] === undefined || model.thinkingLevelMap[level] === null) continue;
      const effort = effortOfPiLevel(level);
      if (effort && !levels.includes(effort)) levels.push(effort);
    }
    out.effortLevels = levels;
  }
  if (model.defaultThinkingLevel) {
    const effort = effortOfPiLevel(model.defaultThinkingLevel);
    if (effort && (!out.effortLevels || out.effortLevels.includes(effort))) out.defaultEffort = effort;
  }
  return out;
}

export interface ModelServerOption {
  id: string;
  label: string;
  custom: true;
  provider: string;
  server: string;
  contextWindow: number;
  effortLevels?: EffortLevel[];
  defaultEffort?: EffortLevel;
}

/** The picker rows of a person's model servers, as pi names them
 * (`<provider>/<model>`). */
export function modelServerOptions(servers: readonly Pick<PiModelServer, "provider" | "name" | "models">[]): ModelServerOption[] {
  return servers.flatMap((server) => server.models.map((model) => ({
    id: `${server.provider}/${model.id}`,
    label: model.label,
    custom: true as const,
    provider: server.provider,
    server: server.name,
    contextWindow: model.contextWindow,
    ...modelServerEffort(model),
  })));
}

/** A pi engine's catalog with one viewer's model-server rows: the rows of
 * any earlier overlay are replaced, every other row kept. */
export function overlayModelServers<T extends { driverKind?: string; models: { default: string; options: Array<{ id: string }> } }>(instances: T[], servers: readonly PiModelServer[]): T[] {
  const rows = modelServerOptions(servers);
  return instances.map((instance) => {
    if (instance.driverKind !== "piAgent") return instance;
    const options = instance.models.options.filter((option) => !isModelServerProvider(option.id.split("/")[0] ?? ""));
    return { ...instance, models: { ...instance.models, options: [...options, ...rows] } };
  });
}
