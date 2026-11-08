// Named OpenAI-compatible servers (2026-10-30, lot 0 of "Providers, models
// and voice"). Until now one address served every "Other (OpenAI-compatible)"
// turn (`openaiCompat.url`); a second server meant editing config.json by
// hand. Each server added here is an engine of its own: an `openai-compat`
// instance `compat-<id>` with its name and address in `instances`, its key
// in `openaiCompatServers` (config.ts), handed to that one instance as
// SAGAX_COMPAT_SERVER_API_KEY and never the workspace's other keys. The
// built-in "Other (OpenAI-compatible)" stays as it was. Pure: the routes in
// server/index.ts persist and reload.
//
// On an organization server (#2054): a server with `ownerPrincipalId` is that
// person's own (they add, edit and remove it; other members never see it). A
// server without an owner is org-wide (shared): only an organization admin
// changes it. Solo servers keep the earlier "anyone who can reach the route"
// behaviour.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { stripOpenAiEndpointSuffix } from "../shared/openai-compat-url.ts";
import { COMPAT_SERVER_KEY_ENV, COMPAT_SERVER_PREFIX, isCompatServerId, type AppConfig } from "./config.ts";

type Instances = NonNullable<AppConfig["instances"]>;
type Keys = NonNullable<AppConfig["openaiCompatServers"]>;
type KeyRecord = NonNullable<Keys[string]>;

/** An address the server may call: https anywhere, http only on this machine
 * or a private network (a local vLLM, Ollama, LM Studio). */
export function serverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local") || host.endsWith(".internal");
  } catch {
    return false;
  }
}

const name = z.string().trim().min(1).max(80);
const address = z.string().trim().max(500).refine(serverUrl, "an https address, or http on this machine or a private network");
const key = z.string().trim().max(512);

export const newCompatServerSchema = z.object({ displayName: name, url: address, key: key.optional(), model: z.string().trim().max(200).optional() }).strict();
/** `key: ""` removes the key; absent keeps it. */
export const editCompatServerSchema = z.object({ displayName: name.optional(), url: address.optional(), key: key.optional() }).strict()
  .refine((body) => Object.keys(body).length > 0, "nothing to change");

export type NewCompatServer = z.infer<typeof newCompatServerSchema>;
export type EditCompatServer = z.infer<typeof editCompatServerSchema>;

/** One named server as Settings lists it: never its key. */
export interface CompatServerView {
  instanceId: string;
  name: string;
  url: string;
  configured: boolean;
}

/** Who may see which named servers on an organization server. */
export interface CompatServerViewer {
  /** Normalized principal id, or null when unknown. */
  principalId: string | null;
  /** Organization admin (or solo): sees every server. */
  admin: boolean;
}

/** The person who owns this named server, or null when it is org-wide. */
export function compatServerOwner(keys: AppConfig["openaiCompatServers"], instanceId: string): string | null {
  const owner = keys?.[instanceId]?.ownerPrincipalId?.trim().toLowerCase();
  return owner || null;
}

/** Whether this viewer may change the named server (or create one). */
export function canManageCompatServer(input: {
  admin: boolean;
  principalId: string | null;
  /** Null when creating: a member stamps themselves, an admin creates org-wide. */
  owner: string | null | undefined;
}): boolean {
  if (input.owner === undefined) {
    return input.admin || Boolean(input.principalId);
  }
  if (!input.owner) return input.admin;
  return Boolean(input.principalId) && input.owner === input.principalId;
}

/** Whether this viewer may see the named server in Settings / the picker. */
export function compatServerVisible(owner: string | null, viewer: CompatServerViewer): boolean {
  if (viewer.admin || !owner) return true;
  return Boolean(viewer.principalId) && owner === viewer.principalId;
}

/** The named servers of this configuration, in the order they were added.
 * Pass `viewer` on an organization server to keep person isolation. */
export function compatServers(
  cfg: Pick<AppConfig, "instances" | "openaiCompatServers">,
  viewer?: CompatServerViewer,
): CompatServerView[] {
  return Object.entries(cfg.instances ?? {})
    .filter(([id, entry]) => isCompatServerId(id) && entry.driver === "openai-compat")
    .filter(([id]) => !viewer || compatServerVisible(compatServerOwner(cfg.openaiCompatServers, id), viewer))
    .map(([id, entry]) => ({
      instanceId: id,
      name: entry.displayName?.trim() || id,
      url: String((entry.config as { url?: unknown } | undefined)?.url ?? ""),
      configured: Boolean(cfg.openaiCompatServers?.[id]?.key),
    }));
}

/** A pasted endpoint (".../v1/chat/completions") is kept as its base: the
 * driver appends /chat/completions and /models itself (shared helper). */
export function strippedUrl(url: string): string {
  return stripOpenAiEndpointSuffix(url);
}

function keyRecord(base: KeyRecord | undefined, patch: { key?: string | null; ownerPrincipalId?: string | null }): KeyRecord {
  const next: KeyRecord = { ...base };
  if (patch.key !== undefined) {
    if (patch.key) next.key = patch.key;
    else delete next.key;
  }
  if (patch.ownerPrincipalId !== undefined) {
    if (patch.ownerPrincipalId) next.ownerPrincipalId = patch.ownerPrincipalId;
    else delete next.ownerPrincipalId;
  }
  return next;
}

/** A new named server: its instance and its key record. */
export function addCompatServer(
  instances: Instances,
  keys: AppConfig["openaiCompatServers"],
  input: NewCompatServer,
  id: () => string = () => randomUUID().replace(/-/g, "").slice(0, 12),
  ownerPrincipalId?: string | null,
): { instanceId: string; instances: Instances; keys: Keys } {
  const instanceId = `${COMPAT_SERVER_PREFIX}${id()}`;
  const config: Record<string, unknown> = { url: strippedUrl(input.url), apiKeyEnv: COMPAT_SERVER_KEY_ENV };
  if (input.model) config.model = input.model;
  return {
    instanceId,
    instances: { ...instances, [instanceId]: { driver: "openai-compat", displayName: input.displayName.trim(), config } },
    keys: {
      ...keys,
      [instanceId]: keyRecord(undefined, {
        key: input.key ?? null,
        ownerPrincipalId: ownerPrincipalId ?? null,
      }),
    },
  };
}

/** A named server renamed, moved or given another key. Null: not one. */
export function editCompatServer(
  instances: Instances,
  keys: AppConfig["openaiCompatServers"],
  instanceId: string,
  input: EditCompatServer,
): { instances: Instances; keys: Keys } | null {
  const entry = instances[instanceId];
  if (!isCompatServerId(instanceId) || !entry || entry.driver !== "openai-compat") return null;
  const config = { ...(entry.config as Record<string, unknown> | undefined) };
  if (input.url !== undefined) config.url = strippedUrl(input.url);
  config.apiKeyEnv = COMPAT_SERVER_KEY_ENV;
  const next = { ...entry, config, ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}) };
  const record = keyRecord(keys?.[instanceId], input.key !== undefined ? { key: input.key || null } : {});
  return { instances: { ...instances, [instanceId]: next }, keys: { ...keys, [instanceId]: record } };
}

/** A named server removed, its key with it. Null: not one. */
export function removeCompatServer(
  instances: Instances,
  keys: AppConfig["openaiCompatServers"],
  instanceId: string,
): { instances: Instances; keys: Keys } | null {
  const entry = instances[instanceId];
  if (!isCompatServerId(instanceId) || !entry || entry.driver !== "openai-compat") return null;
  const { [instanceId]: _removed, ...rest } = instances;
  const { [instanceId]: _key, ...restKeys } = keys ?? {};
  return { instances: rest, keys: restKeys };
}
