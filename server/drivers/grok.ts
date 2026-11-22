// xAI API driver. Grok uses the OpenAI chat-completions wire contract and
// adds the shared transient-failure retry policy.
import { titleCaseModelId, type ModelCatalog, type ProviderDriver } from "../contracts.ts";
import type { EffortLevel } from "../../shared/model-selection.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";
import { reportBackgroundError } from "../background-error.ts";
import { createKeyModelCatalogs } from "../models/key-model-catalogs.ts";
import { imageTransportAllowed } from "./chat-images.ts";
import { currentEnvName, readEnvName } from "../../electron/legacy-names.mjs";

const DRIVER_KIND = "grok";
const DEFAULT_URL = "https://api.x.ai/v1";
/** Fallback only, for when the account's own list cannot be read (no key,
 * xAI down, a malformed answer): the live list (`xaiModelCatalog`) replaces
 * it per key, so two keys can list different models. */
/** Levels Grok 4.6 and later take. grok-4.5 stops at high. Older chat
 * models are left without a level: the HTTP API rejects reasoning_effort
 * on a model that does not reason. */
const GROK_HTTP_EFFORT = ["low", "medium", "high", "xhigh"] as const satisfies readonly EffortLevel[];

export function grokHttpEffortFor(id: string): { effortLevels: EffortLevel[]; defaultEffort: "high" } | undefined {
  if (/^grok-4\.5(?:[^0-9]|$)/.test(id)) return { effortLevels: ["low", "medium", "high"], defaultEffort: "high" };
  if (/^grok-4\.(?:[6-9]|\d{2,})/.test(id) || /^grok-[5-9]/.test(id)) return { effortLevels: [...GROK_HTTP_EFFORT], defaultEffort: "high" };
  return undefined;
}

/** The level a Grok HTTP chat call sends. A model with no levels sends
 * nothing. A level that model takes is sent as asked; anything else is
 * the model's default, so an unset chat turn still names high. */
export function grokHttpReasoningEffort(model: string, effort: EffortLevel | undefined): EffortLevel | undefined {
  const facts = grokHttpEffortFor(model);
  if (!facts) return undefined;
  if (effort && facts.effortLevels.includes(effort)) return effort;
  return facts.defaultEffort;
}

const withHttpEffort = <T extends { id: string; effortLevels?: EffortLevel[]; defaultEffort?: EffortLevel }>(option: T): T => {
  const facts = option.effortLevels ? undefined : grokHttpEffortFor(option.id);
  return facts ? { ...option, ...facts } : option;
};

const MODELS: ModelCatalog = {
  default: "grok-4.7",
  options: [
    withHttpEffort({ id: "grok-4.7", label: "Grok 4.7", contextWindow: 500_000 }),
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-4-fast", label: "Grok 4 Fast" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
  ],
};

/** 2026-10-28: the xAI models that read images (Grok 4 and later, and any
 * vision model). The others keep the browser and computer tools, whose page
 * reads and snapshots are text, and never receive a screenshot. */
export function grokSeesImages(model: string): boolean {
  return /^grok-(?:[4-9]|\d{2,})/i.test(model) || /vision/i.test(model);
}

/** The cheap model for background text, when the account offers it. */
const GENERATE_MODEL = "grok-3-mini";
/** /v1/models names image, video and speech models too; none answers a chat turn. */
const NON_CHAT_MODELS = /imagine|image|video|tts|speech|embed/i;

/** One row of xAI's `GET /v1/language-models` (or of `GET /v1/models`, which
 * carries only the id). Aliases are other ids xAI answers for the same model. */
export interface XaiModelRow {
  id: string;
  aliases?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
}

/** A readable name for an id the written list does not know:
 * "grok-4-1-fast-reasoning" reads "Grok 4.1 Fast Reasoning". */
export function xaiModelLabel(id: string): string {
  return titleCaseModelId(id.replace(/(?<=(?:^|-)\d)-(?=\d(?:-|$))/g, "."), /[-_\s]+/);
}

/** The catalog of what the key really offers: each chat model once, under
 * the written id when the written list knows it (directly or as an alias,
 * so a bot saved on "grok-4" keeps its model) and its readable name.
 * `images` gets the models whose input modalities xAI listed: true when
 * they include image, false otherwise; a model xAI said nothing about is
 * left out (unknown), never guessed. Null when nothing usable was listed. */
export function xaiModelCatalog(rows: readonly XaiModelRow[], images?: Map<string, boolean>): ModelCatalog | null {
  const written = new Map(MODELS.options.map((option) => [option.id, option]));
  const options: ModelCatalog["options"] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id.trim();
    if (!id || NON_CHAT_MODELS.test(id)) continue;
    if (row.output_modalities && !row.output_modalities.includes("text")) continue;
    const names = [id, ...(row.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)];
    const known = names.map((name) => written.get(name)).find(Boolean);
    const option = withHttpEffort(known ? { ...known } : { id, label: xaiModelLabel(id) });
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
    if (images && row.input_modalities) images.set(option.id, row.input_modalities.includes("image"));
  }
  if (!options.length) return null;
  return { default: seen.has(MODELS.default) ? MODELS.default : options[0].id, options };
}

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

function xaiRows(list: unknown): XaiModelRow[] | null {
  if (!Array.isArray(list)) return null;
  const rows: XaiModelRow[] = [];
  for (const entry of list) {
    const row = entry as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string") continue;
    const aliases = stringList(row.aliases);
    const input = stringList(row.input_modalities);
    const output = stringList(row.output_modalities);
    rows.push({ id: row.id, ...(aliases ? { aliases } : {}), ...(input ? { input_modalities: input } : {}), ...(output ? { output_modalities: output } : {}) });
  }
  return rows;
}

/** One read of what `key`'s account offers: language-models lists the chat
 * models with their modalities and aliases; an endpoint without it answers
 * the plain model list. Null when nothing usable came back. */
export async function readXaiCatalog(url: string, key: string, images: Map<string, boolean>): Promise<ModelCatalog | null> {
  const lookup = async (path: string): Promise<unknown> => {
    const response = await fetch(`${url}${path}`, {
      headers: { authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? await response.json() : null;
  };
  const rich = xaiRows(((await lookup("/language-models").catch(() => null)) as { models?: unknown } | null)?.models);
  const rows = rich ?? xaiRows(((await lookup("/models")) as { data?: unknown } | null)?.data);
  const listed = new Map<string, boolean>();
  const next = rows && xaiModelCatalog(rows, listed);
  if (next) for (const [model, sees] of listed) images.set(model, sees);
  return next || null;
}

export interface GrokConfig {
  tools?: boolean;
  url: string;
  apiKeyEnv: string;
}

function decodeConfig(raw: unknown): GrokConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    url: typeof config.url === "string" ? config.url : DEFAULT_URL,
    apiKeyEnv: typeof config.apiKeyEnv === "string" ? currentEnvName(config.apiKeyEnv) : "XAI_API_KEY",
  };
}

export const GrokDriver: ProviderDriver<GrokConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Grok (API)", supportsMultipleInstances: true },
  models: MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    const apiKey = readEnvName(config.apiKeyEnv, input.environment) ?? readEnvName(config.apiKeyEnv) ?? "";
    // #4416: the models this key really offers, read from xAI with no model
    // turn. A failed or empty lookup keeps the last usable catalog (the
    // written list until a lookup succeeds). What a model takes in is the
    // model's, not the account's: one map for every key read here.
    let catalog: ModelCatalog = MODELS;
    const images = new Map<string, boolean>();
    const refreshModels = async () => {
      if (!apiKey) return;
      const next = await readXaiCatalog(config.url, apiKey, images).catch(() => null);
      if (next) catalog = next;
    };
    // Each organization person's own key: its own list (per key, kept).
    const perKey = createKeyModelCatalogs({ fallback: () => MODELS });
    const modelsForKey = (key: string) => perKey.forKey(key, () => readXaiCatalog(config.url, key, images));
    if (apiKey) void refreshModels().catch(reportBackgroundError);
    return createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl: config.url,
      tools: config.tools,
      // 2026-10-28: the browser and the computer through the same tool bridge
      // as the other chat engines, when the endpoint can carry them
      computerUse: imageTransportAllowed(config.url),
      // What xAI listed for the model; else the written rule, as before.
      imageInput: (model) => images.get(model) ?? grokSeesImages(model),
      models: () => catalog, refreshModels, modelsForKey,
      requestBody: (model, messages, stream) => ({ model, messages, stream }),
      chatEffortBody: (model, effort) => {
        const level = grokHttpReasoningEffort(model, effort);
        return level ? { reasoning_effort: level } : {};
      },
      // xAI stores a prompt cache per server. The same conversation id on
      // every turn of a thread routes those turns to one server (docs: x-grok-conv-id).
      conversationHeaders: (threadId) => {
        const id = threadId.replace(/[\r\n]/g, "").trim().slice(0, 128);
        return id ? { "x-grok-conv-id": id } : {};
      },
      effortLevels: GROK_HTTP_EFFORT,
      httpErrorLabel: "xAI",
      missingKeyError: `Save an xAI API key in Settings → API keys, or set ${config.apiKeyEnv}.`,
      unavailableReason: "No xAI API key — open Settings → API keys.",
      timeoutMs: 120_000,
      retryScale: Number(process.env.FAKE_GROK_RETRY_SCALE ?? "1"),
      generateModel: () => catalog.options.some((option) => option.id === GENERATE_MODEL) ? GENERATE_MODEL : catalog.default,
      permissionReview: true,
      warmSession: true,
      nativeLog: {
        source: "xai.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, usage }) => ({ text, usage }),
      },
    });
  },
};
