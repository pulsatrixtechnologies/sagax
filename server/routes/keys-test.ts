// Provider key check: does a pasted or saved key open the provider's door.
// One read-only request from this server; the verdict never carries the
// key. Admin scope by default, like every route not opened to clients.
//
//   POST /api/keys/test   { provider, key?, url? }
import type { AppConfig } from "../config.ts";
import { instanceConfigs } from "../config.ts";
import { noteKeyAccepted, noteKeyRejected } from "../key-rejections.ts";
import {
  allowedProviderTestUrl,
  checkProviderKey,
  PROVIDER_KEY_KINDS,
  providerBaseUrl,
  type ProviderKeyKind,
} from "../engines/provider-key-check.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface KeysTestRouteDeps {
  cfg: () => AppConfig;
  checkProviderKey?: typeof checkProviderKey;
  noteKeyAccepted?: typeof noteKeyAccepted;
  noteKeyRejected?: typeof noteKeyRejected;
}

export function createKeysTestRoutes(deps: KeysTestRouteDeps): RouteHandler {
  const check = deps.checkProviderKey ?? checkProviderKey;
  const accepted = deps.noteKeyAccepted ?? noteKeyAccepted;
  const rejected = deps.noteKeyRejected ?? noteKeyRejected;
  return async ({ req, res, path, method, json, readBody }) => {
    if (!(method === "POST" && path === "/api/keys/test")) return PASS;
    const body = await readBody(req, 8192) as { provider?: unknown; key?: unknown; url?: unknown } | null;
    const provider = body?.provider;
    if (!PROVIDER_KEY_KINDS.includes(provider as ProviderKeyKind)) {
      return json(res, 400, { error: `provider must be one of ${PROVIDER_KEY_KINDS.join(", ")}` });
    }
    const kind = provider as ProviderKeyKind;
    const cfg = deps.cfg();
    const saved = { anthropic: cfg.anthropic, openai: cfg.openai, openrouter: cfg.openrouter, openaiCompat: cfg.openaiCompat, mistral: cfg.mistral, cerebras: cfg.cerebras, groq: cfg.groq, xai: cfg.xai }[kind];
    if (body?.key !== undefined && typeof body.key !== "string") {
      return json(res, 400, { error: "key must be a string" });
    }
    const key = typeof body?.key === "string" ? body.key.trim() : saved?.key?.trim() || "";
    if (!key) return json(res, 400, { error: "No key to test. Paste one or save one first." });
    if (key.length > 512) return json(res, 400, { error: "That does not look like an API key." });
    const savedUrl = saved && "url" in saved ? saved.url : undefined;
    // A URL in the request may only name a server this workspace already
    // knows: the provider's default, its saved URL or an engine's URL.
    let url = savedUrl;
    if (typeof body?.url === "string" && body.url.trim()) {
      const configured = [savedUrl, ...Object.values(instanceConfigs(cfg)).map((entry) => {
        const value = (entry.config as { url?: unknown } | undefined)?.url;
        return typeof value === "string" ? value : undefined;
      })];
      const allowed = allowedProviderTestUrl(kind, body.url, configured);
      if (!allowed) return json(res, 400, { error: "url must be the provider's default address or a server configured on this workspace." });
      url = allowed;
    }
    res.setHeader("cache-control", "no-store");
    const verdict = await check({ provider: kind, key, url });
    // A Test is a real use the person chose: the engines on this key agree
    // with its verdict. Claude runs its key through its CLI, not here.
    if (kind !== "anthropic") {
      const base = providerBaseUrl(kind, url);
      if (verdict.ok) accepted(base, key);
      else if (verdict.reason === "rejected") rejected(base, key);
    }
    return json(res, 200, verdict);
  };
}
