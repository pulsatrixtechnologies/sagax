// POST /api/internal/send-meme: bot tool send_meme (#2121).
// Searches with the person's sealed key, downloads one hit, posts it into
// the current chat. The key never appears in the request, answer, or error.
import {
  MEME_CAPTION_MAX,
  MEME_QUERY_MAX,
  type MemeAttachmentMeta,
} from "../../shared/memes.ts";
import { saveImage } from "../attachments/attachments.ts";
import { downloadMemeBytes, MemeProviderError, searchMemes, type MemeFetch } from "../memes/providers.ts";
import { readyConfig, type MemeConfig } from "../memes/store.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const SEND_MEME_INTERNAL_PATH = "/api/internal/send-meme";

export interface SendMemeInternalDeps {
  config(capability: InternalCapabilityView): MemeConfig | null;
  /** When false, the bot's "Meme replies" setting is Off. */
  memeRepliesEnabled(capability: InternalCapabilityView): boolean;
  appendMeme(capability: InternalCapabilityView, attachment: {
    kind: "image";
    path: string;
    mime: string;
    name?: string;
    meme: MemeAttachmentMeta;
  }, caption?: string): void;
  fetch?: MemeFetch;
}

export function createSendMemeInternalRoutes(deps: SendMemeInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === SEND_MEME_INTERNAL_PATH)) return PASS;
    if (!deps.memeRepliesEnabled(capability)) {
      return json(res, 403, { error: "Meme replies are off for this bot." });
    }
    const body = await readBody();
    const query = typeof body.query === "string" ? body.query.replace(/\s+/g, " ").trim().slice(0, MEME_QUERY_MAX) : "";
    if (!query) return json(res, 400, { error: "query: what meme to look for." });
    const caption = typeof body.caption === "string"
      ? body.caption.replace(/\s+/g, " ").trim().slice(0, MEME_CAPTION_MAX)
      : "";
    const config = deps.config(capability);
    if (!config || !readyConfig(config)) {
      return json(res, 404, {
        error: "No meme provider is set up. Add a Tenor or GIPHY key in Settings > Providers > Memes.",
      });
    }
    try {
      const { hits } = await searchMemes(config, query, {
        limit: 8,
        includeImgflip: true,
        fetch: deps.fetch,
      });
      const hit = hits[0];
      if (!hit) return json(res, 404, { error: `No meme found for "${query}".` });
      const { bytes, mime } = await downloadMemeBytes(hit.url, { fetch: deps.fetch });
      const saved = saveImage(bytes, mime);
      const meme: MemeAttachmentMeta = {
        provider: hit.provider,
        attribution: hit.attribution,
        ...(caption ? { caption } : {}),
        sourceId: hit.id,
      };
      const attachment = {
        kind: "image" as const,
        path: saved.path,
        mime: saved.mime,
        name: `${hit.title.replace(/[^\w.-]+/g, "_").slice(0, 40) || "meme"}.gif`,
        meme,
      };
      deps.appendMeme(capability, attachment, caption || undefined);
      const text = caption
        ? `Sent a meme for "${query}" with caption "${caption}" (${hit.attribution}).`
        : `Sent a meme for "${query}" (${hit.attribution}).`;
      return json(res, 200, { ok: true, text, title: hit.title, attribution: hit.attribution });
    } catch (error) {
      if (error instanceof MemeProviderError) {
        return json(res, error.code === "no_key" ? 400 : 502, { error: error.message, code: error.code });
      }
      return json(res, 502, { error: "Could not send that meme." });
    }
  };
}
