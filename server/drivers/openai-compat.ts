// Transcript-replay driver for OpenRouter, Groq, Together, llama.cpp, and
// other endpoints that speak the OpenAI chat-completions contract.
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { publishedContextWindow } from "../pages/published-context-window.ts";
import { refusedModelsStore } from "../models/refused-models.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";
import { anthropicTransport } from "./anthropic-compat.ts";
import { currentEnvName, readEnvName } from "../../electron/legacy-names.mjs";
import {
  azureDeploymentLabel,
  azureDeployments,
  azureOpenAIEndpoint,
  looksLikeAzureUrl,
  type ModelListIssue,
} from "../../shared/azure-openai.ts";
import { stripOpenAiEndpointSuffix } from "../../shared/openai-compat-url.ts";

const DRIVER_KIND = "openai-compat";
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const idleTimeoutMs = () => {
  const raw = process.env.SAGAX_OPENAI_COMPAT_IDLE_TIMEOUT_MS;
  if (!raw) return DEFAULT_IDLE_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 2_147_483_647 ? value : DEFAULT_IDLE_TIMEOUT_MS;
};
const DEFAULT_MODELS: ModelCatalog = {
  default: "meta-llama/llama-3.3-70b-instruct",
  options: [
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (OpenRouter)", custom: true },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)", custom: true },
  ],
};

const DEFAULT_KEY_ENV = "OPENAI_COMPAT_API_KEY";
/** A provider's own key (the built-in OpenAI and OpenRouter instances, and
 * a named OpenAI-compatible server added from the app, 2026-10-30). An
 * instance reading one of these never falls back to the workspace
 * OpenAI-compatible key, URL, model or routing. */
const OWN_KEY_ENVS = new Set(["SAGAX_OPENAI_API_KEY", "SAGAX_OPENROUTER_API_KEY", "SAGAX_COMPAT_SERVER_API_KEY"]);

/** OpenAI's own API, seeded until its live catalog loads. */
const OPENAI_MODELS: ModelCatalog = {
  default: "gpt-5",
  options: [
    { id: "gpt-5", label: "gpt-5" },
    { id: "gpt-5-mini", label: "gpt-5-mini" },
  ],
};

/** OpenAI's /models lists every model the key can reach: embeddings, speech,
 * images, moderation, completion-only and realtime models too. A bot's
 * engine needs a conversation model that takes tools, so only the chat and
 * reasoning families are kept (an allow list by family, never the raw
 * list): gpt-4 and later, and the o-series. Audio, realtime and speech
 * models belong to the voice settings, not to this picker. */
export function isOpenAIChatModel(id: string): boolean {
  if (!/^(?:gpt-(?:[4-9]|\d{2,})|o[1-9]\d*(?:-|$))/i.test(id)) return false;
  // chatgpt-* and o1-mini / o1-preview take no tools; gpt-4-32k and the
  // dated gpt-4-0314 / 0613 snapshots are retired completion-era models.
  if (/^o1-(?:mini|preview)\b|^gpt-4-(?:32k|0314|0613|vision)/i.test(id)) return false;
  return !/(audio|realtime|tts|transcribe|diarize|search|image|embedding|moderation|instruct|codex|computer-use|deep-research|-pro\b|whisper|dall-e|davinci|babbage|-oss\b)/i.test(id);
}

/** OpenAI's reasoning models: the o-series and gpt-5 on, except the
 * gpt-5-chat aliases. Only these take `reasoning.effort`. */
export function isOpenAIReasoningModel(id: string): boolean {
  if (/-chat\b/i.test(id)) return false;
  return /^(?:o[1-9]\d*(?:-|$)|gpt-(?:[5-9]|\d{2,}))/i.test(id);
}

/** Effort levels OpenAI's reasoning models take as `reasoning.effort`. */
const OPENAI_EFFORT_LEVELS = ["low", "medium", "high"] as const;

/** Why a GET of the endpoint's list failed, in the picker's words. */
function issueForStatus(status: number, azure: boolean): ModelListIssue | undefined {
  if (status === 401 || status === 403) return "key-refused";
  if (status === 404 || status === 400) return azure ? "azure-bad-url" : "bad-url";
  return undefined;
}

/** A fetch that never reached the host: a name that does not resolve is a
 * wrong address, anything else is the network. */
function issueForError(error: unknown, azure: boolean): ModelListIssue {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_NONAME") return azure ? "azure-bad-url" : "bad-url";
  return "unreachable";
}

export interface OpenAICompatConfig {
  tools?: boolean;
  url: string;
  /** Where the key comes from; see OWN_KEY_ENVS. */
  apiKeyEnv: string;
  /** "openai": seed and filter the catalog for OpenAI's own API. */
  catalog?: "openai";
  key?: string;
  model?: string;
  provider?: string;
  managedModels?: string[];
  protocol?: "openai" | "anthropic";
  allowNoKey?: boolean;
  personal?: boolean;
  modelNames?: Record<string, string>;
}

function isOpenRouterUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

function decodeConfig(raw: unknown): OpenAICompatConfig {
  const config = { ...((raw ?? {}) as Record<string, unknown>) };
  // A variable saved under its old name (OMB_OPENAI_API_KEY) reads as the new one.
  if (typeof config.apiKeyEnv === "string") config.apiKeyEnv = currentEnvName(config.apiKeyEnv);
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  if (config.protocol !== undefined && config.protocol !== "openai" && config.protocol !== "anthropic") throw new Error("Invalid API protocol.");
  if (config.managedModels !== undefined && (!Array.isArray(config.managedModels) || !config.managedModels.length || config.managedModels.some(model => typeof model !== "string" || !model.trim()))) throw new Error("Invalid managed models.");
  const ownKey = typeof config.apiKeyEnv === "string" && OWN_KEY_ENVS.has(config.apiKeyEnv);
  if (config.catalog !== undefined && config.catalog !== "openai") throw new Error("catalog must be \"openai\"");
  // Workspace defaults belong to the shared OpenAI-compatible connection only.
  const envUrl = ownKey ? undefined : process.env.OPENAI_COMPAT_URL;
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    ...(config.protocol === "anthropic" ? { protocol: "anthropic" as const } : {}),
    ...(config.allowNoKey === true ? { allowNoKey: true } : {}),
    ...(config.personal === true ? { personal: true } : {}),
    ...(config.modelNames && typeof config.modelNames === "object" ? { modelNames: Object.fromEntries(Object.entries(config.modelNames).filter((entry): entry is [string, string] => typeof entry[1] === "string")) } : {}),
    ...(config.managedModels ? { managedModels: config.managedModels as string[] } : {}),
    // Call-time strip: a saved ".../v1/chat/completions" must not become
    // ".../chat/completions/chat/completions" (#2022).
    url: stripOpenAiEndpointSuffix(
      typeof config.url === "string" && config.url ? config.url : envUrl || "https://openrouter.ai/api/v1",
    ),
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv
      ? config.apiKeyEnv
      : DEFAULT_KEY_ENV,
    ...(config.catalog === "openai" ? { catalog: "openai" as const } : {}),
    key: typeof config.key === "string" && config.key ? config.key : undefined,
    model: typeof config.model === "string" && config.model
      ? config.model
      : ownKey ? undefined : process.env.OPENAI_COMPAT_MODEL || undefined,
    // An explicit empty override disables inherited routing for an isolated
    // connection (CLI setup uses this). Absent still inherits the global pin.
    provider: typeof config.provider === "string"
      ? config.provider || undefined
      : ownKey ? undefined : process.env.OPENAI_COMPAT_PROVIDER || undefined,
  };
}

export const OpenAICompatDriver: ProviderDriver<OpenAICompatConfig> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Other (OpenAI-compatible)",
    supportsMultipleInstances: true,
    access: "api",
  },
  models: DEFAULT_MODELS,
  // Nothing to install: the key and base URL are saved in the app. The old
  // descriptor offered a config.json sentence as an "Open install in
  // Terminal" command.
  install: {
    docsUrl: "https://openrouter.ai/keys",
    settings: "connections",
    signInCommand: "Save an OpenAI-compatible API key in Settings → API keys, or set OPENAI_COMPAT_API_KEY on the server.",
  },
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    // An instance that names its own key variable reads only that one: the
    // workspace key (OPENAI_COMPAT_API_KEY) belongs to the workspace's
    // endpoint and must not reach this instance's host.
    const ownKeyVariable = config.apiKeyEnv !== DEFAULT_KEY_ENV;
    const apiKey =
      config.key ??
      readEnvName(config.apiKeyEnv, input.environment) ??
      (ownKeyVariable ? undefined : input.environment[DEFAULT_KEY_ENV]) ??
      readEnvName(config.apiKeyEnv) ??
      (ownKeyVariable ? undefined : process.env[DEFAULT_KEY_ENV]) ??
      "";
    // The default key and the built-in providers' keys are saved in
    // Settings → API keys; any other variable is configured where it was written.
    const missingKey = !ownKeyVariable || OWN_KEY_ENVS.has(config.apiKeyEnv)
      ? "No API key — open Settings → API keys."
      : `no API key — set ${config.apiKeyEnv} or add it to the instance config`;
    const openai = config.catalog === "openai";
    // Azure AI Foundry / Azure OpenAI, whether picked as such or pasted in
    // "Other (OpenAI-compatible)": its v1 base, its `api-key` header, its
    // deployments as the list (shared/azure-openai.ts).
    const azure = openai || config.protocol === "anthropic" ? null : azureOpenAIEndpoint(config.url);
    const azureWrongUrl = !openai && !azure && looksLikeAzureUrl(config.url);
    const apiUrl = azure ? azure.v1 : config.url;
    /** Deployment name → the model under it, when Azure names it. */
    const deployedModel = new Map<string, string>();
    const underlying = (id: string) => deployedModel.get(id) ?? id;
    let issue: ModelListIssue | undefined = azureWrongUrl ? "azure-bad-url" : undefined;
    /** Models OpenAI refused for a conversation (openai-chat.ts): they leave
     * the catalog, so neither the picker nor Auto offers them again. Loaded
     * from the durable store (#1696) so a restart does not retry them. */
    const refused = new Set(refusedModelsStore().refused(input.instanceId));
    const withEffort = (option: ModelCatalog["options"][number]) => openai || azure
      ? { ...option, effortLevels: isOpenAIReasoningModel(underlying(option.id)) ? [...OPENAI_EFFORT_LEVELS] : [] }
      : option;
    // An Azure resource runs only its own deployments: nothing is seeded,
    // the deployment typed by hand (config.model) aside.
    const seeded = config.personal ? { default: "", options: [] } : openai ? { ...OPENAI_MODELS, options: OPENAI_MODELS.options.map(withEffort) }
      : azure || azureWrongUrl ? { default: "", options: [] }
      : DEFAULT_MODELS;
    let catalog: ModelCatalog = config.managedModels
      ? { default: config.managedModels[0], options: config.managedModels.map(id => ({ id, label: id })) }
      : config.model
      ? {
          default: config.model,
          options: seeded.options.some((model) => model.id === config.model)
            ? seeded.options
            // A deployment typed by hand is the resource's own, not a
            // custom model: an organization server lists it to its members.
            : [{ id: config.model, label: config.model, ...(azure ? {} : { custom: true }) }, ...seeded.options],
        }
      : seeded;

    const azureHeaders = (key: string) => ({ "api-key": key });
    const fetchDeployments = async () => {
      if (!azure) return;
      try {
        const response = await fetch(azure.deployments, {
          headers: azureHeaders(apiKey),
          signal: AbortSignal.timeout(8_000),
          redirect: "manual",
        });
        if (!response.ok) {
          issue = issueForStatus(response.status, true) ?? "unreachable";
          return;
        }
        const deployments = azureDeployments(await response.json());
        if (!deployments.length) {
          issue = "azure-no-deployments";
          return;
        }
        issue = undefined;
        deployedModel.clear();
        for (const deployment of deployments) if (deployment.model) deployedModel.set(deployment.id, deployment.model);
        // The resource's own list: not custom, so an organization server
        // offers it to its members and Auto can pick from it.
        const options: ModelCatalog["options"] = deployments.map((deployment) => withEffort({
          id: deployment.id,
          label: azureDeploymentLabel(deployment),
        }));
        if (config.model && !options.some((model) => model.id === config.model)) {
          options.unshift(withEffort({ id: config.model, label: config.model }));
        }
        catalog = { default: config.model ?? options[0]!.id, options };
      } catch (error) {
        issue = issueForError(error, true);
      }
    };

    const fetchModels = async () => {
      if (config.managedModels) return;
      if (!apiKey && !config.allowNoKey) return;
      if (azureWrongUrl) return;
      if (azure) return fetchDeployments();
      try {
        const response = await fetch(`${config.url}/models`, {
          headers: config.protocol === "anthropic" ? { ...(apiKey ? { "x-api-key": apiKey } : {}), "anthropic-version": "2023-06-01" } : apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          redirect: "error",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) {
          issue = issueForStatus(response.status, false);
          return;
        }
        type Row = { id?: unknown; name?: unknown; created?: unknown; endpoints?: unknown };
        const json = await response.json() as { data?: Row[]; models?: Row[] } | Row[];
        let rows = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
        // A private Cohere deployment lists `{ models: [{ name, endpoints }] }`
        // on /v1/models (#2054): the name is the id, chat rows only.
        if (!Array.isArray(json) && !Array.isArray(json.data) && Array.isArray(json.models)) {
          rows = json.models
            .filter((row) => !Array.isArray(row.endpoints) || row.endpoints.includes("chat"))
            .map((row) => (typeof row.id === "string" ? row : { ...row, id: row.name }));
        }
        // OpenAI lists its catalog unordered and mixed with non-chat models:
        // keep chat models, newest first.
        if (config.catalog === "openai") {
          rows = rows
            .filter((row) => typeof row.id === "string" && isOpenAIChatModel(row.id))
            .sort((a, b) => (typeof b.created === "number" ? b.created : 0) - (typeof a.created === "number" ? a.created : 0));
        }
        const seen = new Set<string>();
        const options: ModelCatalog["options"] = [];
        for (const row of rows) {
          const id = typeof row.id === "string" ? row.id : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const published = publishedContextWindow(row);
          options.push(withEffort({
            id,
            label: typeof row.name === "string" && row.name.trim() ? row.name : id,
            // The endpoint's own window wins over the hardcoded table.
            ...(published ? { contextWindow: published } : {}),
            // A provider's own catalog is its official list, not a custom model.
            ...(config.catalog === "openai" || config.personal ? {} : { custom: true }),
          }));
        }
        if (!options.length) return;
        issue = undefined;
        if (config.model && !options.some((model) => model.id === config.model)) {
          options.unshift({ id: config.model, label: config.model, custom: true });
        }
        catalog = { default: config.model ?? options[0].id, options };
      } catch (error) {
        // Catalog refresh is opportunistic; keep the seeded options.
        issue = issueForError(error, false);
      }
    };
    if (apiKey || config.allowNoKey) void fetchModels().catch(() => {});
    const listed = (): ModelCatalog => {
      if (!refused.size) return catalog;
      // Empty is fine: Auto and the host move to another engine (#1696).
      const options = catalog.options.filter((option) => !refused.has(option.id));
      return {
        ...catalog,
        default: options.some((option) => option.id === catalog.default) ? catalog.default : options[0]?.id ?? catalog.default,
        options,
      };
    };
    const models = (): ModelCatalog => {
      const current = listed();
      return { ...current, ...(issue ? { issue } : {}), options: current.options.map((option) => ({ ...option, label: config.modelNames?.[option.id] || option.label })) };
    };

    return createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl,
      allowNoKey: config.allowNoKey,
      ...(config.allowNoKey ? { authHeaders: (key: string): Record<string, string> => key ? (azure ? azureHeaders(key) : { authorization: `Bearer ${key}` }) : {} } : {}),
      ...(config.protocol === "anthropic" ? { chatRequest: anthropicTransport(apiUrl) } : {}),
      ...(azure ? { authHeaders: azureHeaders } : {}),
      tools: config.tools,
      computerUse: true,
      // #1975: honour warmOnly so POST /api/bots/:id/warm mounts MCP ahead
      // of the first HTTP turn (same path CLI engines already use).
      warmSession: true,
      models,
      refreshModels: fetchModels,
      // OpenAI's own API: /responses, where its newer models take tools
      // with reasoning, and a model it refuses gives way to another one.
      ...(openai ? {
        responsesApi: () => true,
        reasoningModel: isOpenAIReasoningModel,
        effortLevels: OPENAI_EFFORT_LEVELS,
        modelFallback: true,
        onModelUnsupported: (model: string) => {
          refused.add(model);
          refusedModelsStore().remember(input.instanceId, model);
        },
      } : {}),
      // Azure serves /responses for the OpenAI models it deploys (#1688);
      // any other deployment, or one /responses refuses, uses chat
      // completions. The deployment's model decides, not its free name.
      ...(azure ? {
        responsesApi: (model: string) => isOpenAIChatModel(underlying(model)),
        reasoningModel: (model: string) => isOpenAIReasoningModel(underlying(model)),
        effortLevels: OPENAI_EFFORT_LEVELS,
      } : {}),
      requestBody: (model, messages, stream) => ({
        model,
        messages,
        stream,
        stream_options: stream ? { include_usage: true } : undefined,
        ...(!azure && config.provider && isOpenRouterUrl(config.url)
          ? { provider: { order: [config.provider], allow_fallbacks: false } }
          : {}),
      }),
      httpErrorLabel: "upstream",
      missingKeyError: missingKey,
      unavailableReason: missingKey,
      timeoutMs: idleTimeoutMs(),
      reasoning: true,
      billing: "metered",
      includeUsageInCompleted: true,
      nativeLog: {
        source: "openai-compat.chat.completions",
        // Tool names are the answer to "did the harness send them?" — the
        // LiteLLM/proxy hop after this point is what drops tools silently,
        // and until now the tee held no record either side could compare.
        outgoing: (_turn, messages, model, tools) => ({
          model,
          messageCount: messages.length,
          tools: tools.map(tool => tool.function.name),
        }),
        incoming: ({ text, reasoning, usage }) => ({
          textLength: text.length,
          reasoningLength: reasoning.length,
          usage,
        }),
      },
    });
  },
};
