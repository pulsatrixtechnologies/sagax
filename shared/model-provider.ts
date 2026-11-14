// #4329 lot 0: where a model comes from, said once. For any engine instance
// and any row of its catalogue: the provider it belongs to (who gives the
// models), the provider's label and order, and the model's canonical id, so
// one model offered by several engines is one model. Pure: the menu,
// Settings > Providers, Active models, the model window and the phone all
// read this, through shared/provider-catalog.ts.
//
// Rules:
// - a vendor's tool or a vendor's API instance belongs to its vendor;
// - a row of pi or OpenCode belongs to the vendor named before the slash of
//   its id (OpenCode's own subscription models stay "OpenCode");
// - a server added by address is a provider under the name the person gave it;
// - a `host::model` row is "This computer".
import { keyProvidersOfDriver } from "./harness-matrix.ts";
import { isModelServerProvider } from "./model-server-option.ts";
import { PERSONAL_PROVIDER_NAMES } from "./provider-accounts.ts";

/** The label of the xAI group (its models, its tool, its key and the link
 * to the person's bots in its bot app). One constant: the owner's word. */
export const XAI_GROUP_LABEL = "SpaceXAI";

/** The provider of this computer's models. */
export const COMPUTER_PROVIDER_ID = "computer";
export const COMPUTER_PROVIDER_LABEL = "This computer";

/** A model of a multi-vendor engine with no vendor in its id. */
export const OTHER_PROVIDER_ID = "other";
export const OTHER_PROVIDER_LABEL = "Other models";

export type ProviderKind = "vendor" | "server" | "computer" | "other";

export interface ProviderRef {
  /** Stable, never shown: a vendor id ("anthropic"), `server:<id>`, "computer" or "other". */
  id: string;
  label: string;
  kind: ProviderKind;
}

/** The name a person knows a vendor by: its models (Claude, Gemini, Kimi),
 * else the company. */
const VENDOR_LABEL: Readonly<Record<string, string>> = {
  ...PERSONAL_PROVIDER_NAMES,
  anthropic: "Claude",
  xai: XAI_GROUP_LABEL,
  google: "Gemini",
  moonshot: "Kimi",
  kimi: "Kimi Coding",
  meta: "Meta",
  github: "GitHub Copilot",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  cline: "Cline",
};

/** Tools whose vendor no key pays (the key table names the rest). */
const TOOL_VENDOR: Readonly<Record<string, string>> = {
  antigravityAgent: "google",
  copilotAgent: "github",
  qwenAgent: "qwen",
  deepseekAgent: "deepseek",
  clineAgent: "cline",
  museCode: "meta",
  meta: "meta",
};

/** Engines whose rows come from many vendors: each row lands under the
 * vendor before the slash of its id. The value is the engine's own vendor,
 * for rows that name none (OpenCode's own subscription). */
const SPLIT_ENGINES: Readonly<Record<string, string | null>> = {
  piAgent: null,
  opencodeGo: "opencode",
};

/** The engines' own names for a vendor (the part before "/" in a pi or
 * OpenCode model id) that are not the vendor's id. */
export const ENGINE_VENDOR_ALIAS: Readonly<Record<string, string>> = {
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  "kimi-coding": "kimi",
  "opencode-go": "opencode",
};

/** The built-in OpenAI protocol instances that are one vendor each. */
const VENDOR_API_INSTANCE: Readonly<Record<string, string>> = { openai: "openai", openrouter: "openrouter" };

export function vendorLabel(vendor: string): string {
  return VENDOR_LABEL[vendor] ?? vendor;
}

/** A vendor's provider reference. */
export function vendorProvider(vendor: string): ProviderRef {
  return { id: vendor, label: vendorLabel(vendor), kind: "vendor" };
}

/** The vendor behind an engine's own name for it ("moonshotai" is "moonshot"). */
export function vendorOfEngineName(name: string | undefined): string | null {
  const value = name?.trim().toLowerCase() ?? "";
  if (!value) return null;
  return ENGINE_VENDOR_ALIAS[value] ?? value;
}

/** Whether an engine's rows are split across vendors (pi, OpenCode). */
export function splitEngine(driverKind: string): boolean {
  return Object.hasOwn(SPLIT_ENGINES, driverKind);
}

/** The vendor of a driver that serves one vendor, or undefined for an
 * engine whose vendor depends on the instance or the row. */
export function vendorOfDriver(driverKind: string): string | undefined {
  if (splitEngine(driverKind) || driverKind === "openai-compat") return undefined;
  return TOOL_VENDOR[driverKind] ?? keyProvidersOfDriver(driverKind)[0];
}

export interface ProviderInstanceFacts {
  instanceId: string;
  driverKind: string;
  displayName: string;
  /** A server the person added (GET /api/me/providers servers). */
  providerAccount?: { provider?: string; serverId: string };
}

export interface ProviderModelFacts {
  id: string;
  local?: boolean;
  /** The engine's own provider name for the row (pi). */
  provider?: string;
  /** A model server's name (pi's model servers). */
  server?: string;
  custom?: boolean;
}

/**
 * The provider an instance belongs to, or null for an engine with no vendor
 * of its own (pi): each of its rows lands under its vendor instead.
 */
export function providerOfInstance(instance: ProviderInstanceFacts): ProviderRef | null {
  if (instance.providerAccount?.serverId) return { id: `server:${instance.providerAccount.serverId}`, label: instance.displayName, kind: "server" };
  if (instance.driverKind === "openai-compat") {
    const vendor = VENDOR_API_INSTANCE[instance.instanceId];
    return vendor ? vendorProvider(vendor) : { id: `server:${instance.instanceId}`, label: instance.displayName, kind: "server" };
  }
  if (splitEngine(instance.driverKind)) {
    const home = SPLIT_ENGINES[instance.driverKind];
    return home ? vendorProvider(home) : null;
  }
  const vendor = vendorOfDriver(instance.driverKind);
  return vendor ? vendorProvider(vendor) : { id: `engine:${instance.instanceId}`, label: instance.displayName, kind: "other" };
}

/** A `host::model` row, or one the engine marks local. */
export function isComputerModel(option: Pick<ProviderModelFacts, "id" | "local">): boolean {
  return option.local === true || option.id.includes("::");
}

function vendorHead(instance: ProviderInstanceFacts, option: ProviderModelFacts): string | null {
  if (!splitEngine(instance.driverKind)) return null;
  const slash = option.id.indexOf("/");
  if (slash <= 0) return null;
  return option.id.slice(0, slash);
}

/** The provider one catalogue row belongs to. */
export function providerOfModel(instance: ProviderInstanceFacts, option: ProviderModelFacts): ProviderRef {
  if (isComputerModel(option)) return { id: COMPUTER_PROVIDER_ID, label: COMPUTER_PROVIDER_LABEL, kind: "computer" };
  const head = vendorHead(instance, option);
  if (head) {
    if (option.custom && isModelServerProvider(head)) return { id: `server:${head}`, label: option.server?.trim() || head.replace(/^px-(org|own)-/, ""), kind: "server" };
    return vendorProvider(vendorOfEngineName(head)!);
  }
  return providerOfInstance(instance) ?? { id: OTHER_PROVIDER_ID, label: OTHER_PROVIDER_LABEL, kind: "other" };
}

/**
 * The model's id with the engine's own vendor prefix taken off, so the same
 * model reads the same under every engine that lists it: Claude's tool lists
 * "claude-opus-5", pi lists "anthropic/claude-opus-5". Nothing else is
 * guessed: two ids that differ otherwise are two models, each kept with the
 * engines that list it. A model of this computer keeps its host.
 */
export function canonicalModelId(instance: ProviderInstanceFacts, option: ProviderModelFacts): string {
  if (isComputerModel(option)) return option.id;
  const head = vendorHead(instance, option);
  const bare = head ? option.id.slice(head.length + 1) : option.id;
  return bare.trim().toLowerCase();
}

/** The fixed head of the signed-in accounts, in this order. */
const ACCOUNT_HEAD = ["anthropic", "openai", "xai"] as const;

/** Provider order: rank of the connection kind first (accounts, keys,
 * servers, other, this computer), Claude, OpenAI and the xAI group heading
 * the accounts, then by label. */
export function compareProviders(
  a: { id: string; label: string; rank: number },
  b: { id: string; label: string; rank: number },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const head = (id: string) => {
    const at = (ACCOUNT_HEAD as readonly string[]).indexOf(id);
    return at < 0 ? ACCOUNT_HEAD.length : at;
  };
  return head(a.id) - head(b.id) || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
